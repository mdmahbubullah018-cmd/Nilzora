import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { adminSetup } from './admin-helpers';
import { testApp } from './helpers';

/*
 * The store's public answer to a review, and how customers rate reviews
 * ---------------------------------------------------------------------
 * Two new surfaces, both of which the database guards again on its own:
 *
 *   POST   /admin/product-reviews/:reviewId/reply   needs `reviews.reply`
 *   DELETE /admin/product-reviews/:reviewId/reply   needs `reviews.reply`
 *   PUT    /me/reviews/:reviewId/vote               a customer's own verdict
 *
 * The permission is deliberately not `reviews.moderate`: deciding whether a review may be shown
 * is a different power from speaking for the shop in public. These tests hold that separation,
 * and hold the one-vote rule that keeps a tally from being inflated.
 *
 * The reply routes live in the admin workspace and the vote route in the customer API, so the two
 * halves use the two apps that actually serve them.
 */

function review(setup: ReturnType<typeof adminSetup>, authorId: string, status = 'approved') {
  const row = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    productId: setup.products.lamp.id,
    productName: 'Desk Lamp',
    productSlug: 'desk-lamp',
    authorId,
    authorName: 'Ayesha R.',
    authorEmail: null,
    rating: 4,
    title: 'Good lamp',
    body: 'The light is warm and the stand is steady.',
    status: status as 'approved' | 'pending' | 'rejected',
    moderatedAt: null,
    moderationNote: null,
    images: [],
    createdAt: '2026-11-10T10:00:00.000Z',
    reply: null,
    helpfulCount: 0,
    notHelpfulCount: 0,
    viewerVote: null,
  };
  setup.admin.reviewRows.push(row);
  return row;
}

/** The customer-facing app, which is where the vote route is mounted. */
function customerApp(setup: ReturnType<typeof adminSetup>) {
  return testApp({ auth: setup.identity.deps, reviews: setup.admin.stores.reviews });
}

describe('answering a review in public', () => {
  it('saves the shop reply and reads it back on the review', async () => {
    const setup = adminSetup();
    const row = review(setup, setup.users.customer.id);

    const answer = await request(setup.app)
      .post(`/api/v1/admin/product-reviews/${row.id}/reply`)
      .set('Authorization', `Bearer ${setup.tokens.admin}`)
      .send({ body: 'Thank you — we are glad the light works for you.' });

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      authorName: 'Nilzora',
      body: 'Thank you — we are glad the light works for you.',
    });
    expect(setup.admin.reviewRows[0]?.reply?.body).toBe(
      'Thank you — we are glad the light works for you.',
    );
  });

  it('refuses an account that may moderate but may not speak for the shop', async () => {
    const setup = adminSetup();
    const row = review(setup, setup.users.customer.id);

    const answer = await request(setup.app)
      .post(`/api/v1/admin/product-reviews/${row.id}/reply`)
      .set('Authorization', `Bearer ${setup.tokens.staff}`)
      .send({ body: 'Our answer' });

    expect(answer.status).toBe(403);
    expect(setup.admin.reviewRows[0]?.reply).toBeNull();
  });

  it('refuses an empty answer before it reaches the database', async () => {
    const setup = adminSetup();
    const row = review(setup, setup.users.customer.id);

    const answer = await request(setup.app)
      .post(`/api/v1/admin/product-reviews/${row.id}/reply`)
      .set('Authorization', `Bearer ${setup.tokens.admin}`)
      .send({ body: ' ' });

    expect(answer.status).toBe(400);
  });

  it('withdraws the answer', async () => {
    const setup = adminSetup();
    const row = review(setup, setup.users.customer.id);

    await request(setup.app)
      .post(`/api/v1/admin/product-reviews/${row.id}/reply`)
      .set('Authorization', `Bearer ${setup.tokens.admin}`)
      .send({ body: 'An answer that will be withdrawn' });
    const removed = await request(setup.app)
      .delete(`/api/v1/admin/product-reviews/${row.id}/reply`)
      .set('Authorization', `Bearer ${setup.tokens.admin}`);

    expect(removed.status).toBe(204);
    expect(setup.admin.reviewRows[0]?.reply).toBeNull();
  });
});

describe('rating a review', () => {
  it('records a verdict and counts it once, however many times it is pressed', async () => {
    const setup = adminSetup();
    const row = review(setup, setup.users.owner.id);

    const first = await request(customerApp(setup))
      .put(`/api/v1/me/reviews/${row.id}/vote`)
      .set('Authorization', `Bearer ${setup.tokens.customer}`)
      .send({ verdict: 'helpful' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      helpfulCount: 1,
      notHelpfulCount: 0,
      viewerVote: 'helpful',
    });

    // The same account again, the same way: still one vote.
    const again = await request(customerApp(setup))
      .put(`/api/v1/me/reviews/${row.id}/vote`)
      .set('Authorization', `Bearer ${setup.tokens.customer}`)
      .send({ verdict: 'helpful' });
    expect(again.body).toMatchObject({ helpfulCount: 1, notHelpfulCount: 0 });

    // Changing one's mind moves the same vote rather than adding a second.
    const changed = await request(customerApp(setup))
      .put(`/api/v1/me/reviews/${row.id}/vote`)
      .set('Authorization', `Bearer ${setup.tokens.customer}`)
      .send({ verdict: 'not_helpful' });
    expect(changed.body).toMatchObject({
      helpfulCount: 0,
      notHelpfulCount: 1,
      viewerVote: 'not_helpful',
    });

    // And withdrawing it leaves nothing behind.
    const withdrawn = await request(customerApp(setup))
      .put(`/api/v1/me/reviews/${row.id}/vote`)
      .set('Authorization', `Bearer ${setup.tokens.customer}`)
      .send({ verdict: null });
    expect(withdrawn.body).toMatchObject({ helpfulCount: 0, notHelpfulCount: 0, viewerVote: null });
  });

  it('refuses a vote on one’s own review', async () => {
    const setup = adminSetup();
    const row = review(setup, setup.users.customer.id);

    const answer = await request(customerApp(setup))
      .put(`/api/v1/me/reviews/${row.id}/vote`)
      .set('Authorization', `Bearer ${setup.tokens.customer}`)
      .send({ verdict: 'helpful' });

    expect(answer.status).toBeGreaterThanOrEqual(400);
    expect(setup.admin.reviewVotes).toHaveLength(0);
  });

  it('needs an account', async () => {
    const setup = adminSetup();
    const row = review(setup, setup.users.owner.id);

    const answer = await request(customerApp(setup))
      .put(`/api/v1/me/reviews/${row.id}/vote`)
      .send({ verdict: 'helpful' });

    expect(answer.status).toBe(401);
  });
});
