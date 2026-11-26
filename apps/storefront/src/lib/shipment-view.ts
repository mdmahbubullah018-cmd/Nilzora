import {
  SHIPMENT_STATUS_LABELS,
  type CustomerShipment,
  type ShipmentKind,
  type ShipmentStatus,
} from '@nilzora/contracts';
import type { BadgeTone } from '@nilzora/ui';

/*
 * How a courier shipment reads on the customer's order and return pages.
 *
 * A shipment has its own life, separate from the order's: these words describe where the
 * courier has the parcel and never stand in for the order's status. The data is the
 * customer contract's (no costs, no settlement, no raw courier data), so nothing here can
 * show money.
 */

/** Calm tones: progress is blue or violet, an arrival green, a hitch amber, an end grey. */
const STATUS_TONES: Readonly<Record<ShipmentStatus, BadgeTone>> = {
  draft: 'neutral',
  quoted: 'neutral',
  booking_pending: 'neutral',
  booking_failed: 'neutral',
  booked: 'primary',
  pickup_pending: 'primary',
  picked_up: 'primary',
  in_transit: 'primary',
  on_hold: 'warning',
  out_for_delivery: 'violet',
  delivered: 'success',
  partially_delivered: 'warning',
  delivery_failed: 'warning',
  cancelled: 'neutral',
  return_initiated: 'neutral',
  returned: 'neutral',
  unknown: 'neutral',
};

export function shipmentTone(status: ShipmentStatus): BadgeTone {
  return STATUS_TONES[status];
}

/**
 * The words for a status. A return pickup travels the other way, so "Delivered" means the
 * items reached Nilzora, and the label says so.
 */
export function shipmentStatusLabel(kind: ShipmentKind, status: ShipmentStatus): string {
  if (kind === 'return_pickup') {
    if (status === 'delivered') return 'Received by Nilzora';
    if (status === 'picked_up') return 'Collected from you';
    if (status === 'pickup_pending') return 'Awaiting pickup';
  }
  return SHIPMENT_STATUS_LABELS[status];
}

export const SHIPMENT_KIND_LABELS: Readonly<Record<ShipmentKind, string>> = {
  forward: 'Your parcel',
  exchange: 'Exchange parcel',
  return_pickup: 'Return pickup',
};

/**
 * The parcels coming to the customer (the order itself and any exchange), newest first as
 * the API sends them. A cancelled booking that was replaced by another is left out: it is
 * no longer where the parcel is. When every booking is cancelled, they still show.
 */
export function deliveryShipments(
  shipments: readonly CustomerShipment[],
): readonly CustomerShipment[] {
  const outbound = shipments.filter((shipment) => shipment.kind !== 'return_pickup');
  const live = outbound.filter((shipment) => shipment.status !== 'cancelled');
  return live.length > 0 ? live : outbound;
}

/** Return pickups, optionally only those of one return request. */
export function returnPickups(
  shipments: readonly CustomerShipment[],
  returnRequestId?: string,
): readonly CustomerShipment[] {
  return shipments.filter(
    (shipment) =>
      shipment.kind === 'return_pickup' &&
      (returnRequestId === undefined || shipment.returnRequestId === returnRequestId),
  );
}

/**
 * The courier's tracking page, only when it is an ordinary web address. Anything else
 * (another scheme, a relative path, a malformed value) is no link at all.
 */
export function trackingHref(url: string | null): string | null {
  if (url === null) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export interface TrackingStep {
  status: ShipmentStatus;
  at: string;
}

/**
 * The courier's updates, newest first. A shipment booked before any event was recorded
 * still shows its booking, so the timeline is never empty without reason.
 */
export function trackingSteps(shipment: CustomerShipment): readonly TrackingStep[] {
  const steps = shipment.events.map((event) => ({ status: event.status, at: event.occurredAt }));
  if (steps.length === 0 && shipment.bookedAt !== null) {
    return [{ status: 'booked', at: shipment.bookedAt }];
  }
  return steps.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Orders that may still be handed to a courier: the place to say tracking will come. */
export const AWAITING_COURIER_ORDER_STATUSES = ['confirmed', 'processing', 'shipped'] as const;
