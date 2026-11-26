'use client';

import type { OrderGeography, OrderGeographyMetric } from '@nilzora/contracts';
import {
  Banknote,
  ChartPie,
  CircleCheck,
  CircleGauge,
  Layers,
  MapPin,
  PackageCheck,
  Receipt,
  Trophy,
  TrendingUp,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nilzora/ui';
import { BarList } from '@/components/admin-kit/charts/bar-list';
import { ComboChart } from '@/components/admin-kit/charts/combo-chart';
import { DonutChart } from '@/components/admin-kit/charts/donut-chart';
import { DataTable } from '@/components/admin-kit/data-table';
import { KpiCard } from '@/components/admin-kit/kpi-card';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { SectionCard } from '@/components/admin-kit/section-card';
import { ORDER_STATUS_CHART_TONE } from '@/components/admin-kit/status-badge';
import { formatCompactMoney, formatCount, formatMoney, formatPercent, plural } from '@/lib/format';
import {
  emptyReason,
  geographyHref,
  mapFill,
  METRIC_NOUN,
  METRIC_OPTIONS,
  metricValue,
  rankDistricts,
  rangeLabel,
  shareText,
  STATUS_LABEL,
  type GeographySelection,
  type MapFocus,
} from '@/lib/order-geography';
import { BangladeshMap } from './bangladesh-map';
import { GeographyFilters } from './geography-filters';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';
import { CountText } from '@/components/i18n/format-text';

/*
 * Bangladesh Order Analytics: one aggregate in, every surface out.
 *
 * The data is read once on the server and handed over whole, so the cards, the
 * choropleth's shading, the rankings and all five charts come from the same numbers and
 * cannot disagree. What the admin clicks on the map is *view* state, held here: selecting
 * a district needs no request at all, which is what makes hover and click feel immediate.
 * The filters — which do change the data — stay in the URL.
 */

export interface GeographyViewProps {
  geography: OrderGeography;
  selection: GeographySelection;
  today: string;
}

/** The swatches the map's shading uses, named so the legend can explain every step. */
const LEGEND_LABELS = ['No orders', 'Very low', 'Low', 'Medium', 'High', 'Highest'];

export function GeographyView({ geography, selection, today }: GeographyViewProps) {
  const tx = useTx();
  const { summary, filters } = geography;
  const metric = filters.metric;
  const noun = METRIC_NOUN[metric];
  const label = rangeLabel(selection.range, today);
  const [focus, setFocus] = useState<MapFocus>(selection.focus);

  const focusedDistrict =
    focus?.kind === 'district'
      ? (geography.districts.find((row) => row.district === focus.name) ?? null)
      : null;
  const focusedDivision =
    focus?.kind === 'division'
      ? (geography.divisions.find((row) => row.division === focus.name) ?? null)
      : null;
  const max = geography.districts.reduce((top, row) => Math.max(top, metricValue(row, metric)), 0);
  const ranked = rankDistricts(geography.districts, metric, focusedDivision?.division ?? null);
  const topDistricts = ranked.slice(0, 10);
  const trend = geography.timeline.map((day) => day.orderCount);
  const cleared = summary.totalOrders === 0 || summary.eligibleOrders === 0;

  return (
    <div className="grid gap-5">
      <PageToolbar
        icon={MapPin}
        title={tx("Bangladesh Order Analytics")}
        description={tx("Explore customer orders across Bangladesh by division and district.")}
        meta={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span><AutoText value={label} /></span>
            <span aria-hidden="true">·</span>
            <span>Updated {updatedLabel(geography.generatedAt)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {formatCount(summary.mappedOrders)} <CountText count={summary.mappedOrders} one="order" /> mapped
            </span>
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={geographyHref(selection)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-surface px-3 text-xs font-semibold text-foreground ring-1 ring-hairline hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-action"
            >
              <TrendingUp className="size-3.5" aria-hidden="true" /><AutoText>Refresh</AutoText></Link>
            <Link
              href="/admin/analytics"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-surface px-3 text-xs font-semibold text-foreground ring-1 ring-hairline hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-action"
            >
              <Receipt className="size-3.5" aria-hidden="true" /><AutoText>Sales analytics</AutoText></Link>
          </div>
        }
      />

      <GeographyFilters selection={selection} geography={geography} today={today} />

      <section aria-label={tx("Headline figures")}>
        <div className="nz-stagger grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-5">
          <KpiCard
            label={tx("Orders")}
            animate={{ value: summary.eligibleOrders, kind: 'count' }}
            icon={Receipt}
            tone="primary"
            trend={trend}
            footnote={`${formatCount(summary.cancelledOrders)} cancelled excluded`}
          />
          <KpiCard
            label={tx("Delivered")}
            animate={{ value: summary.deliveredOrders, kind: 'count' }}
            icon={PackageCheck}
            tone="success"
            trend={geography.timeline.map((day) => day.deliveredCount)}
            footnote={`${formatCount(summary.pendingOrders)} still pending`}
          />
          <KpiCard
            label={tx("Revenue")}
            animate={{ value: summary.revenueMinor, kind: 'money' }}
            icon={Banknote}
            tone="violet"
            footnote="COD totals, delivery included"
          />
          <KpiCard
            label={tx("Average order")}
            animate={{ value: summary.averageOrderMinor, kind: 'money' }}
            icon={CircleGauge}
            tone="warning"
            footnote="Revenue ÷ orders"
          />
          <KpiCard
            label={tx("Delivery success")}
            value={summary.deliveredRate === null ? '—' : formatPercent(summary.deliveredRate)}
            icon={CircleCheck}
            tone={
              summary.deliveredRate === null
                ? 'neutral'
                : summary.deliveredRate >= 0.9
                  ? 'success'
                  : 'warning'
            }
            footnote={summary.deliveredRate === null ? 'No orders to rate' : 'Delivered ÷ orders'}
          />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <SectionCard
          title={tx("Where the orders come from")}
          description={`Shaded by ${noun}. Click a district to inspect it, or a division to narrow the ranking.`}
          icon={MapPin}
          actions={
            <div role="group" aria-label={tx("Shade the map by")} className="flex gap-1">
              {METRIC_OPTIONS.map((option) => (
                <Link
                  key={option.metric}
                  href={geographyHref(selection, { metric: option.metric })}
                  aria-current={metric === option.metric ? 'true' : undefined}
                  className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${
                    metric === option.metric
                      ? 'bg-primary-action text-white'
                      : 'bg-surface-muted text-foreground hover:bg-info-soft'
                  }`}
                >
                  {option.label}
                </Link>
              ))}
            </div>
          }
        >
          <BangladeshMap
            districts={geography.districts}
            metric={metric}
            selectedDistrict={focusedDistrict?.district ?? null}
            selectedDivision={focusedDivision?.division ?? filters.division}
            onSelect={(name) => {
              setFocus({ kind: 'district', name });
            }}
            rangeLabel={label}
          />
          <MapLegend metric={metric} max={max} />
          <p className="mt-2 text-xs text-muted-foreground">
            {cleared
              ? emptyReason(geography)
              : `${plural(ranked.length, 'district')} with ${noun} in this view.`}
          </p>
        </SectionCard>

        <div className="grid content-start gap-5">
          <DivisionRanking
            geography={geography}
            metric={metric}
            focusedDivision={focusedDivision?.division ?? null}
            onSelect={(name) => {
              setFocus((current) =>
                current?.kind === 'division' && current.name === name
                  ? null
                  : { kind: 'division', name },
              );
            }}
          />
          <InsightPanel
            focusedDistrict={focusedDistrict}
            focusedDivision={focusedDivision}
            label={label}
            onClear={() => {
              setFocus(null);
            }}
          />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard
          title={tx("Top districts")}
          description={`The ten busiest by ${noun}. Select one on the map to inspect it.`}
          icon={Trophy}
        >
          {topDistricts.length === 0 ? (
            <Empty text={emptyReason(geography)} />
          ) : (
            <BarList
              label={`Top districts by ${noun}`}
              ranked
              items={topDistricts.map((row) => ({
                key: row.district,
                label: row.district,
                value: metricValue(row, metric),
                display:
                  metric === 'revenue'
                    ? formatCompactMoney(row.revenueMinor)
                    : formatCount(metricValue(row, metric)),
                secondary: `${row.division} · ${shareText(row.share)}`,
              }))}
            />
          )}
        </SectionCard>

        <SectionCard
          title={tx("Orders over time")}
          description={tx("Orders placed each day in the range, with the ones that were delivered.")}
          icon={TrendingUp}
        >
          <ComboChart
            data={geography.timeline.map((day) => ({
              label: day.day,
              detail: day.day,
              area: day.orderCount,
              line: day.deliveredCount,
            }))}
            title={`Orders and delivered orders per day, ${label}`}
            summary={`${formatCount(summary.eligibleOrders)} orders and ${formatCount(summary.deliveredOrders)} delivered in ${label}.`}
            areaSeries={{ label: 'Orders', tone: 'primary' }}
            lineSeries={{ label: 'Delivered', tone: 'success' }}
            formatArea={formatCount}
            formatLine={formatCount}
            integerLine
            bandLabel="Day"
          />
        </SectionCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <SectionCard
          title={tx("Revenue by division")}
          description={tx("Where the money comes from.")}
          icon={Banknote}
        >
          <BarList
            label={tx("Revenue by division")}
            items={[...geography.divisions]
              .sort((a, b) => b.revenueMinor - a.revenueMinor)
              .map((row) => ({
                key: row.division,
                label: row.division,
                value: row.revenueMinor,
                display: formatCompactMoney(row.revenueMinor),
                secondary: `${formatCount(row.orderCount)} ${plural(row.orderCount, 'order')}`,
              }))}
          />
        </SectionCard>

        <SectionCard
          title={tx("Orders by division")}
          description={tx("Demand across the eight divisions.")}
          icon={Layers}
        >
          <BarList
            label={tx("Orders by division")}
            items={[...geography.divisions]
              .sort((a, b) => b.orderCount - a.orderCount)
              .map((row) => ({
                key: row.division,
                label: row.division,
                value: row.orderCount,
                display: formatCount(row.orderCount),
                secondary: shareText(row.share),
              }))}
          />
        </SectionCard>

        <SectionCard
          title={tx("Order status")}
          description={tx("Every order placed in the range.")}
          icon={ChartPie}
        >
          {geography.statusBreakdown.length === 0 ? (
            <Empty text={tx("No orders in this range.")} />
          ) : (
            <DonutChart
              segments={geography.statusBreakdown.map((entry) => ({
                key: entry.status,
                label: STATUS_LABEL[entry.status],
                value: entry.count,
                tone: ORDER_STATUS_CHART_TONE[entry.status],
              }))}
              title={tx("Orders by status")}
              centerValue={formatCount(summary.totalOrders)}
              centerLabel="orders placed"
              formatValue={formatCount}
            />
          )}
        </SectionCard>
      </div>

      <DistrictTable
        geography={geography}
        metric={metric}
        focused={focusedDistrict?.district ?? null}
        onSelect={(name) => {
          setFocus({ kind: 'district', name });
        }}
      />

      <UnmappedNote geography={geography} />
    </div>
  );
}

function updatedLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'just now';
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Dhaka',
  });
}

function MapLegend({ metric, max }: { metric: OrderGeographyMetric; max: number }) {
  const noun = METRIC_NOUN[metric];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5" aria-hidden="true">
      {LEGEND_LABELS.map((legend, level) => (
        <span
          key={legend}
          className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
        >
          <span
            className="size-3 rounded-sm ring-1 ring-hairline"
            style={{
              background: mapFill(level).fill,
              opacity: level === 0 ? 0.4 : 0.35 + level * 0.13,
            }}
          />
          {legend}
        </span>
      ))}
      <span className="text-[11px] text-muted-foreground">
        {max === 0 ? `no ${noun} in this view` : `top district: ${formatCount(max)}`}
      </span>
    </div>
  );
}

function DivisionRanking({
  geography,
  metric,
  focusedDivision,
  onSelect,
}: {
  geography: OrderGeography;
  metric: OrderGeographyMetric;
  focusedDivision: string | null;
  onSelect: (division: string) => void;
}) {
  const tx = useTx();
  const rows = [...geography.divisions].sort(
    (a, b) =>
      metricValue(b, metric) - metricValue(a, metric) || a.division.localeCompare(b.division),
  );
  const max = rows.reduce((top, row) => Math.max(top, metricValue(row, metric)), 0);
  return (
    <SectionCard title={tx("Divisions")} description={tx("Select one to narrow the ranking.")} icon={Layers}>
      <ul role="list" className="grid gap-1">
        {rows.map((row) => {
          const value = metricValue(row, metric);
          const selected = focusedDivision === row.division;
          return (
            <li key={row.division}>
              <button
                type="button"
                onClick={() => {
                  onSelect(row.division);
                }}
                aria-pressed={selected}
                className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-action ${
                  selected ? 'bg-info-soft ring-1 ring-primary-action' : 'hover:bg-surface-muted'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium text-foreground"><AutoText value={row.division} /></span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                    <span
                      className="block h-full rounded-full bg-chart-1"
                      style={{ width: max === 0 ? '0%' : `${String((value / max) * 100)}%` }}
                    />
                  </span>
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {metric === 'revenue' ? formatCompactMoney(row.revenueMinor) : formatCount(value)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

function InsightPanel({
  focusedDistrict,
  focusedDivision,
  label,
  onClear,
}: {
  focusedDistrict: OrderGeography['districts'][number] | null;
  focusedDivision: OrderGeography['divisions'][number] | null;
  label: string;
  onClear: () => void;
}) {
  const tx = useTx();
  if (focusedDistrict !== null) {
    return (
      <SectionCard
        title={focusedDistrict.district}
        description={`${focusedDistrict.division} division · ${label}`}
        icon={MapPin}
        actions={<ClearButton onClick={onClear} />}
      >
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <Fact label={tx("Orders")} value={formatCount(focusedDistrict.orderCount)} />
          <Fact label={tx("Delivered")} value={formatCount(focusedDistrict.deliveredCount)} />
          <Fact label={tx("Revenue")} value={formatMoney(focusedDistrict.revenueMinor)} />
          <Fact
            label={tx("Average order")}
            value={
              focusedDistrict.orderCount === 0
                ? '—'
                : formatMoney(
                    Math.round(focusedDistrict.revenueMinor / focusedDistrict.orderCount),
                  )
            }
          />
          <Fact label={tx("Share of orders")} value={shareText(focusedDistrict.share)} />
          <Fact
            label={tx("Delivery rate")}
            value={
              focusedDistrict.orderCount === 0
                ? '—'
                : formatPercent(focusedDistrict.deliveredCount / focusedDistrict.orderCount)
            }
          />
        </dl>
        <p className="mt-3 text-[11px] text-muted-foreground"><AutoText>Every figure comes from the same aggregate as the map and the cards.</AutoText></p>
      </SectionCard>
    );
  }

  if (focusedDivision !== null) {
    return (
      <SectionCard
        title={focusedDivision.division}
        description={`Division · ${label}`}
        icon={Layers}
        actions={<ClearButton onClick={onClear} />}
      >
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <Fact label={tx("Orders")} value={formatCount(focusedDivision.orderCount)} />
          <Fact label={tx("Delivered")} value={formatCount(focusedDivision.deliveredCount)} />
          <Fact label={tx("Revenue")} value={formatMoney(focusedDivision.revenueMinor)} />
          <Fact label={tx("Share of orders")} value={shareText(focusedDivision.share)} />
        </dl>
        <p className="mt-3 text-[11px] text-muted-foreground">
          The ranking beside the map lists this division&apos;s districts. Pick one on the map
          to inspect it.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={tx("Nothing selected")} description={tx("Click a district on the map.")} icon={MapPin}>
      <p className="text-xs text-muted-foreground">
        A district opens its orders, delivered orders, revenue, average order and share of the
        current filter. Nothing is re-read: the map already holds all sixty-four districts.
      </p>
    </SectionCard>
  );
}

function ClearButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-medium text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-action"
    >
      <X className="size-3" aria-hidden="true" /><AutoText>Clear</AutoText></button>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-muted-foreground"><AutoText value={label} /></dt>
      <dd className="font-semibold tabular-nums text-foreground"><AutoText value={value} /></dd>
    </div>
  );
}

function DistrictTable({
  geography,
  metric,
  focused,
  onSelect,
}: {
  geography: OrderGeography;
  metric: OrderGeographyMetric;
  focused: string | null;
  onSelect: (district: string) => void;
}) {
  const tx = useTx();
  const rows = rankDistricts(geography.districts, metric);
  return (
    <SectionCard
      title={tx("Districts")}
      description={`All ${String(geography.districts.length)} districts from the reference table, busiest first — the map's accessible alternative.`}
      icon={Layers}
      flush
    >
      {rows.length === 0 ? (
        <div className="p-4">
          <Empty text={emptyReason(geography)} />
        </div>
      ) : (
        <div className="nz-scroll max-h-96 overflow-auto">
          <DataTable caption="Orders, delivered orders and revenue by district">
            <TableHeader className="nz-sticky-head">
              <TableRow>
                <TableHead><AutoText>District</AutoText></TableHead>
                <TableHead><AutoText>Division</AutoText></TableHead>
                <TableHead className="text-right"><AutoText>Orders</AutoText></TableHead>
                <TableHead className="text-right"><AutoText>Delivered</AutoText></TableHead>
                <TableHead className="text-right"><AutoText>Revenue</AutoText></TableHead>
                <TableHead className="text-right"><AutoText>Share</AutoText></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const selected = focused === row.district;
                return (
                  <TableRow key={row.district} data-selected={selected ? 'true' : undefined}>
                    <TableCell className="font-medium text-foreground">
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(row.district);
                        }}
                        aria-pressed={selected}
                        className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-action"
                      >
                        {row.district}
                      </button>
                    </TableCell>
                    <TableCell className="text-muted-foreground"><AutoText value={row.division} /></TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCount(row.orderCount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCount(row.deliveredCount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.revenueMinor)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {shareText(row.share)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </DataTable>
        </div>
      )}
      <p className="border-t border-hairline px-4 py-2 text-[11px] text-muted-foreground">
        The map&apos;s outline data is from geoBoundaries (CC BY 3.0 IGO) - Bangladesh Bureau of
        Statistics and OCHA ROAP.
      </p>
    </SectionCard>
  );
}

function UnmappedNote({ geography }: { geography: OrderGeography }) {
  const tx = useTx();
  const { unmapped, summary } = geography;
  const reconciled = summary.mappedOrders + summary.unmappedOrders === summary.eligibleOrders;
  return (
    <SectionCard
      title={tx("Orders the map cannot place")}
      description={tx("Kept in every total, never guessed into a district.")}
      icon={MapPin}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Fact label={tx("Mapped orders")} value={formatCount(summary.mappedOrders)} />
        <Fact label={tx("Unmapped orders")} value={formatCount(unmapped.orderCount)} />
        <Fact label={tx("Unmapped revenue")} value={formatMoney(unmapped.revenueMinor)} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {reconciled
          ? `${formatCount(summary.mappedOrders)} mapped + ${formatCount(unmapped.orderCount)} unmapped = ${formatCount(summary.eligibleOrders)} orders.`
          : 'The reconciliation does not balance — this is a defect, please report it.'}
      </p>
      {unmapped.orderCount > 0 ? (
        <div className="mt-3">
          <p className="mb-1 text-[11px] font-semibold text-muted-foreground"><AutoText>Delivery districts that are not in the reference table</AutoText></p>
          <ul role="list" className="grid gap-1 text-xs">
            {unmapped.values.map((value) => (
              <li
                key={`${value.district}-${value.division}`}
                className="flex items-center justify-between gap-2 rounded-lg bg-surface-muted/60 px-2 py-1"
              >
                <span className="min-w-0 truncate">
                  <span className="font-medium text-foreground">
                    {value.district === '' ? '(no district)' : value.district}
                  </span>
                  <span className="text-muted-foreground"> · {value.division}</span>
                </span>
                <span className="tabular-nums text-muted-foreground">
                  <CountText count={value.orderCount} one="order" />
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">
            These come from the delivery snapshot stored with each order; a new order takes its
            district from the address chosen at checkout.
          </p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground"><AutoText>Every order in this view names a district the map knows.</AutoText></p>
      )}
    </SectionCard>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-xl bg-surface-muted/60 px-3 py-6 text-center text-xs text-muted-foreground">
      {text}
    </p>
  );
}
