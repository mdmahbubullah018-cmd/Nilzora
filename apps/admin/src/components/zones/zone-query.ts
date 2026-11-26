import type { AdminShoppingZone } from '@nilzora/contracts';

/*
 * The zones page filters in memory: a store has a handful of zones and the API answers them
 * all in one read, so search and visibility are plain GET parameters with their own address.
 */

export const ZONES_PATH = '/admin/zones';

export const ZONE_VIEWS = ['all', 'shown', 'hidden'] as const;
export type ZoneView = (typeof ZONE_VIEWS)[number];

export interface ZoneFilters {
  q: string;
  view: ZoneView;
}

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** Reads the address' filters; anything unknown falls back to showing every zone. */
export function parseZoneFilters(
  params: Record<string, string | string[] | undefined>,
): ZoneFilters {
  const view = single(params.view);
  return {
    q: single(params.q).trim().slice(0, 100),
    view: ZONE_VIEWS.find((candidate) => candidate === view) ?? 'all',
  };
}

/** Name, address, audience or description contains the text, then the visibility. */
export function filterZones(
  zones: readonly AdminShoppingZone[],
  filters: ZoneFilters,
): AdminShoppingZone[] {
  const needle = filters.q.toLowerCase();
  return zones.filter((zone) => {
    if (filters.view === 'shown' && !zone.isActive) return false;
    if (filters.view === 'hidden' && zone.isActive) return false;
    if (needle === '') return true;
    return [zone.name, zone.slug, zone.audience ?? '', zone.description ?? ''].some((text) =>
      text.toLowerCase().includes(needle),
    );
  });
}

export function hasZoneFilters(filters: ZoneFilters): boolean {
  return filters.q !== '' || filters.view !== 'all';
}

/** A zone's address on the storefront, for the "open in the store" link. */
export function zoneStoreHref(slug: string): string {
  return `/products?zone=${encodeURIComponent(slug)}`;
}
