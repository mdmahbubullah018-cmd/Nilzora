import { buttonClasses, cn } from '@nilzora/ui';
import { CalendarRange, Check, GitCompareArrows } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { withQuery } from '@/components/admin-kit/href';
import { SegmentedNav } from '@/components/admin-kit/segmented-nav';
import { ClosePopoverOnOutside } from './close-popover-on-outside';
import {
  dhakaToday,
  PRESET_LABELS,
  RANGE_PRESETS,
  rangeParams,
  shiftDay,
  type RangePreset,
  type ReportRange,
} from '@/lib/date-range';
import { AutoText } from '@/components/i18n/translate';

export interface RangeFilterProps {
  /** The page the filter reloads, e.g. `/admin`. */
  path: Route;
  range: ReportRange;
  /** Extra parameters the page keeps (e.g. a report's own filters). */
  keep?: Readonly<Record<string, string | undefined>>;
  className?: string;
}

/**
 * The date range of a report page: presets (Today, 7 days, 30 days, This month), a custom
 * range in a small GET form, and the previous-period comparison switch. Links and a GET
 * form only, so it works without JavaScript and every view has its own address. The page
 * validates whatever comes back (lib/date-range.ts) before anything reaches the API.
 */
export function RangeFilter({ path, range, keep = {}, className }: RangeFilterProps) {
  const today = dhakaToday();
  const hrefFor = (preset: RangePreset): Route =>
    withQuery(path, {
      ...keep,
      ...rangeParams({ preset, from: range.from, to: range.to, compare: range.compare }),
      ...(preset === 'custom' ? {} : { from: undefined, to: undefined }),
    });
  const presets = RANGE_PRESETS.filter((preset) => preset !== 'custom').map((preset) => ({
    key: preset,
    // The labels are dictionary keys, so the pills follow the language switch.
    label: <AutoText>{PRESET_LABELS[preset]}</AutoText>,
    href: hrefFor(preset),
  }));
  const compareHref = withQuery(path, {
    ...keep,
    ...rangeParams({ ...range, compare: !range.compare }),
  });
  const customOpen = range.preset === 'custom';

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <SegmentedNav label="Report period" options={presets} current={range.preset} />

      <details className="group relative">
        <ClosePopoverOnOutside />
        <summary
          className={cn(
            'nz-panel inline-flex h-10 cursor-pointer list-none items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition-colors select-none [&::-webkit-details-marker]:hidden',
            customOpen
              ? 'text-foreground ring-1 ring-info-line'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <CalendarRange aria-hidden="true" className="size-4" strokeWidth={1.75} />
          {customOpen ? range.label : <AutoText>Custom</AutoText>}
        </summary>
        <form
          action={path}
          method="get"
          className="nz-glass absolute top-full left-0 z-30 mt-2 grid w-72 max-w-[calc(100vw-2rem)] gap-3 rounded-xl border p-4 sm:right-0 sm:left-auto"
        >
          <input type="hidden" name="range" value="custom" />
          {range.compare ? null : <input type="hidden" name="compare" value="0" />}
          {Object.entries(keep).map(([name, value]) =>
            value === undefined || value === '' ? null : (
              <input key={name} type="hidden" name={name} value={value} />
            ),
          )}
          <p className="text-sm font-semibold text-foreground">
            <AutoText>Custom range</AutoText>
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              From
              <input
                type="date"
                name="from"
                required
                max={today}
                min={shiftDay(today, -365)}
                defaultValue={range.from}
                className="h-10 rounded-lg border border-input-border bg-surface px-2 text-sm text-foreground"
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              To
              <input
                type="date"
                name="to"
                required
                max={today}
                defaultValue={range.to}
                className="h-10 rounded-lg border border-input-border bg-surface px-2 text-sm text-foreground"
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            <AutoText>Up to 366 days, ending today at the latest.</AutoText>
          </p>
          <button type="submit" className={buttonClasses({ size: 'sm', className: 'rounded-lg' })}>
            <AutoText>Apply range</AutoText>
          </button>
        </form>
      </details>

      <Link
        href={compareHref}
        scroll={false}
        aria-label={
          range.compare
            ? `Comparing ${range.comparisonLabel.replace(/^vs /, 'with ')}; turn the comparison off`
            : 'Compare with the previous period'
        }
        className={cn(
          'nz-panel inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition-colors',
          range.compare
            ? 'text-foreground ring-1 ring-info-line'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {range.compare ? (
          <Check aria-hidden="true" className="size-4 text-primary" />
        ) : (
          <GitCompareArrows aria-hidden="true" className="size-4" strokeWidth={1.75} />
        )}
        <AutoText>Compare</AutoText>
      </Link>
    </div>
  );
}
