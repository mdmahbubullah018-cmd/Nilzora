import type { ApiErrorCode } from '@nilzora/contracts';

/*
 * The fixed messages courier actions show for the API's refusals. Never API text: the
 * codes are mapped here, and anything unknown falls back to the admin kit's messages.
 */
export const COURIER_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  courier_unavailable:
    'Courier connections are switched off on this server, or this courier is not enabled. Nothing was sent to the courier. Use the courier’s portal for now.',
  courier_operation_unsupported:
    'This courier has no API for that step. Do it in the courier’s portal, then record the result here.',
  shipment_not_bookable:
    'This order cannot be booked with a courier in its current state. Reload the page to see why.',
  shipment_already_active:
    'There is already an active shipment for this. Open it from the list below instead of booking again.',
  courier_quote_invalid:
    'That price has expired or no longer matches the parcel. Compare couriers again, then book.',
  invalid_shipment_transition:
    'The shipment cannot move to that status from where it is now. Reload to see its current status.',
  shipment_booking_unresolved:
    'The courier has not answered this booking clearly yet. Check the courier’s portal, then resolve the booking.',
  courier_override_reason_required:
    'You chose a courier other than the recommended one: say why before booking.',
  shipment_not_cancellable: 'This shipment can no longer be cancelled from here.',
  settlement_invalid:
    'The courier records do not add up, or this reference was already recorded. Check the amounts and the reference.',
  return_not_eligible:
    'This return cannot get a courier booking in its current state. Reload the page to see its status.',
  courier_confirmation_required:
    'This change needs the typed confirmation. Type the phrase exactly as shown, then save again.',
  courier_live_check_required:
    'Run a successful live connection check for this courier first, then verify it.',
  courier_mock_not_allowed:
    'Test mode only runs against a local database. This API uses a hosted database, so choose Off or Live.',
  forbidden: 'Your account does not have the courier permission this needs.',
};
