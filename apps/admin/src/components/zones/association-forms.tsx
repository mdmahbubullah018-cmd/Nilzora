'use client';

import type { AdminCategory, AdminProductSummary } from '@nilzora/contracts';
import { Alert, Button, Input } from '@nilzora/ui';
import { useActionState, useId, useMemo, useState } from 'react';
import type { ActionState } from '@/components/admin-kit/act';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { setZoneCategoriesAction, setZoneProductsAction } from '@/lib/zone-actions';
import { AutoText } from '@/components/i18n/translate';

/*
 * What a zone holds
 * -----------------
 * Two lists with one rule: a ticked row is attached to the zone, an empty list detaches
 * everything. Filtering only hides rows — a hidden row keeps its tick, so narrowing the list
 * never silently drops products the admin did not touch.
 */

const IDLE: ActionState = { status: 'idle' };

interface Row {
  id: string;
  title: string;
  detail: string;
  meta: string;
  note?: string;
}

export function SelectionForm({
  zoneId,
  field,
  rows,
  selected,
  searchLabel,
  emptyLabel,
  submitLabel,
  action,
  csrf,
}: {
  zoneId: string;
  field: 'productIds' | 'categoryIds';
  rows: readonly Row[];
  selected: readonly string[];
  searchLabel: string;
  emptyLabel: string;
  submitLabel: string;
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  csrf: CsrfInput;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const [query, setQuery] = useState('');
  const [onlyChosen, setOnlyChosen] = useState(false);
  const [chosen, setChosen] = useState<readonly string[]>(selected);
  const id = useId();

  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const chosenSet = new Set(chosen);
    return rows.filter((row) => {
      if (onlyChosen && !chosenSet.has(row.id)) return false;
      if (needle === '') return true;
      return `${row.title} ${row.detail} ${row.meta} ${row.note ?? ''}`
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, chosen, onlyChosen, needle]);

  const toggle = (rowId: string, on: boolean) => {
    setChosen((current) =>
      on ? [...current, rowId] : current.filter((value) => value !== rowId),
    );
  };

  return (
    <form action={formAction} className="grid gap-4">
      <CsrfField csrf={csrf} />
      <input type="hidden" name="zoneId" value={zoneId} />
      {state.status !== 'idle' && state.message ? (
        <Alert tone={state.status === 'success' ? 'success' : 'danger'}>
          <span aria-live="polite"><AutoText value={state.message} /></span>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-0 flex-1 gap-1.5">
          <label htmlFor={`${id}-search`} className="text-xs font-semibold text-muted-foreground">
            {searchLabel}
          </label>
          <Input
            id={`${id}-search`}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            checked={onlyChosen}
            onChange={(event) => setOnlyChosen(event.currentTarget.checked)}
            className="size-5 accent-primary-action"
          /><AutoText>Only what is attached</AutoText></label>
      </div>
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {rows.length === 0
          ? emptyLabel
          : `${String(chosen.length)} of ${String(rows.length)} attached · showing ${String(visible.length)}`}
      </p>
      <ul role="list" className="max-h-96 divide-y divide-hairline overflow-y-auto rounded-xl ring-1 ring-hairline">
        {rows.map((row) => {
          const on = chosen.includes(row.id);
          const shown = visible.includes(row);
          return (
            <li key={row.id} hidden={!shown}>
              <label className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-3 px-4 py-3 transition-colors hover:bg-info-soft/40">
                <input
                  type="checkbox"
                  name={field}
                  value={row.id}
                  checked={on}
                  onChange={(event) => toggle(row.id, event.currentTarget.checked)}
                  className="mt-0.5 size-5 accent-primary-action"
                />
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate text-sm font-medium text-foreground"><AutoText value={row.title} /></span>
                  <span className="truncate text-xs text-muted-foreground"><AutoText value={row.detail} /></span>
                  {row.note ? (
                    <span className="text-xs font-medium text-moderator"><AutoText value={row.note} /></span>
                  ) : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end">
        <Button type="submit" loading={pending} className="max-sm:min-h-11 max-sm:w-full">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** The categories whose products a zone inherits (unless a product is pinned elsewhere). */
export function ZoneCategoryPicker({
  zoneId,
  categories,
  selected,
  csrf,
}: {
  zoneId: string;
  categories: readonly AdminCategory[];
  selected: readonly string[];
  csrf: CsrfInput;
}) {
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const rows: Row[] = categories.map((category) => ({
    id: category.id,
    title: category.name,
    detail: `/${category.slug} · ${String(category.productCount)} ${category.productCount === 1 ? 'product' : 'products'}`,
    meta: category.isActive ? 'active' : 'hidden',
    ...(category.parentId && names.has(category.parentId)
      ? { note: `under ${names.get(category.parentId) ?? ''}` }
      : {}),
  }));
  return (
    <SelectionForm
      zoneId={zoneId}
      field="categoryIds"
      rows={rows}
      selected={selected}
      searchLabel="Find a category"
      emptyLabel="There are no categories yet."
      submitLabel="Save categories"
      action={setZoneCategoriesAction}
      csrf={csrf}
    />
  );
}

/** Products pinned to a zone by hand: these win over whatever their category says. */
export function ZoneProductPicker({
  zoneId,
  products,
  selected,
  csrf,
}: {
  zoneId: string;
  products: readonly AdminProductSummary[];
  selected: readonly string[];
  csrf: CsrfInput;
}) {
  const rows: Row[] = products.map((product) => ({
    id: product.id,
    title: product.name,
    detail: `${product.sku} · ${product.category.name}`,
    meta: product.status,
  }));
  return (
    <SelectionForm
      zoneId={zoneId}
      field="productIds"
      rows={rows}
      selected={selected}
      searchLabel="Find a product by name, SKU or category"
      emptyLabel="There are no products in the catalogue yet."
      submitLabel="Save pinned products"
      action={setZoneProductsAction}
      csrf={csrf}
    />
  );
}
