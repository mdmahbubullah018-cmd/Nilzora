import type { AnalyticsOverview, Permission } from '@nilzora/contracts';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nilzora/ui';
import { ChartNoAxesCombined, TableProperties } from 'lucide-react';
import { DataTable } from '@/components/admin-kit/data-table';
import { KpiCard } from '@/components/admin-kit/kpi-card';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { SectionCard } from '@/components/admin-kit/section-card';
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
} from '@/components/dashboard/dashboard-analytics';
import { analyticsKpis } from '@/components/dashboard/dashboard-view';
import { RangeFilter } from '@/components/range/range-filter';
import { BUCKET_NOUN, bucketOverview, bucketSizeFor } from '@/lib/analytics';
import type { ReportRange } from '@/lib/date-range';
import { formatCount, formatMoney } from '@/lib/format';
import { AutoText } from '@/components/i18n/translate';

export const ANALYTICS_PATH = '/admin/analytics' as const;

/** Every figure of the range, bucket by bucket: the data behind the charts as a table. */
function BreakdownSection({
  overview,
  range,
}: {
  overview: AnalyticsOverview;
  range: ReportRange;
}) {
  const size = bucketSizeFor(range.days);
  const buckets = bucketOverview(overview, size);
  const compared = overview.previousRange !== null;
  return (
    <SectionCard
      title={`${BUCKET_NOUN[size]} by ${BUCKET_NOUN[size].toLowerCase()}`}
      icon={TableProperties}
      description="The figures behind the charts, newest first"
      flush
    >
      <div className="nz-scroll max-h-128 overflow-y-auto">
        <DataTable
          caption={`Revenue and orders by ${BUCKET_NOUN[size].toLowerCase()}`}
          className="nz-sticky-head"
        >
          <TableHeader>
            <TableRow>
              <TableHead>{BUCKET_NOUN[size]}</TableHead>
              <TableHead className="text-right">
                <AutoText>Revenue</AutoText>
              </TableHead>
              <TableHead className="text-right">
                <AutoText>Orders</AutoText>
              </TableHead>
              <TableHead className="text-right">
                <AutoText>Average order</AutoText>
              </TableHead>
              <TableHead className="text-right">
                <AutoText>New customers</AutoText>
              </TableHead>
              {compared ? (
                <TableHead className="text-right">
                  <AutoText>Previous revenue</AutoText>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...buckets].reverse().map((bucket) => (
              <TableRow key={bucket.key}>
                <TableCell className="font-medium text-foreground">
                  <AutoText value={bucket.detail} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <AutoText value={formatMoney(bucket.revenueMinor)} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <AutoText value={formatCount(bucket.orderCount)} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {bucket.orderCount > 0
                    ? formatMoney(Math.round(bucket.revenueMinor / bucket.orderCount))
                    : '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <AutoText value={formatCount(bucket.newCustomers)} />
                </TableCell>
                {compared ? (
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {bucket.previousRevenueMinor === null
                      ? '—'
                      : formatMoney(bucket.previousRevenueMinor)}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </DataTable>
      </div>
    </SectionCard>
  );
}

export interface AnalyticsViewProps {
  overview: AnalyticsOverview;
  range: ReportRange;
  permissions: readonly Permission[];
}

/**
 * Sales analytics over any range up to a year: the headline figures, revenue and orders
 * over time, status, cash, zones, targets and rates, what sells and who buys, when orders
 * come in, the shopping journey, and the figures as a table. All from one API read.
 */
export function AnalyticsView({ overview, range, permissions }: AnalyticsViewProps) {
  return (
    <div className="grid gap-6">
      <PageToolbar
        icon={ChartNoAxesCombined}
        title="Analytics"
        description={`${range.label}${range.compare ? `, compared ${range.comparisonLabel.replace(/^vs /, 'with ')}` : ''}. Revenue counts orders that were not cancelled.`}
        actions={<RangeFilter path={ANALYTICS_PATH} range={range} />}
      />
      <section aria-label="Headline figures">
        <div className="nz-stagger grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-6">
          {analyticsKpis(overview, range.comparisonLabel, permissions).map(({ key, ...kpi }) => (
            <KpiCard key={key} {...kpi} />
          ))}
        </div>
      </section>
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
      <FunnelSection overview={overview} range={range} abandoned={null} />
      <RatesSection overview={overview} canSetTarget={permissions.includes('settings.manage')} />
      <div className="grid gap-6 xl:grid-cols-2">
        <TopProductsSection overview={overview} />
        <CategorySalesSection overview={overview} />
      </div>
      {overview.topCustomers ? <TopCustomersSection customers={overview.topCustomers} /> : null}
      <BreakdownSection overview={overview} range={range} />
    </div>
  );
}
