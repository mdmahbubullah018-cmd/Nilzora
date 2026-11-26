import {
  DELIVERY_ZONES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  type AdminOrderListQuery,
  type DeliveryZone,
  type OrderActorKind,
  type OrderStatus,
  type PaymentStatus,
} from '@nilzora/contracts';
import type { Route } from 'next';
import type { FilterChip } from '@/components/admin-kit/filter-bar';
import { oneOf, pageParam, single, withQuery } from '@/components/admin-kit/href';
import { ORDER_STATUS, PAYMENT_STATUS } from '@/components/admin-kit/status-badge';
import { formatDayLong } from '@/lib/format';

/*
 * The orders list's address: every filter is a query parameter (?status=pending&
 * paymentStatus=pending&q=NZ1000&from=2026-10-01&to=2026-10-25&deliveryZone=inside_dhaka&
 * sort=oldest&page=2), validated here before it reaches the API, which validates again.
 * The default order (newest first) is left out of the address.
 */

export const ORDERS_PATH = '/admin/orders' satisfies Route;
export const ORDERS_PAGE_SIZE = 25;

export type SearchParams = Partial<Record<string, string | string[]>>;

export interface OrderFilters {
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  q?: string;
  from?: string;
  to?: string;
  /** One customer's orders (from the customer page). */
  customerId?: string;
  /** "archived": archived (test) orders only; they are left out otherwise. */
  view?: 'archived';
  /** Delivery zone of the order's address. */
  deliveryZone?: DeliveryZone;
  /** How the list is ordered; undefined is the default, newest first. */
  sort?: Exclude<AdminOrderSort, 'newest'>;
}

/** How the API can order the list (the contract's sort choices). */
export type AdminOrderSort = NonNullable<AdminOrderListQuery['sort']>;
/*
 * The contracts package does not re-export its ADMIN_ORDER_SORTS list, so the choices are
 * listed here; `satisfies` keeps them in step with the contract's type.
 */
export const ORDER_SORTS = [
  'newest',
  'oldest',
  'total_high',
  'total_low',
] as const satisfies readonly AdminOrderSort[];

/** The sort choices, in the order the sort control lists them. */
export const ORDER_SORT_LABEL: Record<AdminOrderSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  total_high: 'Highest total',
  total_low: 'Lowest total',
};

/** A sort from the address; the default (newest) and anything unknown are left out. */
export function sortParamOf(
  value: string | string[] | undefined,
): Exclude<AdminOrderSort, 'newest'> | undefined {
  const sort = oneOf(value, ORDER_SORTS);
  return sort === 'newest' ? undefined : sort;
}

/** A calendar day (YYYY-MM-DD) that exists, else undefined. */
export function dayParam(value: string | string[] | undefined): string | undefined {
  const text = single(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const day = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(text) ? text : undefined;
}

/** An account id (a UUID) from the address, else undefined. */
export function idParam(value: string | string[] | undefined): string | undefined {
  const text = single(value);
  return text && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
    ? text.toLowerCase()
    : undefined;
}

/** Free-text search as the API accepts it: trimmed, 1 to 100 characters. */
export function searchParam(value: string | string[] | undefined): string | undefined {
  const text = single(value)?.trim().slice(0, 100).trim();
  return text ? text : undefined;
}

export function parseOrderFilters(params: SearchParams): OrderFilters & { page: number } {
  return {
    status: oneOf(params.status, ORDER_STATUSES),
    paymentStatus: oneOf(params.paymentStatus, PAYMENT_STATUSES),
    q: searchParam(params.q),
    from: dayParam(params.from),
    to: dayParam(params.to),
    customerId: idParam(params.customerId),
    view: single(params.view) === 'archived' ? 'archived' : undefined,
    deliveryZone: oneOf(params.deliveryZone, DELIVERY_ZONES),
    sort: sortParamOf(params.sort),
    page: pageParam(params.page),
  };
}

export function orderListQuery(filters: OrderFilters & { page: number }): AdminOrderListQuery {
  return { ...filters, pageSize: ORDERS_PAGE_SIZE };
}

/** The list with these filters (and page; page 1 is left out of the address). */
export function ordersHref(filters: OrderFilters, page = 1): Route {
  return withQuery(ORDERS_PATH, {
    status: filters.status,
    paymentStatus: filters.paymentStatus,
    q: filters.q,
    from: filters.from,
    to: filters.to,
    customerId: filters.customerId,
    view: filters.view,
    deliveryZone: filters.deliveryZone,
    sort: filters.sort,
    page: page > 1 ? page : undefined,
  });
}

export function hasOrderFilters(filters: OrderFilters): boolean {
  return Boolean(
    filters.status ||
    filters.paymentStatus ||
    filters.q ||
    filters.from ||
    filters.to ||
    filters.customerId ||
    filters.view ||
    filters.deliveryZone,
  );
}

/**
 * One removable chip per filter in effect. `customerName` comes from the API (the
 * customer's account), never from the address.
 */
export function orderFilterChips(filters: OrderFilters, customerName?: string): FilterChip[] {
  const without = (key: keyof OrderFilters) => ordersHref({ ...filters, [key]: undefined });
  const chips: FilterChip[] = [];
  if (filters.status) {
    chips.push({
      key: 'status',
      label: `Status: ${ORDER_STATUS[filters.status].label}`,
      removeHref: without('status'),
    });
  }
  if (filters.paymentStatus) {
    chips.push({
      key: 'paymentStatus',
      label: `Payment: ${PAYMENT_STATUS[filters.paymentStatus].label}`,
      removeHref: without('paymentStatus'),
    });
  }
  if (filters.q) {
    chips.push({ key: 'q', label: `Search: “${filters.q}”`, removeHref: without('q') });
  }
  if (filters.deliveryZone) {
    chips.push({
      key: 'deliveryZone',
      label: `Zone: ${DELIVERY_ZONE_LABEL[filters.deliveryZone]}`,
      removeHref: without('deliveryZone'),
    });
  }
  if (filters.view === 'archived') {
    chips.push({ key: 'view', label: 'Archived orders', removeHref: without('view') });
  }
  if (filters.from) {
    chips.push({
      key: 'from',
      label: `From ${formatDayLong(filters.from)}`,
      removeHref: without('from'),
    });
  }
  if (filters.to) {
    chips.push({ key: 'to', label: `To ${formatDayLong(filters.to)}`, removeHref: without('to') });
  }
  if (filters.customerId) {
    chips.push({
      key: 'customerId',
      label: `Customer: ${customerName ?? 'one account'}`,
      removeHref: without('customerId'),
    });
  }
  if (filters.sort) {
    chips.push({
      key: 'sort',
      label: `Sorted: ${ORDER_SORT_LABEL[filters.sort]}`,
      removeHref: without('sort'),
    });
  }
  return chips;
}

export const DELIVERY_ZONE_LABEL: Record<DeliveryZone, string> = {
  inside_dhaka: 'Inside Dhaka',
  outside_dhaka: 'Outside Dhaka',
};

export const ORDER_ACTOR_LABEL: Record<OrderActorKind, string> = {
  customer: 'Customer',
  staff: 'Staff',
  system: 'Nilzora',
};

/** The fulfilment steps staff take, as action labels. */
export const ORDER_STEP: Record<
  Exclude<OrderStatus, 'pending' | 'cancelled'>,
  { action: string; confirm: string; description: string }
> = {
  confirmed: {
    action: 'Confirm order',
    confirm: 'Yes, confirm it',
    description: 'Confirm that the order is genuine and will be prepared for delivery.',
  },
  processing: {
    action: 'Start processing',
    confirm: 'Yes, start processing',
    description: 'The order is being picked and packed.',
  },
  shipped: {
    action: 'Mark as shipped',
    confirm: 'Yes, it has shipped',
    description: 'The parcel has been handed to the courier. It can no longer be cancelled.',
  },
  delivered: {
    action: 'Mark as delivered',
    confirm: 'Yes, it was delivered',
    description:
      'The customer received the parcel. Record the cash once the courier hands it over.',
  },
};

export function isOrderStep(status: OrderStatus): status is keyof typeof ORDER_STEP {
  return status !== 'pending' && status !== 'cancelled';
}

/*
 * Notices: a Server Action that redirects (because the form it came from disappears
 * once the change is made) names a fixed notice key in `?notice=`. Pages show the
 * message for a known key only; the query text itself is never displayed.
 */

/** `href` with `?notice=key` (or `&notice=key`) appended. */
export function withNotice(href: string, notice: string): Route {
  const separator = href.includes('?') ? '&' : '?';
  return `${href}${separator}notice=${encodeURIComponent(notice)}` as Route;
}

/** The message of an allow-listed notice key; anything else shows nothing. */
export function noticeMessage(
  value: string | string[] | undefined,
  notices: Readonly<Record<string, string>>,
): string | undefined {
  const key = single(value);
  return key !== undefined && Object.hasOwn(notices, key) ? notices[key] : undefined;
}

/** Notices of the order page. */
export const ORDER_NOTICES = {
  confirmed: 'The order is confirmed.',
  processing: 'The order is now processing.',
  shipped: 'The order is marked as shipped.',
  delivered: 'The order is marked as delivered. Record the cash once the courier hands it over.',
  cancelled: 'The order is cancelled and its stock is back in inventory.',
  cash_collected: 'The cash is recorded as collected. The order is fully paid.',
} as const satisfies Record<string, string>;
export type OrderNotice = keyof typeof ORDER_NOTICES;
