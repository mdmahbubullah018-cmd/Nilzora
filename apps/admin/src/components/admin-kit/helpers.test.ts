import { describe, expect, it } from 'vitest';
import {
  alignedScale,
  areaPath,
  bandCenter,
  funnelSteps,
  heatLevel,
  heightPercent,
  labelIndexes,
  linePath,
  niceScale,
  shareOf,
  smoothAreaPath,
  smoothLinePath,
} from './charts/scale';
import { parseSort, sortParam } from './data-table';
import { oneOf, pageParam, single, withQuery } from './href';
import { pageWindow, rangeSummary } from './pagination';
import { stockLevel } from './status-badge';

describe('withQuery', () => {
  it('adds encoded parameters and drops empty ones', () => {
    expect(withQuery('/admin', { q: 'NZ 1&2', page: 2, status: '', days: undefined })).toBe(
      '/admin?q=NZ+1%262&page=2',
    );
    expect(withQuery('/admin', { flag: false, other: null })).toBe('/admin');
  });
});

describe('search parameters', () => {
  it('refuses repeated parameters', () => {
    expect(single('a')).toBe('a');
    expect(single(['a', 'b'])).toBeUndefined();
  });

  it('reads page numbers and falls back to the first page', () => {
    expect(pageParam('3')).toBe(3);
    for (const value of [undefined, '0', '-1', '1.5', 'abc', '99999', ['2', '3']]) {
      expect(pageParam(value)).toBe(1);
    }
  });

  it('accepts only listed enum values', () => {
    expect(oneOf('pending', ['pending', 'confirmed'] as const)).toBe('pending');
    expect(oneOf('PENDING', ['pending'] as const)).toBeUndefined();
  });
});

describe('sorting', () => {
  const columns = ['placed', 'total'] as const;
  const fallback = { column: 'placed', direction: 'desc' } as const;

  it('reads ascending and descending sorts and ignores unknown columns', () => {
    expect(parseSort('total', columns, fallback)).toEqual({ column: 'total', direction: 'asc' });
    expect(parseSort('-total', columns, fallback)).toEqual({ column: 'total', direction: 'desc' });
    expect(parseSort('-password', columns, fallback)).toBe(fallback);
    expect(parseSort(undefined, columns, fallback)).toBe(fallback);
  });

  it('writes sorts back as parameters', () => {
    expect(sortParam({ column: 'total', direction: 'desc' })).toBe('-total');
    expect(sortParam({ column: 'total', direction: 'asc' })).toBe('total');
  });
});

describe('pagination helpers', () => {
  it('shows the ends, the current page and its neighbours', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageWindow(3, 10)).toEqual([1, 2, 3, 4, null, 10]);
  });

  it('summarises the visible range', () => {
    expect(rangeSummary(2, 25, 230, 'orders')).toBe('Showing 26–50 of 230 orders');
    expect(rangeSummary(10, 25, 230, 'orders')).toBe('Showing 226–230 of 230 orders');
    expect(rangeSummary(1, 25, 0, 'orders')).toBe('No orders');
  });
});

describe('chart scale', () => {
  it('rounds the axis up to a nice step', () => {
    expect(niceScale(87)).toEqual({ max: 100, ticks: [0, 25, 50, 75, 100] });
    expect(niceScale(1_234_500)).toEqual({
      max: 1_500_000,
      ticks: [0, 500_000, 1_000_000, 1_500_000],
    });
    expect(niceScale(4)).toEqual({ max: 4, ticks: [0, 1, 2, 3, 4] });
  });

  it('keeps an empty series on a visible axis', () => {
    expect(niceScale(0).max).toBe(1);
  });

  it('places points in the middle of their bands and clamps heights', () => {
    expect(bandCenter(0, 4)).toBe(12.5);
    expect(bandCenter(3, 4)).toBe(87.5);
    expect(heightPercent(50, 200)).toBe(25);
    expect(heightPercent(500, 200)).toBe(100);
    expect(heightPercent(5, 0)).toBe(0);
  });

  it('labels at most six evenly spaced points, always the first and last', () => {
    expect(labelIndexes(4)).toEqual([0, 1, 2, 3]);
    expect(labelIndexes(30)).toEqual([0, 6, 12, 17, 23, 29]);
    expect(labelIndexes(0)).toEqual([]);
  });

  it('draws lines and closes areas to the baseline', () => {
    const points = [
      [10, 80],
      [90, 20],
    ] as const;
    expect(linePath(points)).toBe('M10.00 80.00 L90.00 20.00');
    expect(areaPath(points)).toBe('M10.00 80.00 L90.00 20.00 L90.00 100 L10.00 100 Z');
    expect(areaPath([])).toBe('');
  });

  it('keeps count axes on whole numbers', () => {
    expect(niceScale(2)).toEqual({ max: 2, ticks: [0, 0.5, 1, 1.5, 2] });
    expect(niceScale(2, 4, { integer: true })).toEqual({ max: 2, ticks: [0, 1, 2] });
    expect(niceScale(0, 4, { integer: true })).toEqual({ max: 1, ticks: [0, 1] });
  });

  it('aligns a second axis to the first axis gridlines', () => {
    // Five gridlines on the left (0–100 by 25) give the right axis exactly four steps.
    expect(alignedScale(37, 4)).toEqual({ max: 40, ticks: [0, 10, 20, 30, 40] });
    expect(alignedScale(3, 4, { integer: true })).toEqual({ max: 4, ticks: [0, 1, 2, 3, 4] });
    expect(alignedScale(0, 4, { integer: true }).ticks).toEqual([0, 1, 2, 3, 4]);
    expect(alignedScale(0, 2).ticks).toEqual([0, 0.5, 1]);
  });

  it('smooths a line through every point without overshooting', () => {
    const points = [
      [10, 80],
      [50, 20],
      [90, 20],
    ] as const;
    const path = smoothLinePath(points);
    expect(path.startsWith('M10.00 80.00 C')).toBe(true);
    expect(path.endsWith('90.00 20.00')).toBe(true);
    expect(path).toContain(' 50.00 20.00 C');
    // A flat run stays flat: no control point rises above the plateau (y < 20).
    const ys = [...path.matchAll(/(-?d+.d+) (-?d+.d+)/g)].map((match) => Number(match[2]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(20);
    expect(smoothAreaPath(points).endsWith('L90.00 100 L10.00 100 Z')).toBe(true);
    // Two points are a straight line.
    expect(smoothLinePath(points.slice(0, 2))).toBe('M10.00 80.00 L50.00 20.00');
    expect(smoothAreaPath([])).toBe('');
  });

  it('steps heatmap cells by their share of the busiest cell', () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(2, 10)).toBe(1);
    expect(heatLevel(5, 10)).toBe(3);
    expect(heatLevel(10, 10)).toBe(5);
    expect(heatLevel(3, 0)).toBe(0);
  });

  it('gives shares only when there is a whole to share', () => {
    expect(shareOf(1, 4)).toBe(0.25);
    expect(shareOf(1, 0)).toBeNull();
  });

  it('scales funnel stages to the widest and converts each from the one before', () => {
    expect(funnelSteps([200, 50, 10])).toEqual([
      { width: 100, conversion: null },
      { width: 25, conversion: 0.25 },
      { width: 5, conversion: 0.2 },
    ]);
    expect(funnelSteps([0, 0, 0]).map((step) => step.conversion)).toEqual([null, null, null]);
  });
});

describe('stockLevel', () => {
  it('bands exact quantities at the low-stock threshold', () => {
    expect(stockLevel(0)).toBe('out');
    expect(stockLevel(5)).toBe('low');
    expect(stockLevel(6)).toBe('in');
  });
});
