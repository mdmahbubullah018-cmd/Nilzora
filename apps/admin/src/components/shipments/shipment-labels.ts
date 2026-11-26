import {
  COD_POSITION_STATUSES,
  COURIER_PROVIDER_IDS,
  COURIER_QUOTE_KIND_LABELS,
  SHIPMENT_KINDS,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUSES,
  TERMINAL_SHIPMENT_STATUSES,
  type CodPositionStatus,
  type CodState,
  type CourierCapability,
  type CourierCapabilityState,
  type CourierMode,
  type CourierProviderId,
  type CourierQuoteKind,
  type Permission,
  type Shipment,
  type ShipmentKind,
  type ShipmentStatus,
} from '@nilzora/contracts';
import type { Route } from 'next';
import { oneOf, pageParam, single, withQuery } from '@/components/admin-kit/href';
import type { StatusTone } from '@/components/admin-kit/status-tones';
import { dayParam, searchParam, type SearchParams } from '@/components/orders/order-query';

/*
 * Words, tones, addresses and URL filters shared by the Operations pages (couriers,
 * shipments, COD reconciliation, providers, pricing) and the shipment panels of the order
 * and return pages. Pure: no server or browser code, so both sides and the tests use it.
 *
 * A shipment's status is its own lifecycle, never the order's: these labels always say
 * "shipment" or the courier's step, never an order status.
 */

export const OPERATIONS_PATHS = {
  couriers: '/admin/operations/couriers',
  shipments: '/admin/operations/shipments',
  cod: '/admin/operations/cod',
  providers: '/admin/operations/providers',
  pricing: '/admin/operations/pricing',
  settings: '/admin/operations/settings',
  locations: '/admin/operations/locations',
} as const satisfies Record<string, Route>;

export const SHIPMENTS_PAGE_SIZE = 25;
export const COD_POSITIONS_PAGE_SIZE = 25;

export function shipmentHref(shipmentId: string): Route {
  return `${OPERATIONS_PATHS.shipments}/${shipmentId}` as Route;
}

export function orderHref(orderNumber: string): Route {
  return `/admin/orders/${orderNumber}` as Route;
}

/** The courier's name when the API did not send one (the ids are fixed). */
const PROVIDER_NAMES: Record<CourierProviderId, string> = {
  steadfast: 'Steadfast',
  pathao: 'Pathao',
};

export function providerName(provider: string): string {
  return PROVIDER_NAMES[provider as CourierProviderId] ?? provider;
}

export function isProviderId(value: string): value is CourierProviderId {
  return (COURIER_PROVIDER_IDS as readonly string[]).includes(value);
}

export const PROVIDER_OPTIONS = COURIER_PROVIDER_IDS.map((id) => ({
  value: id,
  label: PROVIDER_NAMES[id],
}));

export const SHIPMENT_STATUS_TONE: Record<ShipmentStatus, StatusTone> = {
  draft: 'neutral',
  quoted: 'neutral',
  booking_pending: 'warning',
  booking_failed: 'danger',
  booked: 'primary',
  pickup_pending: 'primary',
  picked_up: 'violet',
  in_transit: 'violet',
  on_hold: 'warning',
  out_for_delivery: 'violet',
  delivered: 'success',
  partially_delivered: 'warning',
  delivery_failed: 'danger',
  cancelled: 'neutral',
  return_initiated: 'offer',
  returned: 'offer',
  unknown: 'neutral',
};

export function shipmentStatusLabel(status: ShipmentStatus): string {
  return SHIPMENT_STATUS_LABELS[status];
}

export function isTerminalShipment(status: ShipmentStatus): boolean {
  return TERMINAL_SHIPMENT_STATUSES.includes(status);
}

export const SHIPMENT_KIND_LABELS: Record<ShipmentKind, string> = {
  forward: 'Delivery',
  return_pickup: 'Return pickup',
  exchange: 'Exchange',
};

export const QUOTE_KIND_TONE: Record<CourierQuoteKind, StatusTone> = {
  live: 'success',
  provider_estimate: 'primary',
  internal_estimate: 'violet',
  unavailable: 'neutral',
};

export function quoteKindLabel(kind: CourierQuoteKind): string {
  return COURIER_QUOTE_KIND_LABELS[kind];
}

export const COD_POSITION_LABELS: Record<CodPositionStatus, { label: string; tone: StatusTone }> = {
  pending: { label: 'Awaiting collection', tone: 'warning' },
  collected: { label: 'Collected by courier', tone: 'primary' },
  partially_settled: { label: 'Partly settled', tone: 'violet' },
  settled: { label: 'Settled', tone: 'success' },
  disputed: { label: 'Disputed', tone: 'danger' },
  reconciled: { label: 'Reconciled', tone: 'success' },
};

export const COD_STATE_LABELS: Record<CodState, string> = {
  open: 'Open',
  disputed: 'Disputed',
  reconciled: 'Reconciled (closed)',
};

export const COD_LEDGER_LABELS: Record<string, string> = {
  cod_expected: 'Cash to collect',
  cod_collected: 'Collected by courier',
  delivery_charge: 'Delivery charge',
  cod_fee: 'COD fee',
  return_charge: 'Return charge',
  other_deduction: 'Other deduction',
  settlement: 'Settlement received',
  adjustment: 'Adjustment',
};

export const CAPABILITY_LABELS: Record<CourierCapability, string> = {
  quote: 'Price quotes',
  book: 'Booking',
  track: 'Tracking',
  cancel: 'Cancellation',
  webhook: 'Status updates (webhook)',
  returnPickup: 'Return pickup',
  locations: 'Location lookup',
};

export const CAPABILITY_STATE: Record<CourierCapabilityState, { label: string; tone: StatusTone }> =
  {
    available: { label: 'Available', tone: 'success' },
    unsupported: { label: 'Use the courier portal', tone: 'neutral' },
    awaiting_documentation: { label: 'Awaiting API documentation', tone: 'warning' },
  };

export const COURIER_MODE_COPY: Record<
  CourierMode,
  { label: string; tone: StatusTone; description: string }
> = {
  off: {
    label: 'Couriers off',
    tone: 'neutral',
    description:
      'Courier connections are switched off on this server, so no parcel can be quoted or booked from here. Book with the courier’s own portal and record the status on the shipment by hand.',
  },
  mock: {
    label: 'Test mode — no real parcels',
    tone: 'warning',
    description:
      'Quotes and bookings come from the built-in test courier. Nothing is sent to Steadfast or Pathao, prices are not real, and test shipments are left out of every total unless you include test data.',
  },
  live: {
    label: 'Live couriers',
    tone: 'success',
    description:
      'Bookings go to the real couriers where their API has been verified. Operations still awaiting documentation are done in the courier’s portal.',
  },
};

/**
 * Whether Nilzora can book through a courier API right now: always in test mode; in live
 * mode only with real bookings switched on and at least one enabled courier whose API for
 * this step is verified. Otherwise staff book in the courier's portal and record it.
 */
export function apiCanBook(
  config: {
    mode: CourierMode;
    bookingEnabled: boolean;
    providers: readonly {
      isEnabled: boolean;
      capabilities: Record<CourierCapability, CourierCapabilityState>;
    }[];
  } | null,
  capability: 'book' | 'returnPickup',
): boolean {
  if (!config || config.mode === 'off') return false;
  if (config.mode === 'mock') return true;
  return (
    config.bookingEnabled &&
    config.providers.some((p) => p.isEnabled && p.capabilities[capability] === 'available')
  );
}

/** Grams as "0.5 kg" / "1.25 kg". */
export function formatWeight(grams: number): string {
  if (!Number.isFinite(grams)) return '';
  const kg = grams / 1000;
  return `${kg.toLocaleString('en-IN', { maximumFractionDigits: 3 })} kg`;
}

/** Grams as the kilogram text a weight field starts with ("0.5"). */
export function gramsToKgText(grams: number): string {
  if (!Number.isSafeInteger(grams)) return '';
  const whole = Math.trunc(grams / 1000);
  const rest = grams % 1000;
  return rest === 0
    ? String(whole)
    : `${String(whole)}.${String(rest).padStart(3, '0').replace(/0+$/, '')}`;
}

/** Kilograms typed into a form ("0.5", "2", "1.25") as whole grams, without float rounding. */
export function kgTextToGrams(text: string): number | undefined {
  const match = /^(\d{1,2})(?:\.(\d{1,3}))?$/.exec(text.trim());
  if (!match?.[1]) return undefined;
  const grams = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
  return grams >= 1 && grams <= 50_000 ? grams : undefined;
}

/** A basis-point COD fee as a percentage ("1%", "0.75%"). */
export function formatBasisPoints(bp: number): string {
  return `${(bp / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;
}

/** A percentage typed into a form ("1", "0.75") as basis points. */
export function percentTextToBasisPoints(text: string): number | undefined {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match?.[1]) return undefined;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bp <= 10_000 ? bp : undefined;
}

/** Destination fields (the courier's own location ids and names) as readable label/value pairs. */
export function destinationEntries(destination: Record<string, unknown>): [string, string][] {
  return Object.entries(destination).flatMap(([key, value]) => {
    if (typeof value !== 'string' && typeof value !== 'number') return [];
    const text = String(value).trim();
    if (!text) return [];
    const label = key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replaceAll('_', ' ')
      .toLowerCase();
    return [[label.charAt(0).toUpperCase() + label.slice(1), text]];
  });
}

/** Who may resolve an uncertain booking: the permission that books its kind. */
export function bookPermissionFor(kind: ShipmentKind): Permission {
  return kind === 'forward' ? 'shipments.create' : 'shipments.returns.manage';
}

/** Money the courier may charge for a quote, when it has a price. */
export function quoteTotal(quote: {
  deliveryChargeMinor: number | null;
  codFeeMinor: number | null;
}): number | null {
  if (quote.deliveryChargeMinor === null) return null;
  return quote.deliveryChargeMinor + (quote.codFeeMinor ?? 0);
}

/** Whether a shipment needs attention in a list (uncertain booking or a sync problem). */
export function shipmentFlags(
  shipment: Pick<Shipment, 'bookingUncertain' | 'syncError'>,
): string[] {
  const flags: string[] = [];
  if (shipment.bookingUncertain) flags.push('Check the courier portal');
  if (shipment.syncError) flags.push('Tracking sync problem');
  return flags;
}

// ---------------------------------------------------------------------------
// URL filters
// ---------------------------------------------------------------------------

export interface ShipmentFilters {
  status?: ShipmentStatus;
  provider?: CourierProviderId;
  kind?: ShipmentKind;
  q?: string;
  from?: string;
  to?: string;
  /** Include test (mock) shipments. */
  test?: boolean;
  /** How this page's rows are ordered: "updated", "-cod", ... (the API lists newest first). */
  sort?: string | undefined;
}

export const SHIPMENT_SORT_COLUMNS = ['updated', 'cod', 'status', 'courier'] as const;
export type ShipmentSortColumn = (typeof SHIPMENT_SORT_COLUMNS)[number];

/** A shipment page's rows in the chosen order (the page itself comes from the API). */
export function sortShipments<
  T extends Pick<
    Shipment,
    'updatedAt' | 'lastEventAt' | 'codAmountMinor' | 'status' | 'providerName' | 'provider'
  >,
>(rows: readonly T[], sort: { column: ShipmentSortColumn; direction: 'asc' | 'desc' }): T[] {
  const key = (row: T): string | number => {
    switch (sort.column) {
      case 'cod':
        return row.codAmountMinor;
      case 'status':
        return SHIPMENT_STATUS_LABELS[row.status];
      case 'courier':
        return row.providerName || row.provider;
      case 'updated':
        return row.lastEventAt ?? row.updatedAt;
    }
  };
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return (
      (typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y))) * sign
    );
  });
}

export function parseShipmentFilters(params: SearchParams): ShipmentFilters & { page: number } {
  let from = dayParam(params.from);
  let to = dayParam(params.to);
  if (from && to && from > to) {
    from = undefined;
    to = undefined;
  }
  return {
    status: oneOf(params.status, SHIPMENT_STATUSES),
    provider: oneOf(params.courier, COURIER_PROVIDER_IDS),
    kind: oneOf(params.kind, SHIPMENT_KINDS),
    q: searchParam(params.q),
    from,
    to,
    test: single(params.test) === '1',
    sort: single(params.sort),
    page: pageParam(params.page),
  };
}

export function shipmentsHref(filters: ShipmentFilters, page = 1): Route {
  return withQuery(OPERATIONS_PATHS.shipments, {
    status: filters.status,
    courier: filters.provider,
    kind: filters.kind,
    q: filters.q,
    from: filters.from,
    to: filters.to,
    test: filters.test ? 1 : undefined,
    sort: filters.sort,
    page: page > 1 ? page : undefined,
  });
}

export function hasShipmentFilters(filters: ShipmentFilters): boolean {
  return Boolean(
    filters.status ?? filters.provider ?? filters.kind ?? filters.q ?? filters.from ?? filters.to,
  );
}

export interface CodFilters {
  provider?: CourierProviderId;
  status?: CodPositionStatus;
  test?: boolean;
}

export function parseCodFilters(params: SearchParams): CodFilters & { page: number } {
  return {
    provider: oneOf(params.courier, COURIER_PROVIDER_IDS),
    status: oneOf(params.status, COD_POSITION_STATUSES),
    test: single(params.test) === '1',
    page: pageParam(params.page),
  };
}

export function codHref(filters: CodFilters, page = 1): Route {
  return withQuery(OPERATIONS_PATHS.cod, {
    courier: filters.provider,
    status: filters.status,
    test: filters.test ? 1 : undefined,
    page: page > 1 ? page : undefined,
  });
}
