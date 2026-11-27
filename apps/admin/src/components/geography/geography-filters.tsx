import { ORDER_STATUSES, type OrderGeography } from '@nilzora/contracts';
import { Check, Filter, SlidersHorizontal, X } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import { Button } from '@nilzora/ui';
import {
  activePreset,
  GEOGRAPHY_PATH,
  GEOGRAPHY_PRESETS,
  geographyHref,
  METRIC_OPTIONS,
  presetHref,
  rangeLabel,
  STATUS_LABEL,
  type GeographySelection,
} from '@/lib/order-geography';
import { AutoText } from '@/components/i18n/translate';

/*
 * Every filter on one bar, and all of them encode into the URL: the page is a server
 * component, so a filter change is one small read and no client state can drift from the
 * figures. The date presets are links; the rest is a plain GET form, which means it works
 * with a keyboard, without JavaScript, and with the browser's own back button.
 */

export interface GeographyFiltersProps {
  selection: GeographySelection;
  geography: OrderGeography;
  /** Dhaka's today, so the presets and the date inputs agree with the page. */
  today: string;
}

/** District names grouped by division, for the optgroup fallback when no division is chosen. */
function groupByDivision(geography: OrderGeography): [string, string[]][] {
  const grouped = new Map<string, string[]>();
  for (const row of geography.districts) {
    const names = grouped.get(row.division) ?? [];
    names.push(row.district);
    grouped.set(row.division, names);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function GeographyFilters({ selection, geography, today }: GeographyFiltersProps) {
  const active = activePreset(selection.range, today);
  const districtsInDivision =
    selection.division === null
      ? []
      : geography.districts.filter((row) => row.division === selection.division);
  const narrowed =
    selection.division !== null || selection.district !== null || selection.status !== null;
  const clearHref = geographyHref(selection, {
    division: null,
    district: null,
    status: null,
    focus: null,
  });

  return (
    <section
      aria-label="Filters"
      className="grid gap-3 rounded-2xl bg-surface p-3 ring-1 ring-hairline sm:p-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <SlidersHorizontal className="size-3.5" aria-hidden="true" />
          <AutoText>Dates</AutoText>
        </span>
        <div role="group" aria-label="Date range" className="flex flex-wrap gap-1">
          {GEOGRAPHY_PRESETS.filter((entry) => entry.preset !== 'custom').map((entry) => (
            <Link
              key={entry.preset}
              href={presetHref(selection, entry.preset, today)}
              aria-current={active === entry.preset ? 'page' : undefined}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-action ${
                active === entry.preset
                  ? 'bg-primary-action text-white'
                  : 'bg-surface-muted text-foreground hover:bg-info-soft'
              }`}
            >
              {entry.label}
            </Link>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          <AutoText value={rangeLabel(selection.range, today)} />
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Filter className="size-3.5" aria-hidden="true" />
          <AutoText>Shade by</AutoText>
        </span>
        <div role="group" aria-label="Metric" className="flex flex-wrap gap-1">
          {METRIC_OPTIONS.map((option) => (
            <Link
              key={option.metric}
              href={geographyHref(selection, { metric: option.metric })}
              aria-current={selection.metric === option.metric ? 'true' : undefined}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-action ${
                selection.metric === option.metric
                  ? 'bg-primary-action text-white'
                  : 'bg-surface-muted text-foreground hover:bg-info-soft'
              }`}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </div>

      <form
        action={GEOGRAPHY_PATH}
        method="get"
        className="flex flex-wrap items-end gap-2 border-t border-hairline pt-3"
      >
        <input type="hidden" name="metric" value={selection.metric} />
        {selection.focus !== null ? (
          <input
            type="hidden"
            name="focus"
            value={`${selection.focus.kind === 'division' ? 'v' : 'd'}:${selection.focus.name}`}
          />
        ) : null}

        <Field label="Range">
          <select name="range" defaultValue={active} className={SELECT}>
            {GEOGRAPHY_PRESETS.map((entry) => (
              <option key={entry.preset} value={entry.preset}>
                {entry.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <input
            type="date"
            name="from"
            defaultValue={selection.range.from}
            max={today}
            className={SELECT}
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            name="to"
            defaultValue={selection.range.to}
            max={today}
            className={SELECT}
          />
        </Field>
        <Field label="Division">
          <select name="division" defaultValue={selection.division ?? ''} className={SELECT}>
            <option value="">
              <AutoText>All divisions</AutoText>
            </option>
            {geography.divisions.map((division) => (
              <option key={division.division} value={division.division}>
                {division.division}
              </option>
            ))}
          </select>
        </Field>
        <Field label="District">
          <select name="district" defaultValue={selection.district ?? ''} className={SELECT}>
            <option value="">
              <AutoText>All districts</AutoText>
            </option>
            {selection.division !== null
              ? districtsInDivision.map((row) => (
                  <option key={row.district} value={row.district}>
                    {row.district}
                  </option>
                ))
              : groupByDivision(geography).map(([group, names]) => (
                  <optgroup key={group} label={group}>
                    {names.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </optgroup>
                ))}
          </select>
        </Field>
        <Field label="Status">
          <select name="status" defaultValue={selection.status ?? ''} className={SELECT}>
            <option value="">
              <AutoText>Every status</AutoText>
            </option>
            {ORDER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </Field>
        <Button type="submit" size="sm">
          <AutoText>Apply</AutoText>
        </Button>
      </form>

      {narrowed || selection.focus !== null ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">
            <AutoText>Showing</AutoText>
          </span>
          {selection.division !== null ? (
            <Chip
              label={`Division: ${selection.division}`}
              href={geographyHref(selection, { division: null, district: null, focus: null })}
            />
          ) : null}
          {selection.district !== null ? (
            <Chip
              label={`District: ${selection.district}`}
              href={geographyHref(selection, { district: null, focus: null })}
            />
          ) : null}
          {selection.status !== null ? (
            <Chip
              label={`Status: ${STATUS_LABEL[selection.status]}`}
              href={geographyHref(selection, { status: null })}
            />
          ) : null}
          {selection.focus !== null ? (
            <Chip
              label={`Focus: ${selection.focus.name}`}
              href={geographyHref(selection, { focus: null })}
            />
          ) : null}
          {narrowed ? (
            <Link
              href={clearHref}
              className="ml-1 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-action"
            >
              <X className="size-3" aria-hidden="true" />
              <AutoText>Clear filters</AutoText>
            </Link>
          ) : null}
        </div>
      ) : (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="size-3.5" aria-hidden="true" />
          <AutoText>No filters: every division and district is included.</AutoText>
        </p>
      )}
    </section>
  );
}

const SELECT =
  'h-9 rounded-lg border border-hairline bg-surface px-2 text-xs text-foreground shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-action max-sm:min-h-11 max-sm:w-full';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">
        <AutoText value={label} />
      </span>
      {children}
    </label>
  );
}

function Chip({ label, href }: { label: string; href: Route }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-1 text-xs font-medium text-foreground ring-1 ring-hairline hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-action"
    >
      {label}
      <X className="size-3" aria-hidden="true" />
    </Link>
  );
}
