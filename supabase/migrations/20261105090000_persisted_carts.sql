-- ---------------------------------------------------------------------------
-- Persisted carts and checkout tracking
--
-- A cart is the customer's own list of product+variant lines, kept on the server so it
-- survives a refresh, a new device or a sign-in. The storefront cookie and the Android
-- store stay as they are: they identify the cart, they are not the cart.
--
-- Lifecycle (never "abandoned" just because it exists):
--   active     – being filled; may sit idle indefinitely
--   checkout   – checkout genuinely started (an order attempt was made)
--   incomplete – checkout started and then went quiet past cart_inactivity_minutes
--   converted  – an order was created from it; never returns to the queue
--   expired    – idle past retention without ever starting checkout
--
-- Prices, stock and discounts are never stored here: the existing quote and order
-- functions remain the authority.
--
-- SQLSTATEs: NZ490 cart_line_invalid, NZ491 cart_guest_token_invalid,
--            NZ492 checkout_already_converted.
-- ---------------------------------------------------------------------------

create type public.cart_status as enum ('active', 'checkout', 'converted', 'expired');
create type public.checkout_status as enum ('started', 'incomplete', 'converted', 'expired');

-- ---------------------------------------------------------------------------
-- Carts
-- ---------------------------------------------------------------------------

create table public.carts (
  id uuid primary key default gen_random_uuid(),
  /** The signed-in customer's cart; null for a guest cart. */
  user_id uuid references public.profiles (id) on delete cascade,
  /** An opaque, unguessable handle for a guest cart; null for a customer's cart. */
  guest_token uuid,
  status public.cart_status not null default 'active',
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  converted_order_id uuid references public.orders (id) on delete set null,
  constraint carts_one_owner check ((user_id is null) <> (guest_token is null))
);

comment on table public.carts is
  'A customer''s or guest''s cart. Lines live in cart_items; prices are never stored.';
comment on column public.carts.guest_token is
  'Random handle for a guest cart. Knowing it is the only way to reach that cart.';

-- One open cart per customer, and one per guest handle.
create unique index carts_one_active_per_user on public.carts (user_id)
  where user_id is not null and status in ('active', 'checkout');
create unique index carts_guest_token_idx on public.carts (guest_token)
  where guest_token is not null;
create index carts_queue_idx on public.carts (status, last_activity_at desc);
create index carts_user_idx on public.carts (user_id, last_activity_at desc);

alter table public.carts enable row level security;

create table public.cart_items (
  id bigint generated always as identity primary key,
  cart_id uuid not null references public.carts (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete cascade,
  quantity integer not null check (quantity between 1 and 100),
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.cart_items is
  'One line per product and variant. The same product twice with different variants is two lines.';

create unique index cart_items_line_idx
  on public.cart_items (cart_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index cart_items_cart_idx on public.cart_items (cart_id);

alter table public.cart_items enable row level security;

create trigger cart_items_set_updated_at
before update on public.cart_items
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Checkout attempts
-- ---------------------------------------------------------------------------

create table public.checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status public.checkout_status not null default 'started',
  /** The coupon the customer was trying; the order function still validates it. */
  coupon_code text check (coupon_code is null or char_length(coupon_code) <= 40),
  /** The address chosen at the time; the order function re-checks ownership. */
  address_id uuid references public.addresses (id) on delete set null,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  converted_at timestamptz,
  converted_order_id uuid references public.orders (id) on delete set null,
  constraint checkout_conversion_recorded check (
    (status = 'converted') = (converted_at is not null)
  )
);

comment on table public.checkout_sessions is
  'One row per genuine checkout attempt. A cart is only "incomplete" once a session went quiet.';

-- Only one open attempt per cart, so retries never duplicate the queue.
create unique index checkout_sessions_open_idx on public.checkout_sessions (cart_id)
  where status in ('started', 'incomplete');
create index checkout_sessions_queue_idx
  on public.checkout_sessions (status, last_activity_at desc);
create index checkout_sessions_user_idx on public.checkout_sessions (user_id, started_at desc);

alter table public.checkout_sessions enable row level security;

-- ---------------------------------------------------------------------------
-- The one configured threshold
-- ---------------------------------------------------------------------------

create function private.cart_inactivity_minutes()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select cart_inactivity_minutes from public.store_settings where id;
$$;

/**
 * Re-labels silent carts and checkouts. Called on demand by the reads below and by the
 * admin queue, so no scheduler is needed; nothing is ever deleted.
 */
create function private.classify_stale_carts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - make_interval(mins => private.cart_inactivity_minutes());
  /** A cart never touched checkout is dropped from tracking after a week of silence. */
  v_retention timestamptz := now() - interval '7 days';
begin
  update public.checkout_sessions
  set status = 'incomplete'
  where status = 'started' and last_activity_at < v_cutoff;

  update public.checkout_sessions
  set status = 'expired'
  where status = 'incomplete' and last_activity_at < v_retention;

  update public.carts c
  set status = 'expired'
  where c.status = 'active'
    and c.last_activity_at < v_retention
    and not exists (select 1 from public.checkout_sessions s where s.cart_id = c.id);
end;
$$;

revoke execute on function private.classify_stale_carts() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The customer's own cart
-- ---------------------------------------------------------------------------

/** The signed-in customer's open cart, created on first use. */
create function public.my_cart()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_cart uuid;
begin
  if v_user is null then
    raise exception 'sign in to use a saved cart' using errcode = '42501';
  end if;

  select id into v_cart
  from public.carts
  where user_id = v_user and status in ('active', 'checkout')
  limit 1;

  if v_cart is null then
    insert into public.carts (user_id) values (v_user) returning id into v_cart;
  end if;
  return v_cart;
end;
$$;

/** A guest cart for a fresh, random handle. The caller stores the handle locally. */
create function public.start_guest_cart(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart uuid;
begin
  if p_token is null then
    raise exception 'a guest cart needs its handle' using errcode = 'NZ491';
  end if;

  select id into v_cart from public.carts where guest_token = p_token;
  if v_cart is null then
    insert into public.carts (guest_token) values (p_token) returning id into v_cart;
  end if;
  update public.carts set last_activity_at = now() where id = v_cart;
  return v_cart;
end;
$$;

/**
 * Sets a line's quantity (0 removes it). The product and variant must exist and the
 * variant must belong to the product; stock is not reserved here — the quote and the
 * order functions decide that.
 */
create function public.cart_set_item(
  p_product_id uuid,
  p_variant_id uuid,
  p_quantity integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart uuid := public.my_cart();
begin
  if p_quantity is null or p_quantity < 0 or p_quantity > 100 then
    raise exception 'the quantity must be from 1 to 100' using errcode = 'NZ412';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'that product is not sold' using errcode = 'NZ490';
  end if;
  if p_variant_id is not null and not exists (
    select 1 from public.product_variants where id = p_variant_id and product_id = p_product_id
  ) then
    raise exception 'that option does not belong to this product' using errcode = 'NZ490';
  end if;

  if p_quantity = 0 then
    delete from public.cart_items
    where cart_id = v_cart
      and product_id = p_product_id
      and coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid);
  else
    insert into public.cart_items (cart_id, product_id, variant_id, quantity)
    values (v_cart, p_product_id, p_variant_id, p_quantity)
    on conflict (cart_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set quantity = excluded.quantity;
  end if;

  update public.carts set last_activity_at = now(), status = 'active' where id = v_cart;
  return v_cart;
end;
$$;

create function public.cart_remove_item(p_product_id uuid, p_variant_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.cart_set_item(p_product_id, p_variant_id, 0);
end;
$$;

/** Empties the cart, e.g. after an order is placed or the customer clears it. */
create function public.cart_clear()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart uuid := public.my_cart();
begin
  delete from public.cart_items where cart_id = v_cart;
  update public.carts set last_activity_at = now() where id = v_cart;
end;
$$;

/**
 * Sets a guest line (0 removes it). The handle is the whole permission, so this is the
 * only way an anonymous visitor can change a saved cart. Validation matches
 * cart_set_item(); stock is still decided by the quote and order functions.
 */
create function public.guest_cart_set_item(
  p_token uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_quantity integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart uuid;
begin
  if p_token is null then
    raise exception 'a guest cart needs its handle' using errcode = 'NZ491';
  end if;

  select id into v_cart from public.carts
  where guest_token = p_token and status = 'active'
  for update;
  if v_cart is null then
    raise exception 'that guest cart is no longer open' using errcode = 'NZ491';
  end if;

  if p_quantity is null or p_quantity < 0 or p_quantity > 100 then
    raise exception 'the quantity must be from 1 to 100' using errcode = 'NZ412';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'that product is not sold' using errcode = 'NZ490';
  end if;
  if p_variant_id is not null and not exists (
    select 1 from public.product_variants where id = p_variant_id and product_id = p_product_id
  ) then
    raise exception 'that option does not belong to this product' using errcode = 'NZ490';
  end if;

  if p_quantity = 0 then
    delete from public.cart_items
    where cart_id = v_cart
      and product_id = p_product_id
      and coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid);
  else
    insert into public.cart_items (cart_id, product_id, variant_id, quantity)
    values (v_cart, p_product_id, p_variant_id, p_quantity)
    on conflict (cart_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set quantity = excluded.quantity;
  end if;

  update public.carts set last_activity_at = now() where id = v_cart;
  return v_cart;
end;
$$;

/** Empties a guest cart, e.g. after the browser forgets it. Unknown handles are a no-op. */
create function public.guest_cart_clear(p_token uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart uuid;
begin
  select id into v_cart from public.carts
  where guest_token = p_token and status = 'active';
  if v_cart is null then
    return;
  end if;
  delete from public.cart_items where cart_id = v_cart;
  update public.carts set last_activity_at = now() where id = v_cart;
end;
$$;

-- ---------------------------------------------------------------------------
-- Guest → account merge
-- ---------------------------------------------------------------------------
/**
 * Folds a guest cart into the signed-in customer's cart. Lines add up, capped at the
 * per-line limit; the guest cart is consumed. Knowing the handle is the whole permission.
 */
create function public.merge_guest_cart(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_cart uuid := public.my_cart();
  v_guest uuid;
  v_line record;
begin
  if v_user is null then
    raise exception 'sign in to keep your cart' using errcode = '42501';
  end if;
  select id into v_guest from public.carts
  where guest_token = p_token and status = 'active'
  for update;
  if v_guest is null then
    return v_cart;
  end if;

  for v_line in
    select product_id, variant_id, quantity from public.cart_items where cart_id = v_guest
  loop
    insert into public.cart_items (cart_id, product_id, variant_id, quantity)
    values (v_cart, v_line.product_id, v_line.variant_id, v_line.quantity)
    on conflict (cart_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set quantity = least(public.cart_items.quantity + excluded.quantity, 100);
  end loop;

  delete from public.carts where id = v_guest;
  update public.carts set last_activity_at = now() where id = v_cart;
  return v_cart;
end;
$$;

-- ---------------------------------------------------------------------------
-- Checkout lifecycle
-- ---------------------------------------------------------------------------

/**
 * Records that checkout genuinely started for the signed-in customer's cart. Called by
 * the checkout screen, not by every page view, so a full cart is not "abandoned".
 */
create function public.checkout_start(p_address_id uuid default null, p_coupon_code text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_cart uuid := public.my_cart();
  v_session uuid;
begin
  if not exists (select 1 from public.cart_items where cart_id = v_cart) then
    raise exception 'the cart is empty' using errcode = 'NZ412';
  end if;

  select id into v_session
  from public.checkout_sessions
  where cart_id = v_cart and status in ('started', 'incomplete')
  limit 1;

  if v_session is null then
    insert into public.checkout_sessions (cart_id, user_id, address_id, coupon_code)
    values (v_cart, v_user, p_address_id, nullif(btrim(coalesce(p_coupon_code, '')), ''))
    returning id into v_session;
  else
    update public.checkout_sessions
    set status = 'started',
        last_activity_at = now(),
        address_id = coalesce(p_address_id, address_id),
        coupon_code = coalesce(nullif(btrim(coalesce(p_coupon_code, '')), ''), coupon_code)
    where id = v_session;
  end if;

  update public.carts set status = 'checkout', last_activity_at = now() where id = v_cart;
  return v_session;
end;
$$;

/** A meaningful act inside checkout (changing an address, applying a coupon, retrying). */
create function public.checkout_activity(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  update public.checkout_sessions
  set status = 'started', last_activity_at = now()
  where id = p_session_id and user_id = v_user and status in ('started', 'incomplete');
  update public.carts c
  set last_activity_at = now()
  where c.user_id = v_user and c.status = 'checkout';
end;
$$;

/**
 * Marks the customer's checkout converted. The API calls this only after place_cod_order
 * answered with a created (or replayed) order, so a failed attempt never converts. The
 * order is named by its number because that is what the place-order answer carries; the
 * lookup is scoped to the caller, so another customer's number changes nothing.
 */
create function public.checkout_converted(p_order_number text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_session public.checkout_sessions;
  v_order uuid;
begin
  select * into v_session
  from public.checkout_sessions
  where user_id = v_user and status in ('started', 'incomplete')
  order by started_at desc
  limit 1
  for update;

  if not found then
    return;
  end if;

  select id into v_order
  from public.orders
  where order_number = p_order_number and user_id = v_user;
  if v_order is null then
    raise exception 'that order is not the caller''s' using errcode = 'NZ492';
  end if;

  update public.checkout_sessions
  set status = 'converted', converted_at = now(), converted_order_id = v_order
  where id = v_session.id;
  update public.carts
  set status = 'converted', converted_order_id = v_order, last_activity_at = now()
  where id = v_session.cart_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff: the incomplete-checkout queue
-- ---------------------------------------------------------------------------

create function public.admin_list_checkouts(
  p_status text default null,
  p_query text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  status public.checkout_status,
  customer_name text,
  item_count integer,
  coupon_code text,
  started_at timestamptz,
  last_activity_at timestamptz,
  order_number text,
  total_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('orders.read');
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
begin
  perform private.classify_stale_carts();

  return query
  select s.id,
         s.status,
         pr.full_name,
         coalesce((select sum(i.quantity) from public.cart_items i where i.cart_id = s.cart_id), 0)::integer,
         s.coupon_code,
         s.started_at,
         s.last_activity_at,
         o.order_number,
         count(*) over () as total_count
  from public.checkout_sessions s
  join public.profiles pr on pr.id = s.user_id
  left join public.orders o on o.id = s.converted_order_id
  where (p_status is null or s.status::text = p_status)
    and (
      v_query is null
      or pr.full_name ilike '%' || v_query || '%'
      or o.order_number ilike '%' || v_query || '%'
    )
  order by s.last_activity_at desc
  limit least(coalesce(p_limit, 25), 100) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create function public.admin_get_checkout(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('orders.read');
  v_session public.checkout_sessions;
begin
  perform private.classify_stale_carts();

  select * into v_session from public.checkout_sessions where id = p_session_id;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_session.id,
    'status', v_session.status,
    'couponCode', v_session.coupon_code,
    'startedAt', v_session.started_at,
    'lastActivityAt', v_session.last_activity_at,
    'convertedAt', v_session.converted_at,
    'orderNumber', (select o.order_number from public.orders o where o.id = v_session.converted_order_id),
    'customer', (
      select jsonb_build_object('id', pr.id, 'name', pr.full_name)
      from public.profiles pr where pr.id = v_session.user_id
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'productName', p.name,
               'variantLabel', private.variant_label(i.variant_id),
               'sku', coalesce(v.sku, p.sku),
               'quantity', i.quantity,
               'unitPriceMinor', coalesce(v.price_minor, p.price_minor)
             ) order by i.id)
      from public.cart_items i
      join public.products p on p.id = i.product_id
      left join public.product_variants v on v.id = i.variant_id
      where i.cart_id = v_session.cart_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.my_cart() from public, anon, authenticated;
revoke execute on function public.start_guest_cart(uuid) from public, anon, authenticated;
revoke execute on function public.cart_set_item(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.cart_remove_item(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.cart_clear() from public, anon, authenticated;
revoke execute on function public.guest_cart_set_item(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke execute on function public.guest_cart_clear(uuid) from public, anon, authenticated;
revoke execute on function public.merge_guest_cart(uuid) from public, anon, authenticated;
revoke execute on function public.checkout_start(uuid, text) from public, anon, authenticated;
revoke execute on function public.checkout_activity(uuid) from public, anon, authenticated;
revoke execute on function public.checkout_converted(text) from public, anon, authenticated;
revoke execute on function public.admin_list_checkouts(text, text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.admin_get_checkout(uuid) from public, anon, authenticated;

grant execute on function public.my_cart() to authenticated;
grant execute on function public.start_guest_cart(uuid) to anon, authenticated;
grant execute on function public.cart_set_item(uuid, uuid, integer) to authenticated;
grant execute on function public.cart_remove_item(uuid, uuid) to authenticated;
grant execute on function public.cart_clear() to authenticated;
grant execute on function public.guest_cart_set_item(uuid, uuid, uuid, integer) to anon, authenticated;
grant execute on function public.guest_cart_clear(uuid) to anon, authenticated;
grant execute on function public.merge_guest_cart(uuid) to authenticated;
grant execute on function public.checkout_start(uuid, text) to authenticated;
grant execute on function public.checkout_activity(uuid) to authenticated;
grant execute on function public.checkout_converted(text) to authenticated;
grant execute on function public.admin_list_checkouts(text, text, integer, integer) to authenticated;
grant execute on function public.admin_get_checkout(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reads: the mutating functions above answer with an id, so these two return what the
-- screen actually needs. Both are guarded by ownership, and neither trusts a client.
-- ---------------------------------------------------------------------------

create function public.cart_snapshot(p_cart_id uuid)
returns table (
  id uuid,
  status public.cart_status,
  last_activity_at timestamptz,
  lines jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'sign in to read a saved cart' using errcode = '42501';
  end if;
  if not exists (select 1 from public.carts where carts.id = p_cart_id and user_id = v_user) then
    -- Another account's cart is invisible, not merely refused.
    raise exception 'cart not found' using errcode = 'NZ404';
  end if;

  return query
  select c.id, c.status, c.last_activity_at,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'productId', i.product_id,
                    'variantId', i.variant_id,
                    'quantity', i.quantity
                  ) order by i.id)
           from public.cart_items i where i.cart_id = c.id
         ), '[]'::jsonb)
  from public.carts c
  where c.id = p_cart_id;
end;
$$;

/** The same read for a guest, reached only with the cart's own opaque handle. */
create function public.guest_cart_snapshot(p_token uuid)
returns table (
  id uuid,
  status public.cart_status,
  last_activity_at timestamptz,
  lines jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_token is null then
    raise exception 'a guest cart needs its handle' using errcode = 'NZ491';
  end if;

  return query
  select c.id, c.status, c.last_activity_at,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'productId', i.product_id,
                    'variantId', i.variant_id,
                    'quantity', i.quantity
                  ) order by i.id)
           from public.cart_items i where i.cart_id = c.id
         ), '[]'::jsonb)
  from public.carts c
  where c.guest_token = p_token
  limit 1;
end;
$$;

/** One checkout attempt, for the customer it belongs to. */
create function public.checkout_session(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_session public.checkout_sessions;
begin
  if v_user is null then
    raise exception 'sign in to read a checkout' using errcode = '42501';
  end if;
  select * into v_session
  from public.checkout_sessions
  where id = p_session_id and user_id = v_user;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_session.id,
    'status', v_session.status,
    'startedAt', v_session.started_at,
    'lastActivityAt', v_session.last_activity_at,
    'convertedAt', v_session.converted_at,
    'orderNumber', (
      select o.order_number from public.orders o where o.id = v_session.converted_order_id
    )
  );
end;
$$;

revoke execute on function public.cart_snapshot(uuid) from public, anon, authenticated;
revoke execute on function public.guest_cart_snapshot(uuid) from public, anon, authenticated;
revoke execute on function public.checkout_session(uuid) from public, anon, authenticated;

grant execute on function public.cart_snapshot(uuid) to authenticated;
grant execute on function public.guest_cart_snapshot(uuid) to anon, authenticated;
grant execute on function public.checkout_session(uuid) to authenticated;
