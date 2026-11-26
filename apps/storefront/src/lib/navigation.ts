import type { Brand, Category } from '@nilzora/contracts';
import type { Route } from 'next';
import { brandHref, categoryHref, listingHref } from '@/lib/catalog-query';

/*
 * Storefront navigation data
 * --------------------------
 * Built once on the server from the catalog API and handed to the header, the mobile menu,
 * the footer and the home page as plain values. Nothing here is invented: every entry is a
 * category or brand the API published, linked to the page that already lists it.
 */

/** The newest-first product listing; the destination of every "New Arrivals" link. */
export const NEW_ARRIVALS_HREF: Route = listingHref('/products', { sort: 'newest' }, 'featured');

export interface CategoryNode {
  slug: string;
  name: string;
  href: Route;
  children: CategoryNode[];
}

export interface BrandLink {
  slug: string;
  name: string;
  href: Route;
}

/**
 * The published category tree, in the store's own order. A category is attached to its parent
 * when that parent is published too; one whose parent is missing is left out rather than shown
 * as a stray top-level entry, and no category appears twice.
 */
export function categoryTree(categories: readonly Category[]): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>();
  for (const category of categories) {
    if (nodes.has(category.slug)) continue;
    nodes.set(category.slug, {
      slug: category.slug,
      name: category.name,
      href: categoryHref(category.slug),
      children: [],
    });
  }
  const roots: CategoryNode[] = [];
  const placed = new Set<string>();
  for (const category of categories) {
    const node = nodes.get(category.slug);
    if (!node || placed.has(category.slug)) continue;
    if (category.parentSlug === null) {
      roots.push(node);
      placed.add(category.slug);
      continue;
    }
    const parent = nodes.get(category.parentSlug);
    if (parent && parent !== node) {
      parent.children.push(node);
      placed.add(category.slug);
    }
  }
  return roots;
}

/** Brands with at least one product on sale, so no menu entry leads to an empty page. */
export function brandLinks(brands: readonly Brand[]): BrandLink[] {
  return brands
    .filter((brand) => brand.productCount > 0)
    .map((brand) => ({ slug: brand.slug, name: brand.name, href: brandHref(brand.slug) }));
}

/*
 * Men's and Women's collections
 * -----------------------------
 * Products carry no gender or audience field, so the only real classification is the admin's
 * category tree: a top-level department the admin named Men or Women. Nothing is guessed from
 * product names. Until such departments exist, the home page shows no collection.
 */
const AUDIENCE_SLUGS = {
  men: new Set(['men', 'mens']),
  women: new Set(['women', 'womens']),
} as const;

export type Audience = keyof typeof AUDIENCE_SLUGS;

export function audienceDepartment(
  categories: readonly Category[],
  audience: Audience,
): Category | null {
  return (
    categories.find(
      (category) => category.parentSlug === null && AUDIENCE_SLUGS[audience].has(category.slug),
    ) ?? null
  );
}
