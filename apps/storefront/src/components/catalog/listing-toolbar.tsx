'use client';

import type { CatalogSort, ProductFacets } from '@nilzora/contracts';
import { Button, cn } from '@nilzora/ui';
import { Check } from 'lucide-react';
import type { Route } from 'next';
import Form from 'next/form';
import Link from 'next/link';
import { useState } from 'react';
import {
  SORT_LABELS,
  listingHref,
  MAX_FILTER_TAKA,
  type ListingFilters,
} from '@/lib/catalog-query';
import { formatMoney } from '@/lib/format';
import { ChipMenu } from './chip-menu';

/*
 * The listing toolbar: Sort, Size, Colour and Price as compact chips on one row.
 *
 * Everything else (category, brand, availability) stays in the advanced panel behind the
 * Filters button beside them, so the row never grows into a wall of controls.
 *
 * Each chip opens its own small panel — a sheet on a phone, a card beside the chip on a wider
 * screen — and every control in it belongs to this one GET form, so a choice is still a plain
 * address the customer could have typed. A chip shows its current value and is tinted while it
 * narrows the list.
 *
 * Size and Colour are drawn only from the values this listing context really offers (the API's
 * variant facets), so a customer never sees a control that would empty the page.
 */

const FIELD =
  'h-10 w-full min-w-0 rounded-lg border border-input-border bg-surface px-3 text-sm text-foreground tabular-nums shadow-xs placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring';
const OPTION =
  'flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm text-foreground transition-colors hover:bg-surface-muted has-checked:font-semibold has-checked:text-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-[-2px] has-focus-visible:outline-primary';

/** "৳500 – ৳1,500", "From ৳500", "Up to ৳1,500" or null when no range is set. */
export function priceRangeLabel(filters: ListingFilters): string | null {
  const taka = (value: number) => formatMoney(value * 100);
  const min = filters.minTaka;
  const max = filters.maxTaka;
  if (min !== undefined && max !== undefined) return `${taka(min)} – ${taka(max)}`;
  if (min !== undefined) return `From ${taka(min)}`;
  if (max !== undefined) return `Up to ${taka(max)}`;
  return null;
}

/** "Sort" while the listing's own order is in force, otherwise the order's name. */
export function sortChipLabel(sort: CatalogSort, defaultSort: CatalogSort): string {
  return sort === defaultSort ? 'Sort' : SORT_LABELS[sort];
}

/** One selectable value in a chip panel. */
function Choice({
  formId,
  type,
  name,
  value,
  label,
  checked,
  swatch,
  count,
  onChange,
}: {
  formId: string;
  type: 'radio' | 'checkbox';
  name: string;
  value: string;
  label: string;
  checked: boolean;
  swatch?: string | null;
  count?: number;
  onChange?: () => void;
}) {
  return (
    <label className={OPTION}>
      <input
        type={type}
        name={name}
        value={value}
        form={formId}
        defaultChecked={checked}
        onChange={onChange}
        className="size-4 shrink-0 accent-primary"
      />
      {swatch === undefined ? null : (
        <span
          aria-hidden="true"
          className="size-4 shrink-0 rounded-full border border-border"
          style={swatch === null ? undefined : { backgroundColor: swatch }}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count === undefined ? null : (
        <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>
      )}
    </label>
  );
}

export interface ListingToolbarProps {
  /** The listing's own address; the form reloads it with the chosen controls. */
  path: Route;
  sorts: readonly CatalogSort[];
  sort: CatalogSort;
  /** The listing's default sort, so a default chip simply reads "Sort". */
  defaultSort: CatalogSort;
  /** Search text to keep (search results only). */
  q?: string | undefined;
  /** A category filter to keep (search results only). */
  category?: string | undefined;
  /** The collection to keep. */
  zone?: string | undefined;
  /** The filters in force. */
  filters: ListingFilters;
  /** The sizes and colours this listing context offers; an empty list draws no chip. */
  facets: ProductFacets;
}

export function ListingToolbar({
  path,
  sorts,
  sort,
  defaultSort,
  q,
  category,
  zone,
  filters,
  facets,
}: ListingToolbarProps) {
  const formId = 'listing-toolbar-form';
  // Which panel is showing. The panel's own controls are only in the DOM while it is open, so
  // the applied value of every *other* dimension is carried by a hidden input: applying a sort
  // or a price never silently drops the sizes, colours or range already in force.
  const [openChip, setOpenChip] = useState<null | 'sort' | 'size' | 'colour' | 'price'>(null);
  const price = priceRangeLabel(filters);
  const sizes = filters.sizes ?? [];
  const colors = filters.colors ?? [];
  const sortActive = sort !== defaultSort;
  const hrefWith = (next: ListingFilters) =>
    listingHref(path, { q, category, zone, sort, filters: next }, defaultSort);
  const chosen = (options: readonly { slug: string; value: string }[], slugs: readonly string[]) =>
    slugs.length === 1
      ? (options.find((option) => option.slug === slugs[0])?.value ?? undefined)
      : undefined;

  return (
    <Form action={path} id={formId} className="flex min-w-0 items-center gap-1.5">
      {q ? <input type="hidden" name="q" value={q} /> : null}
      {category ? <input type="hidden" name="category" value={category} /> : null}
      {zone ? <input type="hidden" name="zone" value={zone} /> : null}
      {filters.brand ? <input type="hidden" name="brand" value={filters.brand} /> : null}
      {filters.inStock ? <input type="hidden" name="stock" value="in" /> : null}
      {openChip === 'size'
        ? null
        : sizes.map((slug) => <input key={slug} type="hidden" name="size" value={slug} />)}
      {openChip === 'colour'
        ? null
        : colors.map((slug) => <input key={slug} type="hidden" name="color" value={slug} />)}
      {openChip === 'price' || filters.minTaka === undefined ? null : (
        <input type="hidden" name="min" value={String(filters.minTaka)} />
      )}
      {openChip === 'price' || filters.maxTaka === undefined ? null : (
        <input type="hidden" name="max" value={String(filters.maxTaka)} />
      )}

      <ChipMenu
        label="Sort"
        title="Sort by"
        active={sortActive}
        value={sortChipLabel(sort, defaultSort)}
        open={openChip === 'sort'}
        onOpenChange={(next) => {
          setOpenChip(next ? 'sort' : null);
        }}
      >
        <div role="radiogroup" aria-label="Sort by" className="grid gap-0.5">
          {sorts.map((option) => (
            <label key={option} className={OPTION}>
              <input
                type="radio"
                name="sort"
                value={option}
                form={formId}
                defaultChecked={option === sort}
                // Choosing an order is the whole action: the list reloads at once.
                onChange={(event) => {
                  event.currentTarget.form?.requestSubmit();
                }}
                className="size-4 shrink-0 accent-primary"
              />
              <span className="flex-1">{SORT_LABELS[option]}</span>
              {option === sort ? (
                <Check aria-hidden="true" className="size-4 text-primary" strokeWidth={2.5} />
              ) : null}
            </label>
          ))}
        </div>
      </ChipMenu>

      {facets.sizes.length === 0 ? null : (
        <ChipMenu
          label="Size"
          title="Size"
          active={sizes.length > 0}
          value={chosen(facets.sizes, sizes) ?? 'Size'}
          count={sizes.length}
          open={openChip === 'size'}
          onOpenChange={(next) => {
            setOpenChip(next ? 'size' : null);
          }}
        >
          <div className="grid gap-0.5">
            {facets.sizes.map((size) => (
              <Choice
                key={size.slug}
                formId={formId}
                type="checkbox"
                name="size"
                value={size.slug}
                label={size.value}
                checked={sizes.includes(size.slug)}
                count={size.productCount}
              />
            ))}
          </div>
          <PanelFooter formId={formId} clearHref={hrefWith({ ...filters, sizes: [] })} />
        </ChipMenu>
      )}

      {facets.colors.length === 0 ? null : (
        <ChipMenu
          label="Colour"
          title="Colour"
          active={colors.length > 0}
          value={chosen(facets.colors, colors) ?? 'Colour'}
          count={colors.length}
          open={openChip === 'colour'}
          onOpenChange={(next) => {
            setOpenChip(next ? 'colour' : null);
          }}
        >
          <div className="grid gap-0.5">
            {facets.colors.map((colour) => (
              <Choice
                key={colour.slug}
                formId={formId}
                type="checkbox"
                name="color"
                value={colour.slug}
                label={colour.value}
                checked={colors.includes(colour.slug)}
                swatch={colour.swatchHex}
                count={colour.productCount}
              />
            ))}
          </div>
          <PanelFooter formId={formId} clearHref={hrefWith({ ...filters, colors: [] })} />
        </ChipMenu>
      )}

      <ChipMenu
        label="Price"
        title="Price"
        active={price !== null}
        value={price ?? 'Price'}
        open={openChip === 'price'}
        onOpenChange={(next) => {
          setOpenChip(next ? 'price' : null);
        }}
      >
        <div className={cn('grid grid-cols-[1fr_auto_1fr] items-center gap-2')}>
          <label htmlFor="listing-price-min" className="sr-only">
            Lowest price in taka
          </label>
          <input
            id="listing-price-min"
            name="min"
            form={formId}
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_FILTER_TAKA}
            step={1}
            placeholder="Min"
            defaultValue={filters.minTaka ?? ''}
            className={FIELD}
          />
          <span aria-hidden="true" className="text-sm text-muted-foreground">
            –
          </span>
          <label htmlFor="listing-price-max" className="sr-only">
            Highest price in taka
          </label>
          <input
            id="listing-price-max"
            name="max"
            form={formId}
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_FILTER_TAKA}
            step={1}
            placeholder="Max"
            defaultValue={filters.maxTaka ?? ''}
            className={FIELD}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Prices in taka.</p>
        <PanelFooter
          formId={formId}
          applyLabel="Apply price"
          clearHref={hrefWith({ ...filters, minTaka: undefined, maxTaka: undefined })}
        />
      </ChipMenu>
    </Form>
  );
}

/** The "Clear" link and the one button that applies a multi-choice panel. */
function PanelFooter({
  formId,
  clearHref,
  applyLabel = 'Show results',
}: {
  formId: string;
  clearHref: Route;
  applyLabel?: string;
}) {
  return (
    <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
      <Link
        href={clearHref}
        className="rounded-sm px-1 text-sm font-semibold text-link underline-offset-4 hover:underline"
      >
        Clear
      </Link>
      <Button type="submit" form={formId} size="sm" className="h-8.5 rounded-full px-4">
        {applyLabel}
      </Button>
    </div>
  );
}
