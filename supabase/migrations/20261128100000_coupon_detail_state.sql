-- admin_get_coupon (20261101090000) answered every field of the coupon contract except
-- `state`, which the coupon list computes, so opening any coupon failed its response check
-- and the coupon page could never load. Same signature, permission and grants; `state`
-- uses exactly the list's rule (inactive, scheduled, expired, exhausted, else active).

create or replace function public.admin_get_coupon(p_coupon_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('coupons.update');
  v_row jsonb;
begin
  select jsonb_build_object(
    'id', c.id,
    'code', c.code,
    'description', c.description,
    'kind', c.kind,
    'value', c.value,
    'minOrderMinor', c.min_order_minor,
    'maxDiscountMinor', c.max_discount_minor,
    'startsAt', c.starts_at,
    'endsAt', c.ends_at,
    'totalLimit', c.total_limit,
    'perCustomerLimit', c.per_customer_limit,
    'isActive', c.is_active,
    'state', case
      when not c.is_active then 'inactive'
      when c.starts_at is not null and now() < c.starts_at then 'scheduled'
      when c.ends_at is not null and now() >= c.ends_at then 'expired'
      when c.total_limit is not null and u.redemption_count >= c.total_limit then 'exhausted'
      else 'active'
    end,
    'redemptionCount', u.redemption_count,
    'totalDiscountMinor', u.total_discount,
    'createdAt', c.created_at,
    'updatedAt', c.updated_at
  )
  into v_row
  from public.coupons c
  cross join lateral (
    select count(*) as redemption_count, coalesce(sum(r.discount_minor), 0) as total_discount
    from public.coupon_redemptions r where r.coupon_id = c.id
  ) u
  where c.id = p_coupon_id;

  if v_row is null then
    raise exception 'coupon not found' using errcode = 'NZ404';
  end if;
  return v_row;
end;
$$;
