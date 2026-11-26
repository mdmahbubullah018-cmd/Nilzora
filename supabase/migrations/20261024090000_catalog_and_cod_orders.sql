-- Nilzora commerce foundation: catalog, inventory, delivery charges, customer
-- addresses and Cash-on-Delivery orders.
--
-- Prices, delivery charges and totals are computed only here, from the catalog,
-- inside the transaction that places the order. Clients send product ids and
-- quantities, never amounts. Stock changes only through the functions below, which
-- lock the product rows they touch and record every change in inventory_movements.

-- ---------------------------------------------------------------------------
-- Internal helpers live in a schema the Data API does not expose.
-- ---------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.product_status as enum ('draft', 'active', 'archived');
create type public.delivery_zone as enum ('inside_dhaka', 'outside_dhaka');
create type public.order_status as enum (
  'pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'
);
create type public.payment_method as enum ('cod');
create type public.payment_status as enum ('pending', 'collected', 'cancelled');
create type public.inventory_reason as enum (
  'initial_stock', 'order_placed', 'order_cancelled', 'adjustment'
);
create type public.order_actor as enum ('customer', 'staff', 'system');

-- ---------------------------------------------------------------------------
-- Reference data: the 64 districts of Bangladesh and their divisions. Addresses
-- must name a known (district, division) pair; the district decides the zone.
-- ---------------------------------------------------------------------------

create table public.bd_districts (
  name text primary key,
  division text not null,
  delivery_zone public.delivery_zone not null default 'outside_dhaka',
  unique (name, division)
);

comment on table public.bd_districts is 'Districts of Bangladesh. Reference data for delivery addresses.';

insert into public.bd_districts (name, division, delivery_zone) values
  ('Barguna', 'Barishal', 'outside_dhaka'),
  ('Barishal', 'Barishal', 'outside_dhaka'),
  ('Bhola', 'Barishal', 'outside_dhaka'),
  ('Jhalokati', 'Barishal', 'outside_dhaka'),
  ('Patuakhali', 'Barishal', 'outside_dhaka'),
  ('Pirojpur', 'Barishal', 'outside_dhaka'),
  ('Bandarban', 'Chattogram', 'outside_dhaka'),
  ('Brahmanbaria', 'Chattogram', 'outside_dhaka'),
  ('Chandpur', 'Chattogram', 'outside_dhaka'),
  ('Chattogram', 'Chattogram', 'outside_dhaka'),
  ('Cox''s Bazar', 'Chattogram', 'outside_dhaka'),
  ('Cumilla', 'Chattogram', 'outside_dhaka'),
  ('Feni', 'Chattogram', 'outside_dhaka'),
  ('Khagrachhari', 'Chattogram', 'outside_dhaka'),
  ('Lakshmipur', 'Chattogram', 'outside_dhaka'),
  ('Noakhali', 'Chattogram', 'outside_dhaka'),
  ('Rangamati', 'Chattogram', 'outside_dhaka'),
  ('Dhaka', 'Dhaka', 'inside_dhaka'),
  ('Faridpur', 'Dhaka', 'outside_dhaka'),
  ('Gazipur', 'Dhaka', 'outside_dhaka'),
  ('Gopalganj', 'Dhaka', 'outside_dhaka'),
  ('Kishoreganj', 'Dhaka', 'outside_dhaka'),
  ('Madaripur', 'Dhaka', 'outside_dhaka'),
  ('Manikganj', 'Dhaka', 'outside_dhaka'),
  ('Munshiganj', 'Dhaka', 'outside_dhaka'),
  ('Narayanganj', 'Dhaka', 'outside_dhaka'),
  ('Narsingdi', 'Dhaka', 'outside_dhaka'),
  ('Rajbari', 'Dhaka', 'outside_dhaka'),
  ('Shariatpur', 'Dhaka', 'outside_dhaka'),
  ('Tangail', 'Dhaka', 'outside_dhaka'),
  ('Bagerhat', 'Khulna', 'outside_dhaka'),
  ('Chuadanga', 'Khulna', 'outside_dhaka'),
  ('Jashore', 'Khulna', 'outside_dhaka'),
  ('Jhenaidah', 'Khulna', 'outside_dhaka'),
  ('Khulna', 'Khulna', 'outside_dhaka'),
  ('Kushtia', 'Khulna', 'outside_dhaka'),
  ('Magura', 'Khulna', 'outside_dhaka'),
  ('Meherpur', 'Khulna', 'outside_dhaka'),
  ('Narail', 'Khulna', 'outside_dhaka'),
  ('Satkhira', 'Khulna', 'outside_dhaka'),
  ('Jamalpur', 'Mymensingh', 'outside_dhaka'),
  ('Mymensingh', 'Mymensingh', 'outside_dhaka'),
  ('Netrokona', 'Mymensingh', 'outside_dhaka'),
  ('Sherpur', 'Mymensingh', 'outside_dhaka'),
  ('Bogura', 'Rajshahi', 'outside_dhaka'),
  ('Chapai Nawabganj', 'Rajshahi', 'outside_dhaka'),
  ('Joypurhat', 'Rajshahi', 'outside_dhaka'),
  ('Naogaon', 'Rajshahi', 'outside_dhaka'),
  ('Natore', 'Rajshahi', 'outside_dhaka'),
  ('Pabna', 'Rajshahi', 'outside_dhaka'),
  ('Rajshahi', 'Rajshahi', 'outside_dhaka'),
  ('Sirajganj', 'Rajshahi', 'outside_dhaka'),
  ('Dinajpur', 'Rangpur', 'outside_dhaka'),
  ('Gaibandha', 'Rangpur', 'outside_dhaka'),
  ('Kurigram', 'Rangpur', 'outside_dhaka'),
  ('Lalmonirhat', 'Rangpur', 'outside_dhaka'),
  ('Nilphamari', 'Rangpur', 'outside_dhaka'),
  ('Panchagarh', 'Rangpur', 'outside_dhaka'),
  ('Rangpur', 'Rangpur', 'outside_dhaka'),
  ('Thakurgaon', 'Rangpur', 'outside_dhaka'),
  ('Habiganj', 'Sylhet', 'outside_dhaka'),
  ('Moulvibazar', 'Sylhet', 'outside_dhaka'),
  ('Sunamganj', 'Sylhet', 'outside_dhaka'),
  ('Sylhet', 'Sylhet', 'outside_dhaka');

-- ---------------------------------------------------------------------------
-- Delivery charges per zone. No rows ship with the schema: until the store sets
-- its charges, orders are refused (delivery_unavailable) rather than guessed.
-- ---------------------------------------------------------------------------

create table public.delivery_charges (
  zone public.delivery_zone primary key,
  amount_minor bigint not null check (amount_minor between 0 and 10000000),
  updated_at timestamptz not null default now()
);

comment on table public.delivery_charges is 'Delivery charge per zone, in poisha (1 BDT = 100 poisha).';

create trigger delivery_charges_set_updated_at
  before update on public.delivery_charges
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (char_length(slug) <= 80 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index categories_active_order_idx on public.categories (sort_order, name) where is_active;

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete restrict,
  slug text not null unique
    check (char_length(slug) <= 120 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  sku text not null unique check (sku ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  summary text check (summary is null or char_length(summary) <= 300),
  description text check (description is null or char_length(description) <= 5000),
  -- Money is in poisha (1 BDT = 100 poisha): integers, never floating point.
  price_minor bigint not null check (price_minor between 1 and 1000000000),
  compare_at_price_minor bigint
    check (compare_at_price_minor is null or compare_at_price_minor > price_minor),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  max_order_quantity integer not null default 10 check (max_order_quantity between 1 and 100),
  status public.product_status not null default 'draft',
  is_featured boolean not null default false,
  published_at timestamptz,
  search tsvector generated always as (
    setweight(to_tsvector('simple'::regconfig, name), 'A')
    || setweight(to_tsvector('simple'::regconfig, coalesce(summary, '')), 'B')
    || setweight(to_tsvector('simple'::regconfig, coalesce(description, '')), 'C')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.products.price_minor is 'Selling price in poisha.';
comment on column public.products.compare_at_price_minor is 'Former price in poisha, shown struck through when higher.';
comment on column public.products.stock_quantity is 'Units available to order. Changed only by the order and stock functions.';

create index products_category_listing_idx on public.products (category_id, published_at desc)
  where status = 'active';
create index products_listing_idx on public.products (published_at desc) where status = 'active';
create index products_price_idx on public.products (price_minor) where status = 'active';
create index products_search_idx on public.products using gin (search);

create function private.products_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'active' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

create trigger products_before_write
  before insert or update on public.products
  for each row execute function private.products_before_write();

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Customer addresses
-- ---------------------------------------------------------------------------

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  label text check (label is null or char_length(btrim(label)) between 1 and 40),
  recipient_name text not null check (char_length(btrim(recipient_name)) between 1 and 120),
  phone text not null check (phone ~ '^\+8801[3-9][0-9]{8}$'),
  division text not null,
  district text not null,
  area text not null check (char_length(btrim(area)) between 2 and 80),
  address_line text not null check (char_length(btrim(address_line)) between 5 and 200),
  postal_code text check (postal_code is null or postal_code ~ '^[0-9]{4}$'),
  landmark text check (landmark is null or char_length(btrim(landmark)) between 1 and 120),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (district, division) references public.bd_districts (name, division)
);

comment on table public.addresses is 'Delivery addresses owned by one customer. Orders keep their own snapshot.';

create index addresses_user_idx on public.addresses (user_id, created_at desc);
create unique index addresses_one_default_idx on public.addresses (user_id) where is_default;

-- At most this many saved addresses per account.
create function private.addresses_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_existing integer;
begin
  select count(*) into v_existing from public.addresses where user_id = new.user_id;
  if v_existing >= 10 then
    raise exception 'an account can keep at most 10 addresses' using errcode = 'NZ421';
  end if;
  -- The first address becomes the default.
  if v_existing = 0 then
    new.is_default := true;
  end if;
  return new;
end;
$$;

-- One default per account: choosing a new default clears the old one first.
create function private.addresses_keep_single_default()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_default then
    update public.addresses
    set is_default = false
    where user_id = new.user_id and id <> new.id and is_default;
  end if;
  return new;
end;
$$;

-- Removing the default promotes the most recent remaining address.
create function private.addresses_after_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_default then
    update public.addresses
    set is_default = true
    where id = (
      select id from public.addresses
      where user_id = old.user_id
      order by created_at desc, id
      limit 1
    );
  end if;
  return old;
end;
$$;

create trigger addresses_before_insert
  before insert on public.addresses
  for each row execute function private.addresses_before_insert();

create trigger addresses_keep_single_default
  before insert or update of is_default on public.addresses
  for each row execute function private.addresses_keep_single_default();

create trigger addresses_after_delete
  after delete on public.addresses
  for each row execute function private.addresses_after_delete();

create trigger addresses_set_updated_at
  before update on public.addresses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Orders. Status (fulfilment) and payment status (cash) are separate: a COD order
-- can be confirmed while its payment is still pending.
-- ---------------------------------------------------------------------------

create sequence public.order_number_seq start with 100001;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('NZ' || nextval('public.order_number_seq')::text),
  user_id uuid not null references public.profiles (id) on delete restrict,
  status public.order_status not null default 'pending',
  payment_method public.payment_method not null default 'cod',
  payment_status public.payment_status not null default 'pending',
  currency text not null default 'BDT' check (currency = 'BDT'),
  item_count integer not null check (item_count > 0),
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  shipping_fee_minor bigint not null check (shipping_fee_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  total_minor bigint not null,
  delivery_zone public.delivery_zone not null,
  ship_recipient_name text not null,
  ship_phone text not null,
  ship_division text not null,
  ship_district text not null,
  ship_area text not null,
  ship_address_line text not null,
  ship_postal_code text,
  ship_landmark text,
  customer_note text check (customer_note is null or char_length(customer_note) <= 500),
  idempotency_key uuid not null,
  request_fingerprint text not null,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  placed_at timestamptz not null default now(),
  cancelled_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint orders_idempotency_unique unique (user_id, idempotency_key),
  constraint orders_total_consistent
    check (total_minor = subtotal_minor + shipping_fee_minor - discount_minor and total_minor >= 0),
  constraint orders_cancel_consistent check ((status = 'cancelled') = (cancelled_at is not null))
);

alter sequence public.order_number_seq owned by public.orders.order_number;

comment on table public.orders is 'Cash-on-Delivery orders. Written only by place_cod_order and the order status functions.';
comment on column public.orders.request_fingerprint is 'Hash of the placed request, so a reused idempotency key with a different cart is refused.';

create index orders_user_placed_idx on public.orders (user_id, placed_at desc);
create index orders_status_placed_idx on public.orders (status, placed_at desc);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  -- Snapshot of the product as sold; later catalog edits never change past orders.
  product_name text not null,
  product_slug text not null,
  sku text not null,
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  quantity integer not null check (quantity between 1 and 100),
  line_total_minor bigint not null,
  constraint order_items_line_total check (line_total_minor = unit_price_minor * quantity),
  unique (order_id, product_id)
);

create index order_items_product_idx on public.order_items (product_id);

create table public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  from_status public.order_status,
  to_status public.order_status not null,
  actor_kind public.order_actor not null,
  actor_id uuid references public.profiles (id) on delete set null,
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now()
);

create index order_status_history_order_idx on public.order_status_history (order_id, created_at);

create table public.inventory_movements (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products (id) on delete restrict,
  change integer not null check (change <> 0),
  stock_after integer not null check (stock_after >= 0),
  reason public.inventory_reason not null,
  order_id uuid references public.orders (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now()
);

comment on table public.inventory_movements is 'Ledger of every stock change. Never visible to customers.';

create index inventory_movements_product_idx on public.inventory_movements (product_id, created_at desc);
create index inventory_movements_order_idx on public.inventory_movements (order_id);

-- ---------------------------------------------------------------------------
-- Cart pricing, shared by quotes and order placement so both always agree.
-- ---------------------------------------------------------------------------

-- Parses and validates a cart: a JSON array of 1–30 {productId, quantity} objects,
-- each product at most once, quantities 1–100. Anything else is refused (NZ412).
create function private.cart_items(p_items jsonb)
returns table (line_no integer, product_id uuid, quantity integer)
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
      or jsonb_typeof(item -> 'quantity') is distinct from 'number'
      or (case
            when (item ->> 'quantity') ~ '^[0-9]{1,3}$'
              then (item ->> 'quantity')::integer between 1 and 100
            else false
          end) is not true
  ) then
    raise exception 'every cart item needs a product id and a quantity from 1 to 100'
      using errcode = 'NZ412';
  end if;

  if (select count(distinct lower(item ->> 'productId')) from jsonb_array_elements(p_items) as e (item))
     <> v_count then
    raise exception 'each product may appear in the cart only once' using errcode = 'NZ412';
  end if;

  return query
  select e.ordinality::integer, (e.item ->> 'productId')::uuid, (e.item ->> 'quantity')::integer
  from jsonb_array_elements(p_items) with ordinality as e (item, ordinality);
end;
$$;

-- Prices each cart line from the live catalog. Products that are not on sale (draft,
-- archived, unknown, or in a hidden category) reveal nothing but their id.
create function private.price_cart(p_items jsonb)
returns table (
  line_no integer,
  product_id uuid,
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
  )
  select
    ci.line_no,
    ci.product_id,
    p.slug,
    p.name,
    p.sku,
    p.price_minor,
    p.compare_at_price_minor,
    ci.quantity,
    p.price_minor * ci.quantity,
    p.stock_quantity,
    p.max_order_quantity,
    case
      when p.id is null then 'unavailable'
      when ci.quantity > p.max_order_quantity then 'quantity_limit'
      when ci.quantity > p.stock_quantity then 'insufficient_stock'
    end
  from private.cart_items(p_items) as ci
  left join on_sale p on p.id = ci.product_id
  order by ci.line_no;
$$;

-- The delivery zone of one of the caller's own addresses, or null.
create function private.own_address_zone(p_address_id uuid)
returns public.delivery_zone
language sql
stable
set search_path = ''
as $$
  select d.delivery_zone
  from public.addresses a
  join public.bd_districts d on d.name = a.district and d.division = a.division
  where a.id = p_address_id and a.user_id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- quote_cart: what a cart costs right now. Anyone may ask (the answer holds only
-- public catalog data). With an address id, which must be one of the caller's own,
-- the delivery charge and total are included too.
-- ---------------------------------------------------------------------------

create function public.quote_cart(p_items jsonb, p_address_id uuid default null)
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
-- place_cod_order: the only way an order is created.
--
-- Runs as one transaction: validates the account, address and cart; locks every
-- product in the cart (in id order, so concurrent orders cannot deadlock); prices
-- the cart from the catalog; checks stock and limits; then writes the order, its
-- item snapshots and status history, and moves stock with a ledger entry per line.
-- Two orders for the last unit serialise on the row lock, so stock never goes
-- negative. The same idempotency key returns the original order instead of
-- creating another; reusing a key for a different cart is refused.
-- ---------------------------------------------------------------------------

create function public.place_cod_order(
  p_idempotency_key uuid,
  p_address_id uuid,
  p_items jsonb,
  p_note text default null,
  p_expected_total_minor bigint default null
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

  -- Validates the cart (NZ412) before anything is locked.
  perform 1 from private.cart_items(p_items);

  v_fingerprint := md5(jsonb_build_object(
    'address', p_address_id,
    'note', v_note,
    'items', (
      select jsonb_agg(jsonb_build_array(ci.product_id, ci.quantity) order by ci.product_id)
      from private.cart_items(p_items) as ci
    )
  )::text);

  -- Serialise attempts that share a key, then answer a repeat with the first order.
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

  -- Cash-on-Delivery abuse guard: a few unconfirmed orders at a time per account.
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

  -- Lock the products in a fixed order; the pricing below then reads committed stock.
  perform 1
  from public.products
  where id in (select ci.product_id from private.cart_items(p_items) as ci)
  order by id
  for update;

  select
    coalesce(sum(l.line_total_minor), 0),
    coalesce(sum(l.quantity), 0),
    jsonb_agg(jsonb_build_object('productId', l.product_id, 'problem', l.problem)
      order by l.line_no) filter (where l.problem is not null)
  into v_subtotal, v_item_count, v_problems
  from private.price_cart(p_items) as l;

  if v_problems is not null then
    if exists (select 1 from jsonb_array_elements(v_problems) as e (p) where p ->> 'problem' = 'unavailable') then
      raise exception 'some products are not available' using errcode = 'NZ413', detail = v_problems::text;
    elsif exists (select 1 from jsonb_array_elements(v_problems) as e (p) where p ->> 'problem' = 'quantity_limit') then
      raise exception 'some quantities exceed the per-order limit' using errcode = 'NZ415', detail = v_problems::text;
    else
      raise exception 'not enough stock' using errcode = 'NZ414', detail = v_problems::text;
    end if;
  end if;

  if p_expected_total_minor is not null and p_expected_total_minor <> v_subtotal + v_fee then
    raise exception 'the order total has changed' using errcode = 'NZ418',
      detail = jsonb_build_object('totalMinor', v_subtotal + v_fee)::text;
  end if;

  insert into public.orders (
    user_id, item_count, subtotal_minor, shipping_fee_minor, discount_minor, total_minor,
    delivery_zone, ship_recipient_name, ship_phone, ship_division, ship_district, ship_area,
    ship_address_line, ship_postal_code, ship_landmark, customer_note,
    idempotency_key, request_fingerprint
  ) values (
    v_user, v_item_count, v_subtotal, v_fee, 0, v_subtotal + v_fee,
    v_zone, v_address.recipient_name, v_address.phone, v_address.division, v_address.district,
    v_address.area, v_address.address_line, v_address.postal_code, v_address.landmark, v_note,
    p_idempotency_key, v_fingerprint
  )
  returning * into v_order;

  insert into public.order_items (
    order_id, product_id, product_name, product_slug, sku, unit_price_minor, quantity, line_total_minor
  )
  select v_order.id, l.product_id, l.name, l.slug, l.sku, l.unit_price_minor, l.quantity, l.line_total_minor
  from private.price_cart(p_items) as l;

  with moved as (
    update public.products p
    set stock_quantity = p.stock_quantity - ci.quantity
    from private.cart_items(p_items) as ci
    where p.id = ci.product_id
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

-- ---------------------------------------------------------------------------
-- cancel_my_order: a customer may cancel their own order only while it is still
-- pending (before the store confirms it). Stock is returned with ledger entries.
-- ---------------------------------------------------------------------------

create function public.cancel_my_order(p_order_number text, p_reason text default null)
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

  with restored as (
    update public.products p
    set stock_quantity = p.stock_quantity + oi.quantity
    from public.order_items oi
    where oi.order_id = v_order.id and p.id = oi.product_id
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
-- Catalog reads. Security invoker: Row Level Security decides what each caller
-- sees, and the filters repeat it so the functions never widen it.
-- ---------------------------------------------------------------------------

create function public.catalog_categories()
returns table (slug text, name text, description text, product_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.slug, c.name, c.description,
    (select count(*) from public.products p where p.category_id = c.id and p.status = 'active')
  from public.categories c
  where c.is_active
  order by c.sort_order, c.name;
$$;

-- p_query is a prepared prefix query ('term':* & 'term':*), built by the API from
-- the visitor's words; malformed queries are refused by to_tsquery.
create function public.catalog_products(
  p_category_slug text default null,
  p_query text default null,
  p_sort text default 'featured',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  id uuid,
  slug text,
  sku text,
  name text,
  summary text,
  price_minor bigint,
  compare_at_price_minor bigint,
  stock_quantity integer,
  max_order_quantity integer,
  is_featured boolean,
  published_at timestamptz,
  category_slug text,
  category_name text,
  total_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_query tsquery;
begin
  if p_limit is null or p_limit not between 1 and 60 or p_offset is null or p_offset not between 0 and 10000 then
    raise exception 'invalid page' using errcode = '22023';
  end if;
  if p_sort is null or p_sort not in ('featured', 'newest', 'price_asc', 'price_desc', 'relevance') then
    raise exception 'invalid sort' using errcode = '22023';
  end if;
  if p_query is not null then
    v_query := to_tsquery('simple'::regconfig, p_query);
  end if;

  return query
  select p.id, p.slug, p.sku, p.name, p.summary, p.price_minor, p.compare_at_price_minor,
    p.stock_quantity, p.max_order_quantity, p.is_featured, p.published_at,
    c.slug, c.name, count(*) over ()
  from public.products p
  join public.categories c on c.id = p.category_id
  where p.status = 'active'
    and c.is_active
    and (p_category_slug is null or c.slug = p_category_slug)
    and (v_query is null or p.search @@ v_query)
  order by
    case when p_sort = 'relevance' and v_query is not null then ts_rank(p.search, v_query) end desc nulls last,
    case when p_sort = 'featured' then p.is_featured end desc nulls last,
    case when p_sort = 'price_asc' then p.price_minor end asc nulls last,
    case when p_sort = 'price_desc' then p.price_minor end desc nulls last,
    p.published_at desc,
    p.id
  limit p_limit
  offset p_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: deny by default, then grant exactly what the policies allow.
-- ---------------------------------------------------------------------------

revoke all on table
  public.bd_districts, public.delivery_charges, public.categories, public.products,
  public.addresses, public.orders, public.order_items, public.order_status_history,
  public.inventory_movements
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.bd_districts, public.delivery_charges, public.categories, public.products,
  public.addresses, public.orders, public.order_items, public.order_status_history,
  public.inventory_movements
to service_role;

-- Public catalog and reference data (rows filtered by the policies below).
grant select on table public.bd_districts, public.delivery_charges, public.categories, public.products
  to anon, authenticated;

-- Customers manage their own addresses; the owner and timestamps are not theirs to set.
grant select, delete on table public.addresses to authenticated;
grant insert (label, recipient_name, phone, division, district, area, address_line, postal_code, landmark, is_default)
  on table public.addresses to authenticated;
grant update (label, recipient_name, phone, division, district, area, address_line, postal_code, landmark, is_default)
  on table public.addresses to authenticated;

-- Customers read their own orders; all order writes go through the functions.
grant select (
  id, order_number, user_id, status, payment_method, payment_status, currency, item_count,
  subtotal_minor, shipping_fee_minor, discount_minor, total_minor, delivery_zone,
  ship_recipient_name, ship_phone, ship_division, ship_district, ship_area, ship_address_line,
  ship_postal_code, ship_landmark, customer_note, cancel_reason, placed_at, cancelled_at, updated_at
) on table public.orders to authenticated;
grant select on table public.order_items to authenticated;
grant select (id, order_id, from_status, to_status, actor_kind, note, created_at)
  on table public.order_status_history to authenticated;

revoke all on sequence public.order_number_seq from public, anon, authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.quote_cart(jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.place_cod_order(uuid, uuid, jsonb, text, bigint) from public, anon, authenticated;
revoke execute on function public.cancel_my_order(text, text) from public, anon, authenticated;
revoke execute on function public.catalog_categories() from public, anon, authenticated;
revoke execute on function public.catalog_products(text, text, text, integer, integer) from public, anon, authenticated;

grant execute on function public.quote_cart(jsonb, uuid) to anon, authenticated, service_role;
grant execute on function public.place_cod_order(uuid, uuid, jsonb, text, bigint) to authenticated;
grant execute on function public.cancel_my_order(text, text) to authenticated;
grant execute on function public.catalog_categories() to anon, authenticated, service_role;
grant execute on function public.catalog_products(text, text, text, integer, integer) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.bd_districts enable row level security;
alter table public.delivery_charges enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.addresses enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.inventory_movements enable row level security;

create policy "Anyone reads districts"
  on public.bd_districts for select to anon, authenticated
  using (true);

create policy "Anyone reads delivery charges"
  on public.delivery_charges for select to anon, authenticated
  using (true);

create policy "Anyone reads active categories"
  on public.categories for select to anon, authenticated
  using (is_active);

create policy "Anyone reads products on sale"
  on public.products for select to anon, authenticated
  using (
    status = 'active'
    and exists (select 1 from public.categories c where c.id = category_id and c.is_active)
  );

create policy "Customers read their own addresses"
  on public.addresses for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Active customers add their own addresses"
  on public.addresses for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.profiles p where p.id = user_id and p.status = 'active')
  );

create policy "Active customers edit their own addresses"
  on public.addresses for update to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (select 1 from public.profiles p where p.id = user_id and p.status = 'active')
  )
  with check ((select auth.uid()) = user_id);

create policy "Active customers delete their own addresses"
  on public.addresses for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (select 1 from public.profiles p where p.id = user_id and p.status = 'active')
  );

create policy "Customers read their own orders"
  on public.orders for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Customers read their own order items"
  on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())));

create policy "Customers read their own order history"
  on public.order_status_history for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())));

-- inventory_movements has no end-user policies: only the service role reads it.
-- No end user may insert, update or delete catalog, order or stock rows directly.
