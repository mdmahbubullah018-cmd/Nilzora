-- Saved carts refuse a line the shop could never sell.
--
-- A product "has variants" once any product_variants row exists, and a shopper must then pick
-- one (a variant is a complete attribute combination; see 20261204100000). price_cart and
-- place_cod_order already refuse such a line, but the writers of the saved cart accepted it,
-- and guest_cart_set_item is callable by anonymous visitors straight through PostgREST, so
-- the rule has to live here and not only in the API.
--
-- When a line is added or changed (quantity above 0):
--   NZ490  the product is unknown, off sale (not active, or in an inactive category), or the
--          variant belongs to another product;
--   NZ471  the product has variants and none was chosen (variant_required);
--   NZ470  the chosen variant is switched off (variant_invalid).
-- Removing a line (quantity 0) is never validated beyond the existing "known product, variant
-- of this product" checks, so a legacy line can always be taken out of the cart.
--
-- merge_guest_cart() skips guest lines that would now be refused instead of failing the whole
-- merge: valid lines are still folded in and the guest cart is still consumed.

/**
 * What stops a line being added to a saved cart: null when it may be, otherwise
 * product_unknown | variant_foreign | off_sale | variant_required | variant_inactive.
 * Quantity 0 (a removal) only gets the first two checks.
 */
create function private.cart_line_problem(
  p_product_id uuid,
  p_variant_id uuid,
  p_quantity integer
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_variant_active boolean;
begin
  if not exists (select 1 from public.products where id = p_product_id) then
    return 'product_unknown';
  end if;
  if p_variant_id is not null then
    select v.is_active into v_variant_active
    from public.product_variants v
    where v.id = p_variant_id and v.product_id = p_product_id;
    if not found then
      return 'variant_foreign';
    end if;
  end if;
  if p_quantity = 0 then
    return null;
  end if;

  if not exists (
    select 1
    from public.products p
    join public.categories c on c.id = p.category_id
    where p.id = p_product_id and p.status = 'active' and c.is_active
  ) then
    return 'off_sale';
  end if;
  if p_variant_id is null then
    if exists (select 1 from public.product_variants where product_id = p_product_id) then
      return 'variant_required';
    end if;
  elsif v_variant_active is not true then
    return 'variant_inactive';
  end if;
  return null;
end;
$$;

revoke execute on function private.cart_line_problem(uuid, uuid, integer)
  from public, anon, authenticated;

/** Raises the SQLSTATE that matches a cart_line_problem() code. */
create function private.cart_line_assert(
  p_product_id uuid,
  p_variant_id uuid,
  p_quantity integer
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_problem text := private.cart_line_problem(p_product_id, p_variant_id, p_quantity);
begin
  if v_problem is null then
    return;
  elsif v_problem = 'product_unknown' or v_problem = 'off_sale' then
    raise exception 'that product is not sold' using errcode = 'NZ490';
  elsif v_problem = 'variant_foreign' then
    raise exception 'that option does not belong to this product' using errcode = 'NZ490';
  elsif v_problem = 'variant_required' then
    raise exception 'choose an option for this product' using errcode = 'NZ471';
  else
    raise exception 'that option is no longer available' using errcode = 'NZ470';
  end if;
end;
$$;

revoke execute on function private.cart_line_assert(uuid, uuid, integer)
  from public, anon, authenticated;

create or replace function public.cart_set_item(
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
  perform private.cart_line_assert(p_product_id, p_variant_id, p_quantity);

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

create or replace function public.guest_cart_set_item(
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
  perform private.cart_line_assert(p_product_id, p_variant_id, p_quantity);

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

create or replace function public.merge_guest_cart(p_token uuid)
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
    -- A line the shop would refuse today (a variant never chosen, a switched-off option, a
    -- product no longer on sale) is left behind rather than copied or failing the merge.
    if private.cart_line_problem(v_line.product_id, v_line.variant_id, v_line.quantity) is not null then
      continue;
    end if;
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
