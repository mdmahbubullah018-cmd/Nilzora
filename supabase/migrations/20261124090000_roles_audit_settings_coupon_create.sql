-- ---------------------------------------------------------------------------
-- Roles matrix, audit-log search, store settings and creating coupons
--
--   1. admin_list_roles(): every role with the permissions it holds by default, for staff
--      who may assign roles or manage permissions. The owner (super_admin) holds EVERY
--      permission in the catalogue (public.permissions) — the same rule
--      private.permissions_of applies to an active owner — not the rows stored in
--      role_permissions, so a permission added later is reported for the owner at once.
--   2. admin_audit_log_search(): the audit log with optional Bangladesh-day bounds (at most
--      366 days when both are given) and a literal text search over the action, the actor's
--      name and email, and the target id. admin_audit_log keeps its signature and behaviour.
--      The log records no IP address, so there is none to search or show.
--   3. Store settings: admin_store_settings() also reports the insight thresholds and the
--      monthly sales target (extra keys only); admin_save_insight_thresholds() sets the
--      thresholds; a five-argument admin_save_store_settings() saves the settings and,
--      when given, the thresholds in ONE transaction. The two-argument version stays.
--   4. Creating a coupon needs coupons.create. admin_save_coupon is otherwise unchanged:
--      changing an existing coupon still needs coupons.update, as does activating one.
--
-- Additive: new functions, and create-or-replace of functions with unchanged signatures.
-- SQLSTATEs: NZ403 missing permission, NZ412 invalid input.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The roles matrix
-- ---------------------------------------------------------------------------

create function public.admin_list_roles()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  if not (private.has_permission('staff.roles.assign') or private.has_permission('staff.permissions.manage')) then
    raise exception 'missing permission' using errcode = 'NZ403';
  end if;

  return (
    select jsonb_agg(
             jsonb_build_object(
               'role', r.role,
               'permissions', coalesce((
                 case when r.role = 'super_admin'
                   then (select jsonb_agg(p.name order by p.name) from public.permissions p)
                   else (select jsonb_agg(rp.permission order by rp.permission)
                         from public.role_permissions rp where rp.role::text = r.role)
                 end
               ), '[]'::jsonb)
             ) order by r.position)
    from unnest(array['super_admin', 'admin', 'staff', 'moderator', 'customer'])
           with ordinality as r (role, position)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Audit-log search
-- ---------------------------------------------------------------------------

create function public.admin_audit_log_search(
  p_action_prefix text default null,
  p_actor uuid default null,
  p_from date default null,
  p_to date default null,
  p_q text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id bigint,
  actor_id uuid,
  actor_email text,
  actor_name text,
  action text,
  target_type text,
  target_id text,
  details jsonb,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_pattern text;
  v_start timestamptz;
  v_end timestamptz;
begin
  perform private.require_permission('audit_logs.read');
  if p_limit not between 1 and 100 or p_offset not between 0 and 100000 then
    raise exception 'invalid page' using errcode = 'NZ412';
  end if;
  if p_action_prefix is not null and p_action_prefix !~ '^[a-z_.]{1,60}$' then
    raise exception 'invalid action filter' using errcode = 'NZ412';
  end if;
  if p_q is not null and (v_q is null or char_length(v_q) > 100) then
    raise exception 'the search must be 1 to 100 characters' using errcode = 'NZ412';
  end if;
  if p_from is not null and p_to is not null and (p_from > p_to or p_to - p_from + 1 > 366) then
    raise exception 'choose a range of 1 to 366 days' using errcode = 'NZ412';
  end if;

  -- Whole Bangladesh days: from midnight on the first day to midnight after the last.
  v_start := case when p_from is null then null else p_from::timestamp at time zone 'Asia/Dhaka' end;
  v_end := case when p_to is null then null else (p_to + 1)::timestamp at time zone 'Asia/Dhaka' end;
  -- The search text is literal: LIKE wildcards in it match themselves.
  v_pattern := case when v_q is null then null
    else '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' end;

  return query
  select a.id, a.actor_id, coalesce(p.email, u.email)::text, p.full_name, a.action, a.target_type, a.target_id,
    a.details, a.created_at, count(*) over ()
  from public.audit_log a
  left join auth.users u on u.id = a.actor_id
  left join public.profiles p on p.id = a.actor_id
  where (p_action_prefix is null or left(a.action, char_length(p_action_prefix)) = p_action_prefix)
    and (p_actor is null or a.actor_id = p_actor)
    and (v_start is null or a.created_at >= v_start)
    and (v_end is null or a.created_at < v_end)
    and (v_pattern is null
         or a.action ilike v_pattern
         or a.target_id ilike v_pattern
         or p.full_name ilike v_pattern
         or coalesce(p.email, u.email::text) ilike v_pattern)
  order by a.created_at desc, a.id desc
  limit p_limit offset p_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Store settings
-- ---------------------------------------------------------------------------

create or replace function public.admin_store_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
begin
  return (
    select jsonb_build_object(
             'returnWindowDays', return_window_days,
             'cartInactivityMinutes', cart_inactivity_minutes,
             'repeatOrderThreshold', repeat_order_threshold,
             'highSpendThresholdMinor', high_spend_threshold_minor,
             'inactiveDays', inactive_days,
             'monthlySalesTargetMinor', monthly_sales_target_minor,
             'updatedAt', updated_at
           )
    from public.store_settings where id
  );
end;
$$;

/** The customer-insight thresholds. Null keeps the current value of that threshold. */
create function public.admin_save_insight_thresholds(
  p_repeat_order_threshold integer,
  p_high_spend_threshold_minor bigint,
  p_inactive_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('settings.manage');
  v_current public.store_settings;
  v_repeat integer;
  v_high bigint;
  v_inactive integer;
begin
  select * into v_current from public.store_settings ss where ss.id for update;
  v_repeat := coalesce(p_repeat_order_threshold, v_current.repeat_order_threshold);
  v_high := coalesce(p_high_spend_threshold_minor, v_current.high_spend_threshold_minor);
  v_inactive := coalesce(p_inactive_days, v_current.inactive_days);

  if v_repeat not between 2 and 20 then
    raise exception 'a repeat customer has 2 to 20 orders' using errcode = 'NZ412';
  end if;
  if v_high not between 1 and 1000000000 then
    raise exception 'the high-spend threshold must be from 1 poisha to 10,000,000 taka' using errcode = 'NZ412';
  end if;
  if v_inactive not between 7 and 730 then
    raise exception 'inactivity must be 7 to 730 days' using errcode = 'NZ412';
  end if;

  update public.store_settings
  set repeat_order_threshold = v_repeat,
      high_spend_threshold_minor = v_high,
      inactive_days = v_inactive,
      updated_by = v_actor
  where id;

  perform private.audit(v_actor, 'settings.insight_thresholds_saved', 'store_settings', 'settings',
    jsonb_build_object('repeatOrderThreshold', v_repeat, 'highSpendThresholdMinor', v_high,
      'inactiveDays', v_inactive));
  return public.admin_store_settings();
end;
$$;

/**
 * The settings and, for any threshold that is not null, the insight thresholds, saved
 * together: if one value is invalid nothing is saved.
 */
create function public.admin_save_store_settings(
  p_return_window_days integer,
  p_cart_inactivity_minutes integer,
  p_repeat_order_threshold integer,
  p_high_spend_threshold_minor bigint,
  p_inactive_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('settings.manage');
  perform public.admin_save_store_settings(p_return_window_days, p_cart_inactivity_minutes);
  if p_repeat_order_threshold is not null or p_high_spend_threshold_minor is not null
     or p_inactive_days is not null then
    perform public.admin_save_insight_thresholds(
      p_repeat_order_threshold, p_high_spend_threshold_minor, p_inactive_days);
  end if;
  return public.admin_store_settings();
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Creating a coupon needs coupons.create
-- ---------------------------------------------------------------------------

create or replace function public.admin_save_coupon(
  p_coupon_id uuid,
  p_code text,
  p_kind text,
  p_value bigint,
  p_min_order_minor bigint default 0,
  p_max_discount_minor bigint default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_total_limit integer default null,
  p_per_customer_limit integer default 1,
  p_is_active boolean default true,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- A new coupon needs coupons.create; changing one needs coupons.update.
  v_actor uuid := private.require_permission(
    case when p_coupon_id is null then 'coupons.create' else 'coupons.update' end);
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_id uuid := p_coupon_id;
  v_kind text := coalesce(p_kind, 'percent');
begin
  if v_code !~ '^[A-Z0-9][A-Z0-9_-]{2,31}$' then
    raise exception 'use 3-32 letters, digits, dashes or underscores' using errcode = 'NZ412';
  end if;
  if v_kind not in ('percent', 'fixed') then
    raise exception 'choose a percentage or a fixed amount' using errcode = 'NZ412';
  end if;
  if p_value is null or p_value <= 0 then
    raise exception 'the discount must be more than zero' using errcode = 'NZ412';
  end if;
  if v_kind = 'percent' and p_value > 100 then
    raise exception 'a percentage cannot exceed 100' using errcode = 'NZ412';
  end if;
  if v_kind = 'fixed' and p_max_discount_minor is not null then
    raise exception 'a fixed discount needs no cap' using errcode = 'NZ412';
  end if;
  if coalesce(p_min_order_minor, 0) < 0 then
    raise exception 'the minimum order cannot be negative' using errcode = 'NZ412';
  end if;
  if coalesce(p_per_customer_limit, 1) < 1 then
    raise exception 'the per-customer limit must be at least one' using errcode = 'NZ412';
  end if;
  if p_total_limit is not null and p_total_limit < 1 then
    raise exception 'the total limit must be at least one' using errcode = 'NZ412';
  end if;
  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'the end must be after the start' using errcode = 'NZ412';
  end if;
  if exists (
    select 1 from public.coupons c
    where c.code = v_code and (v_id is null or c.id <> v_id)
  ) then
    raise exception 'a coupon with this code already exists' using errcode = 'NZ458';
  end if;

  if v_id is null then
    insert into public.coupons (
      code, description, kind, value, min_order_minor, max_discount_minor,
      starts_at, ends_at, total_limit, per_customer_limit, is_active, created_by
    ) values (
      v_code, v_description, v_kind, p_value, coalesce(p_min_order_minor, 0),
      case when v_kind = 'percent' then p_max_discount_minor else null end,
      p_starts_at, p_ends_at, p_total_limit, coalesce(p_per_customer_limit, 1),
      coalesce(p_is_active, true), v_actor
    )
    returning id into v_id;
    perform private.audit(v_actor, 'coupon.created', 'coupon', v_id::text,
      jsonb_build_object('code', v_code, 'kind', v_kind, 'value', p_value));
  else
    update public.coupons
    set code = v_code,
        description = v_description,
        kind = v_kind,
        value = p_value,
        min_order_minor = coalesce(p_min_order_minor, 0),
        max_discount_minor = case when v_kind = 'percent' then p_max_discount_minor else null end,
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        total_limit = p_total_limit,
        per_customer_limit = coalesce(p_per_customer_limit, 1),
        is_active = coalesce(p_is_active, true)
    where id = v_id;
    if not found then
      raise exception 'coupon not found' using errcode = 'NZ404';
    end if;
    perform private.audit(v_actor, 'coupon.updated', 'coupon', v_id::text,
      jsonb_build_object('code', v_code, 'kind', v_kind, 'value', p_value));
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.admin_list_roles()',
    'public.admin_audit_log_search(text, uuid, date, date, text, integer, integer)',
    'public.admin_save_insight_thresholds(integer, bigint, integer)',
    'public.admin_save_store_settings(integer, integer, integer, bigint, integer)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end;
$$;
