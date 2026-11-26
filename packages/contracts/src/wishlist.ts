import { z } from 'zod';
import { productSummarySchema } from './catalog';
import { slugSchema } from './catalog';

/*
 * The customer's wishlist.
 * ------------------------
 * One list per signed-in account, shared by the website and the app. `product` carries what
 * a card shows and is null when the product is no longer on sale: the shop then says so and
 * offers removal, and nothing about a hidden product (name, price, picture) is disclosed.
 *
 * A guest's device-local list is merged on sign-in: only slugs travel, and the database
 * turns them into products it can still sell.
 */

export const wishlistItemSchema = z.object({
  productId: z.uuid(),
  /** When it was saved, so the newest is first everywhere. */
  savedAt: z.iso.datetime(),
  product: productSummarySchema.nullable(),
});

export const wishlistResponseSchema = z.object({ items: z.array(wishlistItemSchema) });

/** PUT /me/wishlist/:productId, and the body POST /me/wishlist takes. */
export const wishlistAddRequestSchema = z.strictObject({ productId: z.uuid() });

/** POST /me/wishlist/merge — the guest list, as slugs. */
export const wishlistMergeRequestSchema = z.strictObject({
  slugs: z.array(slugSchema).max(200),
});

export type WishlistItem = z.infer<typeof wishlistItemSchema>;
export type WishlistResponse = z.infer<typeof wishlistResponseSchema>;
export type WishlistAddRequest = z.infer<typeof wishlistAddRequestSchema>;
export type WishlistMergeRequest = z.infer<typeof wishlistMergeRequestSchema>;
