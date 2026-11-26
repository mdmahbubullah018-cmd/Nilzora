import {
  orderNumberSchema,
  type DeliveryZone,
  type OrderDetail,
  type OrderStatus,
  type OrderSummary,
  type PaymentStatus,
} from '@nilzora/contracts';
import { formatDate } from '@/lib/dates';
import { itemCountLabel, spokenMoney } from '@/lib/money';
import type { NoticeTone } from '@/theme';

/*
 * Order wording
 * -------------
 * Customer-facing words for order, payment and delivery values. They follow the storefront
 * (apps/storefront/src/components/orders/order-status.tsx) so the website and the app tell
 * the same story. Payment is tracked apart from the order: a confirmed order still waits
 * for its cash on delivery. The server owns every status and rule; this only names them.
 */

export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  pending: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  processing: 'Being prepared',
  shipped: 'On the way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/** `neutral` is for a finished order that needs nothing more from the customer. */
export type StatusTone = NoticeTone | 'neutral';

export const ORDER_STATUS_TONES: Readonly<Record<OrderStatus, StatusTone>> = {
  pending: 'warning',
  confirmed: 'info',
  processing: 'info',
  shipped: 'info',
  delivered: 'success',
  cancelled: 'neutral',
};

/** What each step of the status history means, for the order timeline. */
export const ORDER_EVENT_LABELS: Readonly<Record<OrderStatus, string>> = {
  pending: 'Order placed',
  confirmed: 'Confirmed by Nilzora',
  processing: 'Being prepared for delivery',
  shipped: 'Handed to the courier',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export const PAYMENT_STATUS_LABELS: Readonly<Record<PaymentStatus, string>> = {
  pending: 'Payment pending',
  collected: 'Payment collected',
  cancelled: 'Payment cancelled',
};

export const PAYMENT_STATUS_DESCRIPTIONS: Readonly<Record<PaymentStatus, string>> = {
  pending: 'Pay in cash when your parcel arrives.',
  collected: 'Cash collected on delivery. Thank you.',
  cancelled: 'Nothing to pay: this order was cancelled.',
};

export const PAYMENT_STATUS_TONES: Readonly<Record<PaymentStatus, StatusTone>> = {
  pending: 'warning',
  collected: 'success',
  cancelled: 'neutral',
};

export const DELIVERY_ZONE_LABELS: Readonly<Record<DeliveryZone, string>> = {
  inside_dhaka: 'Inside Dhaka',
  outside_dhaka: 'Outside Dhaka',
};

/** "Cash on delivery · Payment pending": the one-line payment summary shown in lists. */
export function paymentSummary(status: PaymentStatus): string {
  return `Cash on delivery · ${PAYMENT_STATUS_LABELS[status]}`;
}

/** True only for a well-formed order number such as NZ100042 (anything else is untrusted input). */
export function isOrderNumber(value: unknown): value is string {
  return orderNumberSchema.safeParse(value).success;
}

/** The first value of a route parameter (`string | string[] | undefined`), if it is a string. */
export function singleParam(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** One spoken sentence for a row in the order list. */
export function orderRowLabel(order: OrderSummary): string {
  return [
    `Order ${order.orderNumber}`,
    ORDER_STATUS_LABELS[order.status],
    `placed ${formatDate(order.placedAt)}`,
    itemCountLabel(order.itemCount),
    `total ${spokenMoney(order.totalMinor)}`,
    paymentSummary(order.paymentStatus),
  ].join(', ');
}

export interface TimelineEvent {
  status: OrderStatus;
  at: string;
}

/**
 * The order's progress, oldest first. An order with no recorded history still has the
 * moment it was placed.
 */
export function timelineEvents(order: Pick<OrderDetail, 'history' | 'placedAt'>): TimelineEvent[] {
  if (order.history.length === 0) return [{ status: 'pending', at: order.placedAt }];
  return order.history
    .map((event) => ({ status: event.toStatus, at: event.at }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** A product page is linked only for a well-formed slug. */
export function isProductSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

/** "01712-345678" for a stored +8801712345678; anything else is returned unchanged. */
export function formatBdPhone(value: string): string {
  const match = /^\+880(1\d{3})(\d{6})$/.exec(value);
  if (!match?.[1] || !match[2]) return value;
  return `0${match[1]}-${match[2]}`;
}

type Address = OrderDetail['shippingAddress'];

/** The address as written on a parcel, one entry per line (without the name and phone). */
export function addressLines(address: Address): string[] {
  const lines = [address.addressLine];
  if (address.landmark) lines.push(`Near ${address.landmark}`);
  lines.push(
    `${address.area}, ${address.district}${address.postalCode ? ` ${address.postalCode}` : ''}`,
  );
  lines.push(`${address.division} Division`);
  return lines;
}
