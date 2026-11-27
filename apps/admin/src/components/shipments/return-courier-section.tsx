import { randomUUID } from 'node:crypto';
import type { CourierConfigResponse, Permission, ReturnStatus, Shipment } from '@nilzora/contracts';
import { Truck } from 'lucide-react';
import { adminRead } from '@/components/admin-kit/read';
import { SectionCard } from '@/components/admin-kit/section-card';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { ActionDisclosure } from './shipment-actions';
import { CourierModeBanner } from './shipment-chips';
import { apiCanBook, gramsToKgText, PROVIDER_OPTIONS, providerName } from './shipment-labels';
import { PortalBookingForm } from './portal-booking-form';
import { ShipmentSummaryList } from './shipment-summary-list';
import { ReturnBookingForm } from './return-booking-form';
import { AutoText } from '@/components/i18n/translate';

/** Return statuses that may get an exchange delivery (the API decides again). */
const EXCHANGE_STATUSES: readonly ReturnStatus[] = ['approved', 'received', 'completed'];

export interface ReturnCourierViewProps {
  returnId: string;
  /** The order the return belongs to (a portal pickup is recorded on it). */
  orderNumber: string;
  status: ReturnStatus;
  shipments: readonly Shipment[];
  config: CourierConfigResponse | null;
  permissions: readonly Permission[];
  csrf: CsrfInput;
  /** One key per form, created when the page renders it. */
  keys: { pickup: string; exchange: string; portal: string };
}

/** The courier side of a return: pickup and exchange bookings, and the shipments so far. */
export function ReturnCourierView({
  returnId,
  orderNumber,
  status,
  shipments,
  config,
  permissions,
  csrf,
  keys,
}: ReturnCourierViewProps) {
  const canManage = permissions.includes('shipments.returns.manage');
  const canOpen = permissions.includes('shipments.read');
  const providers =
    config && config.providers.length > 0
      ? config.providers.map((p) => ({
          value: p.provider,
          label: p.displayName || providerName(p.provider),
        }))
      : PROVIDER_OPTIONS;
  const weight = gramsToKgText(config?.settings.defaultParcelWeightGrams ?? 1000);
  const off = config?.mode === 'off';
  // A pickup is booked through the API only where its return-pickup API is verified (or in
  // test mode); otherwise staff book it in the courier portal and record it here.
  const apiPickup = apiCanBook(config, 'returnPickup');
  const active = (kind: Shipment['kind']) =>
    shipments.some(
      (s) =>
        s.kind === kind &&
        !['booking_failed', 'cancelled', 'delivered', 'returned'].includes(s.status),
    );
  const pickupNeeded = canManage && status === 'approved' && !active('return_pickup');
  const pickupOpen = pickupNeeded && apiPickup;
  const exchangeOpen =
    canManage &&
    apiCanBook(config, 'book') &&
    EXCHANGE_STATUSES.includes(status) &&
    !active('exchange');
  const portalForm = (
    <PortalBookingForm
      orderNumber={orderNumber}
      returnId={returnId}
      csrf={csrf}
      initialBookingKey={keys.portal}
      providers={providers}
      defaultWeightKg={weight}
      canOpenShipment={canOpen}
    />
  );

  return (
    <SectionCard
      title="Courier"
      icon={Truck}
      description="Book a courier to collect the goods or to deliver an exchange. Each booking is an explicit step."
    >
      <div className="grid gap-3">
        {config && config.mode !== 'live' ? <CourierModeBanner mode={config.mode} compact /> : null}
        {pickupOpen ? (
          <ActionDisclosure
            title="Book a return pickup"
            description="The courier collects the goods from the customer"
          >
            <ReturnBookingForm
              returnId={returnId}
              kind="return_pickup"
              csrf={csrf}
              initialBookingKey={keys.pickup}
              providers={providers}
              defaultWeightKg={weight}
              canOpenShipment={canOpen}
            />
          </ActionDisclosure>
        ) : null}
        {pickupNeeded && !apiPickup ? (
          <section
            aria-labelledby={`portal-pickup-${returnId}`}
            className="grid gap-3 rounded-xl border border-info-line bg-info-soft/30 p-4"
          >
            <div className="grid gap-1">
              <h3
                id={`portal-pickup-${returnId}`}
                className="font-display text-sm font-semibold text-foreground"
              >
                <AutoText>Book the pickup in the courier portal, then record it here</AutoText>
              </h3>
              <p className="text-sm text-muted-foreground">
                {off
                  ? 'Courier connections are switched off on this server.'
                  : 'Return pickups through the courier APIs are not available yet.'}{' '}
                Book the pickup in the courier’s merchant portal, then record its consignment so it
                can be tracked.
              </p>
            </div>
            {portalForm}
          </section>
        ) : null}
        {pickupOpen ? (
          <ActionDisclosure
            title="Pickup booked in the courier portal instead?"
            description="Record a pickup already booked in the courier’s merchant portal"
          >
            {portalForm}
          </ActionDisclosure>
        ) : null}
        {exchangeOpen ? (
          <ActionDisclosure
            title="Book an exchange delivery"
            description="Send the replacement to the customer"
          >
            <ReturnBookingForm
              returnId={returnId}
              kind="exchange"
              csrf={csrf}
              initialBookingKey={keys.exchange}
              providers={providers}
              defaultWeightKg={weight}
              canOpenShipment={canOpen}
            />
          </ActionDisclosure>
        ) : null}
        {!canManage ? (
          <p className="text-xs text-muted-foreground">
            Booking return pickups and exchanges needs the “Book return pickups and exchanges”
            permission.
          </p>
        ) : !pickupNeeded && !exchangeOpen ? (
          <p className="text-xs text-muted-foreground">
            {status === 'requested'
              ? 'A pickup can be booked once the return is approved.'
              : 'No courier booking is open for this return right now.'}
          </p>
        ) : null}
        {shipments.length > 0 ? (
          <ShipmentSummaryList
            shipments={shipments}
            canOpen={canOpen}
            label="Shipments of this return"
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            <AutoText>No courier shipments for this return yet.</AutoText>
          </p>
        )}
      </div>
    </SectionCard>
  );
}

/** What the return page needs for its courier section, or why it shows none. */
export type ReturnCourierData =
  | {
      kind: 'ok';
      shipments: Shipment[];
      config: CourierConfigResponse | null;
      keys: { pickup: string; exchange: string; portal: string };
    }
  | { kind: 'hidden' }
  | { kind: 'unavailable' };

/**
 * Loads the return's shipments (shipments.read or shipments.returns.manage) and the courier
 * configuration. Each booking form gets its key here, once per page render.
 */
export async function loadReturnCourier(
  returnId: string,
  permissions: readonly Permission[],
): Promise<ReturnCourierData> {
  if (
    !permissions.includes('shipments.read') &&
    !permissions.includes('shipments.returns.manage')
  ) {
    return { kind: 'hidden' };
  }
  const [shipments, config] = await Promise.all([
    adminRead((api, token) => api.adminReturnShipments(token, returnId)),
    adminRead((api, token) => api.adminCourierConfig(token)),
  ]);
  if (shipments.kind !== 'ok') {
    return shipments.kind === 'unavailable' || shipments.kind === 'rate_limited'
      ? { kind: 'unavailable' }
      : { kind: 'hidden' };
  }
  return {
    kind: 'ok',
    shipments: shipments.value.shipments.map((entry) => entry.shipment),
    config: config.kind === 'ok' ? config.value : null,
    keys: { pickup: randomUUID(), exchange: randomUUID(), portal: randomUUID() },
  };
}

/** The courier section for a loaded return (nothing when the account has no access). */
export function ReturnCourierSection({
  data,
  returnId,
  orderNumber,
  status,
  permissions,
  csrf,
}: {
  data: ReturnCourierData;
  returnId: string;
  orderNumber: string;
  status: ReturnStatus;
  permissions: readonly Permission[];
  csrf: CsrfInput;
}) {
  if (data.kind === 'hidden') return null;
  if (data.kind === 'unavailable') {
    return (
      <p className="text-sm text-muted-foreground">
        <AutoText>Courier shipments for this return could not be loaded just now.</AutoText>
      </p>
    );
  }
  return (
    <ReturnCourierView
      returnId={returnId}
      orderNumber={orderNumber}
      status={status}
      shipments={data.shipments}
      config={data.config}
      permissions={permissions}
      csrf={csrf}
      keys={data.keys}
    />
  );
}
