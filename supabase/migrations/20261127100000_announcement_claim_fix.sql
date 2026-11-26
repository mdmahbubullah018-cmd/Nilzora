-- claim_announcement_deliveries (20261118090000) joined on claimed.announcement_id, a column its
-- RETURNING list never produced, so every poll failed (42703) and no product announcement was
-- ever delivered. Same function, same signature and grants; the RETURNING list now carries it.

create or replace function public.claim_announcement_deliveries(
  p_limit integer default 20,
  p_lease_seconds integer default 60
)
returns table (
  id uuid,
  user_id uuid,
  product_name text,
  product_slug text,
  image_key text,
  attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit not between 1 and 100
     or p_lease_seconds is null or p_lease_seconds not between 5 and 3600 then
    raise exception 'limit must be 1-100 and lease 5-3600 seconds' using errcode = 'NZ412';
  end if;

  return query
  with due as (
    select x.id, x.user_id
    from public.product_announcement_deliveries x
    where x.next_attempt_at <= now()
      and (x.status = 'pending' or (x.status = 'sending' and x.locked_until <= now()))
    order by x.next_attempt_at, x.created_at, x.id
    limit p_limit
    for update of x skip locked
  ),
  claimed as (
    update public.product_announcement_deliveries x
    set status = case when p.status = 'active' then 'sending'::public.notification_status
                      else 'skipped'::public.notification_status end,
        locked_until = case when p.status = 'active' then now() + make_interval(secs => p_lease_seconds) end,
        attempts = x.attempts + case when p.status = 'active' then 1 else 0 end,
        last_error = case when p.status = 'active' then x.last_error else 'account_inactive' end
    from due
    join public.profiles p on p.id = due.user_id
    where x.id = due.id
    returning x.id, x.user_id, x.announcement_id, x.attempts, x.status
  )
  select c.id, c.user_id, a.product_name, a.product_slug, a.image_key, c.attempts
  from claimed c
  join public.product_announcements a on a.id = c.announcement_id
  where c.status = 'sending';
end;
$$;

