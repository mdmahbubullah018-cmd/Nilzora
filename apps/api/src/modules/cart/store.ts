import {
  cartQuoteSchema,
  checkoutQuoteSchema,
  type CartItem,
  type CartQuote,
  type CheckoutQuote,
} from '@nilzora/contracts';
import type { Pool } from 'pg';
import { withUser } from '../../db/user-context';
import type { SupabaseClients } from '../../supabase/clients';
import { conform, StoreUnavailableError, toStoreError } from '../commerce/errors';
import { createCartLineImages, type CartLineImagesOptions } from './line-images';

/** Prices carts from the live catalog (quote_cart); nothing is reserved or written. */
export interface CartStore {
  /** Anyone's cart, without delivery: public catalog data only. */
  quote(items: CartItem[]): Promise<CartQuote>;
  /**
   * A signed-in customer's cart delivered to one of their own addresses, with the
   * delivery charge and total, and — when a code is given — the coupon the database
   * applies. An unusable code never fails the quote: it comes back in `couponProblem`
   * with the undiscounted totals, so the cart keeps working while the shopper fixes it.
   *
   * `userId` is the verified account id of the caller. The delivery zone comes from an
   * address owned by that account (the database reads `auth.uid()`), never from the
   * request, so the owner cannot be chosen by the client.
   */
  quoteForCustomer(
    accessToken: string,
    userId: string,
    items: CartItem[],
    addressId: string,
    couponCode?: string,
  ): Promise<CheckoutQuote>;
}

/** A plain quote, widened to the checkout shape (no coupon, no discount). */
function asCheckoutQuote(quote: CartQuote): CheckoutQuote {
  return { ...quote, discountMinor: 0, coupon: null, couponProblem: null };
}

export function createSupabaseCartStore(
  clients: SupabaseClients,
  options: CartLineImagesOptions = {},
): CartStore {
  const withLineImages = createCartLineImages(clients, options);
  return {
    async quote(items) {
      const { data, error } = await clients.public().rpc('quote_cart', { p_items: items });
      if (error) throw toStoreError(error, 'quote_cart');
      return withLineImages(conform(cartQuoteSchema, data, 'quote_cart'));
    },

    async quoteForCustomer(accessToken, _userId, items, addressId, couponCode) {
      const user = clients.asUser(accessToken);
      if (couponCode === undefined) {
        const { data, error } = await user.rpc('quote_cart', {
          p_items: items,
          p_address_id: addressId,
        });
        if (error) throw toStoreError(error, 'quote_cart');
        return asCheckoutQuote(await withLineImages(conform(cartQuoteSchema, data, 'quote_cart')));
      }
      const { data, error } = await user.rpc('quote_cart_with_coupon', {
        p_items: items,
        p_address_id: addressId,
        p_coupon_code: couponCode,
      });
      if (error) throw toStoreError(error, 'quote_cart_with_coupon');
      return withLineImages(conform(checkoutQuoteSchema, data, 'quote_cart_with_coupon'));
    },
  };
}

/** PostgreSQL exposes custom SQLSTATEs (`NZ411`, `NZ412`) as a string `code`. */
function pgFailure(error: unknown): { code: string; message: string; details: string | null } {
  const fields = error as { code?: unknown; message?: unknown; detail?: unknown } | null;
  return {
    code: typeof fields?.code === 'string' ? fields.code : '',
    message: typeof fields?.message === 'string' ? fields.message : 'database request failed',
    details: typeof fields?.detail === 'string' ? fields.detail : null,
  };
}

type QuoteRow = { quote: unknown };

/**
 * The cart's user-scoped pricing over a direct PostgreSQL connection.
 *
 * `quote_cart` runs inside `withUser`, so the delivery zone is resolved from an address
 * owned by the verified account (`auth.uid()`); another account's address raises NZ411
 * and is reported as `address_not_found`, exactly as before. Anonymous pricing has no
 * account identity at all, so it keeps using the publishable-key client unchanged.
 *
 * The access token stays in the interface because the other stores still use it as
 * their RLS context; here the verified account id is enough and the token is never read.
 */
export function createPostgresCartStore(
  pool: Pool,
  clients: SupabaseClients,
  options: CartLineImagesOptions = {},
): CartStore {
  const withLineImages = createCartLineImages(clients, options);

  function failure(error: unknown): Error {
    if (error instanceof StoreUnavailableError) return error;
    return toStoreError(pgFailure(error), 'quote_cart');
  }

  return {
    async quote(items) {
      // No RLS identity is involved: the public client is the same `anon` role the
      // publishable key always used, and quote_cart is a security-definer function.
      const { data, error } = await clients.public().rpc('quote_cart', { p_items: items });
      if (error) throw toStoreError(error, 'quote_cart');
      return withLineImages(conform(cartQuoteSchema, data, 'quote_cart'));
    },

    async quoteForCustomer(_accessToken, userId, items, addressId, couponCode) {
      try {
        const quote = await withUser(pool, userId, async (client) => {
          if (couponCode === undefined) {
            const result = await client.query<QuoteRow>(
              'select public.quote_cart($1::jsonb, $2::uuid) as quote',
              [JSON.stringify(items), addressId],
            );
            return asCheckoutQuote(conform(cartQuoteSchema, result.rows[0]?.quote, 'quote_cart'));
          }
          const result = await client.query<QuoteRow>(
            'select public.quote_cart_with_coupon($1::jsonb, $2::uuid, $3::text) as quote',
            [JSON.stringify(items), addressId, couponCode],
          );
          return conform(checkoutQuoteSchema, result.rows[0]?.quote, 'quote_cart_with_coupon');
        });
        // Pictures are public catalogue data, so they are joined on outside the account's
        // transaction rather than extending it with two more round trips.
        return await withLineImages(quote);
      } catch (error) {
        throw failure(error);
      }
    },
  };
}
