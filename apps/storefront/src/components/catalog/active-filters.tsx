import type { CatalogSort } from '@nilzora/contracts';
import { X } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { listingHref, NO_FILTERS, type ListingFilters } from '@/lib/catalog-query';
import { formatMoney } from '@/lib/format';

export interface FilterChip {
  /** What the filter does, e.g. "Brand: Aarong". */
  label: string;
  /** The same listing without this filter. */
  href: Route;
}

export interface ChipSource {
  path: Route;
  filters: ListingFilters;
  sort: CatalogSort;
  /** The listing's default sort for a given set of filters (search changes it). */
  defaultSortFor: (filters: ListingFilters) => CatalogSort;
  q?: string;
  /** Search only: the category filter, with its name. */
  category?: { slug: string; name: string } | undefined;
  /** The collection the listing is narrowed to, with its name. */
  zone?: { slug: string; name: string } | undefined;
  /** The chosen brand's name, when it is known. */
  brandName?: string | undefined;
  /** The words for each chosen size and colour slug, when the facets supplied them. */
  facetLabels?: {
    sizes?: Readonly<Record<string, string>>;
    colors?: Readonly<Record<string, string>>;
  };
  /** The sort to use once a filter is gone, when the current one no longer applies. */
  sortAfter?: (filters: ListingFilters) => CatalogSort;
}

function priceLabel({ minTaka, maxTaka }: ListingFilters): string | null {
  const taka = (value: number) => formatMoney(value * 100);
  if (minTaka !== undefined && maxTaka !== undefined) return `${taka(minTaka)} – ${taka(maxTaka)}`;
  if (minTaka !== undefined) return `From ${taka(minTaka)}`;
  if (maxTaka !== undefined) return `Up to ${taka(maxTaka)}`;
  return null;
}

/** One removable chip per active filter, each linking to the listing without it. */
export function filterChips(source: ChipSource): FilterChip[] {
  const { path, filters, q, category, zone } = source;
  const href = (next: ListingFilters, keepCategory = true): Route => {
    const sort = source.sortAfter ? source.sortAfter(next) : source.sort;
    return listingHref(
      path,
      {
        q,
        category: keepCategory ? category?.slug : undefined,
        zone: zone?.slug,
        sort,
        filters: next,
      },
      source.defaultSortFor(next),
    );
  };
  const chips: FilterChip[] = [];
  if (zone) {
    // Dropping the collection keeps the other filters: they still describe what is wanted.
    chips.push({
      label: `Collection: ${zone.name}`,
      href: listingHref(
        path,
        { q, category: category?.slug, sort: source.sort, filters },
        source.defaultSortFor(filters),
      ),
    });
  }
  if (category) chips.push({ label: `In ${category.name}`, href: href(filters, false) });
  if (filters.brand) {
    chips.push({
      label: `Brand: ${source.brandName ?? filters.brand}`,
      href: href({ ...filters, brand: undefined }),
    });
  }
  const price = priceLabel(filters);
  if (price) {
    chips.push({
      label: price,
      href: href({ ...filters, minTaka: undefined, maxTaka: undefined }),
    });
  }
  // One removable chip per chosen value, so a shopper can drop a single size or colour.
  for (const slug of filters.sizes ?? []) {
    chips.push({
      label: `Size: ${source.facetLabels?.sizes?.[slug] ?? slug.toUpperCase()}`,
      href: href({
        ...filters,
        sizes: (filters.sizes ?? []).filter((entry) => entry !== slug),
      }),
    });
  }
  for (const slug of filters.colors ?? []) {
    chips.push({
      label: `Colour: ${source.facetLabels?.colors?.[slug] ?? slug}`,
      href: href({
        ...filters,
        colors: (filters.colors ?? []).filter((entry) => entry !== slug),
      }),
    });
  }
  if (filters.inStock)
    chips.push({ label: 'In stock only', href: href({ ...filters, inStock: false }) });
  return chips;
}

/** The address with every filter removed (the collection, the search text and sort stay). */
export function clearFiltersHref(source: ChipSource): Route {
  const sort = source.sortAfter ? source.sortAfter(NO_FILTERS) : source.sort;
  return listingHref(
    source.path,
    { q: source.q, zone: source.zone?.slug, sort, filters: NO_FILTERS },
    source.defaultSortFor(NO_FILTERS),
  );
}

/** The active filters as removable chips, with "Clear all". Nothing when no filter is on. */
export function ActiveFilters({ source }: { source: ChipSource }) {
  const chips = filterChips(source);
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="sr-only">Active filters</p>
      <ul role="list" className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li key={chip.label}>
            <Link
              href={chip.href}
              aria-label={`Remove filter: ${chip.label}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/8 pr-2.5 pl-3.5 text-sm font-medium text-foreground transition-colors hover:border-primary hover:bg-primary/12"
            >
              {chip.label}
              <X aria-hidden="true" className="size-3.5 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
      {chips.length > 1 ? (
        <Link
          href={clearFiltersHref(source)}
          className="rounded-sm px-1 text-sm font-semibold text-link underline-offset-4 hover:underline"
        >
          Clear all
        </Link>
      ) : null}
    </div>
  );
}
