import type { HomepageSection } from '@nilzora/contracts';

/*
 * The home page's order.
 *
 * The store arranges its own page in the admin (which sections show, in what order, with what
 * titles), and `public_homepage()` returns exactly that. The one rule the storefront adds on
 * top is where the promotional section belongs: its banner strip is shown immediately after
 * the hero and the trusted/service strip and before the categories, so what is on offer is
 * met before the catalogue. The discount campaigns beneath that strip are drawn by the
 * categories section itself, so they always follow the categories.
 *
 * Everything else keeps the stored order, and a section the store switched off is not in the
 * list at all, so it never reappears here.
 */
export function saleBeforeCategories(sections: readonly HomepageSection[]): HomepageSection[] {
  const sale = sections.find((entry) => entry.key === 'promotions');
  if (sale === undefined || !sections.some((entry) => entry.key === 'categories')) {
    return [...sections];
  }
  const ordered = sections.filter((entry) => entry.key !== 'promotions');
  const categoriesAt = ordered.findIndex((entry) => entry.key === 'categories');
  ordered.splice(categoriesAt, 0, sale);
  return ordered;
}

/**
 * The page closes with Shop by Brand, then Shop the Collections, then Featured Products —
 * after every other section the store kept. Collections are drawn with the featured block, so
 * the tail reads exactly that way; a store without a featured section still gets the
 * collections band after its brands.
 *
 * The sections in between keep the store's own order, so nothing the store placed
 * deliberately is moved except this one tail.
 */
export function brandsThenFeatured(sections: readonly HomepageSection[]): HomepageSection[] {
  const tail = sections.filter((entry) => entry.key === 'brands' || entry.key === 'featured');
  if (tail.length === 0) return [...sections];
  const rest = sections.filter((entry) => entry.key !== 'brands' && entry.key !== 'featured');
  const brands = tail.filter((entry) => entry.key === 'brands');
  const featured = tail.filter((entry) => entry.key === 'featured');
  return [...rest, ...brands, ...featured];
}
