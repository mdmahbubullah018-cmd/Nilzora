-- ---------------------------------------------------------------------------
-- Least privilege for three functions that do not need a PUBLIC grant
--
-- 1. `handle_deleted_auth_user()` and `sync_verified_email_from_auth_user()` are trigger
--    functions on `auth.users`. PostgreSQL does not check EXECUTE when a trigger fires, so
--    they only need to be executable by nobody: their default PUBLIC grant exposed two
--    SECURITY DEFINER entry points to `anon` that always fail on an unassigned `OLD`/`NEW`.
--    `handle_new_auth_user()` has carried a postgres-only ACL all along, which is why a
--    sign-up still creates a profile today — the same holds for these two once revoked.
--
-- 2. `quote_cart(items, address)` is the guest and checkout pricer. It never needed PUBLIC:
--    the API calls it as `anon` (a guest quote) and as `authenticated` (a checkout quote),
--    and `quote_cart_with_coupon()` calls it as its definer. The grant now names those
--    roles instead of relying on the implicit PUBLIC one.
--
-- Privileges only: no table, column, function body or signature changes, so no application
-- behaviour changes and nothing to backfill.
-- ---------------------------------------------------------------------------

revoke execute on function public.handle_deleted_auth_user() from public, anon, authenticated;
revoke execute on function public.sync_verified_email_from_auth_user()
  from public, anon, authenticated;

revoke execute on function public.quote_cart(jsonb, uuid) from public;
grant execute on function public.quote_cart(jsonb, uuid) to anon, authenticated, service_role;
