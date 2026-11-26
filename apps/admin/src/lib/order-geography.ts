import {
  ANALYTICS_MAX_DAYS,
  ORDER_STATUSES,
  type OrderGeography,
  type OrderGeographyDistrict,
  type OrderGeographyMetric,
  type OrderStatus,
} from '@nilzora/contracts';
import type { Route } from 'next';
import {
  dhakaToday,
  formatRange,
  isCalendarDay,
  shiftDay,
  spanDays,
  type ReportRange,
} from '@/lib/date-range';

/*
 * Search-parameter and presentation helpers for the Bangladesh Order Analytics page.
 *
 * Two different kinds of state live in the URL, deliberately kept apart:
 *   - `range`, `division`, `district`, `status`, `metric` narrow the aggregate the API
 *     returns, so every card, chart and shading describes the same orders;
 *   - `focus` names what the admin clicked on the map. It is view state only — the whole
 *     aggregate stays in the payload, so the map keeps its colours and the insight panel
 *     can describe a district without re-reading anything.
 */

export const GEOGRAPHY_PATH = '/admin/order-geography' as const;

export type GeographyPreset = 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'custom';

export const GEOGRAPHY_PRESETS: readonly { preset: GeographyPreset; label: string }[] = [
  { preset: 'today', label: 'Today' },
  { preset: 'yesterday', label: 'Yesterday' },
  { preset: '7d', label: '7 days' },
  { preset: '30d', label: '30 days' },
  { preset: '90d', label: '90 days' },
  { preset: 'custom', label: 'Custom' },
];

/** `focus` is either a district or a division; the prefix keeps the two unambiguous. */
export type MapFocus =
  | { kind: 'district'; name: string }
  | { kind: 'division'; name: string }
  | null;

export interface GeographySelection {
  range: ReportRange;
  division: string | null;
  district: string | null;
  status: OrderStatus | null;
  metric: OrderGeographyMetric;
  focus: MapFocus;
}

export type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function dayOrNull(value: string | undefined): string | null {
  return value !== undefined && isCalendarDay(value) ? value : null;
}

const METRIC_VALUES: readonly OrderGeographyMetric[] = ['orders', 'revenue', 'delivered'];

function metricOr(value: string | undefined): OrderGeographyMetric {
  return METRIC_VALUES.find((metric) => metric === value) ?? 'orders';
}

function statusOr(value: string | undefined): OrderStatus | null {
  return ORDER_STATUSES.find((status) => status === value) ?? null;
}

/** Reads the page's range the same way the rest of the admin does, plus the two extras. */
export function parseGeographyRange(params: SearchParams, now: Date = new Date()): ReportRange {
  const today = dhakaToday(now);
  const requested = single(params.range);
  const compare = single(params.compare) !== '0';
  const days = single(params.days);

  if (requested === 'yesterday') {
    const day = shiftDay(today, -1);
    return finish('custom', day, day, 'Yesterday', compare);
  }
  if (requested === '90d' || days === '90') {
    return finish('custom', shiftDay(today, -89), today, 'Last 90 days', compare);
  }
  if (requested === 'today') {
    return finish('today', today, today, 'Today', compare);
  }
  if (requested === '7d') {
    return finish('7d', shiftDay(today, -6), today, 'Last 7 days', compare);
  }
  if (requested === 'custom') {
    const from = dayOrNull(single(params.from));
    const to = dayOrNull(single(params.to));
    if (from !== null && to !== null && from <= to && spanDays(from, to) <= ANALYTICS_MAX_DAYS) {
      return finish('custom', from, to, formatRange(from, to), compare);
    }
  }
  return finish('30d', shiftDay(today, -29), today, 'Last 30 days', compare);
}

function finish(
  preset: ReportRange['preset'],
  from: string,
  to: string,
  label: string,
  compare: boolean,
): ReportRange {
  const days = spanDays(from, to);
  return {
    preset,
    from,
    to,
    days,
    compare,
    label,
    comparisonLabel: `vs previous ${String(days)} days`,
  };
}

/** The whole page state, as the URL describes it. */
export function parseGeographySelection(params: SearchParams, now: Date = new Date()): GeographySelection {
  const focusRaw = single(params.focus);
  const focus: MapFocus =
    focusRaw === undefined
      ? null
      : focusRaw.startsWith('v:')
        ? { kind: 'division', name: focusRaw.slice(2) }
        : focusRaw.startsWith('d:')
          ? { kind: 'district', name: focusRaw.slice(2) }
          : { kind: 'district', name: focusRaw };

  return {
    range: parseGeographyRange(params, now),
    division: single(params.division) ?? null,
    district: single(params.district) ?? null,
    status: statusOr(single(params.status)),
    metric: metricOr(single(params.metric)),
    focus,
  };
}

/** The search parameters that reproduce this state, minus what a patch replaces. */
export function geographyParams(
  selection: GeographySelection,
  patch: Partial<{
    range: ReportRange;
    division: string | null;
    district: string | null;
    status: OrderStatus | null;
    metric: OrderGeographyMetric;
    focus: MapFocus;
  }> = {},
): Record<string, string> {
  const range = patch.range ?? selection.range;
  const division = patch.division === undefined ? selection.division : patch.division;
  const district = patch.district === undefined ? selection.district : patch.district;
  const status = patch.status === undefined ? selection.status : patch.status;
  const metric = patch.metric ?? selection.metric;
  const focus = patch.focus === undefined ? selection.focus : patch.focus;

  const params: Record<string, string> = { range: range.preset, metric };
  if (range.preset === 'custom' || range.preset === 'today') {
    params.from = range.from;
    params.to = range.to;
  }
  if (division !== null) params.division = division;
  if (district !== null) params.district = district;
  if (status !== null) params.status = status;
  if (focus !== null) params.focus = `${focus.kind === 'division' ? 'v' : 'd'}:${focus.name}`;
  return params;
}

/** A link to this page with the range preserved and one thing changed. */
export function geographyHref(
  selection: GeographySelection,
  patch: Parameters<typeof geographyParams>[1] = {},
): Route {
  const query = new URLSearchParams(geographyParams(selection, patch));
  return `${GEOGRAPHY_PATH}?${query.toString()}` as Route;
}

/** A preset link: keeps the filters, changes only the range. */
export function presetHref(
  selection: GeographySelection,
  preset: GeographyPreset,
  today: string,
): Route {
  if (preset === 'custom') {
    return geographyHref(selection, {
      range: { ...selection.range, preset: 'custom' },
    });
  }
  const range =
    preset === 'yesterday'
      ? finish('custom', shiftDay(today, -1), shiftDay(today, -1), 'Yesterday', selection.range.compare)
      : preset === '90d'
        ? finish('custom', shiftDay(today, -89), today, 'Last 90 days', selection.range.compare)
        : preset === 'today'
          ? finish('today', today, today, 'Today', selection.range.compare)
          : preset === '7d'
            ? finish('7d', shiftDay(today, -6), today, 'Last 7 days', selection.range.compare)
            : finish('30d', shiftDay(today, -29), today, 'Last 30 days', selection.range.compare);
  return geographyHref(selection, { range });
}

/** Which preset a current range reads as, for the pressed state of the buttons. */
export function activePreset(range: ReportRange, today: string): GeographyPreset {
  if (range.from === today && range.to === today) return 'today';
  if (range.from === shiftDay(today, -1) && range.to === shiftDay(today, -1)) return 'yesterday';
  if (range.from === shiftDay(today, -6) && range.to === today) return '7d';
  if (range.from === shiftDay(today, -29) && range.to === today) return '30d';
  if (range.from === shiftDay(today, -89) && range.to === today) return '90d';
  return 'custom';
}

/** How each preset reads in a sentence (the buttons use the shorter GEOGRAPHY_PRESETS labels). */
const PRESET_SENTENCE: Record<GeographyPreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  custom: 'the chosen dates',
};

/** The range's name, with the presets that read better than a pair of dates. */
export function rangeLabel(range: ReportRange, today: string): string {
  const preset = activePreset(range, today);
  return preset === 'custom' ? range.label : PRESET_SENTENCE[preset];
}

export const METRIC_OPTIONS: readonly {
  metric: OrderGeographyMetric;
  label: string;
  short: string;
  money: boolean;
}[] = [
  { metric: 'orders', label: 'Orders', short: 'orders', money: false },
  { metric: 'revenue', label: 'Revenue', short: 'revenue', money: true },
  { metric: 'delivered', label: 'Delivered orders', short: 'delivered', money: false },
];

export const METRIC_NOUN: Record<OrderGeographyMetric, string> = {
  orders: 'orders',
  revenue: 'revenue',
  delivered: 'delivered orders',
};

/** The figure a district or division is shaded and ranked by. */
export function metricValue(
  row: { orderCount: number; deliveredCount: number; revenueMinor: number },
  metric: OrderGeographyMetric,
): number {
  if (metric === 'revenue') return row.revenueMinor;
  if (metric === 'delivered') return row.deliveredCount;
  return row.orderCount;
}

/** Five shaded steps above "no orders", so the legend can name every one. */
export const INTENSITY_LEVELS = 5;

/**
 * The bucket a value falls in: 0 for none, then 1-5 by its share of the busiest district.
 * Relative to the current filter, so a quiet month still uses the whole ramp.
 */
export function intensityOf(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(INTENSITY_LEVELS, Math.max(1, Math.ceil((value / max) * INTENSITY_LEVELS)));
}

/** Fill for a bucket: a neutral slate at 0, then the brand sky at rising opacity. */
export function mapFill(level: number): { fill: string; fillOpacity: number } {
  if (level <= 0) return { fill: 'var(--color-chart-axis)', fillOpacity: 0.16 };
  return { fill: 'var(--color-chart-1)', fillOpacity: 0.16 + level * 0.155 };
}

/** Ranked districts for the current filter, busiest first; only those with data. */
export function rankDistricts(
  rows: readonly OrderGeographyDistrict[],
  metric: OrderGeographyMetric,
  division: string | null = null,
): OrderGeographyDistrict[] {
  return rows
    .filter((row) => division === null || row.division === division)
    .filter((row) => metricValue(row, metric) > 0)
    .sort(
      (a, b) =>
        metricValue(b, metric) - metricValue(a, metric) || a.district.localeCompare(b.district),
    );
}

/** A share as a percentage a person can read, or a dash when there is nothing to divide. */
export function shareText(share: number | null): string {
  return share === null ? '—' : `${(share * 100).toFixed(share < 0.01 ? 1 : 0)}%`;
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/** What the empty state should say: no orders at all, or none that could be placed. */
export function emptyReason(geography: { summary: OrderGeography['summary'] }): string {
  if (geography.summary.totalOrders === 0) {
    return 'No orders were placed in this range. Widen the dates or clear a filter.';
  }
  if (geography.summary.eligibleOrders === 0) {
    return 'Every order in this range was cancelled, so there is no demand to map.';
  }
  return 'No order in this range could be placed on the map.';
}
