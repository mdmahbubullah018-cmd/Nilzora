import { wishlistResponseSchema, type WishlistResponse } from '@nilzora/contracts';
import { functionCallSql } from '../db-rpc';
import type { Pool } from 'pg';
import { withUser } from '../../db/user-context';
import type { SupabaseClients } from '../../supabase/clients';
import { toAdminStoreError } from '../admin/errors';
import { colorView, rpcProductColors, type SummaryColor } from '../catalog/colors';
import { stockView } from '../catalog/store';
import { StoreUnavailableError, isoTimestamp, type DatabaseFailure } from '../commerce/errors';
import { variantKeys } from '../media/images';

/*
 * The customer's wishlist
 * -----------------------
 * One list per account, owned by the database: every call runs a function keyed to the
 * caller (auth.uid()), so this module never decides who may read or change a list. A saved
 * product that is no longer on sale comes back with `product: null`, which the shop shows
 * as unavailable instead of disclosing a product that is no longer public.
 */

type RpcCall = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

type Rpc = <T>(name: string, args: Record<string, unknown>) => Promise<T>;

export interface WishlistStore {
  myWishlist(accessToken: string, userId: string): Promise<WishlistResponse>;
  add(accessToken: string, userId: string, productId: string): Promise<WishlistResponse>;
  remove(accessToken: string, userId: string, productId: string): Promise<WishlistResponse>;
  merge(accessToken: string, userId: string, slugs: readonly string[]): Promise<WishlistResponse>;
}

/** One saved product as the database describes it (a key, not a URL). */
interface StoredWishlistProduct {
  id: string;
  slug: string;
  sku: string;
  name: string;
  summary: string | null;
  priceMinor: number | string;
  compareAtPriceMinor: number | string | null;
  stockQuantity: number;
  maxOrderQuantity: number;
  isFeatured: boolean;
  publishedAt: string | null;
  categorySlug: string;
  categoryName: string;
  brandSlug: string | null;
  brandName: string | null;
  image: {
    id: string;
    storageKey: string;
    alt: string | null;
    width: number;
    height: number;
    position: number;
  } | null;
}

interface StoredWishlistItem {
  productId: string;
  savedAt: string;
  product: StoredWishlistProduct | null;
}

/** The list the function answered, with public URLs built here (only the API knows the host). */
export function toWishlist(
  value: unknown,
  mediaBaseUrl: string | undefined,
  colors: Map<string, SummaryColor[]> = new Map(),
): WishlistResponse {
  const items = (Array.isArray(value) ? (value as StoredWishlistItem[]) : []).map((row) => {
    const product = row.product;
    if (product === null || product === undefined) {
      return { productId: row.productId, savedAt: isoTimestamp(row.savedAt), product: null };
    }
    const image = product.image;
    return {
      productId: row.productId,
      savedAt: isoTimestamp(row.savedAt),
      product: {
        id: product.id,
        slug: product.slug,
        sku: product.sku,
        name: product.name,
        summary: product.summary,
        priceMinor: Number(product.priceMinor),
        compareAtPriceMinor:
          product.compareAtPriceMinor === null ? null : Number(product.compareAtPriceMinor),
        ...stockView({
          stock_quantity: product.stockQuantity,
          max_order_quantity: product.maxOrderQuantity,
        }),
        isFeatured: product.isFeatured,
        category: { slug: product.categorySlug, name: product.categoryName },
        image:
          image === null || mediaBaseUrl === undefined
            ? null
            : (() => {
                const [full, thumb] = variantKeys(image.storageKey);
                return {
                  id: image.id,
                  url: `${mediaBaseUrl}/${full}`,
                  thumbUrl: `${mediaBaseUrl}/${thumb}`,
                  alt: image.alt,
                  width: image.width,
                  height: image.height,
                  position: image.position,
                };
              })(),
        brand:
          product.brandSlug === null || product.brandName === null
            ? null
            : { slug: product.brandSlug, name: product.brandName },
        ...colorView(colors, product.id),
      },
    };
  });
  return wishlistResponseSchema.parse({ items });
}

/** The ids a wishlist answer carries, without duplicates. */
function savedProductIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map((row) => (row as { product?: { id?: unknown } | null } | null)?.product?.id)
    .filter((id): id is string => typeof id === 'string');
  return [...new Set(ids)];
}

/** The same answer, with the card's colour previews read in one extra call. */
async function withColors(
  rpc: Rpc,
  value: unknown,
  mediaBaseUrl: string | undefined,
): Promise<WishlistResponse> {
  return toWishlist(value, mediaBaseUrl, await rpcProductColors(rpc, savedProductIds(value)));
}

function wishlistStoreOver(
  rpcFor: (accessToken: string, userId: string) => Rpc,
  mediaBaseUrl: string | undefined,
): WishlistStore {
  return {
    async myWishlist(accessToken, userId) {
      const rpc = rpcFor(accessToken, userId);
      return withColors(rpc, await rpc('my_wishlist', {}), mediaBaseUrl);
    },
    async add(accessToken, userId, productId) {
      const rpc = rpcFor(accessToken, userId);
      return withColors(rpc, await rpc('wishlist_add', { p_product_id: productId }), mediaBaseUrl);
    },
    async remove(accessToken, userId, productId) {
      const rpc = rpcFor(accessToken, userId);
      return withColors(
        rpc,
        await rpc('wishlist_remove', { p_product_id: productId }),
        mediaBaseUrl,
      );
    },
    async merge(accessToken, userId, slugs) {
      const rpc = rpcFor(accessToken, userId);
      return withColors(rpc, await rpc('wishlist_merge', { p_slugs: [...slugs] }), mediaBaseUrl);
    },
  };
}

export function createSupabaseWishlistStore(
  clients: SupabaseClients,
  { mediaBaseUrl }: { mediaBaseUrl?: string | undefined } = {},
): WishlistStore {
  return wishlistStoreOver((accessToken) => {
    const client = clients.asUser(accessToken);
    const call = client.rpc.bind(client) as unknown as RpcCall;
    return async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      const { data, error } = await call(name, args);
      if (error) throw toAdminStoreError(error as DatabaseFailure, name);
      return data as T;
    };
  }, mediaBaseUrl);
}

export function createPostgresWishlistStore(
  pool: Pool,
  { mediaBaseUrl }: { mediaBaseUrl?: string | undefined } = {},
): WishlistStore {
  return wishlistStoreOver((_accessToken, userId) => {
    return async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      try {
        return await withUser(pool, userId, async (client) => {
          // Positional order is fixed by the call, so a null-ish value is still passed.
          const entries = Object.entries(args);
          // A list goes to PostgreSQL as an array; only a plain object needs JSON text.
          const parameters = entries.map(([, value]) =>
            Array.isArray(value)
              ? value
              : typeof value === 'object' && value !== null
                ? JSON.stringify(value)
                : value,
          );
          const named = entries.map(([key], index) => `${key} => $${index + 1}`).join(', ');
          const result = await client.query<{ value: T }>(
            await functionCallSql(client, name, named),
            parameters,
          );
          const row = result.rows[0];
          if (row === undefined) throw new StoreUnavailableError(`${name} answered with no row`);
          return row.value;
        });
      } catch (error) {
        if (error instanceof StoreUnavailableError) throw error;
        const code = (error as { code?: unknown }).code;
        throw toAdminStoreError(
          {
            code: typeof code === 'string' ? code : '',
            message: error instanceof Error ? error.message : 'database request failed',
            details: null,
          },
          name,
        );
      }
    };
  }, mediaBaseUrl);
}
