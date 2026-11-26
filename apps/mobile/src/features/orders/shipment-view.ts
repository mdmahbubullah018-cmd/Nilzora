import {
  SHIPMENT_STATUS_LABELS,
  type CustomerShipment,
  type OrderStatus,
  type ShipmentKind,
  type ShipmentStatus,
} from '@nilzora/contracts';
import type { StatusTone } from './status';

/*
 * Courier shipment wording
 * ------------------------
 * How a shipment reads on the order and return screens. It follows the storefront
 * (apps/storefront/src/lib/shipment-view.ts) so the website and the app tell the same story.
 * A shipment moves on its own: these words say where the courier has the parcel and never
 * stand in for the order's status. The data is the customer contract's, with no costs.
 */

/** Calm tones: progress blue, an arrival green, a hitch amber, an end grey. Never red. */
const STATUS_TONES: Readonly<Record<ShipmentStatus, StatusTone>> = {
  draft: 'neutral',
  quoted: 'neutral',
  booking_pending: 'neutral',
  booking_failed: 'neutral',
  booked: 'info',
  pickup_pending: 'info',
  picked_up: 'info',
  in_transit: 'info',
  on_hold: 'warning',
  out_for_delivery: 'info',
  delivered: 'success',
  partially_delivered: 'warning',
  delivery_failed: 'warning',
  cancelled: 'neutral',
  return_initiated: 'neutral',
  returned: 'neutral',
  unknown: 'neutral',
};

export function shipmentTone(status: ShipmentStatus): StatusTone {
  return STATUS_TONES[status];
}

/** A return pickup travels the other way: "Delivered" means the items reached Nilzora. */
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
 * Parcels coming to the customer (the order and any exchange), newest first as the API
 * sends them. A cancelled booking that another replaced is left out; when every booking is
 * cancelled, they still show.
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
 * The courier's tracking page, only when it is an ordinary https/http address: the app
 * hands it to the system, so another scheme could open something other than a browser.
 */
export function trackingUrl(url: string | null): string | null {
  if (url === null) return null;
  const match = /^(https?):\/\/[^\s/?#]+[^\s]*$/i.exec(url.trim());
  return match === null ? null : url.trim();
}

export interface TrackingStep {
  status: ShipmentStatus;
  at: string;
}

/** The courier's updates, newest first; a booking with no update yet still shows. */
export function trackingSteps(shipment: CustomerShipment): readonly TrackingStep[] {
  const steps = shipment.events.map((event) => ({ status: event.status, at: event.occurredAt }));
  if (steps.length === 0 && shipment.bookedAt !== null) {
    return [{ status: 'booked', at: shipment.bookedAt }];
  }
  return steps.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Order statuses whose shipments are worth asking for: a pending order has none yet. */
export function mayHaveShipments(status: OrderStatus): boolean {
  return status !== 'pending';
}

/** Orders that may still be handed to a courier: where to say tracking will come. */
export function awaitsCourier(status: OrderStatus): boolean {
  return status === 'confirmed' || status === 'processing' || status === 'shipped';
}
