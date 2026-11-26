-- Deleting an account cascades to its addresses as the Auth service's database role,
-- which has no privileges on public.addresses. The trigger that promotes a new
-- default address then failed ("permission denied"), so the whole account deletion
-- failed. It runs as its owner now; it only ever touches the deleted row's own
-- account, so it grants nothing a customer could not already do.

create or replace function private.addresses_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_default then
    update public.addresses
    set is_default = true
    where id = (
      select id from public.addresses
      where user_id = old.user_id
      order by created_at desc, id
      limit 1
    );
  end if;
  return old;
end;
$$;

revoke execute on function private.addresses_after_delete() from public, anon, authenticated;
