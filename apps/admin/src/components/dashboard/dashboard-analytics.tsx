import {
  ORDER_STATUSES,
  type DeliveryZone,
  type AnalyticsOverview,
  type CheckoutRecoveryMetrics,
  type OrderStatus,
  type PaymentStatus,
} from '@nilzora/contracts';
import {
  Activity,
  CalendarClock,
  ChartPie,
  CircleGauge,
  Crown,
  Filter,
  Layers,
  MapPin,
  Trophy,
  Wallet,
} from 'lucide-react';
import { cn } from '@nilzora/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { BarList } from '@/components/admin-kit/charts/bar-list';
import { ComboChart } from '@/components/admin-kit/charts/combo-chart';
import { DonutChart } from '@/components/admin-kit/charts/donut-chart';
import { Funnel } from '@/components/admin-kit/charts/funnel';
import { Heatmap } from '@/components/admin-kit/charts/heatmap';
import { RadialProgress } from '@/components/admin-kit/charts/radial-progress';
import { Sparkline } from '@/components/admin-kit/charts/sparkline';
import { StackedBarChart } from '@/components/admin-kit/charts/stacked-bar-chart';
import type { ChartTone } from '@/components/admin-kit/charts/tones';
import type { AdminRead } from '@/components/admin-kit/read';
import { withQuery } from '@/components/admin-kit/href';
import { SectionCard } from '@/components/admin-kit/section-card';
import { ORDER_STATUS, ORDER_STATUS_CHART_TONE } from '@/components/admin-kit/status-badge';
import { DELIVERY_ZONE_LABEL } from '@/components/orders/order-query';
import {
  formatCompactMoney,
  formatCount,
  formatMoney,
  formatPercent,
  plural,
} from '@/lib/format';
import { BUCKET_NOUN, bucketOverview, bucketSizeFor } from '@/lib/analytics';
import type { ReportRange } from '@/lib/date-range';
import type { ReactNode } from 'react';
import { AutoText } from '@/components/i18n/translate';
import { CountText, DateTimeText } from '@/components/i18n/format-text';

/*
 * The dashboard's analytics panels, all drawn from one analytics overview (see
 * packages/contracts/src/admin-analytics.ts). Every figure comes from the API; a panel
 * whose data is empty says so plainly instead of drawing zeros as if they were news.
 */

const ORDERS_ROUTE: Route = '/admin/orders';

function count(value: number): string {
  return formatCount(value);
}

const PAYMENT_LABEL: Record<Exclude<PaymentStatus, 'cancelled'>, string> = {
  pending: 'Cash pending',
  collected: 'Cash collected',
};

// ---------------------------------------------------------------------------
// Revenue and orders over time
// ---------------------------------------------------------------------------

export function RevenueOrdersSection({
  overview,
  range,
  className,
}: {
  overview: AnalyticsOverview;
  range: ReportRange;
  className?: string;
}) {
  const size = bucketSizeFor(range.days);
  const data = bucketOverview(overview, size).map((bucket) => ({
    label: bucket.label,
    detail: bucket.detail,
    area: bucket.revenueMinor,
    line: bucket.orderCount,
    previousArea: bucket.previousRevenueMinor,
    previousLine: bucket.previousOrderCount,
  }));
  const { revenueMinor, orderCount } = overview.totals;
  return (
    <SectionCard
      title="Revenue and orders"
      icon={Activity}
      description={`${range.label}: ${formatMoney(revenueMinor)} from ${plural(orderCount, 'order')}`}
      className={className}
    >
      <ComboChart
        data={data}
        title={`Revenue and orders, ${range.label.toLowerCase()}`}
        summary={`${formatMoney(revenueMinor)} of revenue from ${plural(orderCount, 'order')} over ${plural(range.days, 'day')}.`}
        areaSeries={{ label: 'Revenue', tone: 'primary' }}
        lineSeries={{ label: 'Orders', tone: 'violet' }}
        formatArea={formatMoney}
        formatAreaAxis={formatCompactMoney}
        formatLine={count}
        previousLabel={overview.previousRange ? `Previous ${plural(range.days, 'day')}` : undefined}
        bandLabel={BUCKET_NOUN[size]}
      />
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Orders by status
// ---------------------------------------------------------------------------

/** Stack order: the journey bottom-up, cancelled on top. */
const STACK: readonly OrderStatus[] = ORDER_STATUSES;

export function StatusPerDaySection({
  overview,
  range,
  className,
}: {
  overview: AnalyticsOverview;
  range: ReportRange;
  className?: string;
}) {
  const total = Object.values(overview.statusSplit).reduce((sum, value) => sum + (value ?? 0), 0);
  const size = bucketSizeFor(range.days);
  const noun = BUCKET_NOUN[size].toLowerCase();
  return (
    <SectionCard
      title={`Orders by status per ${noun}`}
      icon={Layers}
      description={`Orders placed each ${noun}, by where they are now`}
      className={className}
    >
      {total === 0 ? (
        <EmptyNote><AutoText>No orders were placed in this period.</AutoText></EmptyNote>
      ) : (
        <StackedBarChart
          title={`Orders per ${noun} by current status, ${range.label.toLowerCase()}`}
          data={bucketOverview(overview, size).map((bucket) => ({
            label: bucket.label,
            detail: bucket.detail,
            values: bucket.byStatus,
          }))}
          bandLabel={BUCKET_NOUN[size]}
          series={STACK.map((status) => ({
            key: status,
            label: ORDER_STATUS[status].label,
            tone: ORDER_STATUS_CHART_TONE[status],
          }))}
          formatValue={count}
          totalLabel="Orders"
        />
      )}
    </SectionCard>
  );
}

export function StatusSplitSection({
  overview,
  className,
}: {
  overview: AnalyticsOverview;
  className?: string;
}) {
  const segments = ORDER_STATUSES.map((status) => ({
    key: status,
    label: ORDER_STATUS[status].label,
    value: overview.statusSplit[status] ?? 0,
    tone: ORDER_STATUS_CHART_TONE[status],
    href: withQuery(ORDERS_ROUTE, { status }),
  })).filter((segment) => segment.value > 0);
  return (
    <SectionCard
      title="Order status"
      icon={ChartPie}
      description="Orders placed in this period, by status now"
      className={className}
    >
      {segments.length === 0 ? (
        <EmptyNote><AutoText>No orders were placed in this period.</AutoText></EmptyNote>
      ) : (
        <DonutChart
          title="Orders placed in this period by status"
          segments={segments}
          centerLabel="orders"
          formatValue={count}
        />
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Cash and delivery
// ---------------------------------------------------------------------------

export function PaymentSplitSection({
  overview,
  className,
}: {
  overview: AnalyticsOverview;
  className?: string;
}) {
  const { pendingMinor, pendingCount, collectedMinor, collectedCount } = overview.paymentSplit;
  const segments = [
    {
      key: 'pending',
      label: `${PAYMENT_LABEL.pending} (${plural(pendingCount, 'order')})`,
      value: pendingMinor,
      tone: 'warning' as ChartTone,
      href: withQuery(ORDERS_ROUTE, { paymentStatus: 'pending' }),
    },
    {
      key: 'collected',
      label: `${PAYMENT_LABEL.collected} (${plural(collectedCount, 'order')})`,
      value: collectedMinor,
      tone: 'success' as ChartTone,
      href: withQuery(ORDERS_ROUTE, { paymentStatus: 'collected' }),
    },
  ].filter((segment) => segment.value > 0);
  return (
    <SectionCard
      title="Cash on delivery"
      icon={Wallet}
      description="This period's orders: cash still to collect vs collected"
      className={className}
    >
      {segments.length === 0 ? (
        <EmptyNote><AutoText>No cash is due on this period&apos;s orders.</AutoText></EmptyNote>
      ) : (
        <DonutChart
          title="Cash on delivery: pending vs collected"
          segments={segments}
          centerValue={formatCompactMoney(pendingMinor + collectedMinor)}
          centerLabel="due in total"
          formatValue={formatMoney}
        />
      )}
    </SectionCard>
  );
}

const ZONE_TONE: Record<DeliveryZone, ChartTone> = {
  inside_dhaka: 'primary',
  outside_dhaka: 'violet',
};

export function DeliveryZoneSection({
  overview,
  className,
}: {
  overview: AnalyticsOverview;
  className?: string;
}) {
  const segments = overview.deliveryZones
    .map((zone) => ({
      key: zone.zone,
      label: DELIVERY_ZONE_LABEL[zone.zone],
      value: zone.orderCount,
      tone: ZONE_TONE[zone.zone],
    }))
    .filter((segment) => segment.value > 0);
  return (
    <SectionCard
      title="Delivery zones"
      icon={MapPin}
      description="Orders inside vs outside Dhaka"
      className={className}
    >
      {segments.length === 0 ? (
        <EmptyNote><AutoText>No orders were delivered or placed for delivery in this period.</AutoText></EmptyNote>
      ) : (
        <DonutChart
          title="Orders by delivery zone"
          segments={segments}
          centerLabel="orders"
          formatValue={count}
        />
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Rates and target
// ---------------------------------------------------------------------------

export function RatesSection({
  overview,
  canSetTarget,
  className,
}: {
  overview: AnalyticsOverview;
  /** Whether to link "Set a target" (settings.manage). */
  canSetTarget: boolean;
  className?: string;
}) {
  const { monthTarget, rates, totals } = overview;
  const targetProgress =
    monthTarget.targetMinor !== null && monthTarget.targetMinor > 0
      ? monthTarget.revenueMinor / monthTarget.targetMinor
      : null;
  return (
    <SectionCard
      title="Targets and rates"
      icon={CircleGauge}
      description="This month against its target, and how the period's orders turned out"
      actions={
        canSetTarget ? (
          <Link
            href="/admin/settings"
            className="nz-tap text-sm font-medium text-link underline-offset-4 hover:underline"
          >
            {monthTarget.targetMinor === null ? 'Set a target' : 'Change target'}
          </Link>
        ) : undefined
      }
      className={className}
    >
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <RadialProgress
          value={targetProgress}
          label="Monthly target"
          tone="primary"
          valueText={targetProgress === null ? undefined : formatPercent(targetProgress)}
          targetLabel={
            monthTarget.targetMinor === null
              ? undefined
              : `${formatCompactMoney(monthTarget.revenueMinor)} of ${formatCompactMoney(monthTarget.targetMinor)}`
          }
          emptyReason={
            monthTarget.targetMinor === null ? 'No monthly target is set' : 'The target is zero'
          }
        />
        <RadialProgress
          value={rates.fulfillment}
          label="Fulfilment rate"
          tone="success"
          centerLabel="delivered"
          targetLabel={`${formatCount(totals.deliveredCount)} of ${plural(totals.orderCount, 'order')}`}
          emptyReason="No orders in this period"
        />
        <RadialProgress
          value={rates.returns}
          label="Return rate"
          tone="warning"
          centerLabel="returned"
          targetLabel={`${formatCount(totals.returnedOrderCount)} of ${plural(totals.deliveredCount, 'delivered order')}`}
          emptyReason="No delivered orders in this period"
        />
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// What sells, and who buys
// ---------------------------------------------------------------------------

export function CategorySalesSection({
  overview,
  className,
}: {
  overview: AnalyticsOverview;
  className?: string;
}) {
  return (
    <SectionCard
      title="Sales by category"
      icon={Layers}
      description="Item revenue by each product's current category"
      className={className}
    >
      {overview.salesByCategory.length === 0 ? (
        <EmptyNote><AutoText>Nothing was sold in this period.</AutoText></EmptyNote>
      ) : (
        <BarList
          label="Sales by category"
          tone="violet"
          items={overview.salesByCategory.map((category) => ({
            key: category.categoryId ?? 'uncategorised',
            label: category.categoryName,
            value: category.revenueMinor,
            display: formatMoney(category.revenueMinor),
            secondary: plural(category.unitsSold, 'unit'),
          }))}
        />
      )}
    </SectionCard>
  );
}

export function TopProductsSection({
  overview,
  className,
}: {
  overview: AnalyticsOverview;
  className?: string;
}) {
  return (
    <SectionCard
      title="Top products"
      icon={Trophy}
      description="Best sellers by units"
      className={className}
    >
      {overview.topProducts.length === 0 ? (
        <EmptyNote><AutoText>Nothing was sold in this period.</AutoText></EmptyNote>
      ) : (
        <BarList
          label="Top products by units sold"
          ranked
          items={overview.topProducts.map((product) => ({
            key: product.productId,
            label: product.productName,
            value: product.unitsSold,
            display: plural(product.unitsSold, 'unit'),
            secondary: formatMoney(product.revenueMinor),
            href: `/admin/products/${product.productId}` as Route,
          }))}
        />
      )}
    </SectionCard>
  );
}

export function TopCustomersSection({
  customers,
  className,
}: {
  customers: NonNullable<AnalyticsOverview['topCustomers']>;
  className?: string;
}) {
  return (
    <SectionCard
      title="Top customers"
      icon={Crown}
      description="By revenue in this period"
      flush
      className={className}
    >
      {customers.length === 0 ? (
        <div className="px-5 pb-5 sm:px-6">
          <EmptyNote><AutoText>No customer ordered in this period.</AutoText></EmptyNote>
        </div>
      ) : (
        <ol className="divide-y divide-border">
          {customers.map((customer, index) => (
            <li key={customer.customerId}>
              <Link
                href={`/admin/customers/${customer.customerId}` as Route}
                className="grid grid-cols-[1.75rem_minmax(0,1fr)_5rem_auto] items-center gap-3 px-5 py-3 transition-colors hover:bg-info-soft/40 sm:px-6"
              >
                <span className="grid size-7 place-items-center rounded-full bg-neutral-soft text-xs font-semibold text-neutral-ink tabular-nums">
                  {index + 1}
                </span>
                <span className="grid min-w-0">
                  <span className="truncate text-sm font-medium text-foreground">
                    {customer.name ?? customer.email ?? 'Customer'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    <CountText count={customer.orderCount} one="order" />
                  </span>
                </span>
                <Sparkline
                  values={customer.daily}
                  tone="primary"
                  label={`${customer.name ?? 'Customer'}'s daily spend`}
                />
                <span className="text-right text-sm font-semibold text-foreground tabular-nums">
                  {formatMoney(customer.revenueMinor)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// When orders come in, and the journey to them
// ---------------------------------------------------------------------------

export function HeatmapSection({
  overview,
  className,
}: {
  overview: AnalyticsOverview;
  className?: string;
}) {
  return (
    <SectionCard
      title="Busiest times"
      icon={CalendarClock}
      description="Orders placed by weekday and hour (Dhaka time)"
      className={className}
    >
      <Heatmap
        title="Orders by weekday and hour"
        cells={overview.heatmap.map((cell) => ({
          weekday: cell.weekday,
          hour: cell.hour,
          value: cell.orderCount,
        }))}
        formatValue={(value) => plural(value, 'order')}
        valueLabel="Orders"
        emptyMessage="No orders in this period yet."
      />
    </SectionCard>
  );
}

export function FunnelSection({
  overview,
  range,
  abandoned,
  className,
}: {
  overview: AnalyticsOverview;
  range: ReportRange;
  /** Abandoned-checkout figures for the same window, when the account may read them. */
  abandoned: AdminRead<CheckoutRecoveryMetrics> | null;
  className?: string;
}) {
  const { carts, checkouts, orders } = overview.funnel;
  const previous = overview.previousTotals;
  const metrics = abandoned?.kind === 'ok' ? abandoned.value : null;
  const trackingSince = metrics?.trackingSince ?? null;
  /*
   * Carts and checkout attempts have only been recorded since `trackingSince`. A range that
   * starts before that mixes orders from before tracking with carts from after it, so a
   * "conversion" would be optics, not arithmetic (20 orders from 8 carts reads as 250%).
   * In that case the counts are still shown, but no conversion is claimed.
   */
  const trackingDay = trackingSince ? trackingSince.slice(0, 10) : null;
  const partialCoverage = trackingDay !== null && range.from < trackingDay;

  // Every figure below is a count of records in the same window: carts created, checkout
  // sessions started, orders placed. They are not unique customers and not events, so the
  // three stages are comparable with each other — once the whole window is tracked.
  const stages = [
    { key: 'carts', label: 'Carts created', value: carts, hint: 'A cart with at least one line' },
    {
      key: 'checkouts',
      label: 'Checkouts started',
      value: checkouts,
      hint: 'The customer reached checkout',
    },
    { key: 'orders', label: 'Orders placed', value: orders, hint: 'The checkout became an order' },
  ];

  const overall = !partialCoverage && carts > 0 ? orders / carts : null;
  const dropOffs = [
    { from: 'cart', to: 'checkout', lost: carts - checkouts },
    { from: 'checkout', to: 'order', lost: checkouts - orders },
  ];
  const biggest = partialCoverage
    ? null
    : dropOffs.reduce<(typeof dropOffs)[number] | null>(
        (worst, step) => (step.lost > (worst?.lost ?? 0) ? step : worst),
        null,
      );

  return (
    <SectionCard
      title="Shopping journey"
      icon={Filter}
      description="Carts → checkouts → orders, counted over the reporting period. One unit throughout: records created in the period."
      className={className}
      actions={
        <Link
          href="/admin/checkouts"
          className="text-sm font-semibold text-link underline-offset-4 hover:underline"
        >
          <AutoText>Abandoned checkouts</AutoText>
        </Link>
      }
    >
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-hairline px-2.5 py-1 font-semibold text-foreground">
            <AutoText value={range.label} />
          </span>
          <span>
            <AutoText>Counted by the day the record was created</AutoText>
          </span>
          {partialCoverage ? (
            <span className="rounded-full bg-warning/10 px-2.5 py-1 font-semibold text-warning">
              <AutoText>Partial coverage</AutoText>
            </span>
          ) : null}
        </div>

        {partialCoverage && trackingSince ? (
          <p className="rounded-xl border border-warning/30 bg-warning/5 p-3 text-xs text-foreground">
            <AutoText>
              Carts and checkouts have only been recorded since
            </AutoText>{' '}
            <DateTimeText value={trackingSince} style="date" />.{' '}
            <AutoText>
              This range starts before that, so orders from the untracked days are counted but
              the carts they came from are not. Conversions are hidden until the whole period is
              tracked; the counts below are still exact.
            </AutoText>
          </p>
        ) : null}

        <dl className="grid gap-3 sm:grid-cols-3">
          <JourneyFigure
            label="Overall conversion"
            value={overall === null ? '—' : formatPercent(overall)}
            hint={
              partialCoverage
                ? 'Hidden while this range mixes untracked and tracked days'
                : 'Orders placed ÷ carts created'
            }
            emphasis
          />
          <JourneyFigure
            label="Biggest drop-off"
            value={
              biggest === null || biggest.lost <= 0
                ? '—'
                : `${formatCount(biggest.lost)} ${biggest.from} → ${biggest.to}`
            }
            hint={
              partialCoverage
                ? 'Hidden while this range mixes untracked and tracked days'
                : 'Where the most customers stopped'
            }
          />
          <JourneyFigure
            label="Abandoned checkouts"
            value={metrics === null ? '—' : formatCount(metrics.openCount)}
            hint={
              metrics === null
                ? 'Not available to this account'
                : `${formatMoney(metrics.potentialValueMinor)} waiting in carts`
            }
          />
        </dl>

        <Funnel
          title={`Shopping journey, ${range.label}`}
          formatValue={count}
          showDropOff={!partialCoverage}
          showConversion={!partialCoverage}
          emptyMessage="No carts, checkouts or orders in this period yet."
          stages={stages}
        />

        <div className="grid gap-2 border-t border-hairline pt-3 text-xs text-muted-foreground">
          {previous ? (
            <p>
              <AutoText>Orders placed in the period before</AutoText> (
              <AutoText value={range.comparisonLabel} />){' '}
              <span className="nz-figure font-semibold text-foreground">
                {formatCount(previous.orderCount)}
              </span>
              .{' '}
              {previous.orderCount === 0 ? (
                <AutoText>No orders were recorded there, so no change can be shown.</AutoText>
              ) : orders === previous.orderCount ? (
                <AutoText>No change in orders.</AutoText>
              ) : (
                <>
                  <span className="nz-figure font-semibold text-foreground">
                    {orders > previous.orderCount ? '+' : '−'}
                    {formatCount(Math.abs(orders - previous.orderCount))}
                  </span>{' '}
                  <AutoText>orders compared with that period.</AutoText>
                </>
              )}
            </p>
          ) : (
            <p>
              <AutoText>Previous-period comparison is off for this range.</AutoText>
            </p>
          )}
          <p>
            <AutoText>
              Product views are not tracked, so this journey starts at the cart. Carts and
              checkouts are compared with the previous period only where tracking existed then
            </AutoText>
            {trackingSince ? (
              <>
                {' '}
                <AutoText>— checkout tracking began</AutoText>{' '}
                <DateTimeText value={trackingSince} style="date" />.
              </>
            ) : (
              '.'
            )}
          </p>
        </div>
      </div>
    </SectionCard>
  );
}

/** One figure in the journey header: label, value, and what it means. */
function JourneyFigure({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-surface/70 p-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <AutoText>{label}</AutoText>
      </dt>
      <dd
        className={cn(
          'nz-figure mt-1 font-semibold text-foreground',
          emphasis ? 'text-2xl' : 'text-lg',
        )}
      >
        {value}
      </dd>
      <dd className="mt-0.5 text-xs text-muted-foreground">
        <AutoText>{hint}</AutoText>
      </dd>
    </div>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="grid min-h-40 place-items-center rounded-xl border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
