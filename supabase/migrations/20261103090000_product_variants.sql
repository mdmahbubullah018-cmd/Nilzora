-- ---------------------------------------------------------------------------
-- Product attributes, attribute values and variants
--
-- A product either sells as a simple product (its own price and stock, exactly as
-- before) or as a set of variants. For a product with variants the variant is the
-- unit that carries SKU, price and stock; `products.stock_quantity` becomes a
-- derived total kept in step by the trigger below so listings, search and the
-- existing simple-product paths keep working unchanged.
--
-- Order history is never rewritten: `order_items` stores the variant id *and* the
-- rendered label, and the variant's foreign key is `on delete set null`, so a
-- deleted variant leaves the past order intact.
--
-- SQLSTATEs: NZ470 variant_invalid, NZ471 variant_required, NZ472 variant_duplicate.
-- ---------------------------------------------------------------------------

create table public.product_attributes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (char_length(slug) between 1 and 40 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  position integer not null default 0 check (position between 0 and 999),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.product_attributes is
  'Reusable product attributes such as Size, Colour or Material.';

create trigger product_attributes_set_updated_at
before update on public.product_attributes
for each row execute function public.set_updated_at();

create table public.product_attribute_values (
  id uuid primary key default gen_random_uuid(),
  attribute_id uuid not null references public.product_attributes (id) on delete cascade,
  slug text not null
    check (char_length(slug) between 1 and 40 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  value text not null check (char_length(btrim(value)) between 1 and 40),
  position integer not null default 0 check (position between 0 and 999),
  created_at timestamptz not null default now(),
  unique (attribute_id, slug),
  -- Target of the composite key on product_variant_values, which keeps a variant
  -- from pairing a value with an attribute it does not belong to.
  unique (id, attribute_id)
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  sku text not null unique check (sku ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'),
  -- Null means the variant sells at the product price.
  price_minor bigint check (price_minor is null or price_minor between 1 and 1000000000),
  compare_at_price_minor bigint,
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  image_url text check (image_url is null or char_length(image_url) between 1 and 500),
  position integer not null default 0 check (position between 0 and 999),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_compare_at_price
    check (compare_at_price_minor is null
      or (price_minor is not null and compare_at_price_minor > price_minor))
);

comment on column public.product_variants.price_minor is
  'Variant price in poisha; null inherits the product price.';
comment on column public.product_variants.stock_quantity is
  'Units available for this combination. Changed only by the order and stock functions.';

create index product_variants_product_idx on public.product_variants (product_id, position);

create trigger product_variants_set_updated_at
before update on public.product_variants
for each row execute function public.set_updated_at();

create table public.product_variant_values (
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  attribute_id uuid not null,
  attribute_value_id uuid not null,
  primary key (variant_id, attribute_id),
  foreign key (attribute_value_id, attribute_id)
    references public.product_attribute_values (id, attribute_id) on delete restrict
);

create index product_variant_values_value_idx
  on public.product_variant_values (attribute_value_id);

alter table public.product_attributes enable row level security;
alter table public.product_attribute_values enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_variant_values enable row level security;

-- Variants are read through catalog_product_variants() and written only through the
-- admin functions below; the tables themselves have no policies.

-- ---------------------------------------------------------------------------
-- The product's stock total while it has variants. Place_cod_order locks the
-- product row before touching variants, so this recompute is serialised per product.
-- ---------------------------------------------------------------------------

create function private.variants_sync_product_stock()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_product uuid := coalesce(new.product_id, old.product_id);
begin
  update public.products p
  set stock_quantity = coalesce((
    select sum(v.stock_quantity)
    from public.product_variants v
    where v.product_id = v_product and v.is_active
  ), 0)
  where p.id = v_product
    -- A product whose last variant was removed keeps its last total and is a simple
    -- product again; deleting variants must never silently zero sellable stock.
    and exists (select 1 from public.product_variants v where v.product_id = v_product);
  return null;
end;
$$;

create trigger product_variants_sync_stock
after insert or update of stock_quantity, is_active or delete on public.product_variants
for each row execute function private.variants_sync_product_stock();

-- ---------------------------------------------------------------------------
-- A variant's display label, e.g. 'Size: M / Colour: Navy'.
-- ---------------------------------------------------------------------------

create function private.variant_label(p_variant_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select string_agg(a.name || ': ' || av.value, ' / ' order by a.position, av.position)
  from public.product_variant_values pvv
  join public.product_attribute_values av on av.id = pvv.attribute_value_id
  join public.product_attributes a on a.id = pvv.attribute_id
  where pvv.variant_id = p_variant_id;
$$;

-- ---------------------------------------------------------------------------
-- Cart parsing and pricing, now variant aware. Reproduced in full: every caller
-- (quotes, coupon quotes and order placement) goes through these two functions, so
-- all of them agree on what a line is worth.
--
-- Both row types gain a variant column, and CREATE OR REPLACE cannot change the
-- columns of a set-returning function, so the previous definitions are dropped
-- first. Nothing depends on them except function bodies (all plpgsql, redefined
-- further down in this same migration), so the drop is safe and the recreation is
-- immediately below it.
-- ---------------------------------------------------------------------------

drop function private.cart_items(jsonb);

create function private.cart_items(p_items jsonb)
returns table (line_no integer, product_id uuid, variant_id uuid, quantity integer)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'the cart must be a list of items' using errcode = 'NZ412';
  end if;

  v_count := jsonb_array_length(p_items);
  if v_count < 1 or v_count > 30 then
    raise exception 'the cart must hold 1 to 30 different products' using errcode = 'NZ412';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as e (item)
    where jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item -> 'productId') is distinct from 'string'
      or (item ->> 'productId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(item -> 'variantId') not in ('string', 'null')
      or (jsonb_typeof(item -> 'variantId') = 'string'
          and (item ->> 'variantId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      or jsonb_typeof(item -> 'quantity') is distinct from 'number'
      or (case
            when (item ->> 'quantity') ~ '^[0-9]{1,3}$'
              then (item ->> 'quantity')::integer between 1 and 100
            else false
          end) is not true
  ) then
    raise exception 'every cart item needs a product id, an optional variant id and a quantity from 1 to 100'
      using errcode = 'NZ412';
  end if;

  if (select count(distinct lower(item ->> 'productId') || ':'
                    || coalesce(lower(item ->> 'variantId'), ''))
      from jsonb_array_elements(p_items) as e (item)) <> v_count then
    raise exception 'each product may appear in the cart only once per variant'
      using errcode = 'NZ412';
  end if;

  return query
  select e.ordinality::integer,
         (e.item ->> 'productId')::uuid,
         nullif(e.item ->> 'variantId', '')::uuid,
         (e.item ->> 'quantity')::integer
  from jsonb_array_elements(p_items) with ordinality as e (item, ordinality);
end;
$$;

drop function private.price_cart(jsonb);

create function private.price_cart(p_items jsonb)
returns table (
  line_no integer,
  product_id uuid,
  variant_id uuid,
  variant_label text,
  slug text,
  name text,
  sku text,
  unit_price_minor bigint,
  compare_at_price_minor bigint,
  quantity integer,
  line_total_minor bigint,
  stock_quantity integer,
  max_order_quantity integer,
  problem text
)
language sql
stable
set search_path = ''
as $$
  with on_sale as (
    select p.*
    from public.products p
    join public.categories c on c.id = p.category_id
    where p.status = 'active' and c.is_active
  ),
  lines as (
    select
      ci.line_no,
      ci.product_id,
      ci.variant_id,
      ci.quantity,
      p.id as sale_id,
      p.slug,
      p.name,
      p.sku as product_sku,
      p.price_minor as product_price_minor,
      p.compare_at_price_minor as product_compare_minor,
      p.stock_quantity as product_stock,
      p.max_order_quantity,
      v.id as variant_row,
      v.sku as variant_sku,
      v.price_minor as variant_price_minor,
      v.compare_at_price_minor as variant_compare_minor,
      v.stock_quantity as variant_stock,
      v.is_active as variant_active,
      (select count(*) from public.product_variants pv where pv.product_id = ci.product_id)
        as variant_count,
      case when ci.variant_id is null then null
           else private.variant_label(ci.variant_id) end as variant_label
    from private.cart_items(p_items) as ci
    left join on_sale p on p.id = ci.product_id
    left join public.product_variants v
      on v.id = ci.variant_id and v.product_id = ci.product_id
  )
  select
    l.line_no,
    l.product_id,
    l.variant_id,
    l.variant_label,
    l.slug,
    l.name,
    coalesce(l.variant_sku, l.product_sku),
    coalesce(l.variant_price_minor, l.product_price_minor),
    case when l.variant_price_minor is not null
         then l.variant_compare_minor
         else l.product_compare_minor end,
    l.quantity,
    coalesce(l.variant_price_minor, l.product_price_minor) * l.quantity,
    case when l.variant_id is null then l.product_stock
         else coalesce(l.variant_stock, 0) end,
    l.max_order_quantity,
    case
      when l.sale_id is null then 'unavailable'
      when l.variant_id is not null and l.variant_row is null then 'variant_invalid'
      when l.variant_id is null and l.variant_count > 0 then 'variant_required'
      when l.variant_id is not null and l.variant_active is not true then 'unavailable'
      when l.quantity > l.max_order_quantity then 'quantity_limit'
      when l.quantity > (case when l.variant_id is null then l.product_stock
                              else coalesce(l.variant_stock, 0) end)
        then 'insufficient_stock'
    end
  from lines l
  order by l.line_no;
$$;

create or replace function public.quote_cart(p_items jsonb, p_address_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lines jsonb;
  v_item_count integer;
  v_subtotal bigint;
  v_has_problem boolean;
  v_zone public.delivery_zone;
  v_fee bigint;
begin
  select
    jsonb_agg(
      jsonb_build_object(
        'productId', l.product_id,
        'variantId', l.variant_id,
        'variantLabel', l.variant_label,
        'slug', l.slug,
        'name', l.name,
        'sku', l.sku,
        'unitPriceMinor', l.unit_price_minor,
        'compareAtPriceMinor', l.compare_at_price_minor,
        'quantity', l.quantity,
        'lineTotalMinor', l.line_total_minor,
        'availableQuantity', least(l.stock_quantity, l.max_order_quantity),
        'problem', l.problem
      )
      order by l.line_no
    ),
    coalesce(sum(l.quantity) filter (where l.problem is null), 0),
    coalesce(sum(l.line_total_minor) filter (where l.problem is null), 0),
    bool_or(l.problem is not null)
  into v_lines, v_item_count, v_subtotal, v_has_problem
  from private.price_cart(p_items) as l;

  if p_address_id is not null then
    v_zone := private.own_address_zone(p_address_id);
    if v_zone is null then
      raise exception 'address not found' using errcode = 'NZ411';
    end if;
    select amount_minor into v_fee from public.delivery_charges where zone = v_zone;
  end if;

  return jsonb_build_object(
    'lines', coalesce(v_lines, '[]'::jsonb),
    'itemCount', v_item_count,
    'subtotalMinor', v_subtotal,
    'deliveryZone', v_zone,
    'shippingFeeMinor', v_fee,
    'totalMinor', case when v_fee is null then null else v_subtotal + v_fee end,
    'purchasable', not v_has_problem and (p_address_id is null or v_fee is not null)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Order items carry the variant they were bought as.
-- ---------------------------------------------------------------------------

alter table public.order_items
  add column variant_id uuid references public.product_variants (id) on delete set null,
  add column variant_label text check (variant_label is null or char_length(variant_label) <= 200);

alter table public.order_items drop constraint order_items_order_id_product_id_key;
create unique index order_items_order_line_key
  on public.order_items (order_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.inventory_movements
  add column variant_id uuid references public.product_variants (id) on delete set null;

comment on column public.inventory_movements.variant_id is
  'The variant a movement belongs to; null for movements of simple products.';

-- ---------------------------------------------------------------------------
-- place_cod_order: reproduced in full with variant support.
--
-- Same contract as the coupon version (which stays intact), with these changes:
-- variant rows are locked with the products, variant lines move variant stock, and
-- the order item snapshot records the variant id and label.
-- ---------------------------------------------------------------------------

create or replace function public.place_cod_order(
  p_idempotency_key uuid,
  p_address_id uuid,
  p_items jsonb,
  p_note text default null,
  p_expected_total_minor bigint default null,
  p_coupon_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_fingerprint text;
  v_existing public.orders;
  v_address public.addresses;
  v_zone public.delivery_zone;
  v_fee bigint;
  v_subtotal bigint;
  v_item_count integer;
  v_problems jsonb;
  v_coupon public.coupons;
  v_discount bigint := 0;
  v_order public.orders;
begin
  if v_user is null then
    raise exception 'sign in to place an order' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_address_id is null then
    raise exception 'an idempotency key and an address are required' using errcode = 'NZ412';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'the note is too long' using errcode = 'NZ412';
  end if;

  if not exists (select 1 from public.profiles where id = v_user and status = 'active') then
    raise exception 'this account cannot place orders' using errcode = 'NZ410';
  end if;

  perform 1 from private.cart_items(p_items);

  v_fingerprint := md5(jsonb_build_object(
    'address', p_address_id,
    'note', v_note,
    'coupon', upper(btrim(coalesce(p_coupon_code, ''))),
    'items', (
      select jsonb_agg(jsonb_build_array(ci.product_id, ci.variant_id, ci.quantity) order by ci.product_id, ci.variant_id)
      from private.cart_items(p_items) as ci
    )
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_idempotency_key::text, 0));

  select * into v_existing
  from public.orders
  where user_id = v_user and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'this idempotency key was already used for a different order'
        using errcode = 'NZ416';
    end if;
    return jsonb_build_object(
      'orderId', v_existing.id, 'orderNumber', v_existing.order_number, 'created', false
    );
  end if;

  if (select count(*) from public.orders where user_id = v_user and status = 'pending') >= 5 then
    raise exception 'too many orders are waiting for confirmation' using errcode = 'NZ420';
  end if;

  select * into v_address from public.addresses where id = p_address_id and user_id = v_user;
  if not found then
    raise exception 'address not found' using errcode = 'NZ411';
  end if;

  select d.delivery_zone into v_zone
  from public.bd_districts d
  where d.name = v_address.district and d.division = v_address.division;

  select amount_minor into v_fee from public.delivery_charges where zone = v_zone;
  if v_fee is null then
    raise exception 'delivery is not available for this address yet' using errcode = 'NZ417';
  end if;

  perform 1
  from public.products
  where id in (select ci.product_id from private.cart_items(p_items) as ci)
  order by id
  for update;

  perform 1
  from public.product_variants
  where id in (select ci.variant_id from private.cart_items(p_items) as ci where ci.variant_id is not null)
  order by id
  for update;

  select
    coalesce(sum(l.line_total_minor), 0),
    coalesce(sum(l.quantity), 0),
    jsonb_agg(jsonb_build_object('productId', l.product_id, 'variantId', l.variant_id, 'problem', l.problem)
      order by l.line_no) filter (where l.problem is not null)
  into v_subtotal, v_item_count, v_problems
  from private.price_cart(p_items) as l;

  if v_problems is not null then
    if exists (select 1 from jsonb_array_elements(v_problems) as e (p) where p ->> 'problem' = 'unavailable') then
      raise exception 'some products are not available' using errcode = 'NZ413', detail = v_problems::text;
    elsif exists (select 1 from jsonb_array_elements(v_problems) as e (p) where p ->> 'problem' = 'variant_required') then
      raise exception 'choose an option for every product that has them' using errcode = 'NZ471', detail = v_problems::text;
    elsif exists (select 1 from jsonb_array_elements(v_problems) as e (p) where p ->> 'problem' = 'variant_invalid') then
      raise exception 'one of the chosen options is no longer sold' using errcode = 'NZ470', detail = v_problems::text;
    elsif exists (select 1 from jsonb_array_elements(v_problems) as e (p) where p ->> 'problem' = 'quantity_limit') then
      raise exception 'some quantities exceed the per-order limit' using errcode = 'NZ415', detail = v_problems::text;
    else
      raise exception 'not enough stock' using errcode = 'NZ414', detail = v_problems::text;
    end if;
  end if;

  if p_coupon_code is not null and btrim(p_coupon_code) <> '' then
    v_coupon := private.claim_coupon(p_coupon_code, v_user, v_subtotal);
    v_discount := private.coupon_discount(v_coupon, v_subtotal);
  end if;

  if p_expected_total_minor is not null
     and p_expected_total_minor <> v_subtotal + v_fee - v_discount then
    raise exception 'the order total has changed' using errcode = 'NZ418',
      detail = jsonb_build_object('totalMinor', v_subtotal + v_fee - v_discount)::text;
  end if;

  insert into public.orders (
    user_id, item_count, subtotal_minor, shipping_fee_minor, discount_minor, total_minor,
    delivery_zone, ship_recipient_name, ship_phone, ship_division, ship_district, ship_area,
    ship_address_line, ship_postal_code, ship_landmark, customer_note,
    idempotency_key, request_fingerprint
  ) values (
    v_user, v_item_count, v_subtotal, v_fee, v_discount, v_subtotal + v_fee - v_discount,
    v_zone, v_address.recipient_name, v_address.phone, v_address.division, v_address.district,
    v_address.area, v_address.address_line, v_address.postal_code, v_address.landmark, v_note,
    p_idempotency_key, v_fingerprint
  )
  returning * into v_order;

  insert into public.order_items (
    order_id, product_id, variant_id, variant_label, product_name, product_slug, sku,
    unit_price_minor, quantity, line_total_minor
  )
  select v_order.id, l.product_id, l.variant_id, l.variant_label, l.name, l.slug, l.sku,
         l.unit_price_minor, l.quantity, l.line_total_minor
  from private.price_cart(p_items) as l;

  if v_coupon.id is not null then
    insert into public.coupon_redemptions (coupon_id, user_id, order_id, discount_minor)
    values (v_coupon.id, v_user, v_order.id, v_discount);
  end if;

  with moved as (
    update public.product_variants v
    set stock_quantity = v.stock_quantity - ci.quantity
    from private.cart_items(p_items) as ci
    where ci.variant_id is not null and v.id = ci.variant_id
    returning v.id, v.product_id, ci.quantity, v.stock_quantity
  )
  insert into public.inventory_movements
    (product_id, variant_id, change, stock_after, reason, order_id, actor_id)
  select moved.product_id, moved.id, -moved.quantity, moved.stock_quantity,
         'order_placed', v_order.id, v_user
  from moved;

  with moved as (
    update public.products p
    set stock_quantity = p.stock_quantity - ci.quantity
    from private.cart_items(p_items) as ci
    where ci.variant_id is null and p.id = ci.product_id
    returning p.id, ci.quantity, p.stock_quantity
  )
  insert into public.inventory_movements (product_id, change, stock_after, reason, order_id, actor_id)
  select moved.id, -moved.quantity, moved.stock_quantity, 'order_placed', v_order.id, v_user
  from moved;

  insert into public.order_status_history (order_id, from_status, to_status, actor_kind, actor_id)
  values (v_order.id, null, 'pending', 'customer', v_user);

  return jsonb_build_object('orderId', v_order.id, 'orderNumber', v_order.order_number, 'created', true);
end;
$$;

revoke execute on function public.place_cod_order(uuid, uuid, jsonb, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.place_cod_order(uuid, uuid, jsonb, text, bigint, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Cancellation restores the stock of the variant, not the product, when the line
-- was sold as a variant.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_my_order(p_order_number text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_order public.orders;
begin
  if v_user is null then
    raise exception 'sign in to manage orders' using errcode = '42501';
  end if;
  if v_reason is not null and char_length(v_reason) > 300 then
    raise exception 'the reason is too long' using errcode = 'NZ412';
  end if;
  if not exists (select 1 from public.profiles where id = v_user and status = 'active') then
    raise exception 'this account cannot change orders' using errcode = 'NZ410';
  end if;

  select * into v_order
  from public.orders
  where order_number = p_order_number and user_id = v_user
  for update;

  if not found then
    raise exception 'order not found' using errcode = 'NZ404';
  end if;
  if v_order.status <> 'pending' then
    raise exception 'only orders that are still pending can be cancelled' using errcode = 'NZ419';
  end if;

  update public.orders
  set status = 'cancelled', payment_status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason
  where id = v_order.id
  returning * into v_order;

  perform 1
  from public.products
  where id in (select product_id from public.order_items where order_id = v_order.id)
  order by id
  for update;

  perform 1
  from public.product_variants
  where id in (select variant_id from public.order_items
               where order_id = v_order.id and variant_id is not null)
  order by id
  for update;

  with restored as (
    update public.product_variants v
    set stock_quantity = v.stock_quantity + oi.quantity
    from public.order_items oi
    where oi.order_id = v_order.id and oi.variant_id is not null and v.id = oi.variant_id
    returning v.id, v.product_id, oi.quantity, v.stock_quantity
  )
  insert into public.inventory_movements
    (product_id, variant_id, change, stock_after, reason, order_id, actor_id)
  select restored.product_id, restored.id, restored.quantity, restored.stock_quantity,
         'order_cancelled', v_order.id, v_user
  from restored;

  with restored as (
    update public.products p
    set stock_quantity = p.stock_quantity + oi.quantity
    from public.order_items oi
    where oi.order_id = v_order.id and oi.variant_id is null and p.id = oi.product_id
    returning p.id, oi.quantity, p.stock_quantity
  )
  insert into public.inventory_movements (product_id, change, stock_after, reason, order_id, actor_id)
  select restored.id, restored.quantity, restored.stock_quantity, 'order_cancelled', v_order.id, v_user
  from restored;

  insert into public.order_status_history (order_id, from_status, to_status, actor_kind, actor_id, note)
  values (v_order.id, 'pending', 'cancelled', 'customer', v_user, v_reason);

  return jsonb_build_object('orderId', v_order.id, 'orderNumber', v_order.order_number, 'status', v_order.status);
end;
$$;

-- ---------------------------------------------------------------------------
-- Public read of a product's sellable variants.
-- ---------------------------------------------------------------------------

create function public.catalog_product_variants(p_slug text)
returns table (
  variant_id uuid,
  sku text,
  price_minor bigint,
  compare_at_price_minor bigint,
  stock_quantity integer,
  max_order_quantity integer,
  image_url text,
  "position" integer,
  options jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    v.id,
    v.sku,
    coalesce(v.price_minor, p.price_minor),
    case when v.price_minor is not null then v.compare_at_price_minor
         else p.compare_at_price_minor end,
    v.stock_quantity,
    p.max_order_quantity,
    v.image_url,
    v.position,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'attribute', a.name,
               'attributeSlug', a.slug,
               'value', av.value,
               'valueSlug', av.slug
             ) order by a.position, av.position)
      from public.product_variant_values pvv
      join public.product_attribute_values av on av.id = pvv.attribute_value_id
      join public.product_attributes a on a.id = pvv.attribute_id
      where pvv.variant_id = v.id
    ), '[]'::jsonb)
  from public.product_variants v
  join public.products p on p.id = v.product_id
  join public.categories c on c.id = p.category_id
  where p.slug = p_slug
    and p.status = 'active'
    and c.is_active
    and v.is_active
  order by v.position, v.sku;
$$;

revoke execute on function public.catalog_product_variants(text) from public, anon, authenticated;
grant execute on function public.catalog_product_variants(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Admin: attributes and their values.
-- ---------------------------------------------------------------------------

create function public.admin_list_attributes()
returns table (
  id uuid,
  slug text,
  name text,
  "position" integer,
  is_active boolean,
  "values" jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.read');
begin
  return query
  select a.id, a.slug, a.name, a.position, a.is_active,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', av.id, 'slug', av.slug, 'value', av.value, 'position', av.position
                  ) order by av.position, av.value)
           from public.product_attribute_values av
           where av.attribute_id = a.id
         ), '[]'::jsonb)
  from public.product_attributes a
  order by a.position, a.name;
end;
$$;

create function public.admin_save_attribute(
  p_attribute_id uuid,
  p_slug text,
  p_name text,
  p_position integer,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.update');
  v_id uuid;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 40 then
    raise exception 'the attribute address is not valid' using errcode = 'NZ412';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 40 then
    raise exception 'the attribute name must be 1 to 40 characters' using errcode = 'NZ412';
  end if;
  if exists (select 1 from public.product_attributes
             where slug = p_slug and id is distinct from p_attribute_id) then
    raise exception 'an attribute with this address already exists' using errcode = 'NZ441';
  end if;

  if p_attribute_id is null then
    insert into public.product_attributes (slug, name, position, is_active)
    values (p_slug, btrim(p_name), coalesce(p_position, 0), coalesce(p_is_active, true))
    returning id into v_id;
    perform private.audit(v_actor, 'attribute.created', 'product_attribute', v_id::text,
      jsonb_build_object('slug', p_slug));
  else
    update public.product_attributes
    set slug = p_slug,
        name = btrim(p_name),
        position = coalesce(p_position, position),
        is_active = coalesce(p_is_active, is_active)
    where id = p_attribute_id
    returning id into v_id;
    if v_id is null then
      raise exception 'attribute not found' using errcode = 'NZ404';
    end if;
    perform private.audit(v_actor, 'attribute.updated', 'product_attribute', v_id::text,
      jsonb_build_object('slug', p_slug));
  end if;

  return v_id;
end;
$$;

create function public.admin_save_attribute_value(
  p_value_id uuid,
  p_attribute_id uuid,
  p_slug text,
  p_value text,
  p_position integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.update');
  v_id uuid;
begin
  if p_attribute_id is null then
    raise exception 'an attribute is required' using errcode = 'NZ412';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 40 then
    raise exception 'the value address is not valid' using errcode = 'NZ412';
  end if;
  if p_value is null or char_length(btrim(p_value)) not between 1 and 40 then
    raise exception 'the value must be 1 to 40 characters' using errcode = 'NZ412';
  end if;
  if exists (select 1 from public.product_attribute_values
             where attribute_id = p_attribute_id and slug = p_slug
               and id is distinct from p_value_id) then
    raise exception 'this attribute already has that value' using errcode = 'NZ441';
  end if;

  if p_value_id is null then
    insert into public.product_attribute_values (attribute_id, slug, value, position)
    values (p_attribute_id, p_slug, btrim(p_value), coalesce(p_position, 0))
    returning id into v_id;
    perform private.audit(v_actor, 'attribute_value.created', 'product_attribute_value', v_id::text,
      jsonb_build_object('attribute', p_attribute_id, 'value', p_value));
  else
    update public.product_attribute_values
    set slug = p_slug,
        value = btrim(p_value),
        position = coalesce(p_position, position)
    where id = p_value_id and attribute_id = p_attribute_id
    returning id into v_id;
    if v_id is null then
      raise exception 'attribute value not found' using errcode = 'NZ404';
    end if;
    perform private.audit(v_actor, 'attribute_value.updated', 'product_attribute_value', v_id::text,
      jsonb_build_object('attribute', p_attribute_id, 'value', p_value));
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: variants of one product.
-- ---------------------------------------------------------------------------

create function public.admin_product_variants(p_product_id uuid)
returns table (
  id uuid,
  sku text,
  price_minor bigint,
  compare_at_price_minor bigint,
  stock_quantity integer,
  image_url text,
  "position" integer,
  is_active boolean,
  label text,
  attribute_value_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.read');
begin
  return query
  select v.id, v.sku, v.price_minor, v.compare_at_price_minor, v.stock_quantity,
         v.image_url, v.position, v.is_active,
         private.variant_label(v.id),
         coalesce((
           select array_agg(pvv.attribute_value_id order by pvv.attribute_value_id)
           from public.product_variant_values pvv where pvv.variant_id = v.id
         ), '{}'::uuid[])
  from public.product_variants v
  where v.product_id = p_product_id
  order by v.position, v.sku;
end;
$$;

create function public.admin_save_variant(
  p_variant_id uuid,
  p_product_id uuid,
  p_sku text,
  p_price_minor bigint,
  p_compare_at_price_minor bigint,
  p_image_url text,
  p_position integer,
  p_is_active boolean,
  p_attribute_value_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.update');
  v_id uuid;
  v_price bigint := p_price_minor;
  v_values uuid[] := coalesce(p_attribute_value_ids, '{}'::uuid[]);
begin
  if p_product_id is null then
    raise exception 'a product is required' using errcode = 'NZ412';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'product not found' using errcode = 'NZ404';
  end if;
  if p_sku is null or p_sku !~ '^[A-Z0-9][A-Z0-9-]{1,39}$' then
    raise exception 'the variant SKU is not valid' using errcode = 'NZ412';
  end if;
  if v_price is not null and (v_price < 1 or v_price > 1000000000) then
    raise exception 'the variant price is not valid' using errcode = 'NZ412';
  end if;
  if p_compare_at_price_minor is not null
     and (v_price is null or p_compare_at_price_minor <= v_price) then
    raise exception 'the former price must be higher than the variant price' using errcode = 'NZ412';
  end if;
  if p_image_url is not null and char_length(p_image_url) > 500 then
    raise exception 'the image address is too long' using errcode = 'NZ412';
  end if;

  if exists (select 1 from public.product_variants
             where sku = p_sku and id is distinct from p_variant_id) then
    raise exception 'this SKU is already used' using errcode = 'NZ472';
  end if;

  -- A variant needs exactly one value per attribute, and never two of the same one.
  if exists (
    select 1
    from public.product_attribute_values av
    where av.id = any (v_values)
    group by av.attribute_id
    having count(*) > 1
  ) then
    raise exception 'a variant may hold only one value per attribute' using errcode = 'NZ412';
  end if;
  if exists (
    select 1 from unnest(v_values) as v(id)
    where not exists (select 1 from public.product_attribute_values av where av.id = v.id)
  ) then
    raise exception 'one of the chosen values no longer exists' using errcode = 'NZ412';
  end if;

  if p_variant_id is null then
    insert into public.product_variants
      (product_id, sku, price_minor, compare_at_price_minor, image_url, position, is_active)
    values (p_product_id, p_sku, v_price, p_compare_at_price_minor, p_image_url,
            coalesce(p_position, 0), coalesce(p_is_active, true))
    returning id into v_id;
  else
    update public.product_variants
    set sku = p_sku,
        price_minor = v_price,
        compare_at_price_minor = p_compare_at_price_minor,
        image_url = p_image_url,
        position = coalesce(p_position, position),
        is_active = coalesce(p_is_active, is_active)
    where id = p_variant_id and product_id = p_product_id
    returning id into v_id;
    if v_id is null then
      raise exception 'variant not found' using errcode = 'NZ404';
    end if;

    if exists (
      select 1
      from public.order_items oi
      join public.product_variants v on v.id = v_id
      where oi.variant_id = v_id and oi.sku <> p_sku
    ) then
      raise exception 'this variant appears on a past order, so its SKU cannot change'
        using errcode = 'NZ412';
    end if;
  end if;

  -- Combinations are unique per product: two variants may not share the same values.
  if exists (
    select 1
    from public.product_variants other
    where other.product_id = p_product_id
      and other.id <> v_id
      and (select coalesce(array_agg(pvv.attribute_value_id order by pvv.attribute_value_id), '{}'::uuid[])
           from public.product_variant_values pvv where pvv.variant_id = other.id)
          = (select coalesce(array_agg(x order by x), '{}'::uuid[]) from unnest(v_values) as x)
  ) then
    raise exception 'a variant with these options already exists' using errcode = 'NZ472';
  end if;

  delete from public.product_variant_values where variant_id = v_id;
  insert into public.product_variant_values (variant_id, attribute_id, attribute_value_id)
  select v_id, av.attribute_id, av.id
  from public.product_attribute_values av
  where av.id = any (v_values);

  perform private.audit(v_actor,
    case when p_variant_id is null then 'variant.created' else 'variant.updated' end,
    'product_variant', v_id::text,
    jsonb_build_object('product', p_product_id, 'sku', p_sku, 'priceMinor', v_price));
  return v_id;
end;
$$;

create function public.admin_set_variant_active(p_variant_id uuid, p_is_active boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.update');
  v_product uuid;
begin
  if p_is_active is null then
    raise exception 'a state is required' using errcode = 'NZ412';
  end if;
  update public.product_variants
  set is_active = p_is_active
  where id = p_variant_id
  returning product_id into v_product;
  if v_product is null then
    raise exception 'variant not found' using errcode = 'NZ404';
  end if;
  perform private.audit(v_actor, 'variant.active_changed', 'product_variant', p_variant_id::text,
    jsonb_build_object('isActive', p_is_active));
  return p_is_active;
end;
$$;

create function public.admin_delete_variant(p_variant_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('products.publish');
  v_product uuid;
begin
  delete from public.product_variants where id = p_variant_id returning product_id into v_product;
  if v_product is null then
    raise exception 'variant not found' using errcode = 'NZ404';
  end if;
  perform private.audit(v_actor, 'variant.deleted', 'product_variant', p_variant_id::text,
    jsonb_build_object('product', v_product));
  return true;
end;
$$;

create function public.admin_adjust_variant_stock(
  p_variant_id uuid,
  p_change integer,
  p_note text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('inventory.adjust');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_stock integer;
  v_product uuid;
begin
  if p_change is null or p_change = 0 or abs(p_change) > 1000000 then
    raise exception 'the change must be a whole number, not zero' using errcode = 'NZ412';
  end if;
  if v_note is null or char_length(v_note) < 3 or char_length(v_note) > 300 then
    raise exception 'a reason of 3 to 300 characters is required' using errcode = 'NZ412';
  end if;

  select stock_quantity, product_id into v_stock, v_product
  from public.product_variants where id = p_variant_id for update;
  if v_stock is null then
    raise exception 'variant not found' using errcode = 'NZ404';
  end if;
  if v_stock + p_change < 0 then
    raise exception 'stock cannot go below zero' using errcode = 'NZ433';
  end if;

  update public.product_variants set stock_quantity = v_stock + p_change
  where id = p_variant_id;

  insert into public.inventory_movements
    (product_id, variant_id, change, stock_after, reason, actor_id, note)
  values (v_product, p_variant_id, p_change, v_stock + p_change, 'adjustment', v_actor, v_note);

  perform private.audit(v_actor, 'inventory.variant_adjusted', 'product_variant', p_variant_id::text,
    jsonb_build_object('change', p_change, 'stockAfter', v_stock + p_change));
  return v_stock + p_change;
end;
$$;

-- A product that sells as variants has its stock on the variants; adjusting the
-- product total directly would be undone by the next variant change.
create or replace function public.admin_adjust_stock(p_product_id uuid, p_change integer, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('inventory.adjust');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_stock integer;
begin
  if p_change is null or p_change = 0 or abs(p_change) > 1000000 then
    raise exception 'the change must be a whole number, not zero' using errcode = 'NZ412';
  end if;
  if v_note is null or char_length(v_note) < 3 or char_length(v_note) > 300 then
    raise exception 'a reason of 3 to 300 characters is required' using errcode = 'NZ412';
  end if;

  select stock_quantity into v_stock from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product not found' using errcode = 'NZ404';
  end if;
  if exists (select 1 from public.product_variants where product_id = p_product_id) then
    raise exception 'adjust the stock of each option instead' using errcode = 'NZ412';
  end if;
  if v_stock + p_change < 0 then
    raise exception 'stock cannot go below zero' using errcode = 'NZ433';
  end if;

  update public.products set stock_quantity = v_stock + p_change, updated_by = v_actor
  where id = p_product_id;
  insert into public.inventory_movements (product_id, change, stock_after, reason, actor_id, note)
  values (p_product_id, p_change, v_stock + p_change, 'adjustment', v_actor, v_note);

  perform private.audit(v_actor, 'inventory.adjusted', 'product', p_product_id::text,
    jsonb_build_object('change', p_change, 'stockAfter', v_stock + p_change));
  return v_stock + p_change;
end;
$$;

revoke execute on function public.admin_list_attributes() from public, anon, authenticated;
revoke execute on function public.admin_save_attribute(uuid, text, text, integer, boolean)
  from public, anon, authenticated;
revoke execute on function public.admin_save_attribute_value(uuid, uuid, text, text, integer)
  from public, anon, authenticated;
revoke execute on function public.admin_product_variants(uuid) from public, anon, authenticated;
revoke execute on function public.admin_save_variant(uuid, uuid, text, bigint, bigint, text, integer, boolean, uuid[])
  from public, anon, authenticated;
revoke execute on function public.admin_set_variant_active(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.admin_delete_variant(uuid) from public, anon, authenticated;
revoke execute on function public.admin_adjust_variant_stock(uuid, integer, text)
  from public, anon, authenticated;
revoke execute on function public.admin_adjust_stock(uuid, integer, text) from public, anon, authenticated;

grant execute on function public.admin_list_attributes() to authenticated;
grant execute on function public.admin_save_attribute(uuid, text, text, integer, boolean) to authenticated;
grant execute on function public.admin_save_attribute_value(uuid, uuid, text, text, integer) to authenticated;
grant execute on function public.admin_product_variants(uuid) to authenticated;
grant execute on function public.admin_save_variant(uuid, uuid, text, bigint, bigint, text, integer, boolean, uuid[])
  to authenticated;
grant execute on function public.admin_set_variant_active(uuid, boolean) to authenticated;
grant execute on function public.admin_delete_variant(uuid) to authenticated;
grant execute on function public.admin_adjust_variant_stock(uuid, integer, text) to authenticated;
grant execute on function public.admin_adjust_stock(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Staff cancellation returns stock to the variant that was sold. Reproduced from
-- 20261025090000 with only that change.
-- ---------------------------------------------------------------------------

create or replace function public.admin_update_order_status(
  p_order_number text,
  p_status public.order_status,
  p_note text default null
)
returns public.order_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission(
    case when p_status = 'cancelled' then 'orders.cancel' else 'orders.update_status' end
  );
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_order public.orders;
  v_allowed boolean;
begin
  if p_status is null then
    raise exception 'a status is required' using errcode = 'NZ412';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'the note is too long' using errcode = 'NZ412';
  end if;
  if p_status = 'cancelled' and (v_note is null or char_length(v_note) < 5) then
    raise exception 'a reason is required to cancel an order' using errcode = 'NZ412';
  end if;

  select * into v_order from public.orders where order_number = p_order_number for update;
  if not found then
    raise exception 'order not found' using errcode = 'NZ404';
  end if;

  v_allowed := case v_order.status
    when 'pending' then p_status in ('confirmed', 'cancelled')
    when 'confirmed' then p_status in ('processing', 'cancelled')
    when 'processing' then p_status in ('shipped', 'cancelled')
    when 'shipped' then p_status = 'delivered'
    else false
  end;
  if not v_allowed then
    raise exception 'an order that is % cannot become %', v_order.status, p_status using errcode = 'NZ434';
  end if;

  if p_status = 'cancelled' then
    update public.orders
    set status = 'cancelled', payment_status = 'cancelled', cancelled_at = now(), cancel_reason = v_note
    where id = v_order.id;

    perform 1 from public.products
    where id in (select product_id from public.order_items where order_id = v_order.id)
    order by id
    for update;

    perform 1 from public.product_variants
    where id in (select variant_id from public.order_items
                 where order_id = v_order.id and variant_id is not null)
    order by id
    for update;

    with restored as (
      update public.product_variants v
      set stock_quantity = v.stock_quantity + oi.quantity
      from public.order_items oi
      where oi.order_id = v_order.id and oi.variant_id is not null and v.id = oi.variant_id
      returning v.id, v.product_id, oi.quantity, v.stock_quantity
    )
    insert into public.inventory_movements
      (product_id, variant_id, change, stock_after, reason, order_id, actor_id)
    select restored.product_id, restored.id, restored.quantity, restored.stock_quantity,
           'order_cancelled', v_order.id, v_actor
    from restored;

    with restored as (
      update public.products p
      set stock_quantity = p.stock_quantity + oi.quantity
      from public.order_items oi
      where oi.order_id = v_order.id and oi.variant_id is null and p.id = oi.product_id
      returning p.id, oi.quantity, p.stock_quantity
    )
    insert into public.inventory_movements (product_id, change, stock_after, reason, order_id, actor_id)
    select restored.id, restored.quantity, restored.stock_quantity, 'order_cancelled', v_order.id, v_actor
    from restored;
  else
    update public.orders set status = p_status where id = v_order.id;
  end if;

  insert into public.order_status_history (order_id, from_status, to_status, actor_kind, actor_id, note)
  values (v_order.id, v_order.status, p_status, 'staff', v_actor, v_note);
  perform private.audit(v_actor, 'order.status_changed', 'order', p_order_number,
    jsonb_build_object('from', v_order.status, 'to', p_status));
  return p_status;
end;
$$;
