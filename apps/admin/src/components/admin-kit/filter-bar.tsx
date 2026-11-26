import { Button, buttonClasses, cn, Input, NativeSelect } from '@nilzora/ui';
import { ChevronDown, Search, X } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import { FilterForm } from './filter-form';
import { AutoText } from '@/components/i18n/translate';

/*
 * List filters as a plain GET form: the browser submits the fields as query
 * parameters, so filtering works without JavaScript and every filtered view has its
 * own address (with JavaScript, next/form navigates without a full reload). Pages read
 * the parameters back, validate them, and pass them to the API, which validates again.
 *
 *   <FilterBar action="/admin/orders" resetHref="/admin/orders">
 *     <SearchFilter label="Search orders" defaultValue={q} placeholder="Order number or phone" />
 *     <SelectFilter name="status" label="Status" options={statusOptions} defaultValue={status} />
 *   </FilterBar>
 */

export interface ToolbarProps {
  /** The leading content, e.g. a FilterBar or a result count. */
  children?: ReactNode;
  /** Trailing actions, e.g. "New product". */
  actions?: ReactNode;
  className?: string;
}

/** A row above a list: filters on one side, actions on the other; wraps on phones. */
export function Toolbar({ children, actions, className }: ToolbarProps) {
  return (
    <div
      className={cn('flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between', className)}
    >
      <div className="min-w-0 flex-1"><AutoText value={children} /></div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2"><AutoText value={actions} /></div> : null}
    </div>
  );
}

export interface FilterBarProps {
  /** The list's own address; the form reloads it with the chosen filters. */
  action: Route;
  /** Values to keep that have no visible field (e.g. the sort). Empty values are dropped. */
  hidden?: Readonly<Record<string, string | undefined>>;
  /** A link that clears every filter, shown when set. */
  resetHref?: Route;
  submitLabel?: string;
  /** Names the filter group for assistive technology. */
  label?: string;
  className?: string;
  children: ReactNode;
}

/**
 * The filter form. Submitting always starts again from the first page, because the
 * form never carries a `page` field.
 */
export function FilterBar({
  action,
  hidden = {},
  resetHref,
  submitLabel = 'Apply',
  label = 'Filters',
  className,
  children,
}: FilterBarProps) {
  return (
    <FilterForm
      action={action}
      role="search"
      aria-label={label}
      className={cn(
        'nz-panel flex w-full min-w-0 max-w-full flex-wrap items-end gap-3 rounded-2xl border p-3 sm:p-4',
        className,
      )}
    >
      {Object.entries(hidden).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null,
      )}
      {children}
      <div className="flex items-center gap-2 basis-full sm:basis-auto">
        <Button type="submit" variant="outline" className="max-sm:flex-1">
          {submitLabel}
        </Button>
        {resetHref ? (
          <Link
            href={resetHref}
            className={buttonClasses({ variant: 'ghost', className: 'max-sm:flex-1' })}
          ><AutoText>Clear</AutoText></Link>
        ) : null}
      </div>
    </FilterForm>
  );
}

const fieldLabel =
  'text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase';

export interface SearchFilterProps {
  name?: string;
  label: string;
  defaultValue?: string | undefined;
  placeholder?: string;
  /** Matches the API's search limit (100 characters). */
  maxLength?: number;
  className?: string;
}

/** Free-text search with a visible label and a search icon. */
export function SearchFilter({
  name = 'q',
  label,
  defaultValue,
  placeholder,
  maxLength = 100,
  className,
}: SearchFilterProps) {
  const id = useId();
  return (
    <div className={cn('grid min-w-0 flex-1 basis-full gap-1.5 sm:max-w-sm sm:basis-auto', className)}>
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={id}
          type="search"
          name={name}
          defaultValue={defaultValue ?? ''}
          placeholder={placeholder}
          maxLength={maxLength}
          className="pl-9"
        />
      </div>
    </div>
  );
}

export interface FilterOption {
  value: string;
  label: string;
}

export interface SelectFilterProps {
  name: string;
  label: string;
  options: readonly FilterOption[];
  defaultValue?: string | undefined;
  /** The first option, which clears this filter. */
  allLabel?: string;
  className?: string;
}

/** One choice from a fixed list (status, category...), with an "All" option. */
export function SelectFilter({
  name,
  label,
  options,
  defaultValue,
  allLabel = 'All',
  className,
}: SelectFilterProps) {
  const id = useId();
  return (
    <div className={cn('grid min-w-0 basis-[calc(50%-0.375rem)] gap-1.5 sm:min-w-40 sm:basis-auto', className)}>
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      <div className="relative">
        <NativeSelect
          id={id}
          name={name}
          defaultValue={defaultValue ?? ''}
          className="appearance-none pr-9"
        >
          <option value=""><AutoText value={allLabel} /></option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    </div>
  );
}

export interface DateFilterProps {
  name: string;
  label: string;
  /** A calendar day, YYYY-MM-DD. */
  defaultValue?: string | undefined;
  min?: string;
  max?: string;
  className?: string;
}

/** A calendar day (the browser's date picker; the value is YYYY-MM-DD). */
export function DateFilter({ name, label, defaultValue, min, max, className }: DateFilterProps) {
  const id = useId();
  return (
    <div className={cn('grid min-w-0 basis-[calc(50%-0.375rem)] gap-1.5 sm:basis-auto', className)}>
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      <Input
        id={id}
        type="date"
        name={name}
        defaultValue={defaultValue ?? ''}
        min={min}
        max={max}
        className="w-auto"
      />
    </div>
  );
}

export interface FilterChip {
  key: string;
  /** e.g. "Status: Pending". */
  label: string;
  /** The list's address without this filter. */
  removeHref: Route;
}

export interface FilterChipsProps {
  chips: readonly FilterChip[];
  /** The list's address without any filter. */
  clearHref?: Route;
  className?: string;
}

/** The filters in effect, each removable with one link. Renders nothing without any. */
export function FilterChips({ chips, clearHref, className }: FilterChipsProps) {
  if (chips.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-2 text-sm', className)}>
      <span className="text-xs font-medium text-muted-foreground"><AutoText>Filtered by</AutoText></span>
      <ul className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <li key={chip.key}>
            <Link
              href={chip.removeHref}
              // Starts with the visible label, so speech users can say what they see.
              aria-label={`${chip.label}, remove filter`}
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface pr-2 pl-3 text-xs font-medium text-foreground transition-colors hover:border-border-strong hover:bg-surface-muted"
            >
              {chip.label}
              <X aria-hidden="true" className="size-3.5 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
      {clearHref && chips.length > 1 ? (
        <Link
          href={clearHref}
          className="text-xs font-medium text-link underline-offset-4 hover:underline"
        ><AutoText>Clear all</AutoText></Link>
      ) : null}
    </div>
  );
}
