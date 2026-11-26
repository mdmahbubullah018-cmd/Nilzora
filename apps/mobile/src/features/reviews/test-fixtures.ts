import type {
  MyReview,
  ProductReviewsResponse,
  PublicReview,
  RatingSummary,
} from '@nilzora/contracts';

/*
 * Review fixtures for screen tests. The shapes match the shared contracts, so a change to a
 * review response shows up here as a type error rather than as a silently passing test.
 */

export const productId = '0f8fad5b-d9cb-469f-a165-70867728950e';

export function ratingSummary(overrides: Partial<RatingSummary> = {}): RatingSummary {
  return {
    averageRating: 4.5,
    reviewCount: 2,
    distribution: { '1': 0, '2': 0, '3': 0, '4': 1, '5': 1 },
    ...overrides,
  };
}

export function publicReview(overrides: Partial<PublicReview> = {}): PublicReview {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    rating: 5,
    title: 'Exactly as described',
    body: 'Soft cotton and the fit is right. Arrived in Dhaka in two days.',
    authorName: 'Ayesha R.',
    verified: true,
    images: [],
    createdAt: '2026-01-05T09:15:00.000Z',
    reply: null,
    helpfulCount: 0,
    notHelpfulCount: 0,
    viewerVote: null,
    ...overrides,
  };
}

export function reviewsResponse(
  overrides: Partial<ProductReviewsResponse> = {},
): ProductReviewsResponse {
  const reviews = overrides.reviews ?? [publicReview()];
  return {
    summary: ratingSummary({ reviewCount: reviews.length }),
    reviews,
    page: 1,
    pageSize: 10,
    total: reviews.length,
    totalPages: 1,
    ...overrides,
  };
}

export function emptyReviews(): ProductReviewsResponse {
  return {
    summary: {
      averageRating: 0,
      reviewCount: 0,
      distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
    },
    reviews: [],
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 0,
  };
}

/** The customer's own review of this product, if they wrote one, and whether they may. */
export function myReview(overrides: Partial<MyReview> = {}): MyReview {
  return { eligible: false, review: null, ...overrides };
}
