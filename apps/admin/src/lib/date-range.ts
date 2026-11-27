import { ANALYTICS_MAX_DAYS } from '@nilzora/contracts';
import { translateText } from '@/lib/i18n/text';
import type { Language } from '@/lib/language';

/*
 * Report date ranges
 * ------------------
 * The dashboard and analytics pages report over a range of Bangladesh calendar days
 * (Asia/Dhaka, UTC+6, no daylight saving), chosen with `?range=` and, for a custom
 * range, `?from=YYYY-MM-DD&to=YYYY-MM-DD`; `?compare=0` turns the previous-period
 * comparison off. Everything a visitor can type is checked here, and anything unusable
 * falls back to the last 30 days, so a hand-edited link never reaches the API invalid.
 */

export const RANGE_PRESETS = ['today', '7d', '30d', 'month', 'custom'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const DEFAULT_PRESET: Exclude<RangePreset, 'custom'> = '30d';

export const PRESET_LABELS: Record<RangePreset, string> = {
  today: 'Today',
  '7d': '7 days',
  '30d': '30 days',
  month: 'This month',
  custom: 'Custom',
};

export interface ReportRange {
  preset: RangePreset;
  /** First and last day, inclusive, as YYYY-MM-DD. */
  from: string;
  to: string;
  days: number;
  /** Whether to compare with the equally long period just before. */
  compare: boolean;
  /** "Last 30 days", "1–15 Nov 2026", … */
  label: string;
  /** What the comparison is called, e.g. "vs previous 30 days". */
  comparisonLabel: string;
}

type Params = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in Dhaka, as YYYY-MM-DD. */
export function dhakaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** A YYYY-MM-DD day moved by `days` (negative to go back). */
export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The number of days from `from` to `to`, both included. */
export function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** Whether a string is a real calendar day (rejects 2026-02-30). */
export function isCalendarDay(value: string | undefined): value is string {
  if (value === undefined || !ISO_DAY.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
/** Bengali month names with Western digits, e.g. "15 নভেম্বর 2026". */
const DAY_FORMAT_BN = new Intl.DateTimeFormat('bn-BD-u-nu-latn', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** A dictionary line for Bangla, or the English text when there is none yet. */
function text(key: string, lang: Language): string {
  return translateText(key, lang);
}

function formatDay(day: string, lang: Language = 'en'): string {
  const formatter = lang === 'bn' ? DAY_FORMAT_BN : DAY_FORMAT;
  return formatter.format(new Date(`${day}T00:00:00Z`));
}

/** "1 Nov 2026", or "1–15 Nov 2026" / "28 Oct – 3 Nov 2026" for a span. */
export function formatRange(from: string, to: string, lang: Language = 'en'): string {
  if (from === to) return formatDay(from, lang);
  const [fromYear, fromMonth] = from.split('-');
  const [toYear, toMonth] = to.split('-');
  const end = formatDay(to, lang);
  if (fromYear === toYear && fromMonth === toMonth) {
    return `${String(Number(from.slice(8)))}–${end}`;
  }
  if (fromYear === toYear) {
    const start = formatDay(from, lang).replace(` ${fromYear ?? ''}`, '');
    return `${start} – ${end}`;
  }
  return `${formatDay(from, lang)} – ${end}`;
}

function presetRange(
  preset: Exclude<RangePreset, 'custom'>,
  today: string,
  lang: Language,
): { from: string; to: string; label: string } {
  switch (preset) {
    case 'today':
      return { from: today, to: today, label: text('Today', lang) };
    case '7d':
      return { from: shiftDay(today, -6), to: today, label: text('Last 7 days', lang) };
    case '30d':
      return { from: shiftDay(today, -29), to: today, label: text('Last 30 days', lang) };
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today, label: text('This month', lang) };
  }
}

function comparisonLabel(preset: RangePreset, days: number, lang: Language): string {
  if (preset === 'today') return text('vs yesterday', lang);
  if (preset === 'month') return text('vs the days before', lang);
  if (days === 1) return text('vs the day before', lang);
  return text('vs previous {count} days', lang).replace('{count}', String(days));
}

function finish(
  preset: RangePreset,
  from: string,
  to: string,
  label: string,
  compare: boolean,
  lang: Language,
): ReportRange {
  const days = spanDays(from, to);
  return {
    preset,
    from,
    to,
    days,
    compare,
    label,
    comparisonLabel: comparisonLabel(preset, days, lang),
  };
}

/**
 * The range a page's search parameters ask for. Older links with `?days=7|30|90`
 * still work (7 and 30 are presets; 90 becomes a 90-day custom range).
 */
export function parseReportRange(
  params: Params,
  now: Date = new Date(),
  lang: Language = 'en',
): ReportRange {
  const today = dhakaToday(now);
  const compare = single(params.compare) !== '0';
  const requested = single(params.range);

  if (requested === 'custom') {
    const from = single(params.from);
    const to = single(params.to);
    if (
      isCalendarDay(from) &&
      isCalendarDay(to) &&
      from <= to &&
      to <= today &&
      spanDays(from, to) <= ANALYTICS_MAX_DAYS
    ) {
      return finish('custom', from, to, formatRange(from, to, lang), compare, lang);
    }
  } else if (requested !== undefined && (RANGE_PRESETS as readonly string[]).includes(requested)) {
    const preset = requested as Exclude<RangePreset, 'custom'>;
    const { from, to, label } = presetRange(preset, today, lang);
    return finish(preset, from, to, label, compare, lang);
  } else if (requested === undefined) {
    const legacy = Number(single(params.days));
    if (legacy === 7 || legacy === 30) {
      const preset = legacy === 7 ? '7d' : '30d';
      const { from, to, label } = presetRange(preset, today, lang);
      return finish(preset, from, to, label, compare, lang);
    }
    if (legacy === 90) {
      return finish(
        'custom',
        shiftDay(today, -89),
        today,
        text('Last 90 days', lang),
        compare,
        lang,
      );
    }
  }

  const { from, to, label } = presetRange(DEFAULT_PRESET, today, lang);
  return finish(DEFAULT_PRESET, from, to, label, compare, lang);
}

/** The search parameters that reproduce a range (for links that keep it). */
export function rangeParams(range: Pick<ReportRange, 'preset' | 'from' | 'to' | 'compare'>) {
  const params: Record<string, string> = { range: range.preset };
  if (range.preset === 'custom') {
    params.from = range.from;
    params.to = range.to;
  }
  if (!range.compare) params.compare = '0';
  return params;
}
