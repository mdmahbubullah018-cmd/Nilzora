'use server';

import { randomUUID } from 'node:crypto';
import {
  bookExchangeShipmentRequestSchema,
  bookReturnPickupRequestSchema,
  bookShipmentRequestSchema,
  cancelShipmentRequestSchema,
  COURIER_LIVE_CONFIRMATION,
  courierBaseUrlRequestSchema,
  courierCompareRequestSchema,
  courierCredentialRequestSchema,
  courierLiveVerificationRequestSchema,
  courierLocationMappingRequestSchema,
  courierOperationsRequestSchema,
  courierProviderRequestSchema,
  courierVerifyConfirmation,
  courierRateCardRequestSchema,
  courierSettingsRequestSchema,
  MANUAL_SHIPMENT_STATUSES,
  orderNumberSchema,
  recordCodAdjustmentRequestSchema,
  recordCodCollectedRequestSchema,
  recordCourierSettlementRequestSchema,
  recordPortalBookingRequestSchema,
  recordShipmentStatusRequestSchema,
  resolveShipmentBookingRequestSchema,
  setCodStateRequestSchema,
  SHIPMENT_STATUS_LABELS,
  type BookShipmentResponse,
  type CourierSettlementLine,
} from '@nilzora/contracts';
import type { SessionCall } from '@nilzora/web-session';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import {
  adminAct,
  formText,
  invalid,
  takaToMinor,
  type ActionState,
} from '@/components/admin-kit/act';
import { oneOf } from '@/components/admin-kit/href';
import { uuidParam } from '@/components/customers/customer-query';
import { COURIER_MESSAGES } from '@/components/shipments/courier-messages';
import type { BookingState, CompareState } from '@/components/shipments/courier-state';
import {
  isProviderId,
  kgTextToGrams,
  OPERATIONS_PATHS,
  percentTextToBasisPoints,
  providerName,
  shipmentHref,
} from '@/components/shipments/shipment-labels';
import { formatMoney } from './format';

/*
 * Courier and shipment changes. The API and the database decide every one of them
 * (permission, the shipment's state, the amounts); these actions shape the request, check
 * what can be checked before a round trip, and turn refusals into fixed messages.
 *
 * Nothing here books on its own, marks an order's cash collected, or changes the
 * customer's shipping charge: each action is one explicit staff step.
 */

const MISSING: ActionState = {
  status: 'error',
  message: 'This record could not be identified. Reload the page and try again.',
};

const WEIGHT_MESSAGE = 'Enter the parcel weight in kilograms, from 0.001 to 50 (e.g. 0.5).';

function orderPath(orderNumber: string): Route {
  return `/admin/orders/${orderNumber}` as Route;
}

function returnPath(returnId: string): Route {
  return `/admin/returns/${returnId}` as Route;
}

function refreshOperations(): void {
  revalidatePath(OPERATIONS_PATHS.couriers);
  revalidatePath(OPERATIONS_PATHS.shipments);
  revalidatePath(OPERATIONS_PATHS.cod);
}

function shipmentId(formData: FormData): string | undefined {
  return uuidParam(formText(formData, 'shipmentId'));
}

/** Optional text: undefined when blank. */
function optional(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed ? trimmed : undefined;
}

// ---------------------------------------------------------------------------
// One order: compare and book
// ---------------------------------------------------------------------------

/** Asks every courier for a price for this order's parcel and returns the recommendation. */
export async function compareCouriersAction(
  _previous: CompareState,
  formData: FormData,
): Promise<CompareState> {
  const orderNumber = orderNumberSchema.safeParse(formText(formData, 'orderNumber'));
  if (!orderNumber.success) return MISSING;
  const weight = formText(formData, 'weight');
  const weightGrams = kgTextToGrams(weight);
  const parsed = courierCompareRequestSchema.safeParse({ weightGrams });
  if (weightGrams === undefined || !parsed.success) {
    return invalid(WEIGHT_MESSAGE, { weight: WEIGHT_MESSAGE }, { weight });
  }

  const result = await adminAct(
    formData,
    (api, token) => api.adminCompareCouriers(token, orderNumber.data, parsed.data),
    {
      returnTo: orderPath(orderNumber.data),
      label: 'courier comparison',
      messages: COURIER_MESSAGES,
    },
  );
  if (!result.ok) return { ...result.state, values: { weight } };
  return {
    status: 'success',
    comparison: result.value,
    bookingKey: randomUUID(),
    values: { weight },
  };
}

/** The booking outcome as the form shows it (fixed words; the courier's reason is stored data). */
function bookingState(response: BookShipmentResponse, bookingKey: string): BookingState {
  const { shipment, outcome, duplicate } = response;
  const courier = shipment.providerName || providerName(shipment.provider);
  const message =
    outcome === 'booked'
      ? `Booked with ${courier}${shipment.consignmentId ? ` (consignment ${shipment.consignmentId})` : ''}.`
      : outcome === 'failed'
        ? `${courier} refused the booking, so no parcel was created${shipment.bookingError ? `: ${shipment.bookingError}` : '.'}`
        : outcome === 'uncertain'
          ? `${courier} did not answer clearly. Check the courier portal for ${shipment.merchantRef}, then resolve the booking on the shipment page.`
          : 'This booking is already being sent. Wait a moment, then reload the page.';
  return {
    status: outcome === 'booked' ? 'success' : 'error',
    message,
    outcome,
    duplicate,
    shipmentId: shipment.id,
    courier,
    consignmentId: shipment.consignmentId,
    bookingKey,
  };
}

/**
 * Books the chosen courier for an order. The booking key comes from the form, created once
 * for it, so a retry of the same form never books twice.
 */
export async function bookShipmentAction(
  _previous: BookingState,
  formData: FormData,
): Promise<BookingState> {
  const orderNumber = orderNumberSchema.safeParse(formText(formData, 'orderNumber'));
  if (!orderNumber.success) return MISSING;
  const bookingKey = formText(formData, 'bookingKey');
  const provider = formText(formData, 'provider');
  const recommended = formText(formData, 'recommendedProvider');
  const selectionReason = formText(formData, 'selectionReason').trim();
  const note = formText(formData, 'note').trim();
  const values = { provider, selectionReason, note };

  if (!isProviderId(provider)) {
    return {
      ...invalid('Choose a courier.', { provider: 'Choose a courier.' }, values),
      bookingKey,
    };
  }
  if (recommended && recommended !== provider && selectionReason.length < 3) {
    const message = `Say why you chose ${providerName(provider)} over the recommended ${providerName(recommended)}.`;
    return { ...invalid(message, { selectionReason: message }, values), bookingKey };
  }
  const parsed = bookShipmentRequestSchema.safeParse({
    bookingKey,
    provider,
    quoteId: optional(formText(formData, 'quoteId')),
    weightGrams: Number(formText(formData, 'weightGrams')),
    note: optional(note),
    recommendedProvider: isProviderId(recommended) ? recommended : undefined,
    selectionReason: selectionReason || undefined,
  });
  if (!parsed.success) {
    return {
      ...invalid('This booking form is incomplete. Compare couriers again, then book.', {}, values),
      bookingKey,
    };
  }

  const result = await adminAct(
    formData,
    (api, token) => api.adminBookShipment(token, orderNumber.data, parsed.data),
    {
      returnTo: orderPath(orderNumber.data),
      label: 'shipment booking',
      messages: COURIER_MESSAGES,
    },
  );
  // Refused or unanswered: the same form (and key) may be sent again safely.
  if (!result.ok) return { ...result.state, values, bookingKey };

  revalidatePath(orderPath(orderNumber.data));
  refreshOperations();
  return bookingState(result.value, bookingKey);
}

// ---------------------------------------------------------------------------
// Returns: pickup and exchange
// ---------------------------------------------------------------------------

/**
 * Records a parcel staff already booked in the courier's own merchant portal (an order's
 * delivery, or a return pickup when `returnId` is sent). Nothing is sent to the courier.
 * The key comes from the form, created once for it, so a retry never records twice.
 */
export async function recordPortalBookingAction(
  _previous: BookingState,
  formData: FormData,
): Promise<BookingState> {
  const orderNumber = orderNumberSchema.safeParse(formText(formData, 'orderNumber'));
  if (!orderNumber.success) return MISSING;
  const returnText = formText(formData, 'returnId');
  const returnId = returnText ? uuidParam(returnText) : undefined;
  if (returnText && !returnId) return MISSING;
  const bookingKey = formText(formData, 'bookingKey');
  const provider = formText(formData, 'provider');
  const recommended = formText(formData, 'recommendedProvider');
  const weight = formText(formData, 'weight');
  const consignmentId = formText(formData, 'consignmentId').trim();
  const trackingCode = formText(formData, 'trackingCode').trim();
  const charge = formText(formData, 'charge').trim();
  const note = formText(formData, 'note').trim();
  const selectionReason = formText(formData, 'selectionReason').trim();
  const values = { provider, weight, consignmentId, trackingCode, charge, note, selectionReason };
  const refuse = (message: string, fieldErrors: Record<string, string>): BookingState => ({
    ...invalid(message, fieldErrors, values),
    bookingKey,
  });

  if (!isProviderId(provider))
    return refuse('Choose the courier.', { provider: 'Choose the courier.' });
  if (recommended && recommended !== provider && selectionReason.length < 3) {
    const message = `Say why you chose ${providerName(provider)} over the recommended ${providerName(recommended)}.`;
    return refuse(message, { selectionReason: message });
  }
  const weightGrams = kgTextToGrams(weight);
  const chargeMinor = charge === '' ? undefined : takaToMinor(charge);
  const fieldErrors: Record<string, string> = {};
  if (weightGrams === undefined) fieldErrors.weight = WEIGHT_MESSAGE;
  if (!consignmentId)
    fieldErrors.consignmentId = 'Enter the consignment id the courier portal shows.';
  if (charge !== '' && chargeMinor === undefined) {
    fieldErrors.charge = 'Enter the charge in taka (e.g. 60), or leave it empty.';
  }
  if (note.length < 5) fieldErrors.note = 'Say where and how it was booked (5 to 300 characters).';
  const parsed = recordPortalBookingRequestSchema.safeParse({
    bookingKey,
    provider,
    returnId,
    weightGrams,
    consignmentId,
    trackingCode: trackingCode || undefined,
    chargeMinor,
    note,
    recommendedProvider: isProviderId(recommended) ? recommended : undefined,
    selectionReason: selectionReason || undefined,
  });
  if (Object.keys(fieldErrors).length > 0 || !parsed.success) {
    if (Object.keys(fieldErrors).length === 0) {
      for (const issue of parsed.success ? [] : parsed.error.issues) {
        const field = String(issue.path[0] ?? '');
        if (field === 'consignmentId' || field === 'trackingCode') {
          fieldErrors[field] = 'Use at most 80 characters.';
        } else if (field === 'chargeMinor')
          fieldErrors.charge = 'Enter a charge up to 100,000 taka.';
        else if (field === 'note') fieldErrors.note = 'Keep the note to 300 characters.';
      }
    }
    return refuse(
      Object.keys(fieldErrors).length > 0
        ? 'Check the highlighted fields.'
        : 'This form is incomplete. Reload the page and try again.',
      fieldErrors,
    );
  }

  const result = await adminAct(
    formData,
    (api, token) => api.adminRecordPortalBooking(token, orderNumber.data, parsed.data),
    {
      returnTo: returnId ? returnPath(returnId) : orderPath(orderNumber.data),
      label: 'portal booking record',
      messages: COURIER_MESSAGES,
    },
  );
  // Refused or unanswered: the same form (and key) may be sent again safely.
  if (!result.ok) return { ...result.state, values, bookingKey };

  revalidatePath(orderPath(orderNumber.data));
  if (returnId) revalidatePath(returnPath(returnId));
  refreshOperations();
  const shipment = result.value;
  const courier = shipment.providerName || providerName(shipment.provider);
  return {
    status: 'success',
    outcome: 'booked',
    message: `Recorded the ${courier} portal booking (consignment ${shipment.consignmentId ?? consignmentId}). Nothing was sent to the courier from Nilzora.`,
    shipmentId: shipment.id,
    courier,
    consignmentId: shipment.consignmentId,
    duplicate: false,
    bookingKey,
  };
}

/** Books a courier to collect an approved return, or to deliver its exchange. */
export async function bookReturnShipmentAction(
  _previous: BookingState,
  formData: FormData,
): Promise<BookingState> {
  const returnId = uuidParam(formText(formData, 'returnId'));
  if (!returnId) return MISSING;
  const kind = oneOf(formText(formData, 'kind'), ['return_pickup', 'exchange'] as const);
  if (!kind) return MISSING;
  const bookingKey = formText(formData, 'bookingKey');
  const provider = formText(formData, 'provider');
  const weight = formText(formData, 'weight');
  const cash = formText(formData, 'cash');
  const note = formText(formData, 'note').trim();
  const values = { provider, weight, cash, note };

  if (!isProviderId(provider)) {
    return {
      ...invalid('Choose a courier.', { provider: 'Choose a courier.' }, values),
      bookingKey,
    };
  }
  const weightGrams = kgTextToGrams(weight);
  if (weightGrams === undefined) {
    return { ...invalid(WEIGHT_MESSAGE, { weight: WEIGHT_MESSAGE }, values), bookingKey };
  }
  const common = { bookingKey, provider, weightGrams, note: optional(note) };
  let call: SessionCall<BookShipmentResponse>;
  if (kind === 'exchange') {
    const codAmountMinor = cash.trim() === '' ? 0 : takaToMinor(cash);
    const parsed = bookExchangeShipmentRequestSchema.safeParse({ ...common, codAmountMinor });
    if (codAmountMinor === undefined || !parsed.success) {
      const message = 'Enter the cash to collect in taka (0 for a like-for-like swap).';
      return { ...invalid(message, { cash: message }, values), bookingKey };
    }
    call = (api, token) => api.adminBookExchangeShipment(token, returnId, parsed.data);
  } else {
    const parsed = bookReturnPickupRequestSchema.safeParse(common);
    if (!parsed.success) {
      return {
        ...invalid('This booking form is incomplete. Reload the page.', {}, values),
        bookingKey,
      };
    }
    call = (api, token) => api.adminBookReturnPickup(token, returnId, parsed.data);
  }

  const result = await adminAct(formData, call, {
    returnTo: returnPath(returnId),
    label: kind === 'exchange' ? 'exchange booking' : 'return pickup booking',
    messages: COURIER_MESSAGES,
  });
  if (!result.ok) return { ...result.state, values, bookingKey };

  revalidatePath(returnPath(returnId));
  refreshOperations();
  return bookingState(result.value, bookingKey);
}

// ---------------------------------------------------------------------------
// One shipment
// ---------------------------------------------------------------------------

function refreshShipment(id: string): void {
  revalidatePath(shipmentHref(id));
  refreshOperations();
}

const REFRESH_WORDS = {
  synced: 'Tracking is up to date with the courier.',
  queued: 'The tracking check is queued; the status updates when the courier answers.',
  unsupported:
    'This courier cannot be asked for tracking from here. Check its portal and record the status by hand.',
} as const;

/** Asks the courier for the shipment's latest status (or queues the check). */
export async function refreshShipmentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = shipmentId(formData);
  if (!id) return MISSING;
  const result = await adminAct(formData, (api, token) => api.adminRefreshShipment(token, id), {
    returnTo: shipmentHref(id),
    label: 'shipment tracking refresh',
    messages: COURIER_MESSAGES,
  });
  if (!result.ok) return result.state;
  refreshShipment(id);
  return {
    status: result.value.result === 'unsupported' ? 'error' : 'success',
    message: `${REFRESH_WORDS[result.value.result]} Status: ${SHIPMENT_STATUS_LABELS[result.value.shipment.status]}.`,
    values: { result: result.value.result },
  };
}

/** A datetime-local value ("2026-11-14T15:30") on the Bangladesh clock as an ISO time. */
function dhakaDateTime(text: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return undefined;
  const iso = `${text}:00+06:00`;
  return Number.isNaN(new Date(iso).getTime()) ? undefined : iso;
}

/** Records a courier status staff saw in the courier's portal or heard from the rider. */
export async function recordShipmentStatusAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = shipmentId(formData);
  if (!id) return MISSING;
  const status = formText(formData, 'status');
  const note = formText(formData, 'note');
  const when = formText(formData, 'occurredAt');
  const values = { status, note, occurredAt: when };
  if (!oneOf(status, MANUAL_SHIPMENT_STATUSES)) {
    return invalid(
      'Choose the status to record.',
      { status: 'Choose the status to record.' },
      values,
    );
  }
  const occurredAt = when ? dhakaDateTime(when) : undefined;
  if (when && !occurredAt) {
    return invalid(
      'Enter a valid date and time.',
      { occurredAt: 'Enter a valid date and time.' },
      values,
    );
  }
  const parsed = recordShipmentStatusRequestSchema.safeParse({ status, note, occurredAt });
  if (!parsed.success) {
    const message = 'Say where this status comes from (5 to 300 characters).';
    return invalid(message, { note: message }, values);
  }
  const result = await adminAct(
    formData,
    (api, token) => api.adminRecordShipmentStatus(token, id, parsed.data),
    { returnTo: shipmentHref(id), label: 'shipment status record', messages: COURIER_MESSAGES },
  );
  if (!result.ok) return { ...result.state, values };
  refreshShipment(id);
  const label = SHIPMENT_STATUS_LABELS[parsed.data.status];
  return result.value.applied
    ? {
        status: 'success',
        message: `Recorded “${label}”. The shipment is now ${SHIPMENT_STATUS_LABELS[result.value.shipment.status]}.`,
      }
    : {
        status: 'success',
        message: `“${label}” was recorded in the timeline but did not move the shipment (it is older than, or not allowed after, its current status).`,
      };
}

/** Cancels a shipment, with the courier where its API allows, else as done in its portal. */
export async function cancelShipmentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = shipmentId(formData);
  if (!id) return MISSING;
  const reason = formText(formData, 'reason');
  const inPortal = formText(formData, 'cancelledInPortal') === 'on';
  const needsPortal = formText(formData, 'needsPortal') === '1';
  const values = { reason };
  const parsed = cancelShipmentRequestSchema.safeParse({ reason, cancelledInPortal: inPortal });
  if (!parsed.success) {
    const message = 'Give a reason of 3 to 300 characters.';
    return invalid(message, { reason: message }, values);
  }
  if (needsPortal && !inPortal) {
    const message =
      'This courier cannot be cancelled from here: cancel it in the courier portal first, then confirm.';
    return invalid(message, { cancelledInPortal: message }, values);
  }
  const result = await adminAct(
    formData,
    (api, token) => api.adminCancelShipment(token, id, parsed.data),
    { returnTo: shipmentHref(id), label: 'shipment cancellation', messages: COURIER_MESSAGES },
  );
  if (!result.ok) return { ...result.state, values };
  refreshShipment(id);
  revalidatePath(orderPath(result.value.orderNumber));
  return {
    status: 'success',
    message: 'The shipment is cancelled. The order itself is unchanged.',
  };
}

/** Settles an uncertain booking after staff checked the courier's portal. */
export async function resolveBookingAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = shipmentId(formData);
  if (!id) return MISSING;
  const outcome = formText(formData, 'outcome');
  const consignmentId = formText(formData, 'consignmentId');
  const trackingCode = formText(formData, 'trackingCode');
  const note = formText(formData, 'note');
  const values = { outcome, consignmentId, trackingCode, note };
  const parsed = resolveShipmentBookingRequestSchema.safeParse(
    outcome === 'booked'
      ? { outcome, consignmentId, trackingCode: optional(trackingCode), note }
      : { outcome, note },
  );
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? 'outcome');
      fieldErrors[field] =
        field === 'consignmentId'
          ? 'Enter the consignment id shown in the courier portal.'
          : field === 'note'
            ? 'Say what you found in the portal (5 to 300 characters).'
            : 'Choose what you found in the courier portal.';
    }
    return invalid('Check the highlighted fields.', fieldErrors, values);
  }
  const result = await adminAct(
    formData,
    (api, token) => api.adminResolveShipmentBooking(token, id, parsed.data),
    { returnTo: shipmentHref(id), label: 'booking resolution', messages: COURIER_MESSAGES },
  );
  if (!result.ok) return { ...result.state, values };
  refreshShipment(id);
  revalidatePath(orderPath(result.value.orderNumber));
  return {
    status: 'success',
    message:
      parsed.data.outcome === 'booked'
        ? 'Recorded as booked with the consignment from the portal.'
        : 'Recorded as not created. The order can be booked again.',
  };
}

// ---------------------------------------------------------------------------
// Cash on delivery (courier side; the order's own cash collection is separate)
// ---------------------------------------------------------------------------

/** What the courier reports it collected for a shipment, with its report reference. */
export async function recordCodCollectedAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = shipmentId(formData);
  if (!id) return MISSING;
  const amount = formText(formData, 'amount');
  const evidenceRef = formText(formData, 'evidenceRef');
  const note = formText(formData, 'note');
  const values = { amount, evidenceRef, note };
  const amountMinor = takaToMinor(amount);
  const parsed = recordCodCollectedRequestSchema.safeParse({
    amountMinor,
    evidenceRef,
    note: optional(note),
  });
  if (amountMinor === undefined || !parsed.success) {
    const fieldErrors: Record<string, string> = {};
    if (amountMinor === undefined) fieldErrors.amount = 'Enter the amount in taka, e.g. 1250.';
    if (!evidenceRef.trim())
      fieldErrors.evidenceRef = 'Enter the courier report or invoice reference.';
    return invalid('Check the highlighted fields.', fieldErrors, values);
  }
  const result = await adminAct(
    formData,
    (api, token) => api.adminRecordCodCollected(token, id, parsed.data),
    { returnTo: shipmentHref(id), label: 'courier COD collection', messages: COURIER_MESSAGES },
  );
  if (!result.ok) return { ...result.state, values };
  refreshShipment(id);
  return {
    status: 'success',
    message: `Recorded ${formatMoney(parsed.data.amountMinor)} collected by the courier. The order’s own payment is unchanged.`,
  };
}

/** A signed correction with a reason. */
export async function recordCodAdjustmentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = shipmentId(formData);
  if (!id) return MISSING;
  const amount = formText(formData, 'amount');
  const direction = formText(formData, 'direction');
  const note = formText(formData, 'note');
  const values = { amount, direction, note };
  const magnitude = takaToMinor(amount);
  const amountMinor =
    magnitude === undefined ? undefined : direction === 'debit' ? -magnitude : magnitude;
  const parsed = recordCodAdjustmentRequestSchema.safeParse({ amountMinor, note });
  if (amountMinor === undefined || !parsed.success) {
    const fieldErrors: Record<string, string> = {};
    if (!amountMinor) fieldErrors.amount = 'Enter a non-zero amount in taka.';
    if (note.trim().length < 5) fieldErrors.note = 'Give the reason (5 to 300 characters).';
    return invalid('Check the highlighted fields.', fieldErrors, values);
  }
  const result = await adminAct(
    formData,
    (api, token) => api.adminRecordCodAdjustment(token, id, parsed.data),
    { returnTo: shipmentHref(id), label: 'COD adjustment', messages: COURIER_MESSAGES },
  );
  if (!result.ok) return { ...result.state, values };
  refreshShipment(id);
  return {
    status: 'success',
    message: `Adjustment of ${formatMoney(parsed.data.amountMinor)} recorded.`,
  };
}

const STATE_DONE = {
  open: 'COD reopened.',
  disputed: 'COD marked as disputed.',
  reconciled: 'COD reconciled and closed.',
} as const;

/** Disputes, reconciles (closes) or reopens a shipment's COD. */
export async function setCodStateAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = shipmentId(formData);
  if (!id) return MISSING;
  const state = formText(formData, 'state');
  const note = formText(formData, 'note');
  const values = { state, note };
  const parsed = setCodStateRequestSchema.safeParse({ state, note: optional(note) });
  if (!parsed.success)
    return invalid('Choose what to do and keep the note under 300 characters.', {}, values);
  if (parsed.data.state === 'disputed' && note.trim().length < 5) {
    const message = 'Say what is disputed (5 to 300 characters).';
    return invalid(message, { note: message }, values);
  }
  const result = await adminAct(
    formData,
    (api, token) => api.adminSetCodState(token, id, parsed.data),
    {
      returnTo: shipmentHref(id),
      label: 'COD state change',
      messages: {
        ...COURIER_MESSAGES,
        settlement_invalid: 'The amounts differ: give the reason to close it anyway.',
        validation_failed:
          'The amounts differ or a reason is missing: add a note of at least 5 characters.',
      },
    },
  );
  if (!result.ok) return { ...result.state, values };
  refreshShipment(id);
  return { status: 'success', message: STATE_DONE[parsed.data.state] };
}

interface SettlementLineInput {
  shipmentId?: unknown;
  settled?: unknown;
  deliveryCharge?: unknown;
  codFee?: unknown;
  returnCharge?: unknown;
  other?: unknown;
}

function lineAmount(value: unknown): number | undefined | null {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  return takaToMinor(value) ?? null;
}

/** One courier payout split over its shipments; the lines must add up to the payout. */
export async function recordSettlementAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const provider = formText(formData, 'provider');
  const reference = formText(formData, 'reference');
  const amount = formText(formData, 'amount');
  const receivedOn = formText(formData, 'receivedOn');
  const note = formText(formData, 'note');
  const values = { provider, reference, amount, receivedOn, note };
  let raw: unknown;
  try {
    raw = JSON.parse(formText(formData, 'lines') || '[]');
  } catch {
    raw = null;
  }
  if (!Array.isArray(raw))
    return invalid('The settlement lines could not be read. Reload the page.', {}, values);

  const lines: CourierSettlementLine[] = [];
  for (const item of raw as SettlementLineInput[]) {
    const id = typeof item.shipmentId === 'string' ? uuidParam(item.shipmentId) : undefined;
    const settled = lineAmount(item.settled);
    const parts = {
      deliveryChargeMinor: lineAmount(item.deliveryCharge),
      codFeeMinor: lineAmount(item.codFee),
      returnChargeMinor: lineAmount(item.returnCharge),
      otherDeductionMinor: lineAmount(item.other),
    };
    if (!id || settled === undefined || settled === null || Object.values(parts).includes(null)) {
      const message =
        'Every chosen shipment needs a settled amount in taka; deductions are optional.';
      return invalid(message, { lines: message }, values);
    }
    lines.push({
      shipmentId: id,
      settledMinor: settled,
      ...Object.fromEntries(Object.entries(parts).filter(([, v]) => v !== undefined)),
    });
  }
  const amountMinor = takaToMinor(amount);
  const parsed = recordCourierSettlementRequestSchema.safeParse({
    provider,
    reference,
    amountMinor,
    receivedOn,
    note: optional(note),
    isMock: formText(formData, 'isMock') === 'on',
    lines,
  });
  if (amountMinor === undefined || !parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.success ? [] : parsed.error.issues) {
      const field = String(issue.path[0] ?? '');
      if (field === 'lines') {
        fieldErrors.lines =
          lines.length === 0
            ? 'Choose at least one shipment.'
            : issue.message === 'A shipment appears twice'
              ? 'A shipment appears twice.'
              : 'The settled amounts must add up to the payout amount.';
      } else if (field === 'reference')
        fieldErrors.reference = 'Enter the courier payout reference (2 to 80 characters).';
      else if (field === 'receivedOn') fieldErrors.receivedOn = 'Enter the day the money arrived.';
      else if (field === 'provider') fieldErrors.provider = 'Choose the courier.';
    }
    if (amountMinor === undefined) fieldErrors.amount = 'Enter the payout amount in taka.';
    return invalid('Check the highlighted fields.', fieldErrors, values);
  }
  const result = await adminAct(
    formData,
    (api, token) => api.adminRecordCourierSettlement(token, parsed.data),
    { returnTo: OPERATIONS_PATHS.cod, label: 'courier settlement', messages: COURIER_MESSAGES },
  );
  if (!result.ok) return { ...result.state, values };
  refreshOperations();
  return {
    status: 'success',
    message: `Settlement ${result.value.reference} of ${formatMoney(result.value.amountMinor)} recorded over ${String(result.value.lines)} shipment${result.value.lines === 1 ? '' : 's'}.`,
  };
}

// ---------------------------------------------------------------------------
// Configuration: settings, providers, rate cards
// ---------------------------------------------------------------------------

function refreshConfig(): void {
  revalidatePath(OPERATIONS_PATHS.settings);
  revalidatePath(OPERATIONS_PATHS.providers);
  revalidatePath(OPERATIONS_PATHS.pricing);
  revalidatePath(OPERATIONS_PATHS.couriers);
}

/** Default parcel weight, quote validity, preferred courier and history sample (couriers.configure). */
export async function saveCourierSettingsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const weight = formText(formData, 'weight');
  const validity = formText(formData, 'quoteValidityMinutes');
  const preferred = formText(formData, 'preferredProvider');
  const sample = formText(formData, 'minHistorySample');
  const values = {
    weight,
    quoteValidityMinutes: validity,
    preferredProvider: preferred,
    minHistorySample: sample,
  };
  const parsed = courierSettingsRequestSchema.safeParse({
    defaultParcelWeightGrams: kgTextToGrams(weight),
    quoteValidityMinutes: /^\d{1,4}$/.test(validity) ? Number(validity) : undefined,
    preferredProvider: preferred === '' ? null : preferred,
    minHistorySample: /^\d{1,5}$/.test(sample) ? Number(sample) : undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? '');
      if (field === 'defaultParcelWeightGrams') fieldErrors.weight = WEIGHT_MESSAGE;
      if (field === 'quoteValidityMinutes')
        fieldErrors.quoteValidityMinutes = 'Enter 1 to 1,440 minutes.';
      if (field === 'preferredProvider')
        fieldErrors.preferredProvider = 'Choose a courier or none.';
      if (field === 'minHistorySample')
        fieldErrors.minHistorySample = 'Enter 1 to 10,000 shipments.';
    }
    return invalid('Check the highlighted fields.', fieldErrors, values);
  }
  const result = await adminAct(
    formData,
    (api, token) => api.adminSaveCourierSettings(token, parsed.data),
    {
      returnTo: OPERATIONS_PATHS.settings,
      label: 'courier settings change',
      messages: COURIER_MESSAGES,
    },
  );
  if (!result.ok) return { ...result.state, values };
  refreshConfig();
  return { status: 'success', message: 'Courier settings saved.' };
}

/** A courier's switch and non-secret settings (couriers.configure). Credentials never pass here. */
export async function saveCourierProviderAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const provider = formText(formData, 'provider');
  if (!isProviderId(provider)) return MISSING;
  const codFee = formText(formData, 'codFee');
  const returnCharge = formText(formData, 'returnCharge');
  const keys = formData.getAll('settingKey').map((v) => (typeof v === 'string' ? v.trim() : ''));
  const settingValues = formData
    .getAll('settingValue')
    .map((v) => (typeof v === 'string' ? v.trim() : ''));
  const values = { codFee, returnCharge };

  const settings: Record<string, string> = {};
  for (const [index, key] of keys.entries()) {
    if (!key) continue;
    settings[key] = settingValues[index] ?? '';
  }
  const codFeeBp = codFee.trim() === '' ? null : percentTextToBasisPoints(codFee);
  const returnChargeMinor = returnCharge.trim() === '' ? null : takaToMinor(returnCharge);
  const parsed = courierProviderRequestSchema.safeParse({
    isEnabled: formText(formData, 'isEnabled') === 'on',
    settings,
    codFeeBp,
    returnChargeMinor,
  });
  if (codFeeBp === undefined || returnChargeMinor === undefined || !parsed.success) {
    const fieldErrors: Record<string, string> = {};
    if (codFeeBp === undefined)
      fieldErrors.codFee = 'Enter a percentage from 0 to 100, e.g. 1 or 0.5.';
    if (returnChargeMinor === undefined)
      fieldErrors.returnCharge = 'Enter an amount in taka, or leave it empty.';
    for (const issue of parsed.success ? [] : parsed.error.issues) {
      if (issue.path[0] === 'settings') {
        fieldErrors.settings =
          'Setting names start with a lower-case letter and use letters, digits and _ only. Names that look like credentials (secret, password, token, key) are refused: credentials are set on the server, never here.';
      }
    }
    return invalid('Check the highlighted fields.', fieldErrors, values);
  }
  const result = await adminAct(
    formData,
    (api, token) => api.adminSaveCourierProvider(token, provider, parsed.data),
    {
      returnTo: OPERATIONS_PATHS.providers,
      label: 'courier provider change',
      messages: {
        ...COURIER_MESSAGES,
        validation_failed:
          'Some settings were refused. Setting names must not look like credentials; credentials are set on the server.',
      },
    },
  );
  if (!result.ok) return { ...result.state, values };
  refreshConfig();
  return { status: 'success', message: `${providerName(provider)} saved.` };
}

/** Checks the courier connection (the mock in test mode; a read-only call where verified). */
export async function checkCourierAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const provider = formText(formData, 'provider');
  if (!isProviderId(provider)) return MISSING;
  const result = await adminAct(formData, (api, token) => api.adminCheckCourier(token, provider), {
    returnTo: OPERATIONS_PATHS.providers,
    label: 'courier connection check',
    messages: COURIER_MESSAGES,
  });
  if (!result.ok) return result.state;
  refreshConfig();
  const where = result.value.mode === 'mock' ? 'the test courier' : providerName(provider);
  return result.value.ok
    ? { status: 'success', message: `Connection to ${where} works.` }
    : {
        status: 'error',
        message: `The connection check to ${where} did not pass. See the last check on the card for details.`,
      };
}

/** Adds or edits one negotiated rate (couriers.pricing.manage). */
export async function saveRateCardAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const rateCardId = formText(formData, 'rateCardId');
  const id = rateCardId ? uuidParam(rateCardId) : undefined;
  if (rateCardId && !id) return MISSING;
  const provider = formText(formData, 'provider');
  const zone = formText(formData, 'zone');
  const weight = formText(formData, 'weight');
  const charge = formText(formData, 'charge');
  const values = { provider, zone, weight, charge };
  const chargeMinor = takaToMinor(charge);
  const parsed = courierRateCardRequestSchema.safeParse({
    provider,
    zone,
    weightUpToGrams: kgTextToGrams(weight),
    chargeMinor,
    isActive: formText(formData, 'isActive') === 'on',
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? '');
      if (field === 'provider') fieldErrors.provider = 'Choose the courier.';
      if (field === 'zone') fieldErrors.zone = 'Choose the zone.';
      if (field === 'weightUpToGrams') fieldErrors.weight = WEIGHT_MESSAGE;
      if (field === 'chargeMinor') fieldErrors.charge = 'Enter the charge in taka, up to 100,000.';
    }
    return invalid('Check the highlighted fields.', fieldErrors, values);
  }
  const result = await adminAct(
    formData,
    (api, token) =>
      id
        ? api.adminUpdateCourierRateCard(token, id, parsed.data)
        : api.adminCreateCourierRateCard(token, parsed.data),
    {
      returnTo: OPERATIONS_PATHS.pricing,
      label: 'rate card change',
      messages: COURIER_MESSAGES,
    },
  );
  if (!result.ok) return { ...result.state, values };
  refreshConfig();
  return { status: 'success', message: id ? 'Rate updated.' : 'Rate added.' };
}

/** Removes one negotiated rate (couriers.pricing.manage). */
export async function deleteRateCardAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = uuidParam(formText(formData, 'rateCardId'));
  if (!id) return MISSING;
  const result = await adminAct(
    formData,
    (api, token) => api.adminDeleteCourierRateCard(token, id),
    {
      returnTo: OPERATIONS_PATHS.pricing,
      label: 'rate card removal',
      messages: COURIER_MESSAGES,
    },
  );
  if (!result.ok) return result.state;
  refreshConfig();
  return { status: 'success', message: 'Rate removed.' };
}

// ---------------------------------------------------------------------------
// Operations, credentials, base URLs, live verification (couriers.configure)
// ---------------------------------------------------------------------------

function refreshCourierSetup(): void {
  refreshConfig();
  revalidatePath(OPERATIONS_PATHS.settings);
  revalidatePath(OPERATIONS_PATHS.locations);
}

/**
 * Saves the operating mode, live bookings, tracking sync and timeout. Turning on live mode
 * or live bookings needs the typed confirmation; the API decides when it is required.
 */
export async function saveCourierOperationsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const mode = formText(formData, 'mode');
  const interval = formText(formData, 'trackingSyncMinutes').trim();
  const timeout = formText(formData, 'timeoutSeconds').trim();
  const confirmation = formText(formData, 'confirmation').trim();
  const values = { mode, trackingSyncMinutes: interval, timeoutSeconds: timeout };
  const fieldErrors: Record<string, string> = {};
  if (confirmation && confirmation !== COURIER_LIVE_CONFIRMATION) {
    fieldErrors.confirmation = `Type ${COURIER_LIVE_CONFIRMATION} exactly to confirm.`;
  }
  const minutes = /^\d{1,4}$/.test(interval) ? Number(interval) : NaN;
  const seconds = /^\d{1,2}$/.test(timeout) ? Number(timeout) : NaN;
  const parsed = courierOperationsRequestSchema.safeParse({
    mode,
    bookingEnabled: formText(formData, 'bookingEnabled') === 'on',
    trackingSyncEnabled: formText(formData, 'trackingSyncEnabled') === 'on',
    trackingSyncIntervalSeconds: minutes * 60,
    httpTimeoutMs: seconds * 1000,
    ...(confirmation ? { confirmation } : {}),
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? '');
      if (field === 'mode') fieldErrors.mode = 'Choose Off, Test or Live.';
      if (field === 'trackingSyncIntervalSeconds') {
        fieldErrors.trackingSyncMinutes = 'Enter 1 to 1,440 minutes.';
      }
      if (field === 'httpTimeoutMs') fieldErrors.timeoutSeconds = 'Enter 1 to 60 seconds.';
    }
  }
  if (!parsed.success || Object.keys(fieldErrors).length > 0) {
    return invalid('Check the highlighted fields.', fieldErrors, values);
  }
  const result = await adminAct(
    formData,
    (api, token) => api.adminSaveCourierOperations(token, parsed.data),
    {
      returnTo: OPERATIONS_PATHS.settings,
      label: 'courier operations change',
      messages: COURIER_MESSAGES,
    },
  );
  if (!result.ok) return { ...result.state, values };
  refreshCourierSetup();
  return {
    status: 'success',
    message: result.value.modeNotice
      ? `Saved. ${result.value.modeNotice}`
      : 'Courier operations saved and in effect.',
  };
}

const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;

/**
 * Stores one courier credential, encrypted (write-only). The value is never echoed back to
 * the form, logged, or kept in the page.
 */
export async function setCourierCredentialAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const provider = formText(formData, 'provider');
  const field = formText(formData, 'field');
  if (!isProviderId(provider) || !FIELD_NAME.test(field)) return MISSING;
  const parsed = courierCredentialRequestSchema.safeParse({ value: formText(formData, 'value') });
  if (!parsed.success) {
    const message = 'Enter the value from the courier’s merchant panel (up to 1,000 characters).';
    return invalid(message, { value: message });
  }
  const result = await adminAct(
    formData,
    (api, token) => api.adminSetCourierCredential(token, provider, field, parsed.data.value),
    {
      returnTo: OPERATIONS_PATHS.providers,
      label: 'courier credential change',
      messages: COURIER_MESSAGES,
    },
  );
  if (!result.ok) return result.state;
  refreshCourierSetup();
  return {
    status: 'success',
    message: `Stored encrypted. ${providerName(provider)} must be verified for live use again.`,
  };
}

/** Removes one stored courier credential. */
export async function clearCourierCredentialAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const provider = formText(formData, 'provider');
  const field = formText(formData, 'field');
  if (!isProviderId(provider) || !FIELD_NAME.test(field)) return MISSING;
  const result = await adminAct(
    formData,
    (api, token) => api.adminClearCourierCredential(token, provider, field),
    {
      returnTo: OPERATIONS_PATHS.providers,
      label: 'courier credential removal',
      messages: COURIER_MESSAGES,
    },
  );
  if (!result.ok) return result.state;
  refreshCourierSetup();
  return { status: 'success', message: 'Credential cleared.' };
}

/** The courier's API base URL (https, on its allow-list); empty clears it. */
export async function saveCourierBaseUrlAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const provider = formText(formData, 'provider');
  if (!isProviderId(provider)) return MISSING;
  const url = formText(formData, 'apiBaseUrl').trim();
  const values = { apiBaseUrl: url };
  const message = 'Enter an https address on the courier’s own domain, or leave it empty.';
  let valid = url === '';
  if (!valid) {
    try {
      valid = new URL(url).protocol === 'https:';
    } catch {
      valid = false;
    }
  }
  const parsed = courierBaseUrlRequestSchema.safeParse({ apiBaseUrl: url === '' ? null : url });
  if (!valid || !parsed.success) return invalid(message, { apiBaseUrl: message }, values);
  const result = await adminAct(
    formData,
    (api, token) => api.adminSaveCourierBaseUrl(token, provider, parsed.data),
    {
      returnTo: OPERATIONS_PATHS.providers,
      label: 'courier base URL change',
      messages: {
        ...COURIER_MESSAGES,
        validation_failed:
          'That address is not on this courier’s allow-list. Use the https address from its API documentation.',
      },
    },
  );
  if (!result.ok) return { ...result.state, values };
  refreshCourierSetup();
  return { status: 'success', message: url ? 'API address saved.' : 'API address cleared.' };
}

/** Verifies a courier for live use (typed confirmation), or removes the verification. */
export async function setLiveVerificationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const provider = formText(formData, 'provider');
  if (!isProviderId(provider)) return MISSING;
  const verified = formText(formData, 'verified') === 'true';
  const confirmation = formText(formData, 'confirmation').trim();
  const phrase = courierVerifyConfirmation(provider);
  if (verified && confirmation !== phrase) {
    const message = `Type ${phrase} exactly to confirm.`;
    return invalid(message, { confirmation: message });
  }
  const parsed = courierLiveVerificationRequestSchema.safeParse(
    verified ? { verified, confirmation } : { verified },
  );
  if (!parsed.success) return MISSING;
  const result = await adminAct(
    formData,
    (api, token) => api.adminSetCourierLiveVerification(token, provider, parsed.data),
    {
      returnTo: OPERATIONS_PATHS.providers,
      label: 'courier live verification',
      messages: COURIER_MESSAGES,
    },
  );
  if (!result.ok) return result.state;
  refreshCourierSetup();
  return {
    status: 'success',
    message: verified
      ? `${providerName(provider)} is verified for live use.`
      : `${providerName(provider)} is no longer verified for live use.`,
  };
}

// ---------------------------------------------------------------------------
// Location mappings
// ---------------------------------------------------------------------------

/** A destination value as typed: whole numbers become numbers (courier ids), the rest text. */
function destinationValue(text: string): string | number {
  return /^\d{1,12}$/.test(text) ? Number(text) : text;
}

/** Saves a courier location for a district (and optionally one area). */
export async function saveLocationMappingAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const provider = formText(formData, 'provider');
  const district = formText(formData, 'district').trim();
  const area = formText(formData, 'area').trim();
  const label = formText(formData, 'label').trim();
  const keys = formData.getAll('destKey').map((v) => (typeof v === 'string' ? v.trim() : ''));
  const raw = formData.getAll('destValue').map((v) => (typeof v === 'string' ? v.trim() : ''));
  const values = { provider, district, area, label };
  const fieldErrors: Record<string, string> = {};
  const destination: Record<string, string | number> = {};
  for (const [index, key] of keys.entries()) {
    const value = raw[index] ?? '';
    if (!key && !value) continue;
    if (!/^[a-z][a-zA-Z0-9_]{0,40}$/.test(key)) {
      fieldErrors.destination =
        'Field names start with a lower-case letter and use letters, digits and _ only (e.g. cityId).';
      continue;
    }
    if (!value || value.length > 120) {
      fieldErrors.destination = 'Every field needs a value of up to 120 characters.';
      continue;
    }
    destination[key] = destinationValue(value);
  }
  if (Object.keys(destination).length === 0 && !fieldErrors.destination) {
    fieldErrors.destination = 'Add at least one courier location field, such as cityId.';
  }
  const parsed = courierLocationMappingRequestSchema.safeParse({
    provider,
    district,
    area,
    destination,
    ...(label ? { label } : {}),
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? '');
      if (field === 'provider') fieldErrors.provider = 'Choose the courier.';
      if (field === 'district') fieldErrors.district = 'Choose the district.';
      if (field === 'area') fieldErrors.area = 'Keep the area to 80 characters.';
      if (field === 'label') fieldErrors.label = 'Keep the label to 160 characters.';
      if (field === 'destination') fieldErrors.destination ??= 'Use at most 12 location fields.';
    }
  }
  if (!parsed.success || Object.keys(fieldErrors).length > 0) {
    return invalid('Check the highlighted fields.', fieldErrors, values);
  }
  const result = await adminAct(
    formData,
    (api, token) => api.adminSaveCourierLocationMapping(token, parsed.data),
    {
      returnTo: OPERATIONS_PATHS.locations,
      label: 'courier location mapping',
      messages: COURIER_MESSAGES,
    },
  );
  if (!result.ok) return { ...result.state, values };
  refreshCourierSetup();
  return {
    status: 'success',
    message: `Saved the ${providerName(provider)} location for ${area ? `${area}, ` : ''}${district}.`,
  };
}

/** Removes one courier location mapping. */
export async function deleteLocationMappingAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = uuidParam(formText(formData, 'mappingId'));
  if (!id) return MISSING;
  const result = await adminAct(
    formData,
    (api, token) => api.adminDeleteCourierLocationMapping(token, id),
    {
      returnTo: OPERATIONS_PATHS.locations,
      label: 'courier location mapping removal',
      messages: COURIER_MESSAGES,
    },
  );
  if (!result.ok) return result.state;
  refreshCourierSetup();
  return { status: 'success', message: 'Location mapping removed.' };
}
