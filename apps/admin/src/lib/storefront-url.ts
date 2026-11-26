import { originOf, shareTarget, type ShareTarget } from '@nilzora/contracts';

/*
 * The storefront's address, as the workspace knows it
 * ---------------------------------------------------
 * Sharing from the admin builds a link to the *public* store, never to an admin page. The origin
 * comes from STOREFRONT_URL, and nothing else is trusted for it.
 *
 * Locally the variable may be unset, in which case this falls back to the storefront's own
 * development default — the same address its `siteUrl()` uses. A production build that has not
 * been given a storefront address shares nothing at all: guessing there would put a localhost
 * link, or the wrong store's link, into a customer's hands.
 */

const DEV_STOREFRONT = 'http://localhost:3000';

/** The storefront's origin, or null when this workspace has no address it may use. */
export function storefrontBaseUrl(): string | null {
  const configured = process.env.STOREFRONT_URL?.trim() ?? '';
  if (configured !== '') return originOf(configured);
  return process.env.NODE_ENV === 'production' ? null : DEV_STOREFRONT;
}

/** A product's public page, from its slug; null when there is no public store to point at. */
export function storefrontProductPath(slug: string): string {
  return `/products/${encodeURIComponent(slug)}`;
}

export interface ShareableAdminProduct {
  slug: string;
  name: string;
  summary?: string | null;
  image?: { url: string } | null;
}

/**
 * The public link for one product, or null when the workspace cannot build one.
 *
 * The caller decides *whether* the product may be shared (only a live product has a public page);
 * this only builds the address, and refuses to build one it cannot vouch for.
 */
export function productShareTarget(product: ShareableAdminProduct): ShareTarget | null {
  const base = storefrontBaseUrl();
  if (base === null) return null;
  return shareTarget({
    kind: 'product',
    title: product.name,
    description: product.summary,
    path: storefrontProductPath(product.slug),
    base,
    imageUrl: product.image?.url ?? null,
  });
}
