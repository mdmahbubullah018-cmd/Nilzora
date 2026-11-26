import { shoppingZonesResponseSchema, type ShoppingZonesResponse } from '@nilzora/contracts';
import type { CatalogCache } from '../../cache';
import type { ZoneStore } from './store';

/*
 * The public shopping-zone list through the catalog cache.
 *
 * Every Home screen (app and website) asks for the active zones, and they change only when an
 * administrator edits a zone or its membership, so the list joins the other page-wide public
 * documents in the cache-aside layer (same TTL, same single-flight load, same Redis-down
 * fallback to the database). Every zone write the workspace can make deletes the catalog keys
 * once it has committed, and so do the existing category and product deletions, because
 * invalidation clears every catalog key. Like the category tree's counts, a zone's
 * `productCount` can trail a product publish by at most the TTL; it is a display count only —
 * listings, prices and stock are never cached.
 *
 * Nothing else changes: one zone's own page, the admin list and every write go straight to the
 * store.
 */

export const SHOPPING_ZONES_CACHE_KEY = 'nilzora:v1:catalog:shopping-zones';

function parseZones(value: unknown): ShoppingZonesResponse | null {
  const parsed = shoppingZonesResponseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** `store` with its public list cached and every write followed by an invalidation. */
export function withZoneCache(store: ZoneStore, cache: CatalogCache): ZoneStore {
  if (!cache.enabled) return store;

  async function written<T>(write: Promise<T>): Promise<T> {
    const result = await write;
    // The committed change is what matters: the cache must not outlive it.
    await cache.invalidate();
    return result;
  }

  return {
    ...store,
    list: () => cache.read(SHOPPING_ZONES_CACHE_KEY, parseZones, () => store.list()),
    save: (...args) => written(store.save(...args)),
    setActive: (...args) => written(store.setActive(...args)),
    delete: (...args) => written(store.delete(...args)),
    setProducts: (...args) => written(store.setProducts(...args)),
    setCategories: (...args) => written(store.setCategories(...args)),
    setBanner: (...args) => written(store.setBanner(...args)),
    setMobileBanner: (...args) => written(store.setMobileBanner(...args)),
    setProductZones: (...args) => written(store.setProductZones(...args)),
    setCategoryZones: (...args) => written(store.setCategoryZones(...args)),
  };
}
