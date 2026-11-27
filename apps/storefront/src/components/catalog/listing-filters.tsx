import type { Brand, CatalogSort, Category } from '@nilzora/contracts';
import { Button, cn, NativeSelect } from '@nilzora/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { CleanGetForm } from './clean-get-form';
import {
  categoryHref,
  hasActiveFilters,
  listingHref,
  type ListingFilters,
} from '@/lib/catalog-query';

const counts = new Intl.NumberFormat('en-IN');

/*
 * The advanced filter panel shared by every listing (all products, a category, a brand,
 * search). It is a plain GET form, so it works without JavaScript; with it, next/form navigates
 * without a full reload. Applying it always starts again from the first page.
 *
 * The price range lives in the toolbar beside the sort, so it is carried here as hidden values:
 * applying a brand or availability must never drop a price the shopper already chose. Only the
 * filters the API really supports are offered: brand, price range and stock on hand.
 */

const sectionTitle = 'text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase';

export interface ListingFiltersProps {
  /** The listing's own address; the form reloads it with the chosen filters. */
  action: Route;
  filters: ListingFilters;
  /** The sort to keep, and the listing's default (left out of the address). */
  sort: CatalogSort;
  defaultSort: CatalogSort;
  /** Search text to keep (search results only). */
  q?: string;
  /** The collection to keep while filtering inside it. */
  zone?: string | undefined;
  /** Brands to choose from; left out on a brand's own page. */
  brands?: readonly Brand[];
  /** Search only: a category is a filter there, not a page of its own. */
  searchCategories?: { options: readonly Category[]; selected: string | undefined };
  /** Unique per instance: the panel appears in the sidebar and in the mobile sheet. */
  idPrefix: string;
}

function depthLabel(category: Category): string {
  return `${'  '.repeat(Math.max(0, category.depth - 1))}${category.depth > 1 ? '– ' : ''}${category.name}`;
}

export function ListingFiltersForm({
  action,
  filters,
  sort,
  defaultSort,
  q,
  zone,
  brands,
  searchCategories,
  idPrefix,
}: ListingFiltersProps) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const brandOptions = (brands ?? []).filter(
    (brand) => brand.productCount > 0 || brand.slug === filters.brand,
  );
  const clearHref = listingHref(
    action,
    { q, zone, category: searchCategories?.selected, sort },
    defaultSort,
  );

  return (
    <CleanGetForm action={action} className="grid gap-6" aria-label="Filter products">
      {q ? <input type="hidden" name="q" value={q} /> : null}
      {zone ? <input type="hidden" name="zone" value={zone} /> : null}
      {sort !== defaultSort ? <input type="hidden" name="sort" value={sort} /> : null}
      {/* The toolbar's price range and facets, kept as they are while the panel changes
          something else: applying a brand must never drop a size already chosen. */}
      {filters.minTaka !== undefined ? (
        <input type="hidden" name="min" value={filters.minTaka} />
      ) : null}
      {filters.maxTaka !== undefined ? (
        <input type="hidden" name="max" value={filters.maxTaka} />
      ) : null}
      {filters.sizes !== undefined && filters.sizes.length > 0 ? (
        <input type="hidden" name="size" value={filters.sizes.join(',')} />
      ) : null}
      {filters.colors !== undefined && filters.colors.length > 0 ? (
        <input type="hidden" name="color" value={filters.colors.join(',')} />
      ) : null}

      {searchCategories && searchCategories.options.length > 0 ? (
        <div className="grid gap-2">
          <label htmlFor={id('category')} className={sectionTitle}>
            Category
          </label>
          <NativeSelect
            id={id('category')}
            name="category"
            defaultValue={searchCategories.selected ?? ''}
            className="h-11"
          >
            <option value="">All categories</option>
            {searchCategories.options.map((category) => (
              <option key={category.slug} value={category.slug}>
                {depthLabel(category)}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}

      {brandOptions.length > 0 ? (
        <div className="grid gap-2">
          <label htmlFor={id('brand')} className={sectionTitle}>
            Brand
          </label>
          <NativeSelect
            id={id('brand')}
            name="brand"
            defaultValue={filters.brand ?? ''}
            className="h-11"
          >
            <option value="">All brands</option>
            {brandOptions.map((brand) => (
              <option key={brand.slug} value={brand.slug}>
                {brand.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}

      <div className="grid gap-2">
        <p className={sectionTitle}>Availability</p>
        <label
          htmlFor={id('stock')}
          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground has-checked:border-primary has-checked:bg-primary/5"
        >
          <input
            id={id('stock')}
            type="checkbox"
            name="stock"
            value="in"
            defaultChecked={filters.inStock}
            className="size-4 accent-primary"
          />
          In stock only
        </label>
      </div>

      <div className="grid gap-2">
        <Button type="submit" className="w-full">
          Apply filters
        </Button>
        {hasActiveFilters(filters) ? (
          <Link
            href={clearHref}
            className="justify-self-center rounded-sm py-1 text-sm font-semibold text-link underline-offset-4 hover:underline"
          >
            Clear filters
          </Link>
        ) : null}
      </div>
    </CleanGetForm>
  );
}

/**
 * The category tree as links, for browsing listings: each keeps the visitor's filters and
 * sort. The category on screen (or "All products") is marked current.
 */
export function CategoryFilterLinks({
  categories,
  current,
  filters,
  sort,
}: {
  categories: readonly Category[];
  /** A category slug, or 'all' on the all-products page. */
  current: string;
  filters: ListingFilters;
  sort: CatalogSort;
}) {
  if (categories.length === 0) return null;
  const links = [
    { key: 'all', label: 'All products', depth: 1, href: '/products' as Route, count: null },
    ...categories.map((category) => ({
      key: category.slug,
      label: category.name,
      depth: category.depth,
      href: categoryHref(category.slug),
      count: category.totalProductCount ?? category.productCount,
    })),
  ];
  return (
    <nav aria-label="Categories" className="grid gap-2">
      <p className={sectionTitle}>Categories</p>
      <ul role="list" className="grid gap-0.5">
        {links.map((link) => {
          const active = link.key === current;
          return (
            <li key={link.key}>
              <Link
                href={listingHref(link.href, { sort, filters }, 'featured')}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-10 items-center justify-between gap-3 rounded-md px-3 text-sm transition-colors',
                  link.depth === 2 && 'ml-3',
                  link.depth === 3 && 'ml-6',
                  active
                    ? 'bg-brand-navy font-semibold text-brand-soft'
                    : 'text-foreground hover:bg-surface-muted',
                )}
              >
                <span className="min-w-0 truncate">{link.label}</span>
                {link.count !== null ? (
                  <span
                    className={cn(
                      'shrink-0 text-xs tabular-nums',
                      active ? 'text-brand-soft/80' : 'text-muted-foreground',
                    )}
                  >
                    <span className="sr-only">, </span>
                    {counts.format(link.count)}
                    <span className="sr-only">{link.count === 1 ? ' product' : ' products'}</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
