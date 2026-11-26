import type { DeliveryZone, OrderStatus, PaymentStatus } from '@nilzora/contracts';
import { Badge, type BadgeTone } from '@nilzora/ui';

/*
 * Customer-facing words for order, payment and delivery values. Payment is tracked
 * separately from the order: a confirmed order still waits for its cash on delivery.
 */

export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  pending: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  processing: 'Being prepared',
  shipped: 'On the way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const ORDER_STATUS_TONES: Readonly<Record<OrderStatus, BadgeTone>> = {
  pending: 'warning',
  confirmed: 'primary',
  processing: 'primary',
  shipped: 'violet',
  delivered: 'success',
  cancelled: 'neutral',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge tone={ORDER_STATUS_TONES[status]} dot>
      {ORDER_STATUS_LABELS[status]}
    </Badge>
  );
}

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
  collected: 'Paid',
  cancelled: 'Cancelled',
};

export const PAYMENT_STATUS_DESCRIPTIONS: Readonly<Record<PaymentStatus, string>> = {
  pending: 'Pay in cash when your parcel arrives.',
  collected: 'Cash collected on delivery. Thank you.',
  cancelled: 'Nothing to pay: this order was cancelled.',
};

const PAYMENT_STATUS_TONES: Readonly<Record<PaymentStatus, BadgeTone>> = {
  pending: 'warning',
  collected: 'success',
  cancelled: 'neutral',
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge tone={PAYMENT_STATUS_TONES[status]}>{PAYMENT_STATUS_LABELS[status]}</Badge>;
}

export const DELIVERY_ZONE_LABELS: Readonly<Record<DeliveryZone, string>> = {
  inside_dhaka: 'Inside Dhaka',
  outside_dhaka: 'Outside Dhaka',
};

const eventTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Dhaka',
});

/** e.g. "24 October 2026 at 14:05", in Bangladesh time. */
export function formatEventTime(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  return Number.isNaN(date.getTime()) ? '' : eventTime.format(date);
}
