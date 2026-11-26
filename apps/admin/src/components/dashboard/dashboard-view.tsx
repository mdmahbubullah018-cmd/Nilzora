import type { AnalyticsOverview, DashboardResponse, Permission } from '@nilzora/contracts';
import { Card, cn } from '@nilzora/ui';
import {
  Banknote,
  ClipboardCheck,
  Clock,
  HandCoins,
  PackageX,
  Receipt,
  ShoppingBag,
  Truck,
  UserPlus,
} from 'lucide-react';
import { withQuery } from '@/components/admin-kit/href';
import { KpiCard, type KpiCardProps, type KpiChange } from '@/components/admin-kit/kpi-card';
import { ReadState } from '@/components/admin-kit/states';
import { RangeFilter } from '@/components/range/range-filter';
import { changeRatio, plural } from '@/lib/format';
import { translateText } from '@/lib/i18n/text';
import type { Language } from '@/lib/language';
import {
  CategorySalesSection,
  DeliveryZoneSection,
  FunnelSection,
  HeatmapSection,
  PaymentSplitSection,
  RatesSection,
  RevenueOrdersSection,
  StatusPerDaySection,
  StatusSplitSection,
  TopCustomersSection,
  TopProductsSection,
} from './dashboard-analytics';
import { CatalogueStrip, DashboardCommandBar } from './dashboard-command';
import { QuickActionsSection } from './quick-actions';
import {
  ActivitySection,
  FailedSection,
  LowStockSection,
  OrderPipelineSection,
  PendingReviewsSection,
  RecentOrdersSection,
  ReviewsSection,
} from './dashboard-sections';
import type { DashboardData } from './load-dashboard';
import { AutoText } from '@/components/i18n/translate';

export interface DashboardViewProps {
  data: DashboardData;
  /** The verified account's permissions; they decide which panels are asked for and shown. */
  permissions: readonly Permission[];
  /** The signed-in account's display name, for the greeting. */
  viewerName: string;
  /** The reader's language, for dates, counts and the comparison labels. */
  lang?: Language;
}

type Kpi = KpiCardProps & { key: string };

/** One line of real work waiting, from whichever sections this account could read. */
export function waitingLine(
  summary: DashboardResponse | undefined,
  lang: Language = 'en',
): string | null {
  if (!summary) return null;
  const parts: string[] = [];
  const orders = summary.orders;
  if (orders && orders.pending > 0) {
    parts.push(
      `${plural(orders.pending, 'order', undefined, lang)} ${translateText('to confirm', lang)}`,
    );
  }
  if (orders && orders.awaitingCollection > 0) {
    parts.push(
      `${plural(orders.awaitingCollection, 'order', undefined, lang)} ${translateText('delivered, cash not yet recorded', lang)}`,
    );
  }
  const stock = summary.stock;
  if (stock && stock.lowStockCount > 0) {
    parts.push(
      `${plural(stock.lowStockCount, 'product', undefined, lang)} ${translateText('low on stock', lang)}`,
    );
  }
  const moderation = summary.moderation;
  if (moderation && moderation.assignedToMe > 0) {
    parts.push(
      `${plural(moderation.assignedToMe, 'review', undefined, lang)} ${translateText('assigned to you', lang)}`,
    );
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * The six headline figures over the chosen range (finance.read): each with its change
 * against the previous period when there is one, and a sparkline of the days.
 */
export function analyticsKpis(
  overview: AnalyticsOverview,
  comparison: string,
  permissions: readonly Permission[],
  lang: Language = 'en',
): Kpi[] {
  const { totals, previousTotals: before, daily, snapshot } = overview;
  const change = (current: number, previous: number | undefined): KpiChange | undefined =>
    before && previous !== undefined
      ? { ratio: changeRatio(current, previous), comparison, increaseIs: 'good' }
      : undefined;
  const readsOrders = permissions.includes('orders.read');
  const readsProducts = permissions.includes('products.read');
  return [
    {
      key: 'revenue',
      label: 'Revenue',
      animate: { value: totals.revenueMinor, kind: 'money' },
      icon: Banknote,
      tone: 'primary',
      change: change(totals.revenueMinor, before?.revenueMinor),
      trend: daily.map((day) => day.revenueMinor),
      footnote: 'Orders not cancelled, delivery included',
    },
    {
      key: 'orders',
      label: 'Orders',
      animate: { value: totals.orderCount, kind: 'count' },
      icon: ShoppingBag,
      tone: 'violet',
      change: change(totals.orderCount, before?.orderCount),
      trend: daily.map((day) => day.orderCount),
      footnote:
        totals.cancelledCount > 0
          ? `${plural(totals.cancelledCount, 'cancellation', undefined, lang)} ${translateText('not counted', lang)}`
          : undefined,
      href: readsOrders ? '/admin/orders' : undefined,
    },
    {
      key: 'aov',
      label: 'Average order value',
      animate: { value: totals.averageOrderMinor, kind: 'money' },
      icon: Receipt,
      tone: 'moderator',
      change: change(totals.averageOrderMinor, before?.averageOrderMinor),
      trend: daily.map((day) =>
        day.orderCount > 0 ? Math.round(day.revenueMinor / day.orderCount) : 0,
      ),
    },
    {
      key: 'customers',
      label: 'New customers',
      animate: { value: totals.newCustomers, kind: 'count' },
      icon: UserPlus,
      tone: 'success',
      change: change(totals.newCustomers, before?.newCustomers),
      trend: daily.map((day) => day.newCustomers),
      footnote: 'Customer accounts created',
      href: permissions.includes('customers.read') ? '/admin/customers' : undefined,
    },
    {
      key: 'cod',
      label: 'Pending COD',
      animate: { value: snapshot.codPendingMinor, kind: 'money' },
      icon: HandCoins,
      tone: 'warning',
      footnote: `${plural(snapshot.codPendingCount, 'delivered order', undefined, lang)}, ${translateText('cash not yet recorded', lang)}`,
      href: readsOrders
        ? withQuery('/admin/orders', { status: 'delivered', paymentStatus: 'pending' })
        : undefined,
    },
    {
      key: 'stock',
      label: 'Low-stock items',
      animate: { value: snapshot.lowStockCount, kind: 'count' },
      icon: PackageX,
      tone: snapshot.outOfStockCount > 0 ? 'danger' : 'neutral',
      footnote:
        snapshot.outOfStockCount > 0
          ? `${plural(snapshot.outOfStockCount, 'product', undefined, lang)} ${translateText('sold out', lang)}`
          : 'Nothing sold out',
      href: readsProducts
        ? withQuery('/admin/products', { status: 'active', stock: 'low' })
        : undefined,
    },
  ];
}

/** Waiting work, for accounts that do not read finances: what each step holds right now. */
function workKpis(summary: DashboardResponse): Kpi[] {
  const kpis: Kpi[] = [];
  if (summary.orders) {
    kpis.push(
      {
        key: 'pending',
        label: 'To confirm',
        animate: { value: summary.orders.pending, kind: 'count' },
        icon: Clock,
        tone: summary.orders.pending > 0 ? 'warning' : 'neutral',
        footnote: 'New orders waiting',
        href: withQuery('/admin/orders', { status: 'pending' }),
      },
      {
        key: 'processing',
        label: 'Being prepared',
        animate: { value: summary.orders.confirmed + summary.orders.processing, kind: 'count' },
        icon: ClipboardCheck,
        tone: 'primary',
        footnote: 'Confirmed or processing',
        href: withQuery('/admin/orders', { status: 'processing' }),
      },
      {
        key: 'shipped',
        label: 'On the way',
        animate: { value: summary.orders.shipped, kind: 'count' },
        icon: Truck,
        tone: 'violet',
        footnote: 'Shipped, not yet delivered',
        href: withQuery('/admin/orders', { status: 'shipped' }),
      },
      {
        key: 'cash',
        label: 'Cash to record',
        animate: { value: summary.orders.awaitingCollection, kind: 'count' },
        icon: HandCoins,
        tone: summary.orders.awaitingCollection > 0 ? 'warning' : 'neutral',
        footnote: 'Delivered orders',
        href: withQuery('/admin/orders', { status: 'delivered', paymentStatus: 'pending' }),
      },
    );
  }
  if (summary.stock) {
    kpis.push({
      key: 'stock',
      label: 'Low-stock items',
      animate: { value: summary.stock.lowStockCount, kind: 'count' },
      icon: PackageX,
      tone: summary.stock.lowStockCount > 0 ? 'danger' : 'neutral',
      footnote: 'On sale, at or below the threshold',
      href: withQuery('/admin/products', { status: 'active', stock: 'low' }),
    });
  }
  return kpis;
}

function KpiGrid({ kpis }: { kpis: readonly Kpi[] }) {
  if (kpis.length === 0) return null;
  return (
    <section aria-label="Headline figures">
      <div className="nz-stagger grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-6">
        {kpis.map(({ key, ...kpi }) => (
          <KpiCard key={key} {...kpi} />
        ))}
      </div>
    </section>
  );
}

/**
 * The admin dashboard. Accounts that read finances get the range's analytics: six
 * headline figures, revenue and orders over time, status, cash, zones, targets, what
 * sells and who buys, when orders come in and the shopping journey. Everyone gets the
 * live work their permissions allow: recent orders, open orders, stock, reviews and
 * activity. Every panel comes from the API; none is shown with invented numbers.
 */
export function DashboardView({ data, permissions, viewerName, lang = 'en' }: DashboardViewProps) {
  const summary = data.summary.kind === 'ok' ? data.summary.value : undefined;
  const analytics = data.analytics;
  const finance = analytics !== null;
  const overview = analytics?.kind === 'ok' ? analytics.value : undefined;
  const range = data.range;

  return (
    <div className="grid gap-6">
      <h1 className="sr-only">
        <AutoText>Dashboard</AutoText>
      </h1>
      <DashboardCommandBar
        viewerName={viewerName}
        now={data.now}
        waiting={waitingLine(summary, lang)}
        lang={lang}
        aside={finance ? <RangeFilter path="/admin" range={range} /> : undefined}
      />

      {data.summary.kind !== 'ok' && data.summary.kind !== 'signed_out' ? (
        <Card className="nz-panel rounded-2xl">
          <ReadState failure={data.summary.kind} retryHref="/admin" compact />
        </Card>
      ) : null}

      {overview ? (
        <KpiGrid kpis={analyticsKpis(overview, range.comparisonLabel, permissions, lang)} />
      ) : summary ? (
        <KpiGrid kpis={workKpis(summary)} />
      ) : null}

      {/* An account without finance access starts from its own work, not from the store's money. */}
      {finance ? null : <QuickActionsSection permissions={permissions} summary={summary} />}

      {analytics && analytics.kind !== 'ok' && analytics.kind !== 'signed_out' ? (
        <FailedSection title="Analytics" failure={analytics.kind} permission="finance.read" />
      ) : null}

      {overview ? (
        <>
          <div className="grid gap-6 xl:grid-cols-3">
            <RevenueOrdersSection overview={overview} range={range} className="xl:col-span-2" />
            <StatusSplitSection overview={overview} />
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <StatusPerDaySection overview={overview} range={range} />
            <HeatmapSection overview={overview} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <PaymentSplitSection overview={overview} />
            <DeliveryZoneSection overview={overview} />
          </div>
          <FunnelSection overview={overview} range={range} abandoned={data.abandoned} />
          <RatesSection
            overview={overview}
            canSetTarget={permissions.includes('settings.manage')}
          />
          <div
            className={cn(
              'grid gap-6',
              overview.topCustomers ? 'xl:grid-cols-3' : 'xl:grid-cols-2',
            )}
          >
            <TopProductsSection overview={overview} />
            <CategorySalesSection overview={overview} />
            {overview.topCustomers ? (
              <TopCustomersSection customers={overview.topCustomers} />
            ) : null}
          </div>
        </>
      ) : null}

      <section aria-labelledby="live-work" className="grid gap-4">
        <h2
          id="live-work"
          className="font-display text-lg font-semibold tracking-tight text-foreground"
        >
          <AutoText>Live work</AutoText>
        </h2>
        <div className="grid gap-6 xl:grid-cols-3">
          {data.recentOrders ? (
            data.recentOrders.kind === 'ok' ? (
              <RecentOrdersSection
                orders={data.recentOrders.value}
                now={data.now}
                className="xl:col-span-2"
              />
            ) : data.recentOrders.kind === 'signed_out' ? null : (
              <FailedSection
                title="Recent orders"
                failure={data.recentOrders.kind}
                permission="orders.read"
                className="xl:col-span-2"
              />
            )
          ) : null}
          {summary?.orders ? (
            <OrderPipelineSection orders={summary.orders} asChart={!finance} />
          ) : null}
          {summary?.stock ? <LowStockSection stock={summary.stock} /> : null}
          {data.pendingReviews ? (
            data.pendingReviews.kind === 'ok' ? (
              <PendingReviewsSection reviews={data.pendingReviews.value} now={data.now} />
            ) : data.pendingReviews.kind === 'signed_out' ? null : (
              <FailedSection
                title="Customer reviews"
                failure={data.pendingReviews.kind}
                permission="reviews.moderate"
              />
            )
          ) : null}
          {summary?.moderation ? (
            <ReviewsSection reviews={summary.moderation} permissions={permissions} />
          ) : null}
          {data.activity ? (
            data.activity.kind === 'ok' ? (
              <ActivitySection entries={data.activity.value} now={data.now} />
            ) : data.activity.kind === 'signed_out' ? null : (
              <FailedSection
                title="Recent activity"
                failure={data.activity.kind}
                permission="audit_logs.read"
              />
            )
          ) : null}
        </div>
      </section>

      <CatalogueStrip catalogue={data.catalogue} />
    </div>
  );
}
