-- Deleting a Supabase Auth user still deletes its application account.
--
-- Before the cutover, `profiles_id_fkey ... on delete cascade` removed the profile (and,
-- through its own cascades, the account's roles, sessions, addresses, carts, device
-- tokens and orders) whenever a row in auth.users was deleted. Dropping that foreign key
-- in 20261028110000 removed that behaviour, so an account deleted through the Supabase
-- admin API would keep its data and its push tokens.
--
-- This restores it explicitly for the legacy path, so Supabase Auth keeps working while it
-- remains the fallback provider. Accounts deleted by Nilzora itself are removed by deleting
-- the profile, which is the account; this trigger only mirrors what the cascade used to do.

create or replace function public.handle_deleted_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.profiles where id = old.id;
  return old;
end;
$$;

comment on function public.handle_deleted_auth_user() is
  'Removes the application profile when its legacy Supabase Auth user is deleted, mirroring the cascade the dropped foreign key provided.';

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.handle_deleted_auth_user();
