-- ---------------------------------------------------------------------------
-- Courier integration (3 of 3): record a parcel booked in the courier's own portal
--
-- The hybrid half of the courier system. Until a courier's API is verified (or for a
-- courier that has none), staff book the parcel in the courier's merchant portal and record
-- it here with the consignment id the portal gave them. The shipment then lives exactly like
-- an API booking: the same idempotent booking key, the same one-active-shipment rule, the
-- `booked` event (which tells the customer), the expected COD in the ledger, tracking by
-- hand or by webhook, cancellation and reconciliation.
--
-- Nothing is sent to a courier: this only records what staff already did. The courier must
-- be enabled by the owner (or the row is a local mock), and the order must be bookable, as
-- for an API booking. A return pickup booked in the portal is recorded the same way.
--
-- Rollback (local only): drop function public.admin_record_portal_booking(text, uuid, uuid,
-- text, integer, text, text, bigint, text, text, text, boolean).
-- ---------------------------------------------------------------------------

create function public.admin_record_portal_booking(
  p_order_number text,
  p_return_id uuid,
  p_booking_key uuid,
  p_provider text,
  p_weight_grams integer,
  p_consignment_id text,
  p_tracking_code text,
  p_charge_minor bigint,
  p_note text,
  p_recommended_provider text,
  p_selection_reason text,
  p_is_mock boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_permission(
    case when p_return_id is null then 'shipments.create' else 'shipments.returns.manage' end
  );
  v_order public.orders;
  v_return public.return_requests;
  v_known boolean;
  v_begin jsonb;
  v_shipment public.shipments;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_consignment text := nullif(btrim(coalesce(p_consignment_id, '')), '');
begin
  if v_consignment is null or char_length(v_consignment) > 80 then
    raise exception 'give the consignment id the courier portal showed' using errcode = 'NZ412';
  end if;
  if v_note is null or char_length(v_note) not between 5 and 300 then
    raise exception 'say where and how it was booked' using errcode = 'NZ412';
  end if;
  if p_charge_minor is not null and p_charge_minor not between 0 and 10000000 then
    raise exception 'invalid courier charge' using errcode = 'NZ412';
  end if;

  select * into v_order from public.orders o where o.order_number = p_order_number for update;
  if not found then
    raise exception 'order not found' using errcode = 'NZ404';
  end if;
  v_known := exists (select 1 from public.shipments s where s.booking_key = p_booking_key);

  if p_return_id is null then
    if not v_known and v_order.status not in ('confirmed', 'processing', 'shipped') then
      raise exception 'an order that is % cannot be booked with a courier', v_order.status
        using errcode = 'NZ601';
    end if;
    v_begin := private.shipment_begin(
      v_actor, v_order, 'forward', null, null, p_booking_key, p_provider, null, p_weight_grams,
      private.order_cod_due(v_order), v_note, p_recommended_provider, p_selection_reason,
      '{}'::jsonb, p_is_mock
    );
  else
    select * into v_return from public.return_requests r where r.id = p_return_id for update;
    if not found or v_return.order_id <> v_order.id then
      raise exception 'return not found' using errcode = 'NZ404';
    end if;
    if not v_known and v_return.status <> 'approved' then
      raise exception 'a pickup can be booked only for an approved return' using errcode = 'NZ607';
    end if;
    v_begin := private.shipment_begin(
      v_actor, v_order, 'return_pickup', v_return.id, null, p_booking_key, p_provider, null,
      p_weight_grams, 0, v_note, null, null, '{}'::jsonb, p_is_mock
    );
  end if;

  select * into v_shipment from public.shipments s
  where s.id = (v_begin -> 'shipment' ->> 'id')::uuid for update;

  -- A repeat of the same booking key records nothing new.
  if (v_begin ->> 'shouldCall')::boolean then
    -- Nothing was sent to a courier, so the "call" never started.
    update public.shipments set provider_call_started_at = null where id = v_shipment.id;
    perform private.shipment_mark_booked(v_shipment, v_consignment, p_tracking_code, null, null,
      p_charge_minor, v_actor, 'portal');
    perform private.audit(v_actor, 'shipment.portal_booking_recorded', 'shipment', v_shipment.id::text,
      jsonb_build_object('orderNumber', v_order.order_number, 'kind', v_shipment.kind,
                         'provider', v_shipment.provider, 'consignmentId', v_consignment,
                         'isMock', v_shipment.is_mock));
    select * into v_shipment from public.shipments s where s.id = v_shipment.id;
  end if;

  return private.shipment_json(v_shipment, private.has_permission('couriers.cod.read'));
end;
$$;

revoke execute on function public.admin_record_portal_booking(
  text, uuid, uuid, text, integer, text, text, bigint, text, text, text, boolean
) from public, anon;
grant execute on function public.admin_record_portal_booking(
  text, uuid, uuid, text, integer, text, text, bigint, text, text, text, boolean
) to authenticated;
