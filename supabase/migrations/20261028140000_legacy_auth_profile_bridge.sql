-- Legacy Supabase Auth bridge: a sign-up still gets a profile, but never a duplicate.
--
-- 20261028110000 removed the original `on_auth_user_created` trigger because it always
-- inserted a profile, which made first-party registration impossible. The replacement
-- keeps the Supabase Auth path usable while Supabase Auth remains the fallback provider
-- (and the only way back if the cutover is rolled back), without touching accounts that
-- Nilzora created itself through public.provision_account():
--
--   * the profile is inserted only when that id has no profile yet;
--   * the customer role is granted only when the account has no role yet;
--   * the sign-in address and its verification state are copied onto the profile, which
--     is now the authoritative record;
--   * nothing is updated or deleted, so an existing account is left exactly as it is.
--
-- First-party registration never inserts into auth.users, so this trigger does not run
-- for it and the two paths cannot conflict.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full_name text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
  v_phone text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '');
begin
  -- Signup metadata is user-controlled: keep only well-formed optional profile fields.
  if v_full_name is not null and char_length(v_full_name) > 120 then
    v_full_name := null;
  end if;
  if v_phone is not null and v_phone !~ '^\+8801[3-9][0-9]{8}$' then
    v_phone := null;
  end if;

  insert into public.profiles (id, email, full_name, phone, email_verified_at)
  values (new.id, lower(nullif(btrim(coalesce(new.email, '')), '')), v_full_name, v_phone,
          new.email_confirmed_at)
  on conflict (id) do nothing;

  -- Every new account starts as a customer, whatever the signup request contained.
  insert into public.user_roles (user_id, role)
  values (new.id, 'customer')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

comment on function public.handle_new_auth_user() is
  'Creates the application profile for a Supabase Auth sign-up when it is missing. Never overwrites an account Nilzora provisioned itself.';
