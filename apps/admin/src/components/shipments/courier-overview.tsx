import {
  COURIER_CAPABILITIES,
  type CourierConfigResponse,
  type CourierOverviewResponse,
  type Permission,
} from '@nilzora/contracts';
import { Alert, buttonClasses } from '@nilzora/ui';
import {
  Ban,
  CircleCheck,
  CircleHelp,
  HandCoins,
  PackageCheck,
  PackageX,
  RefreshCwOff,
  Timer,
  Truck,
  Undo2,
  Warehouse,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { Chip } from '@/components/admin-kit/chip';
import { MetricTile } from '@/components/admin-kit/metric-tile';
import { SectionCard } from '@/components/admin-kit/section-card';
import { formatCount, formatMoney, formatPercent } from '@/lib/format';
import { CourierModeBanner } from './shipment-chips';
import {
  CAPABILITY_STATE,
  OPERATIONS_PATHS,
  shipmentsHref,
  type ShipmentFilters,
} from './shipment-labels';
import { AutoText } from '@/components/i18n/translate';

export interface CourierOverviewViewProps {
  overview: CourierOverviewResponse;
  /** Null when the configuration could not be read (the cards then show counts only). */
  config: CourierConfigResponse | null;
  permissions: readonly Permission[];
  includeTest: boolean;
}

/**
 * The courier desk at a glance: how the server talks to couriers, what needs attention
 * (uncertain bookings first), where parcels are, and how each courier performs. Counts are
 * the API's; test shipments count only when "Include test data" is on.
 */
export function CourierOverviewView({
  overview,
  config,
  permissions,
  includeTest,
}: CourierOverviewViewProps) {
  const canList = permissions.includes('shipments.read');
  const list = (filters: ShipmentFilters): Route | undefined =>
    canList ? shipmentsHref({ ...filters, test: includeTest }) : undefined;
  const tiles = [
    {
      label: 'Booking pending',
      value: overview.bookingPending,
      icon: Timer,
      tone: 'warning' as const,
      href: list({ status: 'booking_pending' }),
    },
    {
      label: 'Awaiting pickup',
      value: overview.pendingPickup,
      icon: Warehouse,
      tone: 'primary' as const,
      href: list({ status: 'pickup_pending' }),
    },
    {
      label: 'In transit',
      value: overview.inTransit,
      icon: Truck,
      tone: 'violet' as const,
      href: list({ status: 'in_transit' }),
    },
    {
      label: 'Delivered',
      value: overview.delivered,
      icon: PackageCheck,
      tone: 'success' as const,
      href: list({ status: 'delivered' }),
    },
    {
      label: 'Delivery failed',
      value: overview.failed,
      icon: PackageX,
      tone: 'danger' as const,
      href: list({ status: 'delivery_failed' }),
    },
    {
      label: 'Returned to store',
      value: overview.returned,
      icon: Undo2,
      tone: 'neutral' as const,
      href: list({ status: 'returned' }),
    },
    {
      label: 'Cancelled',
      value: overview.cancelled,
      icon: Ban,
      tone: 'neutral' as const,
      href: list({ status: 'cancelled' }),
    },
    {
      label: 'Tracking sync errors',
      value: overview.syncErrors,
      icon: RefreshCwOff,
      tone: overview.syncErrors > 0 ? ('danger' as const) : ('neutral' as const),
      href: undefined,
    },
  ];

  return (
    <div className="grid gap-6">
      <CourierModeBanner
        mode={overview.mode}
        bookingEnabled={config?.bookingEnabled}
        settingsHref={permissions.includes('couriers.read') ? OPERATIONS_PATHS.settings : undefined}
      />
      {config?.modeNotice ? (
        <Alert tone="warning" title="The saved courier mode is not in effect">
          {config.modeNotice}
        </Alert>
      ) : null}

      {overview.uncertain > 0 ? (
        <Alert
          tone="danger"
          title={`${formatCount(overview.uncertain)} booking${overview.uncertain === 1 ? '' : 's'} need checking`}
        >
          The courier did not answer these bookings clearly, so Nilzora does not know whether a
          parcel exists. Check each one in the courier’s portal, then resolve it on its shipment
          page. They are never retried automatically.{' '}
          {canList ? (
            <Link
              href={shipmentsHref({ status: 'booking_pending', test: includeTest })}
              className="font-semibold underline underline-offset-4"
            ><AutoText>Open pending bookings</AutoText></Link>
          ) : null}
        </Alert>
      ) : null}

      <section aria-labelledby="shipment-counts" className="grid gap-3">
        <h2 id="shipment-counts" className="sr-only"><AutoText>Shipments by status</AutoText></h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricTile
            label="Uncertain bookings"
            value={formatCount(overview.uncertain)}
            icon={CircleHelp}
            tone={overview.uncertain > 0 ? 'danger' : 'neutral'}
            hint={overview.uncertain > 0 ? 'Check the portal, then resolve' : 'Nothing to resolve'}
            {...(canList && overview.uncertain > 0
              ? { href: shipmentsHref({ status: 'booking_pending', test: includeTest }) }
              : {})}
            className={overview.uncertain > 0 ? 'ring-2 ring-danger-line' : undefined}
          />
          {tiles.map((tile) => (
            <MetricTile
              key={tile.label}
              label={tile.label}
              value={formatCount(tile.value)}
              icon={tile.icon}
              tone={tile.tone}
              {...(tile.href ? { href: tile.href } : {})}
            />
          ))}
          {overview.codAwaitingSettlementMinor !== null ? (
            <MetricTile
              label="COD awaiting settlement"
              value={formatMoney(overview.codAwaitingSettlementMinor)}
              icon={HandCoins}
              tone="warning"
              hint="Courier has it, not yet paid out"
              {...(permissions.includes('couriers.cod.read') ? { href: OPERATIONS_PATHS.cod } : {})}
            />
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {formatCount(overview.total)} shipment{overview.total === 1 ? '' : 's'} in all.{' '}
          {overview.includesMock
            ? 'Test shipments from the mock courier are included.'
            : 'Test shipments are left out.'}{' '}
          Shipment statuses are the couriers’; order statuses are changed only on the order.
        </p>
      </section>

      <SectionCard
        title="Couriers"
        icon={Truck}
        description="Delivered and failed parcels per courier, and what Nilzora can do with each one."
        actions={
          permissions.includes('couriers.read') ? (
            <Link
              href={OPERATIONS_PATHS.providers}
              className={buttonClasses({ variant: 'outline', size: 'sm' })}
            ><AutoText>Manage providers</AutoText></Link>
          ) : undefined
        }
      >
        {overview.providers.length === 0 ? (
          <p className="text-sm text-muted-foreground"><AutoText>No couriers are set up yet.</AutoText></p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {overview.providers.map((provider) => {
              const detail = config?.providers.find((p) => p.provider === provider.provider);
              const finished = provider.delivered + provider.failed;
              const available = detail
                ? COURIER_CAPABILITIES.filter((c) => detail.capabilities[c] === 'available').length
                : null;
              const awaiting = detail
                ? COURIER_CAPABILITIES.filter(
                    (c) => detail.capabilities[c] === 'awaiting_documentation',
                  ).length
                : 0;
              return (
                <li
                  key={provider.provider}
                  className="grid gap-3 rounded-xl border border-hairline bg-surface/60 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-display font-semibold text-foreground">
                      {provider.displayName}
                    </h3>
                    <Chip tone={provider.isEnabled ? 'success' : 'neutral'} dot>
                      {provider.isEnabled ? 'Enabled' : 'Not enabled'}
                    </Chip>
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground"><AutoText>Delivered</AutoText></dt>
                      <dd className="font-semibold text-foreground tabular-nums">
                        {formatCount(provider.delivered)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground"><AutoText>Failed</AutoText></dt>
                      <dd className="font-semibold text-foreground tabular-nums">
                        {formatCount(provider.failed)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground"><AutoText>Delivery rate</AutoText></dt>
                      <dd className="font-semibold text-foreground tabular-nums">
                        {finished > 0 ? formatPercent(provider.delivered / finished) : '—'}
                      </dd>
                    </div>
                  </dl>
                  {detail ? (
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <CircleCheck aria-hidden="true" className="size-3.5" />
                      {available} of {COURIER_CAPABILITIES.length} operations available
                      {awaiting > 0 ? (
                        <Chip tone={CAPABILITY_STATE.awaiting_documentation.tone}>
                          {awaiting} awaiting API documentation
                        </Chip>
                      ) : null}
                    </p>
                  ) : null}
                  {detail?.blockedReason ? (
                    <p className="text-xs text-muted-foreground"><AutoText value={detail.blockedReason} /></p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
