-- admin_category_campaigns (20261123090000) passed rows of a CTE to
-- private.campaign_products(public.discount_campaigns); a CTE row is an anonymous record, so
-- every call failed (42846: cannot cast type record to public.discount_campaigns) and the
-- category pages could not show their campaigns. Same signature, grants and answer; the
-- table row itself is passed now. The earlier migration is not edited or re-run.

create or replace function public.admin_category_campaigns(p_category_ids uuid[] default null)
returns table (
  category_id uuid,
  campaign_id uuid,
  customer_title text,
  scope public.campaign_scope,
  discount_kind public.campaign_discount_kind,
  discount_value bigint,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.campaign_status,
  product_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('discounts.view');
  return query
  select w.id, c.id, c.customer_title, c.scope, c.discount_kind, c.discount_value,
         c.starts_at, c.ends_at, c.status, counted.n
  from public.categories w
  cross join public.discount_campaigns c
  cross join lateral (
    select count(*)::bigint as n
    from private.campaign_products(c) cp
    join public.products pr on pr.id = cp.product_id
    where pr.status = 'active'
      and w.id = any (private.category_ancestry(pr.category_id))
  ) counted
  where (p_category_ids is null or w.id = any (p_category_ids))
    and c.status in ('scheduled', 'active')
    and counted.n > 0
  order by c.customer_title;
end;
$$;
