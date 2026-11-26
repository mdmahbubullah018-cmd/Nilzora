import type { ProductSummary } from '@nilzora/contracts';

/*
 * Search suggestions
 * ------------------
 * The API has no separate suggestion service, so suggestions are the first few products the
 * real search returns for what the visitor has typed so far: every one is a product on sale,
 * found by the same search the results page runs. Nothing is made up and nothing is "popular".
 */

/** Fewer characters than this ask nothing: one letter matches too much to be useful. */
export const MIN_SUGGEST_LENGTH = 2;

/** How many products a suggestion list shows. */
export const SUGGEST_LIMIT = 6;

export interface SearchSuggestion {
  slug: string;
  name: string;
  priceMinor: number;
  compareAtPriceMinor: number | null;
  categoryName: string;
  brandName: string | null;
  /** The product's thumbnail, or null for the placeholder. */
  imageUrl: string | null;
  soldOut: boolean;
}

export interface SuggestionResponse {
  /** The text the answer is for, so a late answer to older text can be told apart. */
  query: string;
  items: SearchSuggestion[];
  /** Every match, of which `items` are the first. */
  total: number;
}

export function toSuggestion(product: ProductSummary): SearchSuggestion {
  return {
    slug: product.slug,
    name: product.name,
    priceMinor: product.priceMinor,
    compareAtPriceMinor: product.compareAtPriceMinor,
    categoryName: product.category.name,
    brandName: product.brand?.name ?? null,
    imageUrl: product.image?.thumbUrl ?? null,
    soldOut: product.availability === 'out_of_stock',
  };
}

/** A suggestion answer from the route, checked field by field; null when it is not one. */
export function parseSuggestionResponse(value: unknown): SuggestionResponse | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as Record<string, unknown>;
  if (typeof body.query !== 'string' || typeof body.total !== 'number') return null;
  if (!Array.isArray(body.items)) return null;
  const items: SearchSuggestion[] = [];
  for (const entry of body.items as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return null;
    const item = entry as Record<string, unknown>;
    if (
      typeof item.slug !== 'string' ||
      typeof item.name !== 'string' ||
      typeof item.priceMinor !== 'number' ||
      (item.compareAtPriceMinor !== null && typeof item.compareAtPriceMinor !== 'number') ||
      typeof item.categoryName !== 'string' ||
      (item.brandName !== null && typeof item.brandName !== 'string') ||
      (item.imageUrl !== null && typeof item.imageUrl !== 'string') ||
      typeof item.soldOut !== 'boolean'
    ) {
      return null;
    }
    items.push({
      slug: item.slug,
      name: item.name,
      priceMinor: item.priceMinor,
      compareAtPriceMinor: item.compareAtPriceMinor,
      categoryName: item.categoryName,
      brandName: item.brandName,
      imageUrl: item.imageUrl,
      soldOut: item.soldOut,
    });
  }
  return { query: body.query, items, total: body.total };
}
