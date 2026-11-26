-- ---------------------------------------------------------------------------
-- Wishlist
--
-- Until now the mobile app kept a wishlist on the device only: no account held one, the
-- website had none, and nothing followed a customer from the phone to the browser. This
-- adds the one shared list both clients read and write:
--
--   * private.wishlist_json(user)  the list as the API needs it: each saved product with
--                                  the fields a card shows, or null when the product is no
--                                  longer on sale (deleted rows are removed by the foreign
--                                  key; hidden ones stay, reported as unavailable).
--   * my_wishlist()                the signed-in customer's list.
--   * wishlist_add(product)        saves one product; a repeat is a no-op, not a duplicate.
--   * wishlist_remove(product)     unsaves one product.
--   * wishlist_merge(slugs[])      folds a guest's device-local list into the account.
--
-- Every write goes through a function keyed to auth.uid(); the table itself grants a
-- customer SELECT on their own rows only, so no client can insert, delete or read someone
-- else's list even with a hand-made request. A product can be saved only while it is on
-- sale, which keeps the list free of things a shopper could never open.
--
-- Additive: one table, one helper and four functions. No existing object changes.
-- ---------------------------------------------------------------------------

create table public.wishlist_items (
  user_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- The same product cannot be saved twice by one account: the rule lives in the key.
  primary key (user_id, product_id)
);

comment on table public.wishlist_items is
  'Products a signed-in customer saved. Reads: own rows only (RLS). Writes: through the wishlist functions.';

create index wishlist_items_user_recent_idx on public.wishlist_items (user_id, created_at desc);

alter table public.wishlist_items enable row level security;

revoke all on table public.wishlist_items from public, anon, authenticated;
grant select on table public.wishlist_items to authenticated;

create policy "Customers read their own wishlist"
  on public.wishlist_items for select to authenticated
  using ((select auth.uid()) = user_id);

/** Whether a product can be saved right now: on sale, in a category that is shown. */
create function private.wishlist_product_visible(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.products p
    join public.categories c on c.id = p.category_id
    where p.id = p_product_id and p.status = 'active' and c.is_active
  );
$$;

revoke all on function private.wishlist_product_visible(uuid) from public;

/**
 * One account's wishlist, newest first, as the API needs it. A product that is no longer
 * on sale is reported with `product: null` and nothing else: its name, price and picture
 * are not disclosed after it stops being public.
 */
create function private.wishlist_json(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'productId', w.product_id,
        'savedAt', w.created_at,
        'product', case when p.id is null then null else jsonb_build_object(
          'id', p.id,
          'slug', p.slug,
          'sku', p.sku,
          'name', p.name,
          'summary', p.summary,
          'priceMinor', p.price_minor,
          'compareAtPriceMinor', p.compare_at_price_minor,
          'stockQuantity', p.stock_quantity,
          'maxOrderQuantity', p.max_order_quantity,
          'isFeatured', p.is_featured,
          'publishedAt', p.published_at,
          'categorySlug', c.slug,
          'categoryName', c.name,
          'brandSlug', b.slug,
          'brandName', b.name,
          'image', (
            select jsonb_build_object(
              'id', pi.id,
              'storageKey', pi.storage_key,
              'alt', pi.alt_text,
              'width', pi.width,
              'height', pi.height,
              'position', pi.position
            )
            from public.product_images pi
            where pi.product_id = p.id
            order by pi.position, pi.created_at
            limit 1
          )
        ) end
      )
      order by w.created_at desc
    ),
    '[]'::jsonb
  )
  from public.wishlist_items w
  left join public.products p
    on p.id = w.product_id and p.status = 'active'
  left join public.categories c on c.id = p.category_id and c.is_active
  left join public.brands b on b.id = p.brand_id and b.is_active
  where w.user_id = p_user
    -- The join already drops a hidden product; this keeps its row while hiding its details.
    and (p.id is null or c.id is not null);
$$;

revoke all on function private.wishlist_json(uuid) from public;

/** The signed-in customer's wishlist. */
create function public.my_wishlist()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'sign in to keep a wishlist' using errcode = '42501';
  end if;
  return private.wishlist_json(v_user);
end;
$$;

/** Saves one product. Saving a product already saved changes nothing. */
create function public.wishlist_add(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'sign in to keep a wishlist' using errcode = '42501';
  end if;
  if p_product_id is null then
    raise exception 'choose a product' using errcode = 'NZ412';
  end if;
  if not private.wishlist_product_visible(p_product_id) then
    raise exception 'this product is not available' using errcode = 'NZ404';
  end if;

  insert into public.wishlist_items (user_id, product_id)
  values (v_user, p_product_id)
  on conflict (user_id, product_id) do nothing;

  return private.wishlist_json(v_user);
end;
$$;

/** Unsaves one product. Removing one that was not saved changes nothing. */
create function public.wishlist_remove(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'sign in to keep a wishlist' using errcode = '42501';
  end if;

  delete from public.wishlist_items
  where user_id = v_user and product_id = p_product_id;

  return private.wishlist_json(v_user);
end;
$$;

/**
 * Folds a guest's device-local list into the account. Slugs that are unknown, no longer on
 * sale, or already saved are skipped, so calling it again after a sign-in adds nothing and
 * removes nothing: the merge is idempotent and never overwrites what the account already has.
 */
create function public.wishlist_merge(p_slugs text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_slug text;
  v_product uuid;
begin
  if v_user is null then
    raise exception 'sign in to keep a wishlist' using errcode = '42501';
  end if;

  for v_slug in
    select distinct slug
    from unnest(coalesce(p_slugs, '{}'::text[])) as s (slug)
    where slug is not null and char_length(slug) between 1 and 200
    limit 200
  loop
    select p.id into v_product
    from public.products p
    join public.categories c on c.id = p.category_id
    where p.slug = v_slug and p.status = 'active' and c.is_active;

    if v_product is not null then
      insert into public.wishlist_items (user_id, product_id)
      values (v_user, v_product)
      on conflict (user_id, product_id) do nothing;
    end if;
  end loop;

  return private.wishlist_json(v_user);
end;
$$;

revoke execute on function public.my_wishlist() from public, anon, authenticated;
revoke execute on function public.wishlist_add(uuid) from public, anon, authenticated;
revoke execute on function public.wishlist_remove(uuid) from public, anon, authenticated;
revoke execute on function public.wishlist_merge(text[]) from public, anon, authenticated;

grant execute on function public.my_wishlist() to authenticated;
grant execute on function public.wishlist_add(uuid) to authenticated;
grant execute on function public.wishlist_remove(uuid) to authenticated;
grant execute on function public.wishlist_merge(text[]) to authenticated;
