import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabasePool } from '../../db/pool';
import { withUser } from '../../db/user-context';

/*
 * Attaching photos to a review (migration 20261231100000): a verified buyer's review is published
 * the moment it is submitted, and its photos arrive a moment later, so they must be accepted on a
 * review that is published and recent. An old review, someone else's review and a fifth photo are
 * still refused.
 */

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 4 });
const run = randomUUID().slice(0, 8);
const users: string[] = [];
let category: string;
let product: string;
let author: string;
let order: string;
const zones: string[] = [];
let stranger: string;

async function addUser(label: string): Promise<string> {
  const id = randomUUID();
  await pool.query('select public.provision_account($1::uuid, $2, $3, null, null, true)', [
    id,
    `it-rphoto-${run}-${label}@example.com`,
    `Photos ${label}`,
  ]);
  users.push(id);
  return id;
}

async function review(status: 'pending' | 'approved', minutesAgo: number): Promise<string> {
  // One review per author and product: a fresh product for each case.
  const made = await pool.query<{ id: string }>(
    `insert into public.products
       (category_id, slug, sku, name, summary, price_minor, stock_quantity, max_order_quantity, status, published_at)
     values ($1, $2, $3, 'rp', 'fixture', 10000, 5, 5, 'active', now()) returning id`,
    [
      category,
      `nzrp${run}-${randomUUID().slice(0, 6)}`,
      `RP-${run.toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`,
    ],
  );
  product = (made.rows[0] as { id: string }).id;
  const row = await pool.query<{ id: string }>(
    `insert into public.product_reviews (product_id, user_id, order_id, rating, body, status, published_at)
     values ($1, $2, $5, 5, 'A review long enough to be valid.', $3, now() - make_interval(mins => $4)) returning id`,
    [product, author, status, minutesAgo, order],
  );
  return (row.rows[0] as { id: string }).id;
}

const keyFor = (reviewId: string) => `review-images/${reviewId}/${randomUUID()}`;

const attach = (user: string, reviewId: string, key = keyFor(reviewId)) =>
  withUser(pool, user, async (client) => {
    const result = await client.query<{ value: { images: unknown[] } }>(
      'select public.add_review_image($1::uuid, $2, 800, 600) as value',
      [reviewId, key],
    );
    return result.rows[0]?.value.images.length ?? 0;
  });

beforeAll(async () => {
  category = (
    await pool.query<{ id: string }>(
      "insert into public.categories (slug, name, sort_order, is_active) values ($1, 'rp', 990, true) returning id",
      [`nzrp${run}-cat`],
    )
  ).rows[0]?.id as string;
  author = await addUser('author');
  stranger = await addUser('stranger');

  // A review belongs to an order: the author's own, placed through the real function.
  const stock = (
    await pool.query<{ id: string }>(
      `insert into public.products
         (category_id, slug, sku, name, summary, price_minor, stock_quantity, max_order_quantity, status, published_at)
       values ($1, $2, $3, 'rp-stock', 'fixture', 10000, 5, 5, 'active', now()) returning id`,
      [category, `nzrp${run}-stock`, `RP-${run.toUpperCase()}-STOCK`],
    )
  ).rows[0]?.id as string;
  const address = (
    await pool.query<{ id: string }>(
      `insert into public.addresses (user_id, label, recipient_name, phone, division, district, area, address_line, postal_code)
       values ($1, 'Home', 'Rahima Khatun', '+8801712345678', 'Dhaka', 'Dhaka', 'Dhanmondi', 'House 12, Road 5', '1212') returning id`,
      [author],
    )
  ).rows[0]?.id as string;
  zones.push(
    ...(
      await pool.query<{ zone: string }>(
        `insert into public.delivery_charges (zone, amount_minor) values ('inside_dhaka', 7000), ('outside_dhaka', 13000)
         on conflict (zone) do nothing returning zone`,
      )
    ).rows.map((row) => row.zone),
  );
  order = await withUser(pool, author, async (client) => {
    const placed = await client.query<{ value: { orderId: string } }>(
      'select public.place_cod_order($1::uuid, $2::uuid, $3::jsonb, null, $4::bigint, null) as value',
      [randomUUID(), address, JSON.stringify([{ productId: stock, quantity: 1 }]), 17_000],
    );
    return (placed.rows[0] as { value: { orderId: string } }).value.orderId;
  });
});

afterAll(async () => {
  await pool.query('delete from public.product_review_images where user_id = any($1::uuid[])', [
    users,
  ]);
  await pool.query('delete from public.product_reviews where user_id = any($1::uuid[])', [users]);
  await pool.query('delete from public.orders where user_id = any($1::uuid[])', [users]);
  await pool.query(
    'delete from public.inventory_movements where product_id in (select id from public.products where slug like $1)',
    [`nzrp${run}-%`],
  );
  await pool.query('delete from public.products where slug like $1', [`nzrp${run}-%`]);
  if (zones.length > 0) {
    await pool.query('delete from public.delivery_charges where zone::text = any($1::text[])', [
      zones,
    ]);
  }
  await pool.query('delete from public.categories where id = $1', [category]);
  await pool.query('delete from public.profiles where id = any($1::uuid[])', [users]);
  await pool.end();
});

describe('review photos', () => {
  it('attach to a review that was just published, one by one, up to four', async () => {
    const id = await review('approved', 0);
    expect(await attach(author, id)).toBe(1);
    expect(await attach(author, id)).toBe(2);
    expect(await attach(author, id)).toBe(3);
    expect(await attach(author, id)).toBe(4);
    // A fifth is refused by the database, whatever the client says.
    await expect(attach(author, id)).rejects.toMatchObject({ code: 'NZ467' });
  });

  it('attach to a review that is still waiting for approval', async () => {
    const id = await review('pending', 600);
    expect(await attach(author, id)).toBe(1);
  });

  it('are refused on a review published more than an hour ago', async () => {
    const id = await review('approved', 120);
    await expect(attach(author, id)).rejects.toMatchObject({ code: 'NZ466' });
  });

  it('are refused for someone else’s review, which looks like a missing one', async () => {
    const id = await review('approved', 0);
    await expect(attach(stranger, id)).rejects.toMatchObject({ code: 'NZ404' });
  });

  it('must use the key made for that review', async () => {
    const id = await review('approved', 0);
    const other = await review('approved', 0);
    await expect(attach(author, id, keyFor(other))).rejects.toMatchObject({ code: 'NZ468' });
  });
});
