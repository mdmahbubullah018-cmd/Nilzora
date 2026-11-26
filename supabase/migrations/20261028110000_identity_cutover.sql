-- Identity cutover: Nilzora owns its accounts.
--
-- `supabase/migrations` stays the single schema source of truth. This migration removes
-- the last two links that made `auth.users` the root of application identity, so
-- first-party registration can create an account inside the database without Supabase Auth:
--
--   * `profiles_id_fkey`            — profiles.id no longer must exist in auth.users.
--   * trigger `on_auth_user_created` — a Supabase Auth sign-up no longer fabricates a profile.
--
-- Account creation now happens in exactly one place: public.provision_account(), which
-- inserts the profile row with its email, password hash and verification state, and grants
-- the customer role. `public.handle_new_auth_user()` is left in place (unreferenced) so this
-- migration stays reversible by recreating the trigger; it is not called by anything else.
--
-- Nothing is deleted: existing profiles keep their UUIDs, roles, addresses, carts, orders,
-- device tokens, sessions and audit rows, and every relationship between them is untouched.
-- Existing Supabase Auth users keep signing in through Supabase Auth while it remains the
-- fallback provider; their rows in auth.users are simply no longer authoritative for
-- application identity.

-- ---------------------------------------------------------------------------
-- 1. The replacement path must exist before the old one is removed.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.provision_account(uuid, text, text, text, text, boolean)') is null then
    raise exception 'provision_account() is missing: refusing to detach profiles from auth.users'
      using errcode = 'NZ500';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Stop Supabase Auth sign-ups from creating application profiles.
-- ---------------------------------------------------------------------------

drop trigger if exists on_auth_user_created on auth.users;

-- ---------------------------------------------------------------------------
-- 3. Detach profiles from auth.users. Roles, RLS and ownership are unaffected: every
--    policy and function addresses public.profiles and public.user_roles, never auth.users.
-- ---------------------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_id_fkey;

comment on table public.profiles is
  'Application accounts. Identity is owned by Nilzora: id is a stable UUID that no longer depends on auth.users.';

-- ---------------------------------------------------------------------------
-- 4. provision_account() must be able to run for an account that already has a profile
--    row created by the removed trigger, and must refuse a duplicate email. Both are
--    already true; this only documents the contract the cutover depends on.
-- ---------------------------------------------------------------------------

comment on function public.provision_account(uuid, text, text, text, text, boolean) is
  'Creates an application account: profile row, customer role. The only account-creation path; callers pass a stable UUID.';
