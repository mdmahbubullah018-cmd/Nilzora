'use server';

import {
  bulkOrderStatusRequestSchema,
  bulkOrderSummariesRequestSchema,
  bulkShipmentBookingRequestSchema,
  BULK_SHIPMENT_LIMIT,
} from '@nilzora/contracts';
import { revalidatePath } from 'next/cache';
import { adminAct, formText, UNCONFIRMED_MESSAGE } from '@/components/admin-kit/act';
import {
  cleanOrderNumbers,
  courierBookingAvailability,
  type BulkAnswer,
  type BulkBookingAnswer,
  type BulkStatusAnswer,
  type CourierCheckValue,
} from '@/components/orders/bulk-logic';
import { ORDERS_PATH } from '@/components/orders/order-query';
import { COURIER_MESSAGES } from '@/components/shipments/courier-messages';
import {
  isProviderId,
  kgTextToGrams,
  OPERATIONS_PATHS,
} from '@/components/shipments/shipment-labels';
import type { BulkOrderSummariesResponse } from '@nilzora/contracts';

/*
 * Bulk order actions for the orders list. Each is a Server Action called with a FormData
 * that carries the page's CSRF field (adminAct refuses anything else before calling the
 * API). The API checks every permission, transition and booking order by order and
 * answers per order; these actions only shape the request and fix the messages.
 *
 * Selecting orders never calls any of these: each runs only from an explicit, confirmed
 * step of the bulk toolbar. Booking is never automatic, and booking or a courier status
 * never changes an order's payment.
 */

const BAD_SELECTION = 'The selection could not be read. Clear it and select the orders again.';

const STATUS_MESSAGES = {
  forbidden: 'Your account does not have permission to change these orders.',
  validation_failed: 'Some of the details were refused. Check them and try again.',
};

function selectedNumbers(formData: FormData): string[] {
  return cleanOrderNumbers(formData.getAll('orderNumber'));
}

function refreshOrders(): void {
  revalidatePath(ORDERS_PATH);
  revalidatePath('/admin/orders/[orderNumber]', 'page');
  revalidatePath('/admin');
}

/** The selected orders' list rows (the tray, the status preview and the CSV export). */
export async function loadSelectedOrdersAction(
  formData: FormData,
): Promise<BulkAnswer<BulkOrderSummariesResponse>> {
  const parsed = bulkOrderSummariesRequestSchema.safeParse({
    orderNumbers: selectedNumbers(formData),
  });
  if (!parsed.success) return { ok: false, message: BAD_SELECTION };
  const result = await adminAct(
    formData,
    (api, token) => api.adminBulkOrderSummaries(token, parsed.data.orderNumbers),
    { returnTo: ORDERS_PATH, label: 'selected orders read' },
  );
  if (!result.ok) {
    return { ok: false, message: result.state.message ?? 'The selected orders could not be read.' };
  }
  return { ok: true, value: result.value };
}

/** Moves the listed orders to one status (a cancellation needs a reason). Per-order results. */
export async function bulkChangeStatusAction(formData: FormData): Promise<BulkStatusAnswer> {
  const status = formText(formData, 'status');
  const note = formText(formData, 'note');
  const parsed = bulkOrderStatusRequestSchema.safeParse({
    orderNumbers: selectedNumbers(formData),
    status,
    note,
  });
  if (!parsed.success) {
    const noteIssue = parsed.error.issues.some((issue) => issue.path[0] === 'note');
    if (noteIssue) {
      const noteError =
        status === 'cancelled'
          ? 'Give a reason of 5 to 300 characters.'
          : 'Keep the note under 300 characters.';
      return { ok: false, message: noteError, noteError };
    }
    return { ok: false, message: 'This change is not available. Reload the page and try again.' };
  }
  const result = await adminAct(
    formData,
    (api, token) => api.adminBulkOrderStatus(token, parsed.data),
    { returnTo: ORDERS_PATH, label: 'bulk order status change', messages: STATUS_MESSAGES },
  );
  if (!result.ok) {
    return { ok: false, message: result.state.message ?? UNCONFIRMED_MESSAGE };
  }
  refreshOrders();
  return { ok: true, value: result.value };
}

/**
 * Which selected orders could be booked now, and whether (and with which couriers) parcels
 * can be booked by API at all. Reads only: nothing is booked here.
 */
export async function checkCourierBookingAction(
  formData: FormData,
): Promise<BulkAnswer<CourierCheckValue>> {
  const parsed = bulkOrderSummariesRequestSchema.safeParse({
    orderNumbers: selectedNumbers(formData),
  });
  if (!parsed.success) return { ok: false, message: BAD_SELECTION };
  const check = await adminAct(
    formData,
    (api, token) => api.adminBulkCourierCheck(token, parsed.data.orderNumbers),
    { returnTo: ORDERS_PATH, label: 'bulk courier check', messages: COURIER_MESSAGES },
  );
  if (!check.ok) {
    return { ok: false, message: check.state.message ?? 'The orders could not be checked.' };
  }
  // The courier settings (shipments.read or couriers.read); unreadable means "no API booking".
  const config = await adminAct(formData, (api, token) => api.adminCourierConfig(token), {
    returnTo: ORDERS_PATH,
    label: 'courier configuration read',
  });
  return {
    ok: true,
    value: {
      check: check.value,
      availability: courierBookingAvailability(config.ok ? config.value : null),
    },
  };
}

/**
 * Books one parcel per listed order with the chosen courier, only with the explicit
 * confirmation. Each order carries the booking key the screen made once for this attempt,
 * so sending the same request again never books a parcel twice.
 */
export async function bulkBookShipmentsAction(formData: FormData): Promise<BulkBookingAnswer> {
  if (formText(formData, 'confirm') !== 'yes') {
    return {
      ok: false,
      unconfirmed: false,
      message: 'Confirm the list of orders before booking.',
    };
  }
  const provider = formText(formData, 'provider');
  if (!isProviderId(provider)) {
    return { ok: false, unconfirmed: false, message: 'Choose a courier.', fieldError: 'provider' };
  }
  const weight = formText(formData, 'weight').trim();
  const weightGrams = weight === '' ? undefined : kgTextToGrams(weight);
  if (weight !== '' && weightGrams === undefined) {
    return {
      ok: false,
      unconfirmed: false,
      message: 'Enter the parcel weight in kilograms, from 0.001 to 50 (e.g. 0.5).',
      fieldError: 'weight',
    };
  }
  const items = formData
    .getAll('item')
    .flatMap((value) => {
      if (typeof value !== 'string') return [];
      const [orderNumber = '', bookingKey = ''] = value.split(':');
      return [{ orderNumber, bookingKey }];
    })
    .slice(0, BULK_SHIPMENT_LIMIT + 1);
  const parsed = bulkShipmentBookingRequestSchema.safeParse({
    provider,
    ...(weightGrams === undefined ? {} : { weightGrams }),
    confirm: true,
    items,
  });
  if (!parsed.success) {
    return {
      ok: false,
      unconfirmed: false,
      message: `This booking list could not be read (at most ${String(BULK_SHIPMENT_LIMIT)} orders, each once). Check the orders again.`,
    };
  }
  const result = await adminAct(
    formData,
    (api, token) => api.adminBulkBookShipments(token, parsed.data),
    { returnTo: ORDERS_PATH, label: 'bulk shipment booking', messages: COURIER_MESSAGES },
  );
  if (!result.ok) {
    // No answer, or the API failed: the bookings may have been made. Same keys = safe retry.
    const unconfirmed = result.code === undefined || result.code === 'service_unavailable';
    return {
      ok: false,
      unconfirmed,
      message: unconfirmed
        ? 'Nilzora could not confirm the bookings. Send them again: the same booking keys are used, so no parcel is booked twice.'
        : (result.state.message ?? 'The bookings were refused.'),
    };
  }
  refreshOrders();
  revalidatePath(OPERATIONS_PATHS.shipments);
  revalidatePath(OPERATIONS_PATHS.couriers);
  return { ok: true, value: result.value };
}
