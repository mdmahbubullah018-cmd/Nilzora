import type { AdminBrand } from '@nilzora/contracts';

/*
 * The brands page filters in memory: a store has tens of brands, the API returns them all in
 * one answer, and the search and the visibility filter are plain GET parameters (every view
 * has its own address and works without JavaScript).
 */

export const BRANDS_PATH = '/admin/brands';

export const BRAND_VIEWS = ['all', 'visible', 'hidden', 'no-logo'] as const;
export type BrandView = (typeof BRAND_VIEWS)[number];

export interface BrandFilters {
  q: string;
  view: BrandView;
}

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** Reads the address' filters; anything unknown falls back to showing every brand. */
export function parseBrandFilters(
  params: Record<string, string | string[] | undefined>,
): BrandFilters {
  const view = single(params.view);
  return {
    q: single(params.q).trim().slice(0, 100),
    view: BRAND_VIEWS.find((candidate) => candidate === view) ?? 'all',
  };
}

/** Name, address or description contains the text (case-insensitive), then the view. */
export function filterBrands(brands: readonly AdminBrand[], filters: BrandFilters): AdminBrand[] {
  const needle = filters.q.toLowerCase();
  return brands.filter((brand) => {
    if (filters.view === 'visible' && !brand.isActive) return false;
    if (filters.view === 'hidden' && brand.isActive) return false;
    if (filters.view === 'no-logo' && brand.logo) return false;
    if (needle === '') return true;
    return [brand.name, brand.slug, brand.description ?? ''].some((text) =>
      text.toLowerCase().includes(needle),
    );
  });
}

export function hasBrandFilters(filters: BrandFilters): boolean {
  return filters.q !== '' || filters.view !== 'all';
}
