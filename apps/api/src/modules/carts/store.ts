import {
  cartResponseSchema,
  checkoutDetailSchema,
  checkoutListResponseSchema,
  checkoutRecoveryLinkResponseSchema,
  checkoutRecoveryMetricsSchema,
  checkoutRecoveryPreviewSchema,
  checkoutSessionResponseSchema,
  type AdminCheckoutListQuery,
  type CartResponse,
  type CheckoutDetail,
  type CheckoutRecoveryChannel,
  type CheckoutRecoveryLink,
  type CheckoutRecoveryMetrics,
  type CheckoutRecoveryPreview,
  type CheckoutRecoveryState,
  type CheckoutSessionResponse,
  type CheckoutSummary,
} from '@nilzora/contracts';
import { postgresRpc } from '../db-rpc';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { SupabaseClients } from '../../supabase/clients';
import {
  StoreUnavailableError,
  isoTimestamp,
  isoTimestamps,
  toStoreError,
  type DatabaseFailure,
} from '../commerce/errors';
import { toAdminStoreError } from '../admin/errors';

/**
 * The generated client typings enumerate every RPC by name, but both persisted-cart
 * adapters are generic over the function name by design, so the callable is widened
 * once here instead of asserting at every call site.
 */
type RpcCall = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: DatabaseFailure | null }>;

/*
 * Persisted carts and checkout tracking
 * -------------------------------------
 * The cart lives in the database; the storefront cookie and the Android store only
 * identify it. Every call runs one ownership-checking function as the caller, so this
 * module never decides prices, stock or access itself: the quote and order functions
 * remain the only authority on money, and a checkout is converted only after an order
 * really exists.
 */

/** One database function call, as the caller. */
type Rpc = <T>(name: string, args: Record<string, unknown>) => Promise<T>;

export interface SavedCartStore {
  myCart(accessToken: string, userId: string): Promise<CartResponse>;
  guestCart(token: string): Promise<CartResponse | null>;
  /** Creates the guest cart for a handle the client chose, or returns the one it already has. */
  startGuestCart(token: string): Promise<CartResponse>;
  /** Sets a guest line. The handle is the only permission, so it is always required. */
  setGuestItem(
    token: string,
    input: { productId: string; variantId: string | null; quantity: number },
  ): Promise<CartResponse>;
  clearGuestCart(token: string): Promise<void>;
  setItem(
    accessToken: string,
    userId: string,
    input: { productId: string; variantId: string | null; quantity: number },
  ): Promise<CartResponse>;
  clearCart(accessToken: string, userId: string): Promise<CartResponse>;
  mergeGuestCart(accessToken: string, userId: string, token: string): Promise<CartResponse>;
  startCheckout(
    accessToken: string,
    userId: string,
    input: { addressId?: string; couponCode?: string },
  ): Promise<CheckoutSessionResponse>;
  checkoutActivity(accessToken: string, userId: string, sessionId: string): Promise<void>;
  checkoutConverted(accessToken: string, userId: string, orderNumber: string): Promise<void>;
  listCheckouts(
    accessToken: string,
    userId: string,
    query: AdminCheckoutListQuery,
    page: { limit: number; offset: number },
  ): Promise<{ checkouts: CheckoutSummary[]; total: number }>;
  getCheckout(accessToken: string, userId: string, checkoutId: string): Promise<CheckoutDetail | null>;
  /** The summary figures for one reporting window. */
  checkoutMetrics(
    accessToken: string,
    userId: string,
    window: { from: string | null; to: string | null },
  ): Promise<CheckoutRecoveryMetrics>;
  recordCheckoutAttempt(
    accessToken: string,
    userId: string,
    checkoutId: string,
    input: { channel: CheckoutRecoveryChannel; note?: string },
  ): Promise<CheckoutDetail>;
  setCheckoutRecoveryState(
    accessToken: string,
    userId: string,
    checkoutId: string,
    state: CheckoutRecoveryState,
  ): Promise<CheckoutDetail>;
  /** Mints a single-use link. The token is returned once and is never readable again. */
  createCheckoutRecoveryLink(
    accessToken: string,
    userId: string,
    checkoutId: string,
  ): Promise<CheckoutRecoveryLink>;
  revokeCheckoutRecoveryLink(
    accessToken: string,
    userId: string,
    checkoutId: string,
  ): Promise<CheckoutDetail>;
  /** Works without a session: the link is the capability, and it reveals no personal data. */
  previewRecovery(token: string): Promise<CheckoutRecoveryPreview>;
  restoreRecovery(
    accessToken: string,
    userId: string,
    token: string,
  ): Promise<{
    checkoutId: string;
    restoredLines: number;
    lines: { productId: string; variantId: string | null; quantity: number }[];
  }>;
}

interface CartRow {
  id: string;
  status: string;
  last_activity_at: string | Date;
  lines: unknown;
}

interface CheckoutRow {
  id: string;
  status: string;
  recovery_state?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  item_count: number | string;
  coupon_code: string | null;
  cart_value_minor?: number | string | null;
  started_at: string | Date;
  last_activity_at: string | Date;
  abandoned_at?: string | Date | null;
  converted_at?: string | Date | null;
  order_number?: string | null;
  attempt_count?: number | string | null;
  total_count?: number | string | null;
}

const idSchema = z.uuid();

const linesSchema = z.array(
  z.object({
    productId: z.uuid(),
    variantId: z.uuid().nullable(),
    quantity: z.number(),
  }),
);

function toIso(value: string | Date): string {
  return isoTimestamp(value);
}

/** The row a snapshot RPC returned, mapped to the contract. */
export function toCart(row: CartRow): CartResponse {
  return cartResponseSchema.parse({
    cart: {
      id: row.id,
      status: row.status,
      lines: linesSchema.parse(row.lines ?? []),
      lastActivityAt: toIso(row.last_activity_at),
    },
  });
}

/** Reads a cart by id, as the signed-in owner. */
async function readCart(rpc: Rpc, cartId: string): Promise<CartResponse> {
  const rows = await rpc<CartRow[]>('cart_snapshot', { p_cart_id: cartId });
  const row = rows[0];
  if (!row) throw new StoreUnavailableError('cart_snapshot answered with no row');
  return toCart(row);
}

function savedCartStoreOver(rpcFor: (accessToken: string | null, userId: string | null) => Rpc): SavedCartStore {
  return {
    async myCart(accessToken, userId) {
      const rpc = rpcFor(accessToken, userId);
      const cartId = idSchema.parse(await rpc<unknown>('my_cart', {}));
      return readCart(rpc, cartId);
    },

    async guestCart(token) {
      const rows = await rpcFor(null, null)<CartRow[]>('guest_cart_snapshot', { p_token: token });
      const row = rows[0];
      return row ? toCart(row) : null;
    },

    async startGuestCart(token) {
      const rpc = rpcFor(null, null);
      // Idempotent: the function answers the same cart for a handle it already knows.
      idSchema.parse(await rpc<unknown>('start_guest_cart', { p_token: token }));
      const rows = await rpc<CartRow[]>('guest_cart_snapshot', { p_token: token });
      const row = rows[0];
      if (!row) throw new StoreUnavailableError('guest_cart_snapshot answered with no row');
      return toCart(row);
    },

    async setItem(accessToken, userId, input) {
      const rpc = rpcFor(accessToken, userId);
      const cartId = idSchema.parse(
        await rpc<unknown>('cart_set_item', {
          p_product_id: input.productId,
          p_variant_id: input.variantId,
          p_quantity: input.quantity,
        }),
      );
      return readCart(rpc, cartId);
    },

    async setGuestItem(token, input) {
      const rpc = rpcFor(null, null);
      await rpc<unknown>('guest_cart_set_item', {
        p_token: token,
        p_product_id: input.productId,
        p_variant_id: input.variantId,
        p_quantity: input.quantity,
      });
      const rows = await rpc<CartRow[]>('guest_cart_snapshot', { p_token: token });
      const row = rows[0];
      if (!row) throw new StoreUnavailableError('guest_cart_snapshot answered with no row');
      return toCart(row);
    },

    async clearGuestCart(token) {
      await rpcFor(null, null)('guest_cart_clear', { p_token: token });
    },

    async clearCart(accessToken, userId) {
      const rpc = rpcFor(accessToken, userId);
      const cartId = idSchema.parse(await rpc<unknown>('my_cart', {}));
      await rpc<unknown>('cart_clear', {});
      return readCart(rpc, cartId);
    },

    async mergeGuestCart(accessToken, userId, token) {
      const rpc = rpcFor(accessToken, userId);
      const cartId = idSchema.parse(await rpc<unknown>('merge_guest_cart', { p_token: token }));
      return readCart(rpc, cartId);
    },

    async startCheckout(accessToken, userId, input) {
      const rpc = rpcFor(accessToken, userId);
      const sessionId = idSchema.parse(
        await rpc<unknown>('checkout_start', {
          ...(input.addressId === undefined ? {} : { p_address_id: input.addressId }),
          ...(input.couponCode === undefined ? {} : { p_coupon_code: input.couponCode }),
        }),
      );
      const session = await rpc<unknown>('checkout_session', { p_session_id: sessionId });
      if (session === null) throw new StoreUnavailableError('checkout_session answered with no row');
      const parsed = z
        .object({
          id: z.uuid(),
          status: z.string(),
          startedAt: z.iso.datetime(),
          lastActivityAt: z.iso.datetime(),
        })
        .parse({
          ...session as Record<string, unknown>,
          // The database writes timestamps with an offset; the contract wants the `Z` form.
          startedAt: toIso((session as { startedAt: string | Date }).startedAt),
          lastActivityAt: toIso((session as { lastActivityAt: string | Date }).lastActivityAt),
        });
      return checkoutSessionResponseSchema.parse({ checkout: parsed });
    },

    async checkoutActivity(accessToken, userId, sessionId) {
      await rpcFor(accessToken, userId)('checkout_activity', { p_session_id: sessionId });
    },

    async checkoutConverted(accessToken, userId, orderNumber) {
      await rpcFor(accessToken, userId)('checkout_converted', { p_order_number: orderNumber });
    },

    async listCheckouts(accessToken, userId, query, page) {
      const rows = await rpcFor(accessToken, userId)<CheckoutRow[]>('admin_abandoned_checkouts', {
        p_status: query.status === 'all' ? null : query.status,
        p_query: query.q === '' ? null : query.q,
        p_from: query.from === '' ? null : query.from,
        p_to: query.to === '' ? null : query.to,
        p_sort: query.sort,
        p_limit: page.limit,
        p_offset: page.offset,
      });
      const list = rows ?? [];
      const total = list.length === 0 ? 0 : Number(list[0]?.total_count ?? list.length);
      const checkouts = list.map((row) =>
        checkoutListResponseSchema.shape.checkouts.element.parse({
          id: row.id,
          status: row.status,
          recoveryState: row.recovery_state,
          customerName: row.customer_name ?? null,
          customerPhone: row.customer_phone ?? null,
          itemCount: Number(row.item_count),
          couponCode: row.coupon_code,
          cartValueMinor: Number(row.cart_value_minor ?? 0),
          startedAt: toIso(row.started_at),
          lastActivityAt: toIso(row.last_activity_at),
          abandonedAt: row.abandoned_at === null || row.abandoned_at === undefined ? null : toIso(row.abandoned_at),
          convertedAt: row.converted_at === null || row.converted_at === undefined ? null : toIso(row.converted_at),
          orderNumber: row.order_number ?? null,
          attemptCount: Number(row.attempt_count ?? 0),
        }),
      );
      return { checkouts, total };
    },

    async getCheckout(accessToken, userId, checkoutId) {
      const data = await rpcFor(accessToken, userId)<unknown>('admin_abandoned_checkout', {
        p_session_id: checkoutId,
      });
      return data === null ? null : checkoutDetailSchema.parse(isoTimestamps(data));
    },

    async checkoutMetrics(accessToken, userId, window) {
      const data = await rpcFor(accessToken, userId)<unknown>('admin_checkout_recovery_metrics', {
        p_from: window.from,
        p_to: window.to,
      });
      return checkoutRecoveryMetricsSchema.parse(isoTimestamps(data));
    },

    async recordCheckoutAttempt(accessToken, userId, checkoutId, input) {
      const data = await rpcFor(accessToken, userId)<unknown>('admin_record_recovery_attempt', {
        p_session_id: checkoutId,
        p_channel: input.channel,
        p_note: input.note === undefined ? null : input.note,
      });
      return checkoutDetailSchema.parse(isoTimestamps(data));
    },

    async setCheckoutRecoveryState(accessToken, userId, checkoutId, state) {
      const data = await rpcFor(accessToken, userId)<unknown>('admin_set_recovery_state', {
        p_session_id: checkoutId,
        p_state: state,
      });
      return checkoutDetailSchema.parse(isoTimestamps(data));
    },

    async createCheckoutRecoveryLink(accessToken, userId, checkoutId) {
      const data = await rpcFor(accessToken, userId)<unknown>('admin_create_recovery_link', {
        p_session_id: checkoutId,
      });
      return checkoutRecoveryLinkResponseSchema.parse(isoTimestamps(data));
    },

    async revokeCheckoutRecoveryLink(accessToken, userId, checkoutId) {
      const data = await rpcFor(accessToken, userId)<unknown>('admin_revoke_recovery_link', {
        p_session_id: checkoutId,
      });
      return checkoutDetailSchema.parse(isoTimestamps(data));
    },

    async previewRecovery(token) {
      // No session: the link is the capability. Grant execute to anon is the whole of the
      // authorization, and the function returns no personal data.
      const data = await rpcFor(null, null)<unknown>('checkout_recovery_preview', { p_token: token });
      return checkoutRecoveryPreviewSchema.parse(isoTimestamps(data));
    },

    async restoreRecovery(accessToken, userId, token) {
      const rpc = rpcFor(accessToken, userId);
      const data = z
        .object({
          checkoutId: z.uuid(),
          lines: z.array(
            z.object({
              productId: z.uuid(),
              variantId: z.uuid().nullable(),
              quantity: z.number().int().min(1),
              existingQuantity: z.number().int().min(0),
            }),
          ),
        })
        .parse(await rpc<unknown>('checkout_recovery_restore', { p_token: token }));
      let restored = 0;
      const restoredLines: { productId: string; variantId: string | null; quantity: number }[] = [];
      for (const line of data.lines) {
        // Adding, not replacing: the customer may have put something in the cart since.
        const quantity = Math.min(100, line.existingQuantity + line.quantity);
        await rpc('cart_set_item', {
          p_product_id: line.productId,
          p_variant_id: line.variantId,
          p_quantity: quantity,
        });
        restoredLines.push({
          productId: line.productId,
          variantId: line.variantId,
          quantity: line.quantity,
        });
        restored += 1;
      }
      return { checkoutId: data.checkoutId, restoredLines: restored, lines: restoredLines };
    },
  };
}

/**
 * The staff checkout queue answers with the admin refusal codes (NZ403 forbidden, NZ404 not
 * found); every other function here is the customer cart, whose NZ490/NZ491 mean "that line
 * cannot be added" and "that guest handle is unusable". The admin map would turn those into
 * campaign errors, so the translator is chosen per function.
 */
const STAFF_FUNCTIONS: ReadonlySet<string> = new Set([
  'admin_list_checkouts',
  'admin_get_checkout',
  'admin_abandoned_checkouts',
  'admin_abandoned_checkout',
  'admin_checkout_recovery_metrics',
  'admin_record_recovery_attempt',
  'admin_set_recovery_state',
  'admin_create_recovery_link',
  'admin_revoke_recovery_link',
]);

export function translateCartFailure(failure: DatabaseFailure, operation: string): Error {
  return STAFF_FUNCTIONS.has(operation)
    ? toAdminStoreError(failure, operation)
    : toStoreError(failure, operation);
}

export function createSupabaseSavedCartStore(clients: SupabaseClients): SavedCartStore {
  return savedCartStoreOver((accessToken) => {
    const client = clients.asUser(accessToken ?? '');
    const call = client.rpc.bind(client) as unknown as RpcCall;
    return async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      const { data, error } = await call(name, args);
      if (error) throw translateCartFailure(error, name);
      return data as T;
    };
  });
}

export function createPostgresSavedCartStore(pool: Pool): SavedCartStore {
  /*
   * Nulls are sent as SQL NULL: cart_set_item and guest_cart_set_item have no default for
   * p_variant_id, so a simple-product line (variantId null) must still name the argument.
   * The optional checkout arguments are only present when the caller gave them.
   */
  const asUser = postgresRpc(pool, translateCartFailure, { keepNulls: true });
  return savedCartStoreOver((_accessToken, userId) => asUser(userId));
}
