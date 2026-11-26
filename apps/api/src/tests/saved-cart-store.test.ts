import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AdminRefusalError } from '../modules/admin/errors';
import { createPostgresSavedCartStore, createSupabaseSavedCartStore } from '../modules/carts/store';
import { CommerceRefusalError } from '../modules/commerce/errors';
import type { SupabaseClients } from '../supabase/clients';

/*
 * How the saved-cart store reaches the database, in both modes. The customer cart functions
 * raise NZ490/NZ491/NZ470/NZ471, which must surface as cart errors (the storefront's guest
 * handle recovery relies on `cart_guest_token_invalid`); the same codes mean campaign errors
 * in the admin map, which only the staff checkout queue should use. In direct-Postgres mode,
 * `variantId: null` must still name `p_variant_id`, because cart_set_item has no default.
 */

const USER = '11111111-1111-4111-8111-111111111111';
const TOKEN = '33333333-3333-4333-8333-333333333333';
const PRODUCT = '44444444-4444-4444-8444-444444444444';
const CART = '55555555-5555-4555-8555-555555555555';

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to fail');
}

function supabaseStore(code: string) {
  const rpc = vi.fn(() =>
    Promise.resolve({ data: null, error: { code, message: 'database text' } }),
  );
  const clients = { asUser: () => ({ rpc }) } as unknown as SupabaseClients;
  return createSupabaseSavedCartStore(clients);
}

describe('Supabase saved-cart store error mapping', () => {
  it.each([
    ['NZ490', 'cart_line_invalid'],
    ['NZ470', 'variant_invalid'],
    ['NZ471', 'variant_required'],
    ['NZ412', 'cart_invalid'],
  ])('maps %s on a signed-in cart line to %s', async (code, refusal) => {
    const error = await failure(
      supabaseStore(code).setItem('token', USER, {
        productId: PRODUCT,
        variantId: null,
        quantity: 1,
      }),
    );
    expect(error).toBeInstanceOf(CommerceRefusalError);
    expect((error as CommerceRefusalError).refusal).toBe(refusal);
  });

  it.each([
    ['NZ491', 'cart_guest_token_invalid'],
    ['NZ490', 'cart_line_invalid'],
    ['NZ471', 'variant_required'],
  ])('maps %s on a guest cart line to %s', async (code, refusal) => {
    const error = await failure(
      supabaseStore(code).setGuestItem(TOKEN, { productId: PRODUCT, variantId: null, quantity: 1 }),
    );
    expect(error).toBeInstanceOf(CommerceRefusalError);
    expect((error as CommerceRefusalError).refusal).toBe(refusal);
  });

  it('maps a guest merge refusal the same way', async () => {
    const error = await failure(supabaseStore('NZ491').mergeGuestCart('token', USER, TOKEN));
    expect((error as CommerceRefusalError).refusal).toBe('cart_guest_token_invalid');
  });

  it('keeps the admin map for the staff checkout queue', async () => {
    const store = supabaseStore('NZ403');
    const listed = await failure(
      store.listCheckouts(
        'token',
        USER,
        { status: 'all', q: '', page: 1, pageSize: 20 },
        { limit: 20, offset: 0 },
      ),
    );
    expect(listed).toBeInstanceOf(AdminRefusalError);
    expect((listed as AdminRefusalError).refusal).toBe('missing_permission');

    const missing = await failure(supabaseStore('NZ404').getCheckout('token', USER, PRODUCT));
    expect((missing as AdminRefusalError).refusal).toBe('not_found');
  });
});

/** A pool that records function calls and answers each function from a script. */
function fakePool(script: Record<string, { value?: unknown; code?: string }>) {
  const calls: { sql: string; params: unknown[] | undefined }[] = [];
  const query = vi.fn((sql: string, params?: unknown[]) => {
    if (sql.includes('proretset')) {
      return Promise.resolve({ rows: [{ retset: String(params?.[0]) === 'cart_snapshot' }] });
    }
    if (sql.includes('proargnames')) return Promise.resolve({ rows: [] });
    const match = /public\.(\w+)\(/.exec(sql);
    if (match === null) return Promise.resolve({ rows: [] });
    calls.push({ sql, params });
    const answer = script[match[1] ?? ''];
    if (answer?.code !== undefined) {
      return Promise.reject(Object.assign(new Error('database text'), { code: answer.code }));
    }
    return Promise.resolve({ rows: [{ value: answer?.value ?? null }] });
  });
  const client = { query, release: vi.fn() };
  return { pool: { connect: () => Promise.resolve(client) } as unknown as Pool, calls };
}

const SNAPSHOT = [
  {
    id: CART,
    status: 'active',
    last_activity_at: '2026-11-05T10:00:00.000Z',
    lines: [{ productId: PRODUCT, variantId: null, quantity: 1 }],
  },
];

describe('direct-Postgres saved-cart store', () => {
  it('names p_variant_id as NULL for a simple-product line (it has no default)', async () => {
    const { pool, calls } = fakePool({
      cart_set_item: { value: CART },
      cart_snapshot: { value: SNAPSHOT },
    });
    await createPostgresSavedCartStore(pool).setItem('token', USER, {
      productId: PRODUCT,
      variantId: null,
      quantity: 1,
    });
    const write = calls.find((call) => call.sql.includes('cart_set_item'));
    expect(write?.sql).toContain('p_variant_id => $2');
    expect(write?.params).toEqual([PRODUCT, null, 1]);
  });

  it('names p_variant_id as NULL for a guest line too', async () => {
    const { pool, calls } = fakePool({
      guest_cart_set_item: { value: CART },
      guest_cart_snapshot: { value: SNAPSHOT },
    });
    await createPostgresSavedCartStore(pool).setGuestItem(TOKEN, {
      productId: PRODUCT,
      variantId: null,
      quantity: 2,
    });
    const write = calls.find((call) => call.sql.includes('guest_cart_set_item'));
    expect(write?.sql).toContain('p_variant_id => $3');
    expect(write?.params).toEqual([TOKEN, PRODUCT, null, 2]);
  });

  it('still omits the optional checkout arguments that were not given', async () => {
    const { pool, calls } = fakePool({
      checkout_start: { value: CART },
      checkout_session: {
        value: {
          id: CART,
          status: 'started',
          startedAt: '2026-11-05T10:00:00.000Z',
          lastActivityAt: '2026-11-05T10:00:00.000Z',
        },
      },
    });
    await createPostgresSavedCartStore(pool).startCheckout('token', USER, {});
    expect(calls.find((call) => call.sql.includes('checkout_start'))?.params).toEqual([]);
  });

  it.each([
    ['NZ490', 'cart_line_invalid'],
    ['NZ470', 'variant_invalid'],
    ['NZ471', 'variant_required'],
  ])('maps %s to %s', async (code, refusal) => {
    const { pool } = fakePool({ cart_set_item: { code } });
    const error = await failure(
      createPostgresSavedCartStore(pool).setItem('token', USER, {
        productId: PRODUCT,
        variantId: null,
        quantity: 1,
      }),
    );
    expect(error).toBeInstanceOf(CommerceRefusalError);
    expect((error as CommerceRefusalError).refusal).toBe(refusal);
  });

  it('maps an unknown guest handle to cart_guest_token_invalid', async () => {
    const { pool } = fakePool({ guest_cart_set_item: { code: 'NZ491' } });
    const error = await failure(
      createPostgresSavedCartStore(pool).setGuestItem(TOKEN, {
        productId: PRODUCT,
        variantId: null,
        quantity: 1,
      }),
    );
    expect((error as CommerceRefusalError).refusal).toBe('cart_guest_token_invalid');
  });

  it('uses the admin map for the staff checkout queue', async () => {
    const { pool } = fakePool({ admin_abandoned_checkouts: { code: 'NZ403' } });
    const error = await failure(
      createPostgresSavedCartStore(pool).listCheckouts(
        'token',
        USER,
        { status: 'all', q: '', from: '', to: '', sort: 'recent', page: 1, pageSize: 20 },
        { limit: 20, offset: 0 },
      ),
    );
    expect(error).toBeInstanceOf(AdminRefusalError);
  });
});
