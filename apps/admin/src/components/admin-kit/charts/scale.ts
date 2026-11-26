/*
 * Pure geometry for the SVG charts: nice axis ticks, point positions, paths and the small
 * bits of arithmetic the charts share. Cartesian charts draw in a 0–100 viewBox on both
 * axes, so positions here are percentages.
 */

export interface LinearScale {
  /** The top of the axis: a round number at or above the largest value. */
  max: number;
  /** Tick values from 0 to `max`, evenly spaced. */
  ticks: number[];
}

export interface ScaleOptions {
  /** Whole-number steps only, for counts (never "2.5 orders"). */
  integer?: boolean;
}

const STEP_FACTORS = [1, 2, 2.5, 5, 10];

/** The smallest round step (1, 2, 2.5 or 5 times a power of ten) at or above `rough`. */
function niceStep(rough: number, integer: boolean): number {
  const power = 10 ** Math.floor(Math.log10(rough));
  const candidates = STEP_FACTORS.map((factor) => Number((factor * power).toPrecision(12))).filter(
    (step) => !integer || (Number.isInteger(step) && step >= 1),
  );
  return candidates.find((candidate) => candidate >= rough) ?? Math.max(integer ? 1 : 0, 10 * power);
}

function ticksOf(step: number, steps: number): number[] {
  return Array.from({ length: steps + 1 }, (_, i) => Number((i * step).toPrecision(12)));
}

/**
 * A 0-based axis with about `tickCount` intervals at round steps (1, 2, 2.5 or 5 times
 * a power of ten). An all-zero series still gets a visible axis (0 to 1).
 */
export function niceScale(maxValue: number, tickCount = 4, options: ScaleOptions = {}): LinearScale {
  const intervals = Math.max(1, Math.round(tickCount));
  if (!Number.isFinite(maxValue) || maxValue <= 0) {
    if (options.integer) return { max: 1, ticks: [0, 1] };
    return { max: 1, ticks: Array.from({ length: intervals + 1 }, (_, i) => i / intervals) };
  }
  const step = niceStep(maxValue / intervals, options.integer ?? false);
  const ticks = ticksOf(step, Math.ceil(maxValue / step - 1e-9));
  return { max: ticks.at(-1) ?? maxValue, ticks };
}

/**
 * An axis with exactly `intervals` round steps, for a second axis whose ticks must sit
 * on the first axis's gridlines (so a dual-axis chart draws one set of gridlines).
 */
export function alignedScale(maxValue: number, intervals: number, options: ScaleOptions = {}): LinearScale {
  const count = Math.max(1, Math.round(intervals));
  const integer = options.integer ?? false;
  if (!Number.isFinite(maxValue) || maxValue <= 0) {
    const step = integer ? 1 : 1 / count;
    const ticks = ticksOf(step, count);
    return { max: ticks.at(-1) ?? 1, ticks };
  }
  const ticks = ticksOf(niceStep(maxValue / count, integer), count);
  return { max: ticks.at(-1) ?? maxValue, ticks };
}

/** The horizontal centre of point `index` of `count`, as a percentage (bands, not edges). */
export function bandCenter(index: number, count: number): number {
  return count <= 0 ? 50 : ((index + 0.5) / count) * 100;
}

/** How far up the chart `value` sits, as a percentage of the height from the bottom. */
export function heightPercent(value: number, max: number): number {
  if (!Number.isFinite(value) || max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

/**
 * Indexes of the x-axis labels to show: the first, the last, and evenly spaced ones
 * between, at most `maxLabels` in all, so long series never crowd the axis.
 */
export function labelIndexes(count: number, maxLabels = 6): number[] {
  if (count <= 0) return [];
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i);
  const last = count - 1;
  const gaps = Math.max(1, maxLabels - 1);
  const indexes = new Set<number>();
  for (let i = 0; i <= gaps; i += 1) indexes.add(Math.round((i * last) / gaps));
  return [...indexes].sort((a, b) => a - b);
}

type Point = readonly [number, number];

const fixed = (value: number) => value.toFixed(2);

/** An SVG path through points given as [x, y] percentages (y measured from the top). */
export function linePath(points: readonly Point[]): string {
  return points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${fixed(x)} ${fixed(y)}`)
    .join(' ');
}

/** The same line closed down to the baseline, for the filled area beneath it. */
export function areaPath(points: readonly Point[]): string {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return '';
  return `${linePath(points)} L${fixed(last[0])} 100 L${fixed(first[0])} 100 Z`;
}

/**
 * Tangents of a monotone cubic through the points (Fritsch–Carlson, as d3's
 * curveMonotoneX): the curve never overshoots a data point, so a smoothed line never
 * suggests a peak or a dip below zero that the data does not have.
 */
function monotoneTangents(points: readonly Point[]): number[] {
  const secants = points.slice(1).map(([x, y], i) => {
    const [px = 0, py = 0] = points[i] ?? [];
    return x === px ? 0 : (y - py) / (x - px);
  });
  const inner = points.map((_, i) => {
    if (i === 0 || i === points.length - 1) return 0;
    const s0 = secants[i - 1] ?? 0;
    const s1 = secants[i] ?? 0;
    const h0 = (points[i]?.[0] ?? 0) - (points[i - 1]?.[0] ?? 0);
    const h1 = (points[i + 1]?.[0] ?? 0) - (points[i]?.[0] ?? 0);
    const p = h0 + h1 === 0 ? 0 : (s0 * h1 + s1 * h0) / (h0 + h1);
    return (Math.sign(s0) + Math.sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  });
  const last = points.length - 1;
  inner[0] = ((3 * (secants[0] ?? 0) - (inner[1] ?? 0)) / 2) || 0;
  inner[last] = ((3 * (secants[last - 1] ?? 0) - (inner[last - 1] ?? 0)) / 2) || 0;
  return inner;
}

/** A smooth line through the points that keeps their order and never overshoots them. */
export function smoothLinePath(points: readonly Point[]): string {
  if (points.length < 3) return linePath(points);
  const tangents = monotoneTangents(points);
  const [first] = points;
  if (!first) return '';
  let path = `M${fixed(first[0])} ${fixed(first[1])}`;
  for (let i = 1; i < points.length; i += 1) {
    const [x0 = 0, y0 = 0] = points[i - 1] ?? [];
    const [x1 = 0, y1 = 0] = points[i] ?? [];
    const third = (x1 - x0) / 3;
    path += ` C${fixed(x0 + third)} ${fixed(y0 + third * (tangents[i - 1] ?? 0))} ${fixed(x1 - third)} ${fixed(y1 - third * (tangents[i] ?? 0))} ${fixed(x1)} ${fixed(y1)}`;
  }
  return path;
}

/** The smooth line closed down to the baseline. */
export function smoothAreaPath(points: readonly Point[]): string {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return '';
  return `${smoothLinePath(points)} L${fixed(last[0])} 100 L${fixed(first[0])} 100 Z`;
}

/** `part` as a share of `whole` (0–1), or null when the whole is zero (no share exists). */
export function shareOf(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return Math.max(0, part) / whole;
}

/**
 * The intensity step of a heatmap cell: 0 for an empty cell, otherwise 1–`levels` by
 * the cell's share of the busiest cell. Steps (not a continuous ramp) keep the legend
 * honest: each swatch in it stands for an exact range.
 */
export function heatLevel(value: number, max: number, levels = 5): number {
  if (!Number.isFinite(value) || value <= 0 || max <= 0) return 0;
  return Math.min(levels, Math.max(1, Math.ceil((value / max) * levels - 1e-9)));
}

export interface FunnelStep {
  /** Bar length as a percentage of the widest stage (the first, in a real funnel). */
  width: number;
  /** This stage ÷ the stage before it; null for the first stage or after an empty one. */
  conversion: number | null;
}

/** Widths and step-to-step conversion of funnel stages, in order. */
export function funnelSteps(values: readonly number[]): FunnelStep[] {
  const base = Math.max(0, ...values);
  return values.map((value, index) => ({
    width: heightPercent(value, base),
    conversion: index === 0 ? null : shareOf(value, values[index - 1] ?? 0),
  }));
}
