-- orders uses column-level SELECT grants (20261024090000), so the archive columns added by
-- 20261130090000 were unreadable and every order list failed (42501). Row access is unchanged:
-- the existing RLS policies still decide which orders a caller sees (staff with orders.read,
-- a customer their own). archived_by stays unreadable; archive_reason is staff text, but
-- customers' own order reads never select it.

grant select (archived_at, archive_reason) on table public.orders to authenticated;
