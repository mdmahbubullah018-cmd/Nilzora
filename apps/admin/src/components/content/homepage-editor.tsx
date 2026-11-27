'use client';

import type { AdminHomepageSection, HomepageSectionKey } from '@nilzora/contracts';
import { Button, cn, Field, Input, NativeSelect } from '@nilzora/ui';
import { ChevronDown, ChevronUp, LayoutTemplate, Save, Undo2 } from 'lucide-react';
import { useActionState, useState } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { Chip } from '@/components/admin-kit/chip';
import { SubmitButton } from '@/components/admin-kit/submit-button';
import { useInteractive } from '@/components/admin-kit/use-interactive';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { useUnsavedChanges } from '@/components/catalog/use-unsaved-changes';
import { saveHomepageAction } from '@/lib/content-actions';
import {
  checkHomepage,
  HOMEPAGE_ITEM_LIMIT_MAX,
  HOMEPAGE_LABELS,
  homepageRows,
  takesFilter,
  type FieldErrors,
  type HomepageRow,
} from './content-rules';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

const TOUCH = 'max-sm:h-11';

export interface SlugOption {
  slug: string;
  name: string;
}

function FilterSelect({
  id,
  name,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  /** Null when the list could not be read: the slug is then typed. */
  options: readonly SlugOption[] | null;
  onChange: (value: string) => void;
}) {
  return (
    <Field id={id} label={label}>
      {(control) =>
        options ? (
          <NativeSelect
            {...control}
            name={name}
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
            className={TOUCH}
          >
            <option value="">
              <AutoText>Any</AutoText>
            </option>
            {/* A saved slug that is no longer in the list stays selectable, so saving does not drop it. */}
            {value !== '' && !options.some((option) => option.slug === value) ? (
              <option value={value}>{value} (not found)</option>
            ) : null}
            {options.map((option) => (
              <option key={option.slug} value={option.slug}>
                {option.name}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <Input
            {...control}
            name={name}
            value={value}
            placeholder="slug"
            onChange={(event) => onChange(event.currentTarget.value)}
            className={`font-mono ${TOUCH}`}
          />
        )
      }
    </Field>
  );
}

/**
 * Which sections the storefront's homepage shows, in which order, with which heading and
 * how many items. One Save sends every section (the API takes them all at once). Without
 * JavaScript the order is a number typed beside each section; with it, move buttons.
 */
export function HomepageEditor({
  sections,
  categories,
  brands,
  csrf,
}: {
  sections: readonly AdminHomepageSection[];
  categories: readonly SlugOption[] | null;
  brands: readonly SlugOption[] | null;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const interactive = useInteractive();
  const [state, action] = useActionState(saveHomepageAction, IDLE_STATE);
  const saved = homepageRows(sections);
  const [rows, setRows] = useState<HomepageRow[]>(saved);
  const [errors, setErrors] = useState<FieldErrors>({});

  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);
  useUnsavedChanges(dirty);

  const error = (field: string, key: HomepageSectionKey) =>
    errors[`${field}_${key}`] ??
    (state.status === 'error' ? state.fieldErrors?.[`${field}_${key}`] : undefined);

  const update = (key: HomepageSectionKey, patch: Partial<HomepageRow>) => {
    const next = rows.map((row) => (row.key === key ? { ...row, ...patch } : row));
    setRows(next);
    const checked = checkHomepage(next);
    setErrors(checked.ok ? {} : checked.errors);
  };
  const move = (key: HomepageSectionKey, step: -1 | 1) => {
    const index = rows.findIndex((row) => row.key === key);
    const target = index + step;
    if (index < 0 || target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target] as HomepageRow, next[index] as HomepageRow];
    setRows(next);
  };

  return (
    <form
      action={action}
      noValidate
      onSubmit={(event) => {
        const checked = checkHomepage(rows);
        if (checked.ok) return;
        event.preventDefault();
        setErrors(checked.errors);
      }}
      className="grid gap-6"
    >
      <CsrfField csrf={csrf} />
      <ol aria-label={tx('Homepage sections')} className="grid gap-4">
        {rows.map((row, index) => (
          <li
            key={row.key}
            className={cn(
              'nz-panel-strong grid gap-4 rounded-2xl border p-4 sm:p-5',
              !row.isEnabled && 'opacity-80',
            )}
          >
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex shrink-0 items-center gap-1.5">
                {interactive ? (
                  <>
                    <input type="hidden" name={`position_${row.key}`} value={index + 1} />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => move(row.key, -1)}
                      disabled={index === 0}
                      aria-label={`Move ${HOMEPAGE_LABELS[row.key].title} earlier`}
                      className="rounded-xl max-sm:size-11"
                    >
                      <ChevronUp aria-hidden="true" strokeWidth={1.75} />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => move(row.key, 1)}
                      disabled={index === rows.length - 1}
                      aria-label={`Move ${HOMEPAGE_LABELS[row.key].title} later`}
                      className="rounded-xl max-sm:size-11"
                    >
                      <ChevronDown aria-hidden="true" strokeWidth={1.75} />
                    </Button>
                  </>
                ) : (
                  <div className="w-24">
                    <Field id={`position-${row.key}`} label={tx('Position')}>
                      {(control) => (
                        <Input
                          {...control}
                          name={`position_${row.key}`}
                          type="number"
                          min={1}
                          max={rows.length}
                          defaultValue={index + 1}
                          className="tabular-nums"
                        />
                      )}
                    </Field>
                  </div>
                )}
                <span className="grid size-8 place-items-center rounded-full bg-info-soft text-sm font-semibold text-info-ink tabular-nums ring-1 ring-info-line">
                  {index + 1}
                </span>
              </div>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <h2 className="flex flex-wrap items-center gap-2 font-display text-base font-semibold text-foreground">
                  {HOMEPAGE_LABELS[row.key].title}
                  <Chip tone={row.isEnabled ? 'success' : 'neutral'} dot>
                    {row.isEnabled ? 'Shown' : 'Hidden'}
                  </Chip>
                </h2>
                <p className="text-sm text-muted-foreground">
                  <AutoText value={HOMEPAGE_LABELS[row.key].description} />
                </p>
              </div>
              <label className="flex min-h-11 items-center gap-2.5 text-sm font-medium text-foreground">
                <input
                  type="checkbox"
                  name={`enabled_${row.key}`}
                  checked={row.isEnabled}
                  onChange={(event) => update(row.key, { isEnabled: event.currentTarget.checked })}
                  className="size-5 accent-primary-action"
                />
                Show{' '}
                <span className="sr-only">
                  <AutoText value={HOMEPAGE_LABELS[row.key].title} />
                </span>
              </label>
            </div>

            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field
                id={`title-${row.key}`}
                label={tx('Heading')}
                error={error('title', row.key)}
                hint={tx('Replaces the section’s own heading. Empty keeps the built-in one.')}
              >
                {(control) => (
                  <Input
                    {...control}
                    name={`title_${row.key}`}
                    maxLength={60}
                    value={row.title}
                    onChange={(event) => update(row.key, { title: event.currentTarget.value })}
                    className={TOUCH}
                  />
                )}
              </Field>
              <Field
                id={`limit-${row.key}`}
                label={tx('Items shown')}
                error={error('itemLimit', row.key)}
                hint={`1 to ${String(HOMEPAGE_ITEM_LIMIT_MAX)}. Empty keeps the built-in number.`}
              >
                {(control) => (
                  <Input
                    {...control}
                    name={`itemLimit_${row.key}`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={HOMEPAGE_ITEM_LIMIT_MAX}
                    value={row.itemLimit}
                    onChange={(event) => update(row.key, { itemLimit: event.currentTarget.value })}
                    className={`tabular-nums ${TOUCH}`}
                  />
                )}
              </Field>
              {takesFilter(row.key) ? (
                <>
                  <FilterSelect
                    id={`category-${row.key}`}
                    name={`categorySlug_${row.key}`}
                    label={tx('Only this category')}
                    value={row.categorySlug}
                    options={categories}
                    onChange={(value) => update(row.key, { categorySlug: value })}
                  />
                  <FilterSelect
                    id={`brand-${row.key}`}
                    name={`brandSlug_${row.key}`}
                    label={tx('Only this brand')}
                    value={row.brandSlug}
                    options={brands}
                    onChange={(value) => update(row.key, { brandSlug: value })}
                  />
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <div className="sticky bottom-3 z-30 sm:bottom-4">
        <div className="nz-glass grid gap-3 rounded-2xl border px-4 py-3 shadow-glass-lg sm:px-5">
          <ActionFeedback state={state} />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LayoutTemplate aria-hidden="true" className="size-4" strokeWidth={1.75} />
              {dirty ? (
                <>
                  <span aria-hidden="true" className="size-2 rounded-full bg-warning" />
                  <span className="font-medium text-foreground">
                    <AutoText>Unsaved changes</AutoText>
                  </span>
                </>
              ) : (
                'With every section hidden, the storefront shows its built-in homepage.'
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {dirty ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setRows(saved);
                    setErrors({});
                  }}
                  className="max-sm:min-h-11"
                >
                  <Undo2 aria-hidden="true" strokeWidth={1.75} />
                  <AutoText>Discard</AutoText>
                </Button>
              ) : null}
              <SubmitButton pendingLabel="Saving…" className="max-sm:min-h-11">
                <Save aria-hidden="true" strokeWidth={1.75} />
                <AutoText>Save homepage</AutoText>
              </SubmitButton>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
