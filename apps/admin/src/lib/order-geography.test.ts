import { describe, expect, it } from 'vitest';
import type { OrderGeography, OrderGeographyDistrict } from '@nilzora/contracts';
import {
  activePreset,
  emptyReason,
  geographyHref,
  geographyParams,
  intensityOf,
  mapFill,
  metricValue,
  parseGeographyRange,
  parseGeographySelection,
  presetHref,
  rankDistricts,
  shareText,
  type GeographySelection,
} from './order-geography';

/*
 * The page's URL state and presentation maths. These are the rules that decide what a
 * filter means and where a district sits in the ramp, so they are tested directly rather
 * than through a render.
 */

const NOW = new Date('2026-11-11T09:00:00Z');
const TODAY = '2026-11-11';

function selection(overrides: Partial<GeographySelection> = {}): GeographySelection {
  return {
    range: parseGeographyRange({}, NOW),
    division: null,
    district: null,
    status: null,
    metric: 'orders',
    focus: null,
    ...overrides,
  };
}

describe('parseGeographyRange', () => {
  it('defaults to the last 30 days', () => {
    const range = parseGeographyRange({}, NOW);
    expect(range).toMatchObject({ preset: '30d', from: '2026-10-13', to: TODAY, days: 30 });
  });

  it('reads today, 7 and 90 days', () => {
    expect(parseGeographyRange({ range: 'today' }, NOW)).toMatchObject({
      from: TODAY,
      to: TODAY,
      days: 1,
    });
    expect(parseGeographyRange({ range: '7d' }, NOW)).toMatchObject({
      from: '2026-11-05',
      to: TODAY,
      days: 7,
    });
    expect(parseGeographyRange({ range: '90d' }, NOW)).toMatchObject({
      from: '2026-08-14',
      to: TODAY,
      days: 90,
    });
    expect(parseGeographyRange({ days: '90' }, NOW)).toMatchObject({ from: '2026-08-14', days: 90 });
  });

  it('reads yesterday as a one-day range', () => {
    const range = parseGeographyRange({ range: 'yesterday' }, NOW);
    expect(range).toMatchObject({ preset: 'custom', from: '2026-11-10', to: '2026-11-10', days: 1 });
    expect(range.label).toBe('Yesterday');
  });

  it('falls back to the default when a custom range is impossible', () => {
    expect(
      parseGeographyRange({ range: 'custom', from: '2026-11-10', to: '2026-11-01' }, NOW).preset,
    ).toBe('30d');
    expect(
      parseGeographyRange({ range: 'custom', from: '2024-01-01', to: TODAY }, NOW).preset,
    ).toBe('30d');
    expect(
      parseGeographyRange({ range: 'custom', from: '2026-10-01', to: '2026-10-31' }, NOW),
    ).toMatchObject({ preset: 'custom', from: '2026-10-01', to: '2026-10-31', days: 31 });
  });
});

describe('activePreset', () => {
  it('names the range a URL reproduces', () => {
    expect(activePreset(parseGeographyRange({ range: 'today' }, NOW), TODAY)).toBe('today');
    expect(activePreset(parseGeographyRange({ range: '30d' }, NOW), TODAY)).toBe('30d');
    expect(activePreset(parseGeographyRange({ range: '90d' }, NOW), TODAY)).toBe('90d');
    expect(activePreset(parseGeographyRange({ range: 'yesterday' }, NOW), TODAY)).toBe('yesterday');
    expect(
      activePreset(
        parseGeographyRange({ range: 'custom', from: '2026-09-01', to: '2026-09-15' }, NOW),
        TODAY,
      ),
    ).toBe('custom');
  });
});

describe('the URL round trip', () => {
  it('keeps the filters a link should not lose', () => {
    const current = selection({
      division: 'Chattogram',
      status: 'delivered',
      metric: 'revenue',
      focus: { kind: 'district', name: 'Feni' },
    });
    const params = geographyParams(current, { focus: null });
    expect(params).toMatchObject({
      range: '30d',
      metric: 'revenue',
      division: 'Chattogram',
      status: 'delivered',
    });
    expect(params.focus).toBeUndefined();
    expect(geographyHref(current, { metric: 'orders' })).toContain('metric=orders');
  });

  it('encodes a division focus and a district focus differently', () => {
    const district = selection({ focus: { kind: 'district', name: 'Dhaka' } });
    const division = selection({ focus: { kind: 'division', name: 'Dhaka' } });
    expect(geographyParams(district).focus).toBe('d:Dhaka');
    expect(geographyParams(division).focus).toBe('v:Dhaka');
    expect(parseGeographySelection({ focus: 'v:Dhaka' })).toMatchObject({
      focus: { kind: 'division', name: 'Dhaka' },
    });
    expect(parseGeographySelection({ focus: 'd:Dhaka' })).toMatchObject({
      focus: { kind: 'district', name: 'Dhaka' },
    });
    expect(parseGeographySelection({ focus: 'Feni' })).toMatchObject({
      focus: { kind: 'district', name: 'Feni' },
    });
  });

  it('writes the dates of a custom or single-day range, and the preset otherwise', () => {
    const custom = selection({
      range: parseGeographyRange({ range: 'custom', from: '2026-10-01', to: '2026-10-05' }, NOW),
    });
    expect(geographyParams(custom)).toMatchObject({ range: 'custom', from: '2026-10-01', to: '2026-10-05' });
    expect(geographyParams(selection())).not.toHaveProperty('from');
  });

  it('builds preset links that keep everything else', () => {
    const current = selection({ division: 'Khulna', metric: 'delivered' });
    const href = presetHref(current, '90d', TODAY);
    expect(href).toContain('range=custom');
    expect(href).toContain('from=2026-08-14');
    expect(href).toContain('division=Khulna');
    expect(href).toContain('metric=delivered');
  });
});

describe('the choropleth ramp', () => {
  it('gives the busiest district the top bucket and an empty one none', () => {
    expect(intensityOf(0, 100)).toBe(0);
    expect(intensityOf(1, 100)).toBe(1);
    expect(intensityOf(20, 100)).toBe(1);
    expect(intensityOf(21, 100)).toBe(2);
    expect(intensityOf(100, 100)).toBe(5);
    expect(intensityOf(5, 0)).toBe(0);
  });

  it('darkens with the bucket and keeps "no orders" neutral', () => {
    expect(mapFill(0).fill).not.toBe(mapFill(1).fill);
    const opacities = [1, 2, 3, 4, 5].map((level) => mapFill(level).fillOpacity);
    expect(opacities).toEqual([...opacities].sort((a, b) => a - b));
    expect(new Set(opacities).size).toBe(5);
  });
});

describe('ranking and figures', () => {
  const rows: OrderGeographyDistrict[] = [
    { district: 'Dhaka', division: 'Dhaka', orderCount: 10, deliveredCount: 9, revenueMinor: 1000, share: 0.5 },
    { district: 'Feni', division: 'Chattogram', orderCount: 6, deliveredCount: 3, revenueMinor: 3000, share: 0.3 },
    { district: 'Sylhet', division: 'Sylhet', orderCount: 0, deliveredCount: 0, revenueMinor: 0, share: null },
    { district: 'Khulna', division: 'Khulna', orderCount: 4, deliveredCount: 4, revenueMinor: 900, share: 0.2 },
  ];

  it('sorts by the chosen metric and drops the empty districts', () => {
    expect(rankDistricts(rows, 'orders').map((row) => row.district)).toEqual([
      'Dhaka',
      'Feni',
      'Khulna',
    ]);
    expect(rankDistricts(rows, 'revenue').map((row) => row.district)).toEqual([
      'Feni',
      'Dhaka',
      'Khulna',
    ]);
    expect(rankDistricts(rows, 'delivered').map((row) => row.district)).toEqual([
      'Dhaka',
      'Khulna',
      'Feni',
    ]);
  });

  it('narrows the ranking to one division', () => {
    expect(rankDistricts(rows, 'orders', 'Chattogram').map((row) => row.district)).toEqual(['Feni']);
  });

  it('shades by delivered orders when asked', () => {
    expect(metricValue(rows[1] as OrderGeographyDistrict, 'delivered')).toBe(3);
    expect(metricValue(rows[1] as OrderGeographyDistrict, 'revenue')).toBe(3000);
    expect(metricValue(rows[1] as OrderGeographyDistrict, 'orders')).toBe(6);
  });

  it('writes a share without pretending to know it', () => {
    expect(shareText(0.5)).toBe('50%');
    expect(shareText(0.004)).toBe('0.4%');
    expect(shareText(null)).toBe('—');
  });
});

describe('emptyReason', () => {
  const summary = {
    totalOrders: 0,
    eligibleOrders: 0,
  } as OrderGeography['summary'];

  it('separates "nothing placed" from "everything cancelled"', () => {
    expect(emptyReason({ summary })).toContain('No orders were placed');
    expect(
      emptyReason({ summary: { ...summary, totalOrders: 3, eligibleOrders: 0 } }),
    ).toContain('Every order in this range was cancelled');
    expect(
      emptyReason({ summary: { ...summary, totalOrders: 3, eligibleOrders: 2 } }),
    ).toContain('could be placed on the map');
  });
});
