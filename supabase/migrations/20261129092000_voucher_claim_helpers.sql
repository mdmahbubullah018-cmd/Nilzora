-- ---------------------------------------------------------------------------
-- Voucher claim helpers, final form
--
-- 20261129091000 prices coupons with
--   v_coupon   := private.claim_coupon_for_cart(code, user, items, subtotal);
--   v_discount := private.coupon_cart_discount(v_coupon, items, subtotal);
-- PL/pgSQL cannot take a row and a second value from one call, so the claim answers the
-- coupon row and the discount has its own function. claim_coupon_for_cart (created with OUT
-- parameters by 20261129090000) is replaced; no data changes.
-- ---------------------------------------------------------------------------

drop function private.claim_coupon_for_cart(text, uuid, jsonb, bigint);

create function private.claim_coupon_for_cart(
  p_code text,
  p_user uuid,
  p_items jsonb,
  p_subtotal bigint
)
returns public.coupons
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_coupon public.coupons;
  v_eligible bigint;
begin
  select * into v_coupon from public.coupons where code = upper(btrim(coalesce(p_code, '')));
  if found then
    if v_coupon.is_voucher and not exists (
      select 1 from public.voucher_collections vc
      where vc.coupon_id = v_coupon.id and vc.user_id = p_user
    ) then
      raise exception 'collect this voucher before using it' using errcode = 'NZ459';
    end if;
    if not private.coupon_audience_ok(v_coupon, p_user) then
      raise exception '%', case v_coupon.audience
        when 'new_customers' then 'this offer is for a first order only'
        else 'this offer is for returning customers' end
        using errcode = 'NZ459';
    end if;
    v_eligible := case when v_coupon.scope = 'storewide' then p_subtotal
                       else private.coupon_eligible_subtotal(v_coupon, p_items) end;
    if v_coupon.scope <> 'storewide' and v_eligible = 0 then
      raise exception 'nothing in your cart qualifies for this offer' using errcode = 'NZ459';
    end if;
  else
    v_eligible := p_subtotal;
  end if;
  -- The existing claim: validity window, minimum spend (on the qualifying lines), limits, lock.
  return private.claim_coupon(p_code, p_user, v_eligible);
end;
$$;

/** The discount of a claimed coupon, measured on the lines it applies to. */
create function private.coupon_cart_discount(p_coupon public.coupons, p_items jsonb, p_subtotal bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select private.coupon_discount(
    p_coupon,
    case when p_coupon.scope = 'storewide' then p_subtotal
         else private.coupon_eligible_subtotal(p_coupon, p_items) end
  );
$$;

revoke execute on function private.claim_coupon_for_cart(text, uuid, jsonb, bigint) from public, anon, authenticated;
revoke execute on function private.coupon_cart_discount(public.coupons, jsonb, bigint) from public, anon, authenticated;
