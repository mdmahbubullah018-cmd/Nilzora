import { randomUUID } from 'node:crypto';
import type { CourierConfigResponse, OrderCourierContext, Permission } from '@nilzora/contracts';
import { Truck } from 'lucide-react';
import { SectionCard } from '@/components/admin-kit/section-card';
import { ORDER_STATUS } from '@/components/admin-kit/status-badge';
import { adminRead } from '@/components/admin-kit/read';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { OrderCourierPanel } from './booking-panel';
import { apiCanBook, PROVIDER_OPTIONS, providerName } from './shipment-labels';
import { ShipmentSummaryList } from './shipment-summary-list';
import { AutoText } from '@/components/i18n/translate';

/** Why an order cannot be booked, in words. */
export function notBookableText(context: OrderCourierContext): string | null {
  if (context.bookable) return null;
  if (context.notBookableReason === 'active_shipment') {
    return 'This order already has an active shipment. Open it to track, cancel or resolve it.';
  }
  const status = context.order.status;
  const label = Object.hasOwn(ORDER_STATUS, status)
    ? ORDER_STATUS[status as keyof typeof ORDER_STATUS].label
    : status;
  if (status === 'pending') return 'A courier can be booked once the order is confirmed.';
  return `This order is ${label.toLowerCase()}, so no new parcel can be booked.`;
}

export interface OrderShipmentPanelViewProps {
  orderNumber: string;
  context: OrderCourierContext;
  config: CourierConfigResponse | null;
  /** The portal-booking form's key, created once per page render. */
  portalBookingKey: string;
  permissions: readonly Permission[];
  csrf: CsrfInput;
}

/**
 * The Shipment panel of an order. It stays small for an order that cannot ship yet (one
 * line saying why), and otherwise offers the explicit compare-and-book flow and the order's
 * shipments. Booking never changes the order's status or its shipping charge.
 */
export function OrderShipmentPanelView({
  orderNumber,
  context,
  config,
  portalBookingKey,
  permissions,
  csrf,
}: OrderShipmentPanelViewProps) {
  const reason = notBookableText(context);
  const canOpen = permissions.includes('shipments.read');
  const names: Record<string, string> = Object.fromEntries(
    (config?.providers ?? []).map((p) => [p.provider, p.displayName || providerName(p.provider)]),
  );

  if (!context.bookable && context.shipments.length === 0) {
    return (
      <SectionCard title="Shipment" icon={Truck} titleAs="h2">
        <p className="text-sm text-muted-foreground">
          <AutoText value={reason} />
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Shipment"
      icon={Truck}
      description="Compare couriers and book explicitly. Courier events move the shipment only; the order’s status and the customer’s shipping charge stay as they are."
    >
      <div className="grid gap-4">
        <OrderCourierPanel
          orderNumber={orderNumber}
          csrf={csrf}
          context={context}
          mode={config?.mode ?? null}
          bookingEnabled={config?.bookingEnabled ?? null}
          names={names}
          canBook={permissions.includes('shipments.create')}
          canOpenShipments={canOpen}
          apiBookable={apiCanBook(config, 'book')}
          portalBookingKey={portalBookingKey}
          providerOptions={
            config && config.providers.length > 0
              ? config.providers.map((p) => ({
                  value: p.provider,
                  label: names[p.provider] ?? p.provider,
                }))
              : PROVIDER_OPTIONS
          }
        />
        {reason ? (
          <p className="text-sm text-muted-foreground">
            <AutoText value={reason} />
          </p>
        ) : null}
        <ShipmentSummaryList
          shipments={context.shipments}
          canOpen={canOpen}
          label={`Shipments of order ${orderNumber}`}
        />
      </div>
    </SectionCard>
  );
}

/** What the order page needs for its Shipment panel, or why it shows none. */
export type OrderCourierData =
  | {
      kind: 'ok';
      context: OrderCourierContext;
      config: CourierConfigResponse | null;
      portalBookingKey: string;
    }
  | { kind: 'hidden' }
  | { kind: 'unavailable' };

/** Loads the order's courier context (shipments.read) and the courier configuration. */
export async function loadOrderCourier(
  orderNumber: string,
  permissions: readonly Permission[],
): Promise<OrderCourierData> {
  if (!permissions.includes('shipments.read')) return { kind: 'hidden' };
  const [context, config] = await Promise.all([
    adminRead((api, token) => api.adminOrderCourierContext(token, orderNumber)),
    adminRead((api, token) => api.adminCourierConfig(token)),
  ]);
  if (context.kind === 'ok') {
    return {
      kind: 'ok',
      context: context.value,
      config: config.kind === 'ok' ? config.value : null,
      portalBookingKey: randomUUID(),
    };
  }
  return context.kind === 'unavailable' || context.kind === 'rate_limited'
    ? { kind: 'unavailable' }
    : { kind: 'hidden' };
}

/** The order's Shipment panel from loaded data (nothing for accounts without access). */
export function OrderShipmentPanel({
  data,
  orderNumber,
  permissions,
  csrf,
}: {
  data: OrderCourierData;
  orderNumber: string;
  permissions: readonly Permission[];
  csrf: CsrfInput;
}) {
  if (data.kind === 'hidden') return null;
  if (data.kind === 'unavailable') {
    return (
      <p className="text-sm text-muted-foreground">
        <AutoText>
          Courier shipments for this order could not be loaded just now. Reload the page to try
          again.
        </AutoText>
      </p>
    );
  }
  return (
    <OrderShipmentPanelView
      orderNumber={orderNumber}
      context={data.context}
      config={data.config}
      portalBookingKey={data.portalBookingKey}
      permissions={permissions}
      csrf={csrf}
    />
  );
}
