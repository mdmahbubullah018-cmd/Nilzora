import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createEmailSender, type EmailMessage, type EmailSender } from '../../auth/sender';
import { createDatabasePool } from '../../db/pool';
import { withUser } from '../../db/user-context';
import {
  createPostgresOrderEmailStore,
  type OrderEmailStore,
} from '../../modules/order-emails/store';
import { createOrderEmailProcessor } from '../../modules/order-emails/worker';
import { createPostgresOrderStore } from '../../modules/orders/store';
import { createPostgresReviewStore } from '../../modules/reviews/store';

/*
 * The customer email outbox (migration 20261227090000) against the local database: the
 * triggers queue exactly one email per real event, the worker sends it from the order as the
 * database holds it, and the outbox is closed to customers. Mail goes to an in-memory sender;
 * nothing leaves the machine. Shipment, return and refund fixtures live in transactions that
 * are rolled back; orders, products and accounts made here are deleted afterwards.
 */

const { dbUrl, mailUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 4 });
const orders = createPostgresOrderStore(pool);
const NO_TOKEN = 'direct-connection';
const run = randomUUID().slice(0, 8);
const tag = `nzmail${run}`;

const created = {
  categories: [] as string[],
  products: [] as string[],
  users: [] as string[],
  zones: [] as string[],
};
let productId: string;
let owner: string;
let other: string;
let ownerAddress: string;

async function addUser(label: string, verified = true): Promise<string> {
  const id = randomUUID();
  await pool.query('select public.provision_account($1::uuid, $2, $3, null, null, $4)', [
    id,
    `it-mail-${run}-${label}@example.com`,
    `Mail ${label}`,
    verified,
  ]);
  created.users.push(id);
  return id;
}

async function addAddress(userId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into public.addresses
       (user_id, label, recipient_name, phone, division, district, area, address_line, postal_code)
     values ($1, 'Home', 'Rahima Khatun', '+8801712345678', 'Dhaka', 'Dhaka', 'Dhanmondi',
             'House 12, Road 5', '1212')
     returning id`,
    [userId],
  );
  return result.rows[0]!.id;
}

async function place(userId: string, addressId: string, key = randomUUID()) {
  return orders.place(NO_TOKEN, userId, {
    idempotencyKey: key,
    addressId,
    items: [{ productId, quantity: 1 }],
    expectedTotalMinor: 10_000 + 7_000,
  });
}

async function orderId(orderNumber: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    'select id from public.orders where order_number = $1',
    [orderNumber],
  );
  return r.rows[0]!.id;
}

async function outbox(orderIdValue: string) {
  const r = await pool.query<{
    kind: string;
    status: string;
    dedupe_key: string;
    event_status: string | null;
    last_error: string | null;
  }>(
    'select kind, status, dedupe_key, event_status, last_error from public.email_outbox where order_id = $1 order by created_at, kind',
    [orderIdValue],
  );
  return r.rows;
}

/** A new verified customer with an address: the store caps pending orders per account. */
let buyers = 0;
async function buyer(): Promise<{ user: string; address: string; email: string }> {
  buyers += 1;
  const label = `buyer${String(buyers)}`;
  const user = await addUser(label);
  return { user, address: await addAddress(user), email: `it-mail-${run}-${label}@example.com` };
}

async function placeFresh(b?: { user: string; address: string }) {
  const who = b ?? (await buyer());
  return place(who.user, who.address);
}

/** Runs `fn` in a transaction that is always rolled back. */
async function rolledBack(fn: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await fn(client);
  } finally {
    await client.query('rollback');
    client.release();
  }
}

async function insertShipment(
  client: PoolClient,
  order: string,
  options: { kind?: string; mock?: boolean; status?: string; returnRequest?: string } = {},
): Promise<string> {
  const r = await client.query<{ id: string }>(
    `insert into public.shipments
       (order_id, kind, provider, status, is_mock, booking_key, merchant_ref, tracking_code,
        weight_grams, cod_amount_minor, delivery_zone, return_request_id)
     values ($1, $2, 'steadfast', $3::public.shipment_status, $4, gen_random_uuid(), $5, 'TRK-1', 500,
             case when $2 = 'return_pickup' then 0 else 17000 end, 'inside_dhaka', $6)
     returning id`,
    [
      order,
      options.kind ?? 'forward',
      options.status ?? 'in_transit',
      options.mock ?? false,
      `IT-${randomUUID().slice(0, 12).toUpperCase()}`,
      options.returnRequest ?? null,
    ],
  );
  return r.rows[0]!.id;
}

/** Captures messages in memory. */
function sender() {
  const sent: EmailMessage[] = [];
  const email: EmailSender = {
    send(message) {
      sent.push(message);
      return Promise.resolve();
    },
    verify: () => Promise.resolve(),
  };
  return { sent, email };
}

/**
 * The real store, limited to this run's accounts: a row of anyone else that the shared claim
 * happens to take is handed straight back (retry in 1s) and never sent.
 */
function scopedStore(): OrderEmailStore {
  const real = createPostgresOrderEmailStore(pool, (userId, number) =>
    orders.get(NO_TOKEN, userId, number),
  );
  return {
    ...real,
    async claim(limit, lease) {
      const rows = await real.claim(limit, lease);
      const mine = rows.filter((row) => created.users.includes(row.userId));
      for (const row of rows)
        if (!mine.includes(row)) await real.finish(row.id, 'retry', { retrySeconds: 1 });
      return mine;
    },
  };
}

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

beforeAll(async () => {
  const categories = await pool.query<{ id: string }>(
    `insert into public.categories (slug, name, sort_order, is_active) values ($1, $2, 990, true) returning id`,
    [`${tag}-cat`, `Mail ${run}`],
  );
  created.categories.push(categories.rows[0]!.id);
  const products = await pool.query<{ id: string }>(
    `insert into public.products
       (category_id, slug, sku, name, summary, price_minor, stock_quantity, max_order_quantity, status, published_at)
     values ($1, $2, $3, $4, 'Mail fixture', 10000, 20, 10, 'active', now()) returning id`,
    [created.categories[0], `${tag}-mug`, `MAIL-${run.toUpperCase()}`, `${tag} mug`],
  );
  productId = products.rows[0]!.id;
  created.products.push(productId);
  const zones = await pool.query<{ zone: string }>(
    `insert into public.delivery_charges (zone, amount_minor) values ('inside_dhaka', 7000), ('outside_dhaka', 13000)
     on conflict (zone) do nothing returning zone`,
  );
  created.zones = zones.rows.map((row) => row.zone);
  owner = await addUser('owner');
  other = await addUser('other');
  ownerAddress = await addAddress(owner);
});

afterAll(async () => {
  if (created.users.length > 0) {
    // email_outbox rows go with their orders and accounts (on delete cascade).
    await pool.query('delete from public.orders where user_id = any($1::uuid[])', [created.users]);
    await pool.query('delete from public.profiles where id = any($1::uuid[])', [created.users]);
  }
  await pool.query('delete from public.inventory_movements where product_id = any($1::uuid[])', [
    created.products,
  ]);
  await pool.query('delete from public.products where id = any($1::uuid[])', [created.products]);
  await pool.query('delete from public.categories where id = any($1::uuid[])', [
    created.categories,
  ]);
  if (created.zones.length > 0) {
    await pool.query('delete from public.delivery_charges where zone::text = any($1::text[])', [
      created.zones,
    ]);
  }
  await pool.end();
});

describe('email outbox triggers', () => {
  it('queues exactly one confirmation per placed order, even when the placement is replayed', async () => {
    const key = randomUUID();
    const first = await place(owner, ownerAddress, key);
    const replay = await place(owner, ownerAddress, key);
    expect(replay.created).toBe(false);

    const rows = await outbox(await orderId(first.order.orderNumber));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'order_confirmation', status: 'pending' });
    expect(rows[0]?.dedupe_key).toMatch(/^order_placed:/);
  });

  it('queues "out for delivery" once, and only for a real forward shipment', async () => {
    const placed = await placeFresh();
    const id = await orderId(placed.order.orderNumber);
    // One active forward shipment per order: the test booking belongs to a second order.
    const mockOrder = await orderId((await placeFresh()).order.orderNumber);
    await rolledBack(async (client) => {
      const real = await insertShipment(client, id);
      const mock = await insertShipment(client, mockOrder, { mock: true });
      const ret = await client.query<{ id: string }>(
        `insert into public.return_requests (order_id, user_id, reason, item_count)
         select id, user_id, 'Wrong size', 1 from public.orders where id = $1 returning id`,
        [id],
      );
      const pickup = await insertShipment(client, id, {
        kind: 'return_pickup',
        returnRequest: ret.rows[0]!.id,
      });
      for (const shipment of [real, mock, pickup]) {
        await client.query(
          `update public.shipments set status = 'out_for_delivery' where id = $1`,
          [shipment],
        );
      }
      // Reported again, and a later back-and-forth: still one email for the shipment.
      await client.query(`update public.shipments set status = 'out_for_delivery' where id = $1`, [
        real,
      ]);
      await client.query(`update public.shipments set status = 'on_hold' where id = $1`, [real]);
      await client.query(`update public.shipments set status = 'out_for_delivery' where id = $1`, [
        real,
      ]);

      const rows = await client.query<{ shipment_id: string }>(
        `select shipment_id from public.email_outbox where order_id = any($1::uuid[]) and kind = 'out_for_delivery'`,
        [[id, mockOrder]],
      );
      expect(rows.rows).toEqual([{ shipment_id: real }]);
    });
  });

  it('queues return updates and only the refund decisions a customer needs', async () => {
    const placed = await placeFresh();
    const id = await orderId(placed.order.orderNumber);
    await rolledBack(async (client) => {
      const ret = await client.query<{ id: string }>(
        `insert into public.return_requests (order_id, user_id, reason, item_count) values ($1, $2, 'Wrong size', 1) returning id`,
        [id, owner],
      );
      const returnId = ret.rows[0]!.id;
      await client.query(
        `insert into public.return_status_history (return_request_id, from_status, to_status, actor_kind) values ($1, null, 'requested', 'customer')`,
        [returnId],
      );
      const refund = await client.query<{ id: string }>(
        `insert into public.refunds (order_id, return_request_id, amount_minor, reason) values ($1, $2, 10000, 'Returned item') returning id`,
        [id, returnId],
      );
      const refundId = refund.rows[0]!.id;
      for (const [from, to] of [
        [null, 'requested'],
        ['requested', 'approved'],
      ] as const) {
        await client.query(
          `insert into public.refund_status_history (refund_id, from_status, to_status) values ($1, $2, $3)`,
          [refundId, from, to],
        );
      }
      const rows = await client.query<{ kind: string; event_status: string }>(
        `select kind, event_status from public.email_outbox where order_id = $1 and kind <> 'order_confirmation' order by kind`,
        [id],
      );
      expect(rows.rows).toEqual([
        { kind: 'refund_update', event_status: 'approved' },
        { kind: 'return_update', event_status: 'requested' },
      ]);
    });
  });

  it('keeps the outbox and its functions closed to customers and the public', async () => {
    const privileges = await pool.query<Record<string, boolean>>(`
      select
        has_table_privilege('authenticated', 'public.email_outbox', 'select') as auth_select,
        has_table_privilege('anon', 'public.email_outbox', 'select') as anon_select,
        has_function_privilege('authenticated', 'public.claim_customer_emails(integer, integer)', 'execute') as auth_claim,
        has_function_privilege('anon', 'public.finish_customer_email(uuid, text, integer, text)', 'execute') as anon_finish,
        has_function_privilege('service_role', 'public.claim_customer_emails(integer, integer)', 'execute') as service_claim`);
    expect(privileges.rows[0]).toEqual({
      auth_select: false,
      anon_select: false,
      auth_claim: false,
      anon_finish: false,
      service_claim: true,
    });
  });
});

describe('order email worker on the local database', () => {
  it('sends the confirmation once, from the saved order, and records it as sent', async () => {
    const customer = await buyer();
    const placed = await placeFresh(customer);
    const id = await orderId(placed.order.orderNumber);
    const { sent, email } = sender();
    const processor = createOrderEmailProcessor({
      store: scopedStore(),
      sender: email,
      branding: () => ({}),
      logger: silent,
    });

    await processor.runOnce();
    const again = await processor.runOnce();

    const mine = sent.filter((m) => m.subject === `Order ${placed.order.orderNumber} received`);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.to).toBe(customer.email);
    expect(mine[0]?.text).toContain(`${tag} mug`);
    expect(mine[0]?.text).toContain('Total payable on delivery: BDT 170');
    expect(mine[0]?.text).toContain('House 12, Road 5');
    expect(again.claimed).toBe(0);
    expect(await outbox(id)).toEqual([
      expect.objectContaining({ status: 'sent', last_error: null }),
    ]);
  });

  it('skips the confirmation of an order cancelled before it was sent', async () => {
    const customer = await buyer();
    const placed = await placeFresh(customer);
    const id = await orderId(placed.order.orderNumber);
    await orders.cancel(NO_TOKEN, customer.user, placed.order.orderNumber, 'Changed my mind');
    const { sent, email } = sender();
    await createOrderEmailProcessor({
      store: scopedStore(),
      sender: email,
      branding: () => ({}),
      logger: silent,
    }).runOnce();

    expect(sent.filter((m) => m.subject.includes(placed.order.orderNumber))).toHaveLength(0);
    expect(await outbox(id)).toEqual([
      expect.objectContaining({ status: 'skipped', last_error: 'order_cancelled' }),
    ]);
  });

  it('never emails an address that was not verified', async () => {
    const unverified = await addUser('unverified', false);
    const address = await addAddress(unverified);
    const placed = await place(unverified, address);
    const { sent, email } = sender();
    await createOrderEmailProcessor({
      store: scopedStore(),
      sender: email,
      branding: () => ({}),
      logger: silent,
    }).runOnce();

    expect(sent).toHaveLength(0);
    expect(await outbox(await orderId(placed.order.orderNumber))).toEqual([
      expect.objectContaining({ status: 'skipped', last_error: 'email_unverified' }),
    ]);
  });

  it('puts a failed send back in the queue with a short code, then gives up when told', async () => {
    const placed = await placeFresh();
    const id = await orderId(placed.order.orderNumber);
    const store = scopedStore();
    const [row] = await store.claim(10, 60);
    expect(row?.orderId).toBe(id);
    await store.finish(row!.id, 'retry', { retrySeconds: 30, errorCode: 'smtp_not_accepted' });
    expect(await outbox(id)).toEqual([
      expect.objectContaining({ status: 'pending', last_error: 'smtp_not_accepted' }),
    ]);
    // A provider message is never stored: anything that is not a short code becomes a generic one.
    await pool.query(`update public.email_outbox set next_attempt_at = now() where order_id = $1`, [
      id,
    ]);
    const [again] = await store.claim(10, 60);
    await store.finish(again!.id, 'failed', { errorCode: '550 user@example.com unknown' });
    expect(await outbox(id)).toEqual([
      expect.objectContaining({ status: 'failed', last_error: 'smtp_not_accepted' }),
    ]);
  });
});

describe('order email over real SMTP (local Mailpit only)', () => {
  it('is accepted by the mail server and arrives as multipart HTML with the order in it', async () => {
    const smtp = createEmailSender({
      host: '127.0.0.1',
      port: 54325,
      secure: false,
      user: undefined,
      password: undefined,
      from: 'Nilzora <no-reply@nilzora.local>',
    });
    if (!smtp) throw new Error('the SMTP sender could not be created');
    const customer = await buyer();
    const placed = await placeFresh(customer);
    const subject = `Order ${placed.order.orderNumber} received`;
    await createOrderEmailProcessor({
      store: scopedStore(),
      sender: smtp,
      branding: () => ({ siteUrl: 'http://localhost:3000' }),
      logger: silent,
    }).runOnce();

    let found: { ID: string; Subject: string } | undefined;
    for (let i = 0; i < 20 && !found; i += 1) {
      const query = encodeURIComponent(`to:"${customer.email}"`);
      const response = await fetch(`${mailUrl}/api/v1/search?query=${query}&limit=5`);
      const list = (await response.json()) as { messages: { ID: string; Subject: string }[] };
      found = list.messages.find((m) => m.Subject === subject);
      if (!found) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    expect(found).toBeDefined();
    const message = (await (await fetch(`${mailUrl}/api/v1/message/${found!.ID}`)).json()) as {
      HTML: string;
      Text: string;
    };
    expect(message.HTML).toContain(placed.order.orderNumber);
    expect(message.HTML).toContain('href="http://localhost:3000/account/orders/');
    expect(message.Text).toContain('Total payable on delivery: BDT 170');
    expect(await outbox(await orderId(placed.order.orderNumber))).toEqual([
      expect.objectContaining({ status: 'sent' }),
    ]);
    // Only the message this test created is removed from the catcher.
    await fetch(`${mailUrl}/api/v1/messages`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ IDs: [found!.ID] }),
    });
  });
});

describe('review prompt dismissals', () => {
  it('lets a customer dismiss for themselves only', async () => {
    await withUser(pool, owner, async (client) => {
      await client.query(
        'insert into public.review_prompt_dismissals (user_id, product_id) values ($1, $2)',
        [owner, productId],
      );
      const own = await client.query(
        'select 1 from public.review_prompt_dismissals where product_id = $1',
        [productId],
      );
      expect(own.rowCount).toBe(1);
    });
    await expect(
      withUser(pool, owner, (client) =>
        client.query(
          'insert into public.review_prompt_dismissals (user_id, product_id) values ($1, $2)',
          [other, productId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    // The other account sees none of the owner's rows.
    await withUser(pool, other, async (client) => {
      const seen = await client.query(
        'select 1 from public.review_prompt_dismissals where product_id = $1',
        [productId],
      );
      expect(seen.rowCount).toBe(0);
    });
    await pool.query('delete from public.review_prompt_dismissals where user_id = $1', [owner]);
  });

  it('asks about a delivered, unreviewed product until the customer closes it', async () => {
    const reviews = createPostgresReviewStore(pool);
    const customer = await buyer();
    const id = randomUUID();
    // A delivered order written directly: delivery itself is a staff workflow tested elsewhere.
    await pool.query(
      `insert into public.orders (
         id, user_id, status, item_count, subtotal_minor, shipping_fee_minor, total_minor,
         delivery_zone, ship_recipient_name, ship_phone, ship_division, ship_district,
         ship_area, ship_address_line, idempotency_key, request_fingerprint
       ) values ($1::uuid, $2::uuid, 'delivered', 1, 10000, 0, 10000, 'inside_dhaka', 'Prompt Test',
                 '01700000000', 'Dhaka', 'Dhaka', 'Gulshan', 'House 1, Road 1', $3::uuid, 'it-prompt')`,
      [id, customer.user, randomUUID()],
    );
    await pool.query(
      `insert into public.order_items
         (order_id, product_id, product_name, product_slug, sku, unit_price_minor, quantity, line_total_minor)
       values ($1, $2, $3, $4, $5, 10000, 1, 10000)`,
      [id, productId, `${tag} mug`, `${tag}-mug`, `MAIL-${run.toUpperCase()}`],
    );

    const asked = await reviews.reviewPrompt(NO_TOKEN, customer.user);
    expect(asked).toMatchObject({ productId, productName: `${tag} mug` });
    // Another account is never asked about it.
    expect(await reviews.reviewPrompt(NO_TOKEN, other)).toBeNull();

    await reviews.dismissReviewPrompt(NO_TOKEN, customer.user, productId);
    await reviews.dismissReviewPrompt(NO_TOKEN, customer.user, productId); // repeat is harmless
    expect(await reviews.reviewPrompt(NO_TOKEN, customer.user)).toBeNull();
    // The My Orders list still offers it: closing the prompt is not declining to review.
    expect(
      (await reviews.reviewable(NO_TOKEN, customer.user)).map((item) => item.productId),
    ).toEqual([productId]);
    await pool.query('delete from public.review_prompt_dismissals where user_id = $1', [
      customer.user,
    ]);
  });
});
