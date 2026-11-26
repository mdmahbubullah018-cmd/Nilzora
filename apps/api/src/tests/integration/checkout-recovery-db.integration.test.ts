import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabasePool } from '../../db/pool';
import { createPostgresSavedCartStore } from '../../modules/carts/store';
import { AdminRefusalError } from '../../modules/admin/errors';
import { CommerceRefusalError } from '../../modules/commerce/errors';

/*
 * Abandoned checkouts, against the real database: the metrics, the queue, contact attempts,
 * the recovery state, single-use links and the cart restore.
 *
 * Fixtures are created here and removed afterwards. The rules under test — what counts as
 * abandoned, who may restore a link, whether an expired link still works — are the database
 * functions' own, which is why this test calls them through the store rather than mocking them.
 */

const local = inject('supabase');
const pool = createDatabasePool({ connectionString: local.dbUrl, max: 4 });
const carts = createPostgresSavedCartStore(pool);

/** The direct connection ignores the token: identity is the user id it is given. */
const NO_TOKEN = 'direct-connection';

const run = randomUUID().slice(0, 8);
const tag = `nzrec${run}`;

const created = {
  categories: [] as string[],
  products: [] as string[],
  users: [] as string[],
};

let owner: string;
let other: string;
let staff: string;
let productId: string;
let checkoutId: string;

async function addUser(label: string, role: 'super_admin' | 'staff' | 'customer'): Promise<string> {
  const id = randomUUID();
  await pool.query('select public.provision_account($1::uuid, $2, $3, null, null, true)', [
    id,
    `it-rec-${run}-${label}@example.com`,
    `Recovery ${label}`,
  ]);
  if (role !== 'customer') {
    await pool.query('update public.user_roles set role = $1 where user_id = $2', [role, id]);
  }
  created.users.push(id);
  return id;
}

beforeAll(async () => {
  const categories = await pool.query<{ id: string }>(
    `insert into public.categories (slug, name, sort_order, is_active)
     values ($1, $2, 991, true) returning id`,
    [`${tag}-cat`, `Recovery ${run}`],
  );
  const categoryId = categories.rows[0]?.id;
  if (!categoryId) throw new Error('category fixture was not created');
  created.categories.push(categoryId);

  const products = await pool.query<{ id: string }>(
    `insert into public.products
       (category_id, slug, sku, name, summary, price_minor, stock_quantity, max_order_quantity, status,
        published_at)
     values ($1, $2, $3, $4, $5, 25000, 50, 10, 'active', now())
     returning id`,
    [categoryId, `${tag}-bag`, `REC-${run.toUpperCase()}`, `${tag} bag`, `Recovery fixture ${run}`],
  );
  const id = products.rows[0]?.id;
  if (!id) throw new Error('product fixture was not created');
  productId = id;
  created.products.push(id);

  owner = await addUser('owner', 'customer');
  other = await addUser('other', 'customer');
  staff = await addUser('staff', 'staff');

  // A real checkout attempt: lines are put in the cart, then checkout_start is called.
  await carts.setItem(NO_TOKEN, owner, { productId, variantId: null, quantity: 2 });
  const started = await carts.startCheckout(NO_TOKEN, owner, {});
  checkoutId = started.checkout.id;

  // Make it abandoned now rather than waiting out the configured inactivity window.
  await pool.query(
    `update public.checkout_sessions
     set last_activity_at = now() - interval '3 hours',
         abandoned_at = now() - interval '3 hours'
     where id = $1`,
    [checkoutId],
  );
});

afterAll(async () => {
  await pool.query('delete from public.checkout_sessions where id = $1', [checkoutId]);
  await pool.query('delete from public.cart_items where product_id = any($1::uuid[])', [
    created.products,
  ]);
  await pool.query('delete from public.carts where user_id = any($1::uuid[])', [created.users]);
  await pool.query('delete from public.products where id = any($1::uuid[])', [created.products]);
  await pool.query('delete from public.categories where id = any($1::uuid[])', [created.categories]);
  await pool.query('delete from public.profiles where id = any($1::uuid[])', [created.users]);
  await pool.end();
});

describe('abandoned checkout metrics and queue', () => {
  it('counts the abandoned attempt and its catalogue value', async () => {
    const metrics = await carts.checkoutMetrics(NO_TOKEN, staff, { from: null, to: null });
    expect(metrics.abandonedCount).toBeGreaterThanOrEqual(1);
    expect(metrics.potentialValueMinor).toBeGreaterThanOrEqual(50_000);
    // Nothing was abandoned in a window that ended long ago.
    const empty = await carts.checkoutMetrics(NO_TOKEN, staff, {
      from: '2020-01-01T00:00:00.000Z',
      to: '2020-01-02T00:00:00.000Z',
    });
    expect(empty.abandonedCount).toBe(0);
    // A rate with no denominator is null, never 0%.
    expect(empty.recoveryRatePercent).toBeNull();
  });

  it('lists the attempt with the customer, the value and the item count', async () => {
    const { checkouts, total } = await carts.listCheckouts(
      NO_TOKEN,
      staff,
      { status: 'incomplete', q: '', from: '', to: '', sort: 'value', page: 1, pageSize: 25 },
      { limit: 25, offset: 0 },
    );
    expect(total).toBeGreaterThanOrEqual(1);
    const row = checkouts.find((entry) => entry.id === checkoutId);
    expect(row).toBeDefined();
    expect(row?.itemCount).toBe(2);
    expect(row?.cartValueMinor).toBe(50_000);
    expect(row?.abandonedAt).not.toBeNull();
    expect(row?.recoveryState).toBe('open');
  });

  it('searches by phone as well as name, and rejects an unknown customer', async () => {
    const known = await carts.listCheckouts(
      NO_TOKEN,
      staff,
      { status: 'all', q: `Recovery owner`, from: '', to: '', sort: 'recent', page: 1, pageSize: 25 },
      { limit: 25, offset: 0 },
    );
    expect(known.checkouts.some((entry) => entry.id === checkoutId)).toBe(true);
    const unknown = await carts.listCheckouts(
      NO_TOKEN,
      staff,
      { status: 'all', q: 'no-such-customer-xyz', from: '', to: '', sort: 'recent', page: 1, pageSize: 25 },
      { limit: 25, offset: 0 },
    );
    expect(unknown.checkouts.some((entry) => entry.id === checkoutId)).toBe(false);
  });

  it('refuses the whole workflow to an account without checkouts.recover', async () => {
    await expect(
      carts.checkoutMetrics(NO_TOKEN, owner, { from: null, to: null }),
    ).rejects.toBeInstanceOf(AdminRefusalError);
    await expect(
      carts.recordCheckoutAttempt(NO_TOKEN, owner, checkoutId, { channel: 'call' }),
    ).rejects.toBeInstanceOf(AdminRefusalError);
    await expect(
      carts.createCheckoutRecoveryLink(NO_TOKEN, owner, checkoutId),
    ).rejects.toBeInstanceOf(AdminRefusalError);
  });
});

describe('contact attempts and recovery state', () => {
  it('records an attempt, names who made it, and moves the record to contacted', async () => {
    const after = await carts.recordCheckoutAttempt(NO_TOKEN, staff, checkoutId, {
      channel: 'whatsapp',
      note: 'Asked if she still wants the bag',
    });
    expect(after.attempts).toHaveLength(1);
    expect(after.attempts[0]?.channel).toBe('whatsapp');
    expect(after.attempts[0]?.note).toBe('Asked if she still wants the bag');
    expect(after.attempts[0]?.adminName).toBe('Recovery staff');
    expect(after.recoveryState).toBe('contacted');
  });

  it('refuses a channel it does not record, without writing anything', async () => {
    await expect(
      carts.recordCheckoutAttempt(NO_TOKEN, staff, checkoutId, {
        channel: 'carrier-pigeon' as never,
      }),
    ).rejects.toBeInstanceOf(AdminRefusalError);
    const detail = await carts.getCheckout(NO_TOKEN, staff, checkoutId);
    expect(detail?.attempts).toHaveLength(1);
  });

  it('moves between open, contacted and dismissed', async () => {
    expect(
      (await carts.setCheckoutRecoveryState(NO_TOKEN, staff, checkoutId, 'dismissed')).recoveryState,
    ).toBe('dismissed');
    expect(
      (await carts.setCheckoutRecoveryState(NO_TOKEN, staff, checkoutId, 'open')).recoveryState,
    ).toBe('open');
  });
});

describe('recovery links', () => {
  it('mints a link that reveals only a count and a value', async () => {
    const link = await carts.createCheckoutRecoveryLink(NO_TOKEN, staff, checkoutId);
    expect(link.token).toMatch(/^[0-9a-f]{64}$/);
    const preview = await carts.previewRecovery(link.token);
    expect(preview.valid).toBe(true);
    expect(preview.itemCount).toBe(2);
    expect(preview.cartValueMinor).toBe(50_000);
    // No personal data crosses this boundary.
    expect(Object.keys(preview).sort()).toEqual(
      ['cartValueMinor', 'expiresAt', 'itemCount', 'reason', 'valid'],
    );
  });

  it('stops an older link working when a new one is minted', async () => {
    const first = await carts.createCheckoutRecoveryLink(NO_TOKEN, staff, checkoutId);
    const second = await carts.createCheckoutRecoveryLink(NO_TOKEN, staff, checkoutId);
    expect((await carts.previewRecovery(first.token)).reason).toBe('revoked');
    expect((await carts.previewRecovery(second.token)).valid).toBe(true);
  });

  it('reports a token it never issued, without leaking anything', async () => {
    const preview = await carts.previewRecovery('f'.repeat(64));
    expect(preview).toEqual({
      valid: false,
      reason: 'not_found',
      itemCount: 0,
      cartValueMinor: 0,
      expiresAt: null,
    });
  });

  it('refuses to restore the cart for a different customer', async () => {
    const link = await carts.createCheckoutRecoveryLink(NO_TOKEN, staff, checkoutId);
    await expect(carts.restoreRecovery(NO_TOKEN, other, link.token)).rejects.toBeInstanceOf(
      CommerceRefusalError,
    );
  });

  it('restores the saved lines into the owner\u2019s cart, once', async () => {
    const link = await carts.createCheckoutRecoveryLink(NO_TOKEN, staff, checkoutId);
    // The owner already has these two units in the cart from the fixture; restoring adds two more.
    const restored = await carts.restoreRecovery(NO_TOKEN, owner, link.token);
    expect(restored.checkoutId).toBe(checkoutId);
    expect(restored.restoredLines).toBe(1);

    const cart = await carts.myCart(NO_TOKEN, owner);
    const mine = cart.cart.lines.find((line) => line.productId === productId);
    expect(mine?.quantity).toBe(4);

    // The link is spent, and the attempt is live again rather than abandoned.
    expect((await carts.previewRecovery(link.token)).reason).toBe('used');
    const detail = await carts.getCheckout(NO_TOKEN, staff, checkoutId);
    expect(detail?.status).toBe('started');

    await expect(carts.restoreRecovery(NO_TOKEN, owner, link.token)).rejects.toBeInstanceOf(
      CommerceRefusalError,
    );
  });

  it('revokes a link on request', async () => {
    const link = await carts.createCheckoutRecoveryLink(NO_TOKEN, staff, checkoutId);
    const after = await carts.revokeCheckoutRecoveryLink(NO_TOKEN, staff, checkoutId);
    expect(after.link?.revokedAt).not.toBeNull();
    expect((await carts.previewRecovery(link.token)).reason).toBe('revoked');
  });
});

describe('after conversion', () => {
  it('refuses a link and a dismissal, because the checkout is an order', async () => {
    await pool.query(
      `update public.checkout_sessions
       set status = 'converted', converted_at = now(), abandoned_at = now() - interval '3 hours'
       where id = $1`,
      [checkoutId],
    );

    await expect(
      carts.createCheckoutRecoveryLink(NO_TOKEN, staff, checkoutId),
    ).rejects.toBeInstanceOf(AdminRefusalError);
    await expect(
      carts.setCheckoutRecoveryState(NO_TOKEN, staff, checkoutId, 'dismissed'),
    ).rejects.toBeInstanceOf(AdminRefusalError);
  });

  it('counts the attempt as recovered once it has an order', async () => {
    const metrics = await carts.checkoutMetrics(NO_TOKEN, staff, { from: null, to: null });
    expect(metrics.abandonedCount).toBeGreaterThanOrEqual(1);
    expect(metrics.recoveredCount).toBeGreaterThanOrEqual(1);
    expect(metrics.recoveryRatePercent).toBeGreaterThan(0);
  });
});
