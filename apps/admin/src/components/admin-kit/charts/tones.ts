/*
 * Chart colours, on the admin's chart tokens (globals.css: --nz-chart-1 … --nz-chart-8 and
 * --nz-chart-axis). Each token already holds the right shade per theme (one step deeper on
 * light cards where the brand value is too light for white), so no class here needs a
 * `dark:` variant and no component ever names a hex value or a palette step.
 *
 * Marks draw with `currentColor`, so `text` colours an SVG (fills, strokes and gradient
 * stops follow it) and `swatch` colours legend keys and HTML bars. Values and labels stay
 * in the text colours; a colour only identifies a series, never carries meaning alone.
 *
 * `light` and `dark` record the token values behind each class; tones.test.ts reads
 * globals.css to check they match, and that every tone keeps 3:1 against both card
 * surfaces (WCAG non-text contrast).
 */
export const CHART_TONES = {
  primary: { text: 'text-chart-1', swatch: 'bg-chart-1', light: '#0284C7', dark: '#0EA5E9' },
  violet: { text: 'text-chart-2', swatch: 'bg-chart-2', light: '#7C3AED', dark: '#8B5CF6' },
  success: { text: 'text-chart-3', swatch: 'bg-chart-3', light: '#16A34A', dark: '#22C55E' },
  warning: { text: 'text-chart-4', swatch: 'bg-chart-4', light: '#D97706', dark: '#F59E0B' },
  /** The rose slot: the palette's warm alarm hue. */
  danger: { text: 'text-chart-5', swatch: 'bg-chart-5', light: '#E11D48', dark: '#F43F5E' },
  moderator: { text: 'text-chart-6', swatch: 'bg-chart-6', light: '#0D9488', dark: '#14B8A6' },
  indigo: { text: 'text-chart-7', swatch: 'bg-chart-7', light: '#4F46E5', dark: '#6366F1' },
  sky: { text: 'text-chart-8', swatch: 'bg-chart-8', light: '#0891B2', dark: '#38BDF8' },
  /** For "other", "previous period" and anything that should recede. */
  neutral: { text: 'text-chart-axis', swatch: 'bg-chart-axis', light: '#64748B', dark: '#94A3B8' },
} as const;

export type ChartTone = keyof typeof CHART_TONES;

/**
 * The eight palette slots in their fixed order (1 primary blue, 2 violet, 3 green,
 * 4 amber, 5 rose, 6 teal, 7 indigo, 8 cyan): series take them in this order, by
 * identity, never by rank.
 */
export const CHART_SERIES = [
  'primary',
  'violet',
  'success',
  'warning',
  'danger',
  'moderator',
  'indigo',
  'sky',
] as const satisfies readonly ChartTone[];

/**
 * The tone of the `index`th series. The palette is never cycled: a ninth series and
 * beyond share the neutral tone, which is the cue to fold them into "Other".
 */
export function seriesTone(index: number): ChartTone {
  return CHART_SERIES[index] ?? 'neutral';
}

/** Card surfaces the tones are drawn on (white, and the admin dark --nz-surface). */
export const CHART_SURFACES = { light: '#FFFFFF', dark: '#111A2E' } as const;
