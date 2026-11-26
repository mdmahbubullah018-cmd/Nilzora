-- Registration creates an account only after the emailed code is verified.
--
-- Before this migration the API called provision_account() first and sent the code after the
-- transaction had committed, so a failed send (or a visitor who never came back) still left a
-- real customer profile behind: visible in the admin panel, holding a role, and claiming the
-- address. Now:
--
--   begin_registration()     stores the details in auth_pending_registrations (no profile,
--                            no role) and issues the code. Nothing here is an account.
--   cancel_registration()    the API calls it when the code could not be sent: the pending
--                            row and its code go, so a delivery failure leaves nothing.
--   complete_registration()  redeems the code and, in the same transaction, creates the
--                            account (or activates a legacy unverified profile), then queues
--                            its welcome email exactly once.
--
-- It also adds, for every flow that sends mail:
--   * a per-address throttle (one message a minute, five an hour) checked before anything
--     reveals whether the address is known, so it cannot be used to enumerate accounts;
--   * an atomic password reset (code, new password and session revocation in one
--     transaction) that queues a "password changed" notice;
--   * account_emails, an outbox that makes the welcome email idempotent and records whether
--     the mail server actually accepted each message.
--
-- Additive only: no table is dropped and no existing row is deleted. Profiles created by the
-- old flow that were never verified are left untouched; complete_registration() and Google
-- sign-in can activate them safely (see below).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.auth_pending_registrations (
  email text primary key check (email = lower(btrim(email)) and email <> ''),
  password_hash text not null,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.auth_pending_registrations is
  'Sign-ups waiting for their emailed code. Not accounts: no profile and no role exist until complete_registration() succeeds.';

create table public.auth_mail_log (
  id bigint generated always as identity primary key,
  email_hash bytea not null,
  kind text not null check (kind in ('register', 'reset')),
  created_at timestamptz not null default now()
);

comment on table public.auth_mail_log is
  'One row per authentication mail requested, keyed by a hash of the address (never the address), for per-address throttling.';

create index auth_mail_log_lookup on public.auth_mail_log (email_hash, kind, created_at desc);

create table public.account_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('welcome', 'password_changed')),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  last_error text check (last_error is null or char_length(last_error) <= 64),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz
);

comment on table public.account_emails is
  'Account emails to send after a committed change. `sent` means the mail server accepted the message; it says nothing about the inbox.';

-- The welcome email exists at most once per account, whatever retries or callbacks happen.
create unique index account_emails_one_welcome on public.account_emails (user_id)
  where kind = 'welcome';
create index account_emails_unsent on public.account_emails (user_id, created_at)
  where status <> 'sent';

alter table public.auth_pending_registrations enable row level security;
alter table public.auth_mail_log enable row level security;
alter table public.account_emails enable row level security;

revoke all on table public.auth_pending_registrations, public.auth_mail_log, public.account_emails
  from public, anon, authenticated;
grant select, insert, update, delete on table public.auth_pending_registrations,
  public.auth_mail_log, public.account_emails to service_role;

-- ---------------------------------------------------------------------------
-- Throttle
-- ---------------------------------------------------------------------------

/**
 * Records one authentication mail for an address, or raises NZ429 when the address has had
 * one in the last minute or five in the last hour. Called before the address is looked up,
 * so a known and an unknown address are throttled identically.
 */
create function private.auth_mail_throttle(p_email text, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea := extensions.digest(lower(btrim(coalesce(p_email, ''))), 'sha256');
begin
  -- Serialise requests for the same address so two at once cannot both pass the check.
  perform pg_advisory_xact_lock(hashtextextended(encode(v_hash, 'hex') || p_kind, 0));

  if exists (
    select 1 from public.auth_mail_log
     where email_hash = v_hash and kind = p_kind and created_at > now() - interval '60 seconds'
  ) or (
    select count(*) from public.auth_mail_log
     where email_hash = v_hash and kind = p_kind and created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception 'too many emails for this address' using errcode = 'NZ429';
  end if;

  insert into public.auth_mail_log (email_hash, kind) values (v_hash, p_kind);
  -- Housekeeping: nothing older than a day is ever read.
  delete from public.auth_mail_log where created_at < now() - interval '1 day';
end;
$$;

-- ---------------------------------------------------------------------------
-- Registration
-- ---------------------------------------------------------------------------

/**
 * Starts (or restarts) a sign-up. Returns 'code_issued' when a verification code was issued
 * for a pending registration, or 'account_exists' when the address already belongs to a
 * verified account (no code; the API sends that owner a notice instead). Creates no account.
 */
create function public.begin_registration(
  p_email text,
  p_password_hash text,
  p_full_name text,
  p_phone text,
  p_code_hash bytea,
  p_ttl interval default '10 minutes'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_profile_id uuid;
  v_verified timestamptz;
begin
  if v_email = '' then
    raise exception 'an email address is required' using errcode = 'NZ412';
  end if;
  if coalesce(p_password_hash, '') = '' then
    raise exception 'a password is required' using errcode = 'NZ412';
  end if;

  perform private.auth_mail_throttle(v_email, 'register');

  select id, email_verified_at into v_profile_id, v_verified
    from public.profiles where lower(email) = v_email;
  if v_profile_id is not null and v_verified is not null then
    return 'account_exists';
  end if;

  delete from public.auth_pending_registrations where updated_at < now() - interval '1 day';

  insert into public.auth_pending_registrations (email, password_hash, full_name, phone)
  values (v_email, p_password_hash, nullif(btrim(coalesce(p_full_name, '')), ''),
          nullif(btrim(coalesce(p_phone, '')), ''))
  on conflict (email) do update
    set password_hash = excluded.password_hash,
        full_name = excluded.full_name,
        phone = excluded.phone,
        updated_at = now();

  update public.auth_email_codes
     set consumed_at = now()
   where lower(email) = v_email and purpose = 'verify_email' and consumed_at is null;

  insert into public.auth_email_codes (email, user_id, purpose, code_hash, expires_at)
  values (v_email, v_profile_id, 'verify_email', p_code_hash, now() + p_ttl);

  return 'code_issued';
end;
$$;

/**
 * Issues a fresh verification code for a sign-up that is still waiting (a pending
 * registration, or a legacy profile that was never verified). Returns false, and issues
 * nothing, for any other address. Throttled exactly like begin_registration().
 */
create function public.reissue_verification_code(
  p_email text,
  p_code_hash bytea,
  p_ttl interval default '10 minutes'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_profile_id uuid;
  v_verified timestamptz;
begin
  perform private.auth_mail_throttle(v_email, 'register');

  select id, email_verified_at into v_profile_id, v_verified
    from public.profiles where lower(email) = v_email;
  if v_verified is not null then return false; end if;
  if v_profile_id is null
     and not exists (select 1 from public.auth_pending_registrations where email = v_email) then
    return false;
  end if;

  update public.auth_email_codes
     set consumed_at = now()
   where lower(email) = v_email and purpose = 'verify_email' and consumed_at is null;
  insert into public.auth_email_codes (email, user_id, purpose, code_hash, expires_at)
  values (v_email, v_profile_id, 'verify_email', p_code_hash, now() + p_ttl);
  return true;
end;
$$;

/**
 * Undoes begin_registration() after the code could not be delivered: the active code is
 * spent and the pending registration removed, so a failed send leaves nothing behind.
 * Never touches a profile.
 */
create function public.cancel_registration(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  update public.auth_email_codes
     set consumed_at = now()
   where lower(email) = v_email and purpose = 'verify_email' and consumed_at is null;
  delete from public.auth_pending_registrations where email = v_email;
end;
$$;

/**
 * Redeems a verification code and creates the account in the same transaction. Returns the
 * account id, or null when the code is wrong, expired, already used, out of attempts, or the
 * address meanwhile became a verified account another way (then nothing is changed).
 *
 *  - pending registration, no profile         -> provision_account(..., verified)
 *  - pending registration, unverified profile -> the verified owner of the address takes the
 *    legacy profile over with the details just confirmed; its sessions are revoked
 *  - no pending registration, unverified profile (code issued by the old flow) -> verified
 *
 * The code row is locked, so concurrent attempts cannot redeem it twice, and the welcome
 * email is queued here, at most once per account.
 */
create function public.complete_registration(p_email text, p_code_hash bytea)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_code public.auth_email_codes;
  v_pending public.auth_pending_registrations;
  v_profile_id uuid;
  v_verified timestamptz;
  v_user uuid;
  v_name text;
  v_phone text;
begin
  select * into v_code
    from public.auth_email_codes
   where lower(email) = v_email and purpose = 'verify_email' and consumed_at is null
   order by created_at desc
   limit 1
   for update;

  if not found then return null; end if;
  if v_code.expires_at <= now() or v_code.attempts >= 5 then return null; end if;
  if v_code.code_hash <> p_code_hash then
    update public.auth_email_codes set attempts = attempts + 1 where id = v_code.id;
    return null;
  end if;
  update public.auth_email_codes set consumed_at = now() where id = v_code.id;

  select * into v_pending from public.auth_pending_registrations where email = v_email for update;
  select id, email_verified_at into v_profile_id, v_verified
    from public.profiles where lower(email) = v_email for update;

  if v_verified is not null then
    -- Verified meanwhile (Google sign-in): never overwrite an active account.
    delete from public.auth_pending_registrations where email = v_email;
    return null;
  end if;

  if v_pending.email is not null then
    if v_profile_id is not null then
      v_name := nullif(btrim(coalesce(v_pending.full_name, '')), '');
      v_phone := nullif(btrim(coalesce(v_pending.phone, '')), '');
      if v_name is not null and char_length(v_name) > 120 then v_name := null; end if;
      if v_phone is not null and v_phone !~ '^\+8801[3-9][0-9]{8}$' then v_phone := null; end if;
      update public.profiles
         set password_hash = v_pending.password_hash,
             password_updated_at = now(),
             full_name = coalesce(v_name, full_name),
             phone = coalesce(v_phone, phone),
             email_verified_at = now(),
             failed_login_count = 0,
             locked_until = null
       where id = v_profile_id;
      update public.auth_sessions set revoked_at = now()
       where user_id = v_profile_id and revoked_at is null;
      v_user := v_profile_id;
    else
      v_user := public.provision_account(
        gen_random_uuid(), v_email, v_pending.full_name, v_pending.phone,
        v_pending.password_hash, true);
    end if;
    delete from public.auth_pending_registrations where email = v_email;
  elsif v_profile_id is not null then
    update public.profiles set email_verified_at = now() where id = v_profile_id;
    v_user := v_profile_id;
  else
    return null;
  end if;

  insert into public.account_emails (user_id, kind) values (v_user, 'welcome')
  on conflict (user_id) where kind = 'welcome' do nothing;
  return v_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- Password reset
-- ---------------------------------------------------------------------------

/**
 * Issues a reset code for a verified account. Returns false, issuing nothing, for any other
 * address; the throttle runs first, so both answers take the same path.
 */
create function public.begin_password_reset(
  p_email text,
  p_code_hash bytea,
  p_ttl interval default '10 minutes'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user uuid;
begin
  perform private.auth_mail_throttle(v_email, 'reset');

  select id into v_user from public.profiles
   where lower(email) = v_email and email_verified_at is not null;
  if v_user is null then return false; end if;

  update public.auth_email_codes
     set consumed_at = now()
   where lower(email) = v_email and purpose = 'reset_password' and consumed_at is null;
  insert into public.auth_email_codes (email, user_id, purpose, code_hash, expires_at)
  values (v_email, v_user, 'reset_password', p_code_hash, now() + p_ttl);
  return true;
end;
$$;

/** Spends the active reset code for an address (its email could not be sent). */
create function public.cancel_password_reset(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.auth_email_codes
     set consumed_at = now()
   where lower(email) = lower(btrim(coalesce(p_email, '')))
     and purpose = 'reset_password' and consumed_at is null;
end;
$$;

/**
 * Redeems a reset code and, in the same transaction, sets the new password hash, revokes
 * every session of the account and queues the "password changed" notice. Returns the
 * account id, or null when the code is not accepted (then nothing changes).
 */
create function public.complete_password_reset(
  p_email text,
  p_code_hash bytea,
  p_password_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_code public.auth_email_codes;
begin
  if coalesce(p_password_hash, '') = '' then
    raise exception 'a password is required' using errcode = 'NZ412';
  end if;

  select * into v_code
    from public.auth_email_codes
   where lower(email) = v_email and purpose = 'reset_password' and consumed_at is null
   order by created_at desc
   limit 1
   for update;

  if not found or v_code.user_id is null then return null; end if;
  if v_code.expires_at <= now() or v_code.attempts >= 5 then return null; end if;
  if v_code.code_hash <> p_code_hash then
    update public.auth_email_codes set attempts = attempts + 1 where id = v_code.id;
    return null;
  end if;
  update public.auth_email_codes set consumed_at = now() where id = v_code.id;

  perform public.set_password(v_code.user_id, p_password_hash);
  perform public.revoke_all_sessions(v_code.user_id);
  insert into public.account_emails (user_id, kind) values (v_code.user_id, 'password_changed');
  return v_code.user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Account email outbox
-- ---------------------------------------------------------------------------

/** Queues the welcome email for an account (Google sign-up). Idempotent. */
create function public.queue_welcome_email(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.account_emails (user_id, kind) values (p_user, 'welcome')
  on conflict (user_id) where kind = 'welcome' do nothing;
$$;

/** The account's emails that still need sending (never one already accepted). */
create function public.account_emails_due(p_user uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id from public.account_emails e
   where e.user_id = p_user
     and ((e.status in ('pending', 'failed') and e.attempts < 5)
          or (e.status = 'sending' and e.claimed_at < now() - interval '15 minutes'))
   order by e.created_at;
$$;

/**
 * Claims one email for sending. Returns its details only to the one caller that moved it to
 * `sending`, so concurrent requests, retries and repeated callbacks can never send it twice.
 * A claim abandoned for 15 minutes (a crashed process) can be taken again.
 */
create function public.claim_account_email(p_id uuid)
returns table (id uuid, kind text, email text, full_name text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with claimed as (
    update public.account_emails e
       set status = 'sending', claimed_at = now(), attempts = e.attempts + 1
     where e.id = p_id
       and ((e.status in ('pending', 'failed') and e.attempts < 5)
            or (e.status = 'sending' and e.claimed_at < now() - interval '15 minutes'))
    returning e.id, e.kind, e.user_id
  )
  select c.id, c.kind, p.email, p.full_name
    from claimed c join public.profiles p on p.id = c.user_id;
end;
$$;

/** Records the outcome of a claimed email: `sent` only when the mail server accepted it. */
create function public.finish_account_email(p_id uuid, p_sent boolean, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.account_emails
     set status = case when p_sent then 'sent' else 'failed' end,
         sent_at = case when p_sent then now() else null end,
         last_error = case when p_sent then null else left(coalesce(p_error, 'send_failed'), 64) end
   where id = p_id and status = 'sending';
$$;

-- ---------------------------------------------------------------------------
-- Grants: deny by default; only the API's service role may call these.
-- ---------------------------------------------------------------------------

revoke execute on function private.auth_mail_throttle(text, text) from public, anon, authenticated;
revoke execute on function public.begin_registration(text, text, text, text, bytea, interval)
  from public, anon, authenticated;
revoke execute on function public.reissue_verification_code(text, bytea, interval)
  from public, anon, authenticated;
revoke execute on function public.cancel_registration(text) from public, anon, authenticated;
revoke execute on function public.complete_registration(text, bytea) from public, anon, authenticated;
revoke execute on function public.begin_password_reset(text, bytea, interval)
  from public, anon, authenticated;
revoke execute on function public.cancel_password_reset(text) from public, anon, authenticated;
revoke execute on function public.complete_password_reset(text, bytea, text)
  from public, anon, authenticated;
revoke execute on function public.queue_welcome_email(uuid) from public, anon, authenticated;
revoke execute on function public.account_emails_due(uuid) from public, anon, authenticated;
revoke execute on function public.claim_account_email(uuid) from public, anon, authenticated;
revoke execute on function public.finish_account_email(uuid, boolean, text)
  from public, anon, authenticated;

grant execute on function private.auth_mail_throttle(text, text) to service_role;
grant execute on function public.begin_registration(text, text, text, text, bytea, interval)
  to service_role;
grant execute on function public.reissue_verification_code(text, bytea, interval) to service_role;
grant execute on function public.cancel_registration(text) to service_role;
grant execute on function public.complete_registration(text, bytea) to service_role;
grant execute on function public.begin_password_reset(text, bytea, interval) to service_role;
grant execute on function public.cancel_password_reset(text) to service_role;
grant execute on function public.complete_password_reset(text, bytea, text) to service_role;
grant execute on function public.queue_welcome_email(uuid) to service_role;
grant execute on function public.account_emails_due(uuid) to service_role;
grant execute on function public.claim_account_email(uuid) to service_role;
grant execute on function public.finish_account_email(uuid, boolean, text) to service_role;
