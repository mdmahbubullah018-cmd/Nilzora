-- ---------------------------------------------------------------------------
-- Notification preferences: what an account keeps, and what it is told
--
-- Settings → Notifications offered only two device switches before this: push on or off
-- (which unregisters the device) and promotional announcements. There was no way to say
-- "record returns, but stop telling me about payments", and no server-side record at all —
-- the only stored choice was `device_tokens.promotional_opt_in`, which is per device.
--
-- This adds one row per account, written only by its owner, and makes the in-app row
-- writer read it: a category that is switched off stops producing notifications. The
-- defaults are all-on, so no existing account changes behaviour and nothing is backfilled.
--
-- Why a table and not a device setting: the choice is about the *account* — it must follow
-- the customer to a new phone and must be enforced where the notification is created, not
-- where it is displayed. Push delivery stays what it already was: one switch per device
-- (register/unregister) plus the existing promotional opt-in per token, because a device
-- is the only thing that can receive a push.
--
-- Additive only: one table, two functions and one replaced function. No row is deleted.
--
-- Rollback
--   drop function public.save_my_notification_preferences(jsonb);
--   drop function public.my_notification_preferences();
--   drop table public.notification_preferences;
--   -- restore private.notify_customer from 20261213092000_customer_notifications.sql
-- ---------------------------------------------------------------------------

create table public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  order_updates boolean not null default true,
  payment_updates boolean not null default true,
  return_updates boolean not null default true,
  refund_updates boolean not null default true,
  promotions boolean not null default true,
  in_app boolean not null default true,
  updated_at timestamptz not null default now()
);

comment on table public.notification_preferences is
  'One account''s notification choices. Absent row = every category on, which is what an account that never opened Settings gets.';

comment on column public.notification_preferences.in_app is
  'False stops new notifications being recorded for the account; the history already kept stays readable.';

alter table public.notification_preferences enable row level security;

/** What the caller chose, with the all-on defaults applied when they never chose. */
create function public.my_notification_preferences()
returns table (
  order_updates boolean,
  payment_updates boolean,
  return_updates boolean,
  refund_updates boolean,
  promotions boolean,
  in_app boolean,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(p.order_updates, true),
    coalesce(p.payment_updates, true),
    coalesce(p.return_updates, true),
    coalesce(p.refund_updates, true),
    coalesce(p.promotions, true),
    coalesce(p.in_app, true),
    p.updated_at
  from (select auth.uid() as me) me
  left join public.notification_preferences p on p.user_id = me.me;
$$;

/**
 * Saves the caller's choices. Absent fields keep their current value, so a screen can save
 * one switch without sending the rest, and an unknown caller cannot touch another account:
 * the row is keyed by `auth.uid()`, never by a value from the request.
 */
create function public.save_my_notification_preferences(p_preferences jsonb)
returns table (
  order_updates boolean,
  payment_updates boolean,
  return_updates boolean,
  refund_updates boolean,
  promotions boolean,
  in_app boolean,
  updated_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'sign in to continue' using errcode = '42501';
  end if;
  if p_preferences is null or jsonb_typeof(p_preferences) <> 'object' then
    raise exception 'preferences must be an object' using errcode = 'NZ412';
  end if;
  -- Only the six booleans exist; anything else is a mistake, not something to store.
  if exists (
    select 1 from jsonb_object_keys(p_preferences) k
    where k not in ('orderUpdates', 'paymentUpdates', 'returnUpdates', 'refundUpdates',
                    'promotions', 'inApp')
  ) then
    raise exception 'unsupported preference' using errcode = 'NZ412';
  end if;
  if exists (
    select 1 from jsonb_each(p_preferences) e
    where jsonb_typeof(e.value) <> 'boolean'
  ) then
    raise exception 'preferences must be true or false' using errcode = 'NZ412';
  end if;

  insert into public.notification_preferences as p (
    user_id, order_updates, payment_updates, return_updates, refund_updates, promotions, in_app, updated_at
  )
  values (
    v_user,
    coalesce((p_preferences ->> 'orderUpdates')::boolean, true),
    coalesce((p_preferences ->> 'paymentUpdates')::boolean, true),
    coalesce((p_preferences ->> 'returnUpdates')::boolean, true),
    coalesce((p_preferences ->> 'refundUpdates')::boolean, true),
    coalesce((p_preferences ->> 'promotions')::boolean, true),
    coalesce((p_preferences ->> 'inApp')::boolean, true),
    now()
  )
  on conflict (user_id) do update set
    order_updates = coalesce((p_preferences ->> 'orderUpdates')::boolean, p.order_updates),
    payment_updates = coalesce((p_preferences ->> 'paymentUpdates')::boolean, p.payment_updates),
    return_updates = coalesce((p_preferences ->> 'returnUpdates')::boolean, p.return_updates),
    refund_updates = coalesce((p_preferences ->> 'refundUpdates')::boolean, p.refund_updates),
    promotions = coalesce((p_preferences ->> 'promotions')::boolean, p.promotions),
    in_app = coalesce((p_preferences ->> 'inApp')::boolean, p.in_app),
    updated_at = now();

  return query select * from public.my_notification_preferences();
end;
$$;

revoke execute on function public.my_notification_preferences() from public, anon, authenticated;
revoke execute on function public.save_my_notification_preferences(jsonb) from public, anon, authenticated;
grant execute on function public.my_notification_preferences() to authenticated;
grant execute on function public.save_my_notification_preferences(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The writer honours the account's choices
-- ---------------------------------------------------------------------------

/**
 * One notification for one account, written by the triggers — now only when that account
 * has not switched the category off. Same signature and same dedupe behaviour, so every
 * existing caller and every existing test keeps working; an account with no row (or a null
 * preference) is treated as "on", which is what it was before this table existed.
 *
 * A switched-off category is skipped silently and without an error: the business event it
 * belongs to (an order, a refund) must never fail because of a notification choice.
 */
create or replace function private.notify_customer(
  p_user uuid,
  p_kind public.customer_notification_kind,
  p_title text,
  p_body text,
  p_entity_type text,
  p_entity_id text,
  p_action_path text,
  p_dedupe_key text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_allow boolean;
begin
  if p_user is null then
    return;
  end if;

  select case p_kind
           when 'order_update' then coalesce(pref.in_app, true) and coalesce(pref.order_updates, true)
           when 'payment_update' then coalesce(pref.in_app, true) and coalesce(pref.payment_updates, true)
           when 'return_update' then coalesce(pref.in_app, true) and coalesce(pref.return_updates, true)
           when 'refund_update' then coalesce(pref.in_app, true) and coalesce(pref.refund_updates, true)
         end
    into v_allow
    from (select 1) one
    left join public.notification_preferences pref on pref.user_id = p_user;

  if not coalesce(v_allow, true) then
    return;
  end if;

  insert into public.customer_notifications (
    user_id, kind, title, body, entity_type, entity_id, action_path, dedupe_key
  )
  values (
    p_user, p_kind, left(p_title, 120), left(p_body, 500),
    p_entity_type, p_entity_id, p_action_path, left(p_dedupe_key, 160)
  )
  on conflict (dedupe_key) do nothing;
end;
$$;

revoke execute on function private.notify_customer(
  uuid, public.customer_notification_kind, text, text, text, text, text, text
) from public, anon, authenticated;
