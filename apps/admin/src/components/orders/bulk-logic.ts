import {
  BULK_ORDER_LIMIT,
  BULK_SHIPMENT_LIMIT,
  ORDER_TRANSITIONS,
  orderNumberSchema,
  type AdminOrderSummary,
  type BulkCourierCheckResponse,
  type BulkCourierCheckResult,
  type BulkOrderStatusResponse,
  type BulkShipmentBookingResponse,
  type CourierConfigResponse,
  type OrderStatus,
  type Permission,
} from '@nilzora/contracts';
import { ORDER_STATUS } from '@/components/admin-kit/status-badge';
import { COURIER_MESSAGES } from '@/components/shipments/courier-messages';
import { isProviderId, providerName } from '@/components/shipments/shipment-labels';

/*
 * Bulk order actions: the pure rules the admin screen applies before anything is sent.
 * Plain module (no server or browser code), shared by the Server Actions, the client
 * components and the tests. None of this is a security boundary: the API checks every
 * permission, transition and booking again, order by order.
 */

export { BULK_ORDER_LIMIT, BULK_SHIPMENT_LIMIT };

/** Order numbers as the API accepts them, in their first-seen order, without repeats. */
export function cleanOrderNumbers(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const parsed = orderNumberSchema.safeParse(value.trim());
    if (parsed.success) seen.add(parsed.data);
  }
  return [...seen];
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** Where the orders list keeps the current tab's selection (sessionStorage). */
export const SELECTION_STORAGE_KEY = 'nilzora.admin.orders.selection.v1';

export const SELECTION_CAP_MESSAGE = `You can select up to ${String(BULK_ORDER_LIMIT)} orders at a time. Act on these first, or clear some, to select more.`;

/**
 * `current` with `additions` appended (keeping order, without repeats), up to `limit`.
 * `refused` counts the additions left out because the selection is full.
 */
export function addToSelection(
  current: readonly string[],
  additions: readonly string[],
  limit: number = BULK_ORDER_LIMIT,
): { next: string[]; refused: number } {
  const next = [...current];
  const present = new Set(current);
  let refused = 0;
  for (const orderNumber of additions) {
    if (present.has(orderNumber)) continue;
    if (next.length >= limit) {
      refused += 1;
      continue;
    }
    next.push(orderNumber);
    present.add(orderNumber);
  }
  return { next, refused };
}

/** A stored selection, or an empty one when storage is unavailable or holds anything odd. */
export function readStoredSelection(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): string[] {
  try {
    const text = storage?.getItem(SELECTION_STORAGE_KEY);
    if (!text) return [];
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return [];
    return cleanOrderNumbers(value).slice(0, BULK_ORDER_LIMIT);
  } catch {
    return [];
  }
}

/** Saves the selection; storage that refuses (private mode, quota) is ignored. */
export function writeStoredSelection(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined,
  selection: readonly string[],
): void {
  try {
    if (!storage) return;
    if (selection.length === 0) storage.removeItem(SELECTION_STORAGE_KEY);
    else storage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // The selection still works for this page; it is just not remembered.
  }
}

// ---------------------------------------------------------------------------
// Status changes
// ---------------------------------------------------------------------------

/** Statuses an order can be moved to in bulk (never back to pending). */
export type BulkTargetStatus = Exclude<OrderStatus, 'pending'>;

export const BULK_TARGET_STATUSES: readonly BulkTargetStatus[] = [
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
];

/** The target statuses this account may choose: steps need orders.update_status, cancelling orders.cancel. */
export function allowedBulkTargets(permissions: readonly Permission[]): BulkTargetStatus[] {
  const canStep = permissions.includes('orders.update_status');
  const canCancel = permissions.includes('orders.cancel');
  return BULK_TARGET_STATUSES.filter((status) => (status === 'cancelled' ? canCancel : canStep));
}

export const BULK_TARGET_LABEL: Record<BulkTargetStatus, string> = {
  confirmed: 'Confirmed',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/** The shortest cancellation reason the API accepts. */
export const CANCEL_REASON_MIN = 5;
export const STATUS_NOTE_MAX = 300;

export interface StatusPreviewRow {
  orderNumber: string;
  /** Null when the order could not be found (or this account cannot see it). */
  current: OrderStatus | null;
  eligible: boolean;
  /** Why the order will not change (null when eligible). */
  reason: string | null;
}

function label(status: OrderStatus): string {
  return ORDER_STATUS[status].label;
}

/** Why `from` cannot move to `to` per ORDER_TRANSITIONS, or null when it can. */
export function transitionBlocker(from: OrderStatus, to: BulkTargetStatus): string | null {
  if (ORDER_TRANSITIONS[from].includes(to)) return null;
  if (from === to) return `Already ${label(from).toLowerCase()}`;
  if (from === 'delivered' || from === 'cancelled') {
    return `${label(from)} orders are closed`;
  }
  if (to === 'cancelled') return `A ${label(from).toLowerCase()} order can no longer be cancelled`;
  const next = ORDER_TRANSITIONS[from].find((status) => status !== 'cancelled');
  return next
    ? `${label(from)} orders move to ${label(next).toLowerCase()} next`
    : `Cannot move from ${label(from).toLowerCase()}`;
}

/**
 * Classifies every selected order for a bulk change to `target`, in selection order. The
 * API and the database decide again for each order when the change is sent.
 */
export function classifyStatusChange(
  selection: readonly string[],
  orders: readonly Pick<AdminOrderSummary, 'orderNumber' | 'status'>[],
  target: BulkTargetStatus,
): StatusPreviewRow[] {
  const byNumber = new Map(orders.map((order) => [order.orderNumber, order.status]));
  return selection.map((orderNumber) => {
    const current = byNumber.get(orderNumber) ?? null;
    if (current === null) {
      return {
        orderNumber,
        current,
        eligible: false,
        reason: 'Not found, or not visible to your account',
      };
    }
    const reason = transitionBlocker(current, target);
    return { orderNumber, current, eligible: reason === null, reason };
  });
}

/** Fixed words for the API's per-order refusal codes; anything else uses the API's message. */
const BULK_STATUS_ERRORS: Record<string, string> = {
  invalid_status_transition: 'Its status changed since the preview. Reload to see it.',
  not_found: 'Not found, or not visible to your account.',
  forbidden: 'Your account may not make this change.',
  order_archived: 'Archived orders cannot be changed.',
};

/** The message shown for one failed order of a bulk request. */
export function bulkErrorText(error: { code: string; message: string } | null): string {
  if (!error) return 'The change was not made.';
  const fixed = BULK_STATUS_ERRORS[error.code];
  if (fixed) return fixed;
  const text = error.message.trim();
  return text ? text.slice(0, 200) : 'The change was not made.';
}

/** After a bulk status change: the orders to keep selected (failures) and to clear (successes). */
export function splitStatusResults(response: BulkOrderStatusResponse): {
  succeeded: string[];
  failed: string[];
} {
  return {
    succeeded: response.results.filter((row) => row.ok).map((row) => row.orderNumber),
    failed: response.results.filter((row) => !row.ok).map((row) => row.orderNumber),
  };
}

// ---------------------------------------------------------------------------
// Courier booking
// ---------------------------------------------------------------------------

export const COURIER_BLOCKER_TEXT: Record<
  NonNullable<BulkCourierCheckResult['blocker']>,
  string
> = {
  not_found: 'Not found, or not visible to your account',
  order_status: 'Not ready to ship',
  active_shipment: 'Already has an active parcel',
  forbidden: 'Your account may not book this order',
  unavailable: 'Could not be checked just now',
};

/**
 * Why one order cannot be booked now, in words. With `couriersUnavailable` (booking by API
 * is off or not ready) an order whose only blocker is "unavailable" is an order that is fine
 * but cannot be booked from Nilzora: it is said so, not reported as "could not be checked".
 */
export function courierBlockerText(
  result: BulkCourierCheckResult,
  couriersUnavailable = false,
): string | null {
  if (result.bookable) return null;
  if (couriersUnavailable && result.blocker === 'unavailable' && result.orderStatus !== null) {
    return 'Ready to ship, but not bookable from Nilzora now';
  }
  const base = result.blocker ? COURIER_BLOCKER_TEXT[result.blocker] : 'Cannot be booked now';
  if (result.blocker === 'order_status' && result.orderStatus) {
    const status = result.orderStatus as OrderStatus;
    const name = Object.hasOwn(ORDER_STATUS, status) ? label(status).toLowerCase() : status;
    return `${base} (it is ${name})`;
  }
  return base;
}

/**
 * The orders to point at when parcels can only be booked in a courier's portal: every order
 * that could be booked if couriers were available (nothing blocks it but the courier
 * connection). Delivered, cancelled or already-shipped orders, and orders the caller cannot
 * see, are left out.
 */
export function portalBookableOrders(check: Pick<CourierCheckValue['check'], 'results'>): string[] {
  return check.results
    .filter((row) => row.bookable || (row.blocker === 'unavailable' && row.orderStatus !== null))
    .map((row) => row.orderNumber);
}

export interface UsableCourier {
  id: string;
  name: string;
}

export type CourierBookingAvailability =
  | { available: true; mode: 'mock' | 'live'; couriers: UsableCourier[] }
  | { available: false; reason: 'off' | 'live_not_ready' | 'config_unavailable' };

/**
 * Whether parcels can be booked through a courier API right now, and with which couriers:
 * every known courier in test (mock) mode; in live mode only with real bookings switched on
 * and a courier that is enabled, fully ready and able to book by API. Otherwise parcels are
 * booked in the courier's own portal and recorded on each order.
 */
export function courierBookingAvailability(
  config: Pick<CourierConfigResponse, 'mode' | 'bookingEnabled' | 'providers'> | null,
): CourierBookingAvailability {
  if (!config) return { available: false, reason: 'config_unavailable' };
  if (config.mode === 'off') return { available: false, reason: 'off' };
  const known = config.providers.filter((p) => isProviderId(p.provider));
  const usable =
    config.mode === 'mock'
      ? known
      : config.bookingEnabled
        ? known.filter(
            (p) => p.isEnabled && p.readiness.ready && p.capabilities.book === 'available',
          )
        : [];
  if (usable.length === 0) return { available: false, reason: 'live_not_ready' };
  return {
    available: true,
    mode: config.mode,
    couriers: usable.map((p) => ({
      id: p.provider,
      name: p.displayName || providerName(p.provider),
    })),
  };
}

/** The orders a booking would send: the bookable ones, at most BULK_SHIPMENT_LIMIT. */
export function bookableOrders(check: BulkCourierCheckResponse): {
  orderNumbers: string[];
  overLimit: number;
} {
  const bookable = check.results.filter((row) => row.bookable).map((row) => row.orderNumber);
  return {
    orderNumbers: bookable.slice(0, BULK_SHIPMENT_LIMIT),
    overLimit: Math.max(0, bookable.length - BULK_SHIPMENT_LIMIT),
  };
}

/** A random v4 UUID (the booking key): crypto.randomUUID where available, else getRandomValues. */
export function newBookingKey(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * One booking key per order for this booking attempt: keys already made are kept (so a
 * retry resends the same key and the API never books twice); only new orders get one.
 */
export function ensureBookingKeys(
  existing: Readonly<Record<string, string>>,
  orderNumbers: readonly string[],
  makeKey: () => string = newBookingKey,
): Record<string, string> {
  const keys: Record<string, string> = { ...existing };
  for (const orderNumber of orderNumbers) {
    keys[orderNumber] ??= makeKey();
  }
  return keys;
}

export type BookingOutcomeKind = 'booked' | 'duplicate' | 'uncertain' | 'in_progress' | 'failed';

/** How one order's booking ended, for the results list. */
export function bookingOutcomeOf(
  result: BulkShipmentBookingResponse['results'][number],
): BookingOutcomeKind {
  if (result.outcome === 'uncertain') return 'uncertain';
  if (result.outcome === 'in_progress') return 'in_progress';
  if (result.ok && result.duplicate) return 'duplicate';
  if (result.ok && result.outcome === 'booked') return 'booked';
  return 'failed';
}

export const BOOKING_OUTCOME_TEXT: Record<BookingOutcomeKind, string> = {
  booked: 'Booked',
  duplicate: 'Already booked (no new parcel)',
  uncertain: 'No clear answer: check the courier portal, then resolve it on the order page',
  in_progress: 'Already being booked: reload the order in a moment',
  failed: 'Not booked',
};

/** The message shown for one order whose booking did not go through. */
export function bookingErrorText(error: { code: string; message: string } | null): string {
  if (!error) return 'The courier did not book this parcel.';
  const fixed = COURIER_MESSAGES[error.code as keyof typeof COURIER_MESSAGES];
  return fixed ?? bulkErrorText(error);
}

// ---------------------------------------------------------------------------
// What the bulk Server Actions answer (plain data for the client components)
// ---------------------------------------------------------------------------

export type BulkAnswer<T> = { ok: true; value: T } | { ok: false; message: string };

export type BulkStatusAnswer =
  { ok: true; value: BulkOrderStatusResponse } | { ok: false; message: string; noteError?: string };

export interface CourierCheckValue {
  check: BulkCourierCheckResponse;
  availability: CourierBookingAvailability;
}

export type BulkBookingAnswer =
  | { ok: true; value: BulkShipmentBookingResponse }
  /** `unconfirmed`: no clear answer; resending the same keys is safe and never books twice. */
  | { ok: false; message: string; unconfirmed: boolean; fieldError?: 'weight' | 'provider' };
