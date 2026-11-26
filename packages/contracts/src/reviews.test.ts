import { describe, expect, it } from 'vitest';
import {
  adminReviewListResponseSchema,
  myReviewSchema,
  productReviewsResponseSchema,
} from './reviews';

/*
 * The review functions answer with `jsonb_build_object`, so PostgreSQL writes a timestamptz
 * itself: `2026-11-10T14:27:03.575796+00:00`. A schema that only accepted a trailing `Z`
 * refused that, and every read holding a review failed as a whole — the customer's own review
 * (so the product page offered "Sign in to review") and the moderation queue (so no review
 * ever appeared in the admin). These cases pin the accepted spellings.
 */

const summary = {
  averageRating: 5,
  reviewCount: 1,
  distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 1 },
};

describe('review timestamps', () => {
  it('accepts the database’s own spelling, with microseconds and a UTC offset', () => {
    const review = {
      id: '0399dbb1-19cd-43d2-9b73-766b12da9a9a',
      rating: 5,
      title: 'Good product',
      body: 'It arrived quickly and fits well.',
      status: 'pending',
      moderationNote: null,
      images: [],
      createdAt: '2026-11-10T14:27:03.575796+00:00',
      updatedAt: '2026-11-10T14:27:03.575796+00:00',
    };

    expect(myReviewSchema.safeParse({ eligible: true, review }).success).toBe(true);
    expect(
      productReviewsResponseSchema.safeParse({
        summary,
        reviews: [
          {
            id: review.id,
            rating: review.rating,
            title: review.title,
            body: review.body,
            authorName: 'Ayesha R.',
            verified: true,
            images: [],
            createdAt: review.createdAt,
          },
        ],
        page: 1,
        pageSize: 10,
        total: 1,
        totalPages: 1,
      }).success,
    ).toBe(true);
    expect(
      adminReviewListResponseSchema.safeParse({
        reviews: [
          {
            id: review.id,
            rating: review.rating,
            title: review.title,
            body: review.body,
            images: [],
            createdAt: review.createdAt,
            productId: 'e61f0026-f136-45e6-94c2-bda2245edfbe',
            productName: 'Casual T Shirt',
            productSlug: 'casual-t-shirt',
            authorId: '59c10ff5-8cd6-48ca-95df-a2a6aa1edee6',
            authorName: 'Md Atik Ullah',
            authorEmail: 'customer@example.com',
            status: 'pending',
            moderatedAt: null,
            moderationNote: null,
          },
        ],
        page: 1,
        pageSize: 25,
        total: 1,
        totalPages: 1,
      }).success,
    ).toBe(true);
  });

  it('still accepts a UTC instant written with Z, so both stores answer the same shape', () => {
    const parsed = myReviewSchema.safeParse({
      eligible: false,
      review: {
        id: '0399dbb1-19cd-43d2-9b73-766b12da9a9a',
        rating: 4,
        title: null,
        body: 'A perfectly acceptable review body.',
        status: 'approved',
        moderationNote: null,
        images: [],
        createdAt: '2026-11-10T14:06:27.555Z',
        updatedAt: '2026-11-10T14:06:27.555Z',
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('still refuses a value that is not an instant at all', () => {
    const parsed = myReviewSchema.safeParse({ eligible: true, review: { createdAt: 'yesterday' } });
    expect(parsed.success).toBe(false);
  });
});
