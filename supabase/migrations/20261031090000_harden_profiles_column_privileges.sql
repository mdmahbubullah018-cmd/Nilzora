-- S1: public.profiles exposed password_hash to the `authenticated` role.
--
-- Supabase's default `grant all on all tables in schema public to authenticated` was narrowed
-- to SELECT earlier, but a *table*-level SELECT covers every column, so `password_hash` (and
-- phone/email login metadata) stayed readable to any signed-in caller. Row Level Security
-- decides which rows a role may see; it never decides which columns, so RLS was no help here.
--
-- The API is not relying on this grant for credentials: login and OAuth read the hash through
-- the service role, and the signed-in account screen reads only the five profile columns
-- below. Replacing the table grant with an explicit column grant therefore removes the hash
-- while leaving every legitimate read and the self-service profile update working.
--
-- Idempotent: revoke-then-grant always converges on the same column set.

revoke select on public.profiles from authenticated;

-- id        -- key, and the predicate on every user-scoped read/update
-- full_name, phone -- the only columns the account screen reads and the customer may edit
-- status    -- read by the RLS policies and the account screen
-- created_at, updated_at -- displayed as "member since" and "last updated"
grant select (id, full_name, phone, status, created_at, updated_at)
  on public.profiles to authenticated;

-- anon holds no grant today. Restating it keeps a future blanket grant from silently
-- reintroducing anonymous access to profile rows.
revoke all on public.profiles from anon;
