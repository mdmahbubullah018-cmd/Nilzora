import type { AnalyticsOverview, OrderStatus } from '@nilzora/contracts';
import { formatDay, formatDayLong } from './format';

/*
 * Time buckets for the analytics charts. A short range is drawn day by day; a longer one
 * is grouped into weeks or calendar months so a chart keeps a readable number of bars
 * and points. Grouping only adds the API's own daily figures together — it never
 * estimates — and the previous period is grouped the same way, position by position.
 */

export type BucketSize = 'day' | 'week' | 'month';

/** Days for up to a month, weeks for up to four months, calendar months beyond. */
export function bucketSizeFor(days: number): BucketSize {
  if (days <= 31) return 'day';
  if (days <= 120) return 'week';
  return 'month';
}

export interface AnalyticsBucket {
  key: string;
  /** Short axis label, e.g. "25 Oct", "Week of 3 Nov" → "3 Nov", "Oct". */
  label: string;
  /** Long label for tooltips and data tables. */
  detail: string;
  revenueMinor: number;
  orderCount: number;
  newCustomers: number;
  byStatus: Partial<Record<OrderStatus, number>>;
  /** The same positions of the previous period, or null without a comparison. */
  previousRevenueMinor: number | null;
  previousOrderCount: number | null;
}

const monthShort = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });
const monthLong = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function monthOf(isoDate: string): Date {
  return new Date(`${isoDate.slice(0, 7)}-01T00:00:00Z`);
}

function addStatus(
  into: Partial<Record<OrderStatus, number>>,
  from: Partial<Record<OrderStatus, number>>,
) {
  for (const [status, value] of Object.entries(from) as [OrderStatus, number | undefined][]) {
    if (value) into[status] = (into[status] ?? 0) + value;
  }
}

/**
 * The overview's days grouped into buckets of `size` (by default, the size that suits
 * the range). Weeks run in sevens from the range's first day; months follow the calendar.
 */
export function bucketOverview(
  overview: Pick<AnalyticsOverview, 'daily' | 'previousDaily' | 'previousRange'>,
  size: BucketSize = bucketSizeFor(overview.daily.length),
): AnalyticsBucket[] {
  const compared = overview.previousRange !== null;
  const groups: number[][] = [];
  overview.daily.forEach((day, index) => {
    const last = groups.at(-1);
    const previousDay = last ? overview.daily[last[0] ?? 0]?.day : undefined;
    const startsGroup =
      size === 'day' ||
      !last ||
      (size === 'week' ? index % 7 === 0 : previousDay?.slice(0, 7) !== day.day.slice(0, 7));
    if (startsGroup || !last) groups.push([index]);
    else last.push(index);
  });

  return groups.map((indexes) => {
    const days = indexes.flatMap((index) => {
      const day = overview.daily[index];
      return day ? [day] : [];
    });
    const first = days[0]?.day ?? '';
    const lastDay = days.at(-1)?.day ?? first;
    const byStatus: Partial<Record<OrderStatus, number>> = {};
    for (const day of days) addStatus(byStatus, day.byStatus);
    const previous = indexes.flatMap((index) => {
      const day = overview.previousDaily[index];
      return day ? [day] : [];
    });
    const label =
      size === 'day' ? formatDay(first) : size === 'week' ? formatDay(first) : monthShort.format(monthOf(first));
    const detail =
      size === 'day'
        ? formatDayLong(first)
        : size === 'week'
          ? first === lastDay
            ? formatDayLong(first)
            : `${formatDay(first)} – ${formatDay(lastDay)}`
          : monthLong.format(monthOf(first));
    return {
      key: first,
      label,
      detail,
      revenueMinor: days.reduce((sum, day) => sum + day.revenueMinor, 0),
      orderCount: days.reduce((sum, day) => sum + day.orderCount, 0),
      newCustomers: days.reduce((sum, day) => sum + day.newCustomers, 0),
      byStatus,
      previousRevenueMinor: compared
        ? previous.reduce((sum, day) => sum + day.revenueMinor, 0)
        : null,
      previousOrderCount: compared ? previous.reduce((sum, day) => sum + day.orderCount, 0) : null,
    };
  });
}

/** What a bucket is called in prose: "day", "week" or "month". */
export const BUCKET_NOUN: Record<BucketSize, string> = { day: 'Day', week: 'Week', month: 'Month' };
