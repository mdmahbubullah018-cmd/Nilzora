import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { createDatabasePool } from '../../db/pool';
import { withUser } from '../../db/user-context';
import { createPostgresDomainEventStore } from '../../modules/events/store';
import { createDomainEventWorker, type DomainEventConsumer } from '../../modules/events/worker';

/*
 * The domain-event outbox (migration 20261231103000) against the real database: events are written
 * in the same transaction as the change (and not at all when it rolls back), the worker delivers
 * each to every consumer at least once with retries that never repeat a consumer that already
 * succeeded, dead-letters what keeps failing, and a client recovers only its own events by cursor.
 */

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 4 });
const store = createPostgresDomainEventStore(pool);
const run = randomUUID().slice(0, 8);
const users: string[] = [];
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
let category: string;
let product: string;
let customer: string;
let other: string;
let admin: string;
let address: string;
const zones: string[] = [];
const PRICE = 10_000;
const FEE = 7_000;

async function addUser(label: string, role = 'customer'): Promise<string> {
  const id = randomUUID();
  await pool.query('select public.provision_account($1::uuid, $2, $3, null, null, true)', [
    id,
    `it-events-${run}-${label}@example.com`,
    `Events ${label}`,
  ]);
  if (role !== 'customer')
    await pool.query('update public.user_roles set role = $2 where user_id = $1', [id, role]);
  users.push(id);
  return id;
}

const place = (user: string, expected = PRICE + FEE) =>
  withUser(pool, user, async (client) => {
    const result = await client.query<{ value: { orderId: string; orderNumber: string } }>(
      'select public.place_cod_order($1::uuid, $2::uuid, $3::jsonb, null, $4::bigint, null) as value',
      [randomUUID(), address, JSON.stringify([{ productId: product, quantity: 1 }]), expected],
    );
    return (result.rows[0] as { value: { orderId: string; orderNumber: string } }).value;
  });

const eventsFor = async (aggregateId: string) =>
  (
    await pool.query<{
      event_type: string;
      recipient_user_id: string | null;
      audience_permission: string | null;
    }>(
      'select event_type, recipient_user_id, audience_permission from public.domain_events where aggregate_id = $1 order by seq',
      [aggregateId],
    )
  ).rows;

beforeAll(async () => {
  category = (
    await pool.query<{ id: string }>(
      "insert into public.categories (slug, name, sort_order, is_active) values ($1, 'ev', 992, true) returning id",
      [`nzev${run}-cat`],
    )
  ).rows[0]?.id as string;
  product = (
    await pool.query<{ id: string }>(
      `insert into public.products (category_id, slug, sku, name, summary, price_minor, stock_quantity, max_order_quantity, status, published_at)
       values ($1, $2, $3, 'ev', 'fixture', $4, 50, 5, 'active', now()) returning id`,
      [category, `nzev${run}-p`, `EV-${run.toUpperCase()}`, PRICE],
    )
  ).rows[0]?.id as string;
  customer = await addUser('customer');
  other = await addUser('other');
  admin = await addUser('admin', 'admin');
  address = (
    await pool.query<{ id: string }>(
      `insert into public.addresses (user_id, label, recipient_name, phone, division, district, area, address_line, postal_code)
       values ($1, 'Home', 'Rahima Khatun', '+8801712345678', 'Dhaka', 'Dhaka', 'Dhanmondi', 'House 12, Road 5', '1212') returning id`,
      [customer],
    )
  ).rows[0]?.id as string;
  zones.push(
    ...(
      await pool.query<{ zone: string }>(
        `insert into public.delivery_charges (zone, amount_minor) values ('inside_dhaka', ${String(FEE)}), ('outside_dhaka', 13000)
         on conflict (zone) do nothing returning zone`,
      )
    ).rows.map((row) => row.zone),
  );
});

afterAll(async () => {
  await pool.query("delete from public.domain_events where aggregate_id like 'it-ev-%'");
  await pool.query('delete from public.orders where user_id = any($1::uuid[])', [users]);
  await pool.query('delete from public.inventory_movements where product_id = $1', [product]);
  await pool.query('delete from public.products where id = $1', [product]);
  await pool.query('delete from public.categories where id = $1', [category]);
  if (zones.length > 0)
    await pool.query('delete from public.delivery_charges where zone::text = any($1::text[])', [
      zones,
    ]);
  await pool.query('delete from public.profiles where id = any($1::uuid[])', [users]);
  await pool.end();
});

describe('events are written with the change, in the same transaction', () => {
  it('records order.placed for the customer and the order desk when an order commits', async () => {
    const order = await place(customer);
    expect(await eventsFor(order.orderNumber)).toContainEqual({
      event_type: 'order.placed',
      recipient_user_id: customer,
      audience_permission: 'orders.read',
    });
  });

  it('records nothing when the order is refused and rolls back', async () => {
    const before = Number(
      (await pool.query<{ n: string }>('select max(seq) as n from public.domain_events')).rows[0]
        ?.n ?? 0,
    );
    await expect(place(customer, PRICE)).rejects.toMatchObject({ code: 'NZ418' });
    const leaked = await pool.query(
      "select 1 from public.domain_events where seq > $1 and event_type = 'order.placed' and recipient_user_id = $2",
      [before, customer],
    );
    expect(leaked.rowCount).toBe(0);
  });

  it('records each validated status change (and not the initial pending one twice)', async () => {
    const order = await place(customer);
    await withUser(pool, admin, async (client) => {
      await client.query("select public.admin_update_order_status($1, 'confirmed', null)", [
        order.orderNumber,
      ]);
      await client.query("select public.admin_update_order_status($1, 'processing', null)", [
        order.orderNumber,
      ]);
    });
    const types = (await eventsFor(order.orderNumber)).map((row) => row.event_type);
    expect(types).toEqual(
      expect.arrayContaining(['order.placed', 'order.confirmed', 'order.processing']),
    );
    expect(types.filter((type) => type === 'order.placed')).toHaveLength(1);
    expect(types).not.toContain('order.pending');
  });
});

describe('the outbox worker', () => {
  async function addEvent(aggregateId: string): Promise<string> {
    const row = await pool.query<{ id: string }>(
      `insert into public.domain_events (event_type, aggregate_type, aggregate_id, recipient_user_id, payload)
       values ('order.confirmed', 'order', $1, $2, '{}'::jsonb) returning id`,
      [aggregateId, customer],
    );
    return (row.rows[0] as { id: string }).id;
  }
  const state = async (id: string) =>
    (
      await pool.query<{
        published_at: Date | null;
        dead_lettered_at: Date | null;
        attempts: number;
      }>(
        'select published_at, dead_lettered_at, attempts from public.domain_events where id = $1',
        [id],
      )
    ).rows[0];
  const due = (id: string) =>
    pool.query('update public.domain_events set next_attempt_at = now() where id = $1', [id]);

  it('retries a failed consumer without repeating the one that already succeeded, then publishes', async () => {
    const target = `it-ev-${run}-retry`;
    const id = await addEvent(target);
    const calls = { audit: 0, flaky: 0 };
    const consumers: DomainEventConsumer[] = [
      {
        name: 'test.audit',
        handle: (event) => {
          if (event.aggregateId === target) calls.audit += 1;
          return Promise.resolve();
        },
      },
      {
        name: 'test.flaky',
        handle: (event) => {
          if (event.aggregateId !== target) return Promise.resolve();
          calls.flaky += 1;
          return calls.flaky === 1
            ? Promise.reject(new Error('provider timeout'))
            : Promise.resolve();
        },
      },
    ];
    const worker = createDomainEventWorker({ store, consumers, logger: silent });

    await worker.runOnce();
    expect(await state(id)).toMatchObject({ published_at: null, attempts: 1 });
    await due(id);
    await worker.runOnce();
    expect((await state(id))?.published_at).not.toBeNull();
    // The audit consumer succeeded the first time and was not run again on the retry.
    expect(calls).toEqual({ audit: 1, flaky: 2 });
  });

  it('dead-letters an event that keeps failing, and keeps it for inspection', async () => {
    const target = `it-ev-${run}-dead`;
    const id = await addEvent(target);
    const worker = createDomainEventWorker({
      store,
      maxAttempts: 2,
      logger: silent,
      consumers: [
        {
          name: 'test.broken',
          handle: (event) =>
            event.aggregateId === target ? Promise.reject(new Error('always')) : Promise.resolve(),
        },
      ],
    });
    await worker.runOnce();
    await due(id);
    await worker.runOnce();
    const after = await state(id);
    expect(after?.dead_lettered_at).not.toBeNull();
    expect(after?.published_at).toBeNull();
    expect((await store.stats()).deadLettered).toBeGreaterThan(0);
  });

  it('records a consumer once per event: a duplicate delivery is recognised', async () => {
    const id = await addEvent(`it-ev-${run}-dup`);
    expect(await store.recordProcessed('test.dup', id)).toBe(true);
    expect(await store.recordProcessed('test.dup', id)).toBe(false);
    expect(await store.processedConsumers(id)).toContain('test.dup');
  });

  it('lets two workers share the queue without delivering one event twice', async () => {
    const target = `it-ev-${run}-race`;
    for (let i = 0; i < 6; i += 1) await addEvent(`${target}-${String(i)}`);
    const seen: string[] = [];
    const consumer: DomainEventConsumer = {
      name: 'test.race',
      handle: (event) => {
        if (event.aggregateId.startsWith(target)) seen.push(event.aggregateId);
        return Promise.resolve();
      },
    };
    const a = createDomainEventWorker({
      store,
      consumers: [consumer],
      logger: silent,
      batchSize: 3,
    });
    const b = createDomainEventWorker({
      store,
      consumers: [consumer],
      logger: silent,
      batchSize: 3,
    });
    for (let round = 0; round < 4; round += 1) await Promise.all([a.runOnce(), b.runOnce()]);
    expect(seen.sort()).toEqual(
      Array.from({ length: 6 }, (_, i) => `${target}-${String(i)}`).sort(),
    );
  });
});

describe('missed-event recovery', () => {
  it('gives a customer their own events after a cursor, and never another customer’s', async () => {
    const start = await store.cursor(customer);
    const mine = await place(customer);
    const page = await store.forUser(customer, start, 100);
    expect(
      page.some((event) => event.aggregateId === mine.orderNumber && event.type === 'order.placed'),
    ).toBe(true);
    expect(page.every((event) => event.seq > start)).toBe(true);

    const theirs = await store.forUser(other, start, 100);
    expect(theirs.some((event) => event.aggregateId === mine.orderNumber)).toBe(false);
  });

  it('gives staff the events addressed to a permission they hold', async () => {
    const start = await store.cursor(admin);
    const order = await place(customer);
    const page = await store.forUser(admin, start, 100);
    expect(
      page.some(
        (event) => event.aggregateId === order.orderNumber && event.type === 'order.placed',
      ),
    ).toBe(true);
  });

  it('pages by cursor without gaps or repeats', async () => {
    const start = await store.cursor(customer);
    await place(customer);
    await place(customer);
    const first = await store.forUser(customer, start, 1);
    const rest = await store.forUser(customer, first.at(-1)?.seq ?? start, 100);
    const seqs = [...first, ...rest].map((event) => event.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
  });
});
