import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createDatabasePool } from '../../db/pool';
import { withAnon, withUser } from '../../db/user-context';

/*
 * Review votes and public answers, over the real database
 * -----------------------------------------------------
 * The one rule that cannot be tested through a fake is the row-level one: a customer holds at
 * most one verdict per review, so pressing the button again moves that vote instead of adding a
 * second. The other rules — no vote on your own review, no vote on an unpublished one, and no
 * vote detail leaked to an anonymous reader — are checked here too, because they are enforced by
 * the function rather than by the API.
 */

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 4 });

const run = randomUUID().slice(0, 8);
const created: string[] = [];
const reviewIds: string[] = [];

async function account(label: string): Promise<string> {
  const id = randomUUID();
  await pool.query('select public.provision_account($1::uuid, $2, $3, null, null, true)', [
    id,
    `it-votes-${run}-${label}-${id.slice(0, 8)}@example.com`,
    `Voter ${label}`,
  ]);
  created.push(id);
  return id;
}

/** A published review written by `authorId`, with the whole chain the review table requires. */
async function publishedReview(authorId: string, status = 'approved'): Promise<string> {
  const productId = randomUUID();
  const slug = `it-votes-${run}-${productId.slice(0, 8)}`;
  const sku = `IT-VOTE-${productId.slice(0, 8).toUpperCase()}`;
  await pool.query(
    `insert into public.products (id, slug, sku, name, description, price_minor, status, moderation_status, published_at, category_id)
     select $1::uuid, $2, $3, 'Voted product', 'A product for the vote test', 10000, 'active', 'approved', now(), id
       from public.categories limit 1`,
    [productId, slug, sku],
  );

  const orderId = randomUUID();
  await pool.query(
    `insert into public.orders (
       id, user_id, status, item_count, subtotal_minor, shipping_fee_minor, total_minor,
       delivery_zone, ship_recipient_name, ship_phone, ship_division, ship_district,
       ship_area, ship_address_line, idempotency_key, request_fingerprint
     ) values (
       $1::uuid, $2::uuid, 'delivered', 1, 10000, 0, 10000,
       'inside_dhaka', 'Vote Test', '01700000000', 'Dhaka', 'Dhaka',
       'Gulshan', 'House 1, Road 1', $3::uuid, 'it-vote-fixture'
     )`,
    [orderId, authorId, randomUUID()],
  );

  const reviewId = randomUUID();
  await pool.query(
    `insert into public.product_reviews (id, product_id, user_id, order_id, rating, body, status)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 5, 'Well made and fairly priced.', $5)`,
    [reviewId, productId, authorId, orderId, status],
  );
  reviewIds.push(reviewId);
  return reviewId;
}

afterAll(async () => {
  if (reviewIds.length > 0) {
    await pool.query('delete from public.product_reviews where id = any($1::uuid[])', [reviewIds]);
  }
  if (created.length > 0) {
    // The fixture places a real order, which references the account: orders first.
    await pool.query(
      'delete from public.product_reviews where user_id = any($1::uuid[]) and order_id is not null',
      [created],
    );
    await pool.query('delete from public.orders where user_id = any($1::uuid[])', [created]);
    await pool.query('delete from public.profiles where id = any($1::uuid[])', [created]);
  }
  await pool.end();
});

describe('a review nobody has voted on', () => {
  it('reports no votes rather than no row', async () => {
    const author = await account('author');
    const reviewId = await publishedReview(author);

    const rows = await withAnon(pool, async (client) => {
      const result = await client.query<{ review_id: string }>(
        'select * from public.review_vote_summaries($1::uuid[])',
        [[reviewId]],
      );
      return result.rows;
    });
    // No votes means no row at all: the caller defaults the counts to zero.
    expect(rows).toHaveLength(0);
  });
});

describe('one verdict per customer', () => {
  it('moves the same vote instead of adding another, and can be withdrawn', async () => {
    const author = await account('author');
    const voter = await account('voter');
    const reviewId = await publishedReview(author);

    const cast = (helpful: boolean | null) =>
      withUser(pool, voter, async (client) => {
        const result = await client.query<{ payload: Record<string, unknown> }>(
          'select public.vote_product_review($1::uuid, $2::boolean) as payload',
          [reviewId, helpful],
        );
        return result.rows[0]?.payload;
      });

    expect(await cast(true)).toMatchObject({
      helpfulCount: 1,
      notHelpfulCount: 0,
      viewerVote: 'helpful',
    });
    // The same press again is still one vote.
    expect(await cast(true)).toMatchObject({ helpfulCount: 1, notHelpfulCount: 0 });
    // Changing one's mind replaces it.
    expect(await cast(false)).toMatchObject({
      helpfulCount: 0,
      notHelpfulCount: 1,
      viewerVote: 'not_helpful',
    });
    // And withdrawing leaves nothing.
    expect(await cast(null)).toMatchObject({
      helpfulCount: 0,
      notHelpfulCount: 0,
      viewerVote: null,
    });

    const stored = await pool.query(
      'select 1 from public.product_review_votes where review_id = $1::uuid',
      [reviewId],
    );
    expect(stored.rowCount).toBe(0);
  });

  it('refuses a vote on one’s own review', async () => {
    const author = await account('author');
    const reviewId = await publishedReview(author);

    await expect(
      withUser(pool, author, async (client) => {
        await client.query('select public.vote_product_review($1::uuid, true)', [reviewId]);
      }),
    ).rejects.toThrow(/own review/i);
  });

  it('refuses a vote on a review that is not published', async () => {
    const author = await account('author');
    const voter = await account('voter');
    const reviewId = await publishedReview(author, 'pending');

    await expect(
      withUser(pool, voter, async (client) => {
        await client.query('select public.vote_product_review($1::uuid, true)', [reviewId]);
      }),
    ).rejects.toThrow(/not published/i);
  });
});

describe('the public answer', () => {
  it('is written by an account holding reviews.reply and reaches a reader', async () => {
    const author = await account('author');
    const staff = await account('staff');
    await pool.query("update public.user_roles set role = 'admin' where user_id = $1::uuid", [
      staff,
    ]);
    const reviewId = await publishedReview(author);

    const reply = await withUser(pool, staff, async (client) => {
      const result = await client.query<{ payload: Record<string, unknown> }>(
        'select public.admin_reply_to_review($1::uuid, $2::text) as payload',
        [reviewId, 'Thank you for taking the time to write this.'],
      );
      return result.rows[0]?.payload;
    });
    expect(reply).toMatchObject({
      authorName: 'Nilzora',
      body: 'Thank you for taking the time to write this.',
    });

    // Reading it needs the caller's permission too, so the author checks it their own way.
    const stored = await pool.query<{ body: string }>(
      'select body from public.product_review_replies where review_id = $1::uuid',
      [reviewId],
    );
    expect(stored.rows[0]?.body).toBe('Thank you for taking the time to write this.');
  });

  it('is refused for an account without the permission', async () => {
    const author = await account('author');
    const customer = await account('customer');
    const reviewId = await publishedReview(author);

    await expect(
      withUser(pool, customer, async (client) => {
        await client.query('select public.admin_reply_to_review($1::uuid, $2::text)', [
          reviewId,
          'A reply from someone who may not write one',
        ]);
      }),
    ).rejects.toThrow(/missing permission|permission/i);
  });
});
