import type { AnalyticsOverview } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import { bucketOverview, bucketSizeFor } from './analytics';

function overview(days: number, start = '2026-10-01', compared = true) {
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const daily: AnalyticsOverview['daily'] = Array.from({ length: days }, (_, index) => ({
    day: new Date(startTime + index * 86_400_000).toISOString().slice(0, 10),
    revenueMinor: 1000 * (index + 1),
    orderCount: index + 1,
    newCustomers: index % 2,
    byStatus: { delivered: index + 1, cancelled: index % 3 === 0 ? 1 : 0 },
  }));
  const previousDaily = daily.map((day) => ({
    day: day.day,
    revenueMinor: 500,
    orderCount: 1,
  }));
  return {
    daily,
    previousDaily: compared ? previousDaily : [],
    previousRange: compared ? { from: '2026-09-01', to: '2026-09-30' } : null,
  };
}

describe('bucketSizeFor', () => {
  it('draws days up to a month, weeks up to four months, months beyond', () => {
    expect(bucketSizeFor(1)).toBe('day');
    expect(bucketSizeFor(31)).toBe('day');
    expect(bucketSizeFor(32)).toBe('week');
    expect(bucketSizeFor(120)).toBe('week');
    expect(bucketSizeFor(121)).toBe('month');
    expect(bucketSizeFor(366)).toBe('month');
  });
});

describe('bucketOverview', () => {
  it('keeps one bucket per day for a short range, with the comparison beside it', () => {
    const buckets = bucketOverview(overview(3));
    expect(
      buckets.map((b) => [b.key, b.revenueMinor, b.orderCount, b.previousRevenueMinor]),
    ).toEqual([
      ['2026-10-01', 1000, 1, 500],
      ['2026-10-02', 2000, 2, 500],
      ['2026-10-03', 3000, 3, 500],
    ]);
  });

  it('groups weeks in sevens from the first day and adds every figure together', () => {
    const buckets = bucketOverview(overview(10), 'week');
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({
      key: '2026-10-01',
      orderCount: 28, // 1 + 2 + … + 7
      revenueMinor: 28_000,
      previousRevenueMinor: 3500,
      byStatus: { delivered: 28, cancelled: 3 },
    });
    expect(buckets[1]).toMatchObject({ key: '2026-10-08', orderCount: 27, previousOrderCount: 3 });
  });

  it('groups calendar months, whatever day the range starts on', () => {
    const buckets = bucketOverview(overview(45, '2026-10-20'), 'month');
    expect(buckets.map((b) => [b.key, b.label, b.detail])).toEqual([
      ['2026-10-20', 'Oct', 'October 2026'],
      ['2026-11-01', 'Nov', 'November 2026'],
      ['2026-12-01', 'Dec', 'December 2026'],
    ]);
    expect(buckets.reduce((sum, b) => sum + b.orderCount, 0)).toBe((45 * 46) / 2);
  });

  it('marks the comparison absent rather than zero when there is none', () => {
    const [bucket] = bucketOverview(overview(2, '2026-10-01', false));
    expect(bucket?.previousRevenueMinor).toBeNull();
    expect(bucket?.previousOrderCount).toBeNull();
  });
});
