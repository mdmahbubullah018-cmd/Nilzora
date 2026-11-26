import type { MetadataRoute } from 'next';
import { brandHref } from '@/lib/catalog-query';
import { siteUrl } from '@/lib/seo';
import { session } from '@/lib/session';
import { getNavigation } from '@/lib/site-content';

/** Managed help pages: listed only once the store has published them. */
const HELP_PAGES: Readonly<Record<string, string>> = {
  returns: '/help/returns',
  shipping: '/help/shipping',
};

/**
 * The sitemap, built from what the store actually publishes: the home page and the pages the
 * API lists as public. A draft, unpublished or hidden product is not listed, and neither is a
 * page a staff member marked as hidden from search.
 *
 * Regenerated on every request for now; the API's own read is short-cached, so this is cheap.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const entries: MetadataRoute.Sitemap = [
    { url: base.toString(), changeFrequency: 'daily', priority: 1 },
    { url: new URL('/products', base).toString(), changeFrequency: 'daily', priority: 0.9 },
    { url: new URL('/categories', base).toString(), changeFrequency: 'weekly', priority: 0.8 },
    { url: new URL('/brands', base).toString(), changeFrequency: 'weekly', priority: 0.6 },
    { url: new URL('/contact', base).toString(), changeFrequency: 'yearly', priority: 0.3 },
    { url: new URL('/about', base).toString(), changeFrequency: 'yearly', priority: 0.4 },
    { url: new URL('/help/faq', base).toString(), changeFrequency: 'monthly', priority: 0.5 },
    { url: new URL('/privacy', base).toString(), changeFrequency: 'yearly', priority: 0.3 },
    { url: new URL('/terms', base).toString(), changeFrequency: 'yearly', priority: 0.3 },
  ];

  // getNavigation never throws: null means the content could not be read.
  for (const page of (await getNavigation())?.pages ?? []) {
    const path = HELP_PAGES[page.slug];
    if (path) {
      entries.push({
        url: new URL(path, base).toString(),
        changeFrequency: 'monthly',
        priority: 0.4,
      });
    }
  }

  try {
    const { entries: rows } = await session.publicApi().sitemap();
    for (const row of rows) {
      const path = row.kind === 'product' ? `/products/${row.slug}` : `/categories/${row.slug}`;
      entries.push({
        url: new URL(path, base).toString(),
        lastModified: new Date(row.lastModified),
        changeFrequency: row.kind === 'product' ? 'weekly' : 'monthly',
        priority: row.kind === 'product' ? 0.7 : 0.6,
      });
    }
  } catch {
    // A sitemap that lists only the fixed pages is better than no sitemap at all.
    console.error('[nilzora] the sitemap could not read the catalogue');
  }

  // Brand pages: only the brands the API lists publicly (an inactive brand is not listed).
  try {
    const { brands } = await session.publicApi().listBrands();
    for (const brand of brands) {
      entries.push({
        url: new URL(brandHref(brand.slug), base).toString(),
        changeFrequency: 'weekly',
        priority: 0.5,
      });
    }
  } catch {
    console.error('[nilzora] the sitemap could not read the brands');
  }

  return entries;
}
