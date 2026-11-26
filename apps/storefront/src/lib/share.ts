import { shareTarget, type ShareTarget } from '@nilzora/contracts';
import { brandHref, categoryHref, productHref } from './catalog-query';
import { siteUrl } from './site-url';

/*
 * What the storefront shares
 * --------------------------
 * The storefront's own share targets, built from the records it is already showing. Every one of
 * them points at this site's configured origin (`NEXT_PUBLIC_SITE_URL`) and at a public path, so a
 * shared link can never name the admin workspace, an account page, a checkout or another host.
 *
 * The builders take exactly the fields they use, so a card (which knows less about a product than
 * its page does) can share the same address without inventing anything: no price, no discount and
 * no availability claim is ever put into shared text.
 */

/** The picture fields the catalogue objects use; the storefront only needs the address. */
interface Picture {
  url: string;
}

export interface ShareableProduct {
  slug: string;
  name: string;
  summary?: string | null;
  image?: Picture | null;
}

export interface ShareableCategory {
  slug: string;
  name: string;
  description?: string | null;
  image?: Picture | null;
}

export interface ShareableBrand {
  slug: string;
  name: string;
  description?: string | null;
  logo?: Picture | null;
}

export function productShareTarget(product: ShareableProduct): ShareTarget | null {
  return shareTarget({
    kind: 'product',
    title: product.name,
    description: product.summary,
    path: productHref(product.slug),
    base: siteUrl().toString(),
    imageUrl: product.image?.url ?? null,
  });
}

export function categoryShareTarget(category: ShareableCategory): ShareTarget | null {
  return shareTarget({
    kind: 'category',
    title: category.name,
    description: category.description,
    path: categoryHref(category.slug),
    base: siteUrl().toString(),
    imageUrl: category.image?.url ?? null,
  });
}

export function brandShareTarget(brand: ShareableBrand): ShareTarget | null {
  return shareTarget({
    kind: 'brand',
    title: brand.name,
    description: brand.description,
    path: brandHref(brand.slug),
    base: siteUrl().toString(),
    imageUrl: brand.logo?.url ?? null,
  });
}
