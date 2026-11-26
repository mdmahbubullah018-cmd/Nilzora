import { z } from 'zod';
import { productSummarySchema } from './catalog';

/*
 * Home-like product discovery for the search page
 * -----------------------------------------------
 * The API ranks, the client renders. Each section carries a fixed label the API has already
 * proved with data: a section with no supporting evidence is simply absent, so nothing on
 * screen is labelled "Best Selling" or "Top Rated" without the orders or reviews behind it.
 */

export const DISCOVERY_SECTION_KEYS = ['best-selling', 'trending', 'top-rated', 'new'] as const;

/** The approved-review evidence behind a product, when it has any. */
export const discoveryRatingSchema = z.object({
  /** Mean of the approved reviews, to two decimals. */
  averageRating: z.number().min(0).max(5),
  reviewCount: z.number().int().min(0),
});

export const discoveryItemSchema = z.object({
  product: productSummarySchema,
  /** Null when no approved review exists: the card then shows no rating at all. */
  rating: discoveryRatingSchema.nullable(),
});

export const discoverySectionSchema = z.object({
  key: z.enum(DISCOVERY_SECTION_KEYS),
  /** The label to show, e.g. "Best Selling". Already earned by the items below it. */
  title: z.string().min(1),
  items: z.array(discoveryItemSchema),
});

export const discoveryResponseSchema = z.object({
  sections: z.array(discoverySectionSchema),
});

export type DiscoverySectionKey = (typeof DISCOVERY_SECTION_KEYS)[number];
export type DiscoveryRating = z.infer<typeof discoveryRatingSchema>;
export type DiscoveryItem = z.infer<typeof discoveryItemSchema>;
export type DiscoverySection = z.infer<typeof discoverySectionSchema>;
export type DiscoveryResponse = z.infer<typeof discoveryResponseSchema>;
