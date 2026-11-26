-- ---------------------------------------------------------------------------
-- Orders: internal notes, and archiving test orders out of the working views
--
-- Internal notes: staff-only remarks on an order (never shown to the customer). Reading
-- needs orders.read, adding needs orders.update_status; both go through functions that
-- check the caller, and every note records its author.
--
-- Archiving: a safe way to take an inappropriate or test order out of the order queues.
-- Nothing is deleted. Only an order that is cancelled, whose cash was never collected and
-- that has no return or refund can be archived; it keeps its lines, history and audit trail
-- and can be restored. Needs orders.cancel. Both directions are audited.
--
-- Additive: three columns with no default data change, one table, four functions.
-- ---------------------------------------------------------------------------

alter table public.orders
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles (id) on delete set null,
  add column archive_reason text check (archive_reason is null or char_length(archive_reason) between 3 and 300);

create index orders_not_archived_idx on public.orders (placed_at desc) where archived_at is null;

create table public.order_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index order_notes_order_idx on public.order_notes (order_id, created_at);

alter table public.order_notes enable row level security;
create policy "Order staff read internal notes"
  on public.order_notes for select to authenticated
  using ((select public.has_permission('orders.read')));
revoke all on table public.order_notes from public, anon, authenticated;
grant select on table public.order_notes to authenticated;
grant select, insert, update, delete on table public.order_notes to service_role;

/** The internal notes of one order, oldest first, with each author's name. */
create function public.admin_order_notes(p_order_number text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('orders.read');
  v_order_id uuid;
begin
  select id into v_order_id from public.orders where order_number = p_order_number;
  if not found then
    raise exception 'order not found' using errcode = 'NZ404';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', n.id,
             'body', n.body,
             'author', p.full_name,
             'createdAt', n.created_at
           ) order by n.created_at)
    from public.order_notes n
    left join public.profiles p on p.id = n.author_id
    where n.order_id = v_order_id
  ), '[]'::jsonb);
end;
$$;

/** Adds an internal note to an order. */
create function public.admin_add_order_note(p_order_number text, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('orders.update_status');
  v_body text := btrim(coalesce(p_body, ''));
  v_order_id uuid;
begin
  if char_length(v_body) not between 1 and 1000 then
    raise exception 'a note is 1 to 1000 characters' using errcode = 'NZ412';
  end if;
  select id into v_order_id from public.orders where order_number = p_order_number;
  if not found then
    raise exception 'order not found' using errcode = 'NZ404';
  end if;
  insert into public.order_notes (order_id, author_id, body) values (v_order_id, v_actor, v_body);
  perform private.audit(v_actor, 'order.note_added', 'order', p_order_number,
    jsonb_build_object('length', char_length(v_body)));
end;
$$;

/**
 * Archives (p_archive true) or restores an order. Archiving is refused (NZ442) unless the
 * order is cancelled, its cash was never collected and it has no return or refund.
 */
create function public.admin_set_order_archived(p_order_number text, p_archive boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission('orders.cancel');
  v_order public.orders;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_order from public.orders where order_number = p_order_number for update;
  if not found then
    raise exception 'order not found' using errcode = 'NZ404';
  end if;

  if coalesce(p_archive, false) then
    if v_order.status <> 'cancelled'
       or v_order.payment_status = 'collected'
       or exists (select 1 from public.return_requests r where r.order_id = v_order.id)
       or exists (select 1 from public.refunds f where f.order_id = v_order.id) then
      raise exception 'only a cancelled, unpaid order without returns or refunds can be archived'
        using errcode = 'NZ442';
    end if;
    if v_reason is null or char_length(v_reason) not between 3 and 300 then
      raise exception 'give a reason of 3 to 300 characters' using errcode = 'NZ412';
    end if;
    update public.orders
    set archived_at = now(), archived_by = v_actor, archive_reason = v_reason
    where id = v_order.id;
    perform private.audit(v_actor, 'order.archived', 'order', p_order_number,
      jsonb_build_object('reason', v_reason));
  else
    update public.orders set archived_at = null, archived_by = null, archive_reason = null
    where id = v_order.id;
    perform private.audit(v_actor, 'order.restored', 'order', p_order_number, '{}'::jsonb);
  end if;
end;
$$;

revoke execute on function public.admin_order_notes(text) from public, anon;
revoke execute on function public.admin_add_order_note(text, text) from public, anon;
revoke execute on function public.admin_set_order_archived(text, boolean, text) from public, anon;
grant execute on function public.admin_order_notes(text) to authenticated, service_role;
grant execute on function public.admin_add_order_note(text, text) to authenticated, service_role;
grant execute on function public.admin_set_order_archived(text, boolean, text) to authenticated, service_role;
