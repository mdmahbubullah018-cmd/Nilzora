import type { MyReview, ProductReviewsResponse } from '@nilzora/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductReviews } from './product-reviews';

vi.mock('@/lib/review-actions', () => ({ submitReviewAction: vi.fn() }));
vi.mock('@/lib/picture-actions', () => ({ removeReviewPhotoAction: vi.fn() }));

/*
 * Who the visitor is decides what the reviews panel says. "You are signed out" is the only
 * state that may offer a sign-in link: a read that failed (or an unreachable API) must not
 * tell a signed-in customer to sign in — that is how a saved review looked unsent.
 */

const csrf = { name: '__csrf', token: 'token-1' };

const reviews: ProductReviewsResponse = {
  summary: { averageRating: 0, reviewCount: 0, distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } },
  reviews: [],
  page: 1,
  pageSize: 10,
  total: 0,
  totalPages: 0,
};

const eligible: MyReview = { eligible: true, review: null };

const written: MyReview = {
  eligible: true,
  review: {
    id: '0399dbb1-19cd-43d2-9b73-766b12da9a9a',
    rating: 5,
    title: 'Good product',
    body: 'It arrived quickly and fits well.',
    status: 'pending',
    moderationNote: null,
    images: [],
    createdAt: '2026-11-10T14:27:03.575796+00:00',
    updatedAt: '2026-11-10T14:27:03.575796+00:00',
  },
};

function show(overrides: Partial<Parameters<typeof ProductReviews>[0]> = {}) {
  return render(
    <ProductReviews
      productId="e61f0026-f136-45e6-94c2-bda2245edfbe"
      slug="casual-t-shirt"
      reviews={reviews}
      mine={undefined}
      csrf={undefined}
      {...overrides}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe('the reviews panel', () => {
  it('offers a sign-in link only when the visitor is signed out', () => {
    show({ viewer: 'signed_out' });

    const link = screen.getByRole('link', { name: 'Sign in' });
    expect(link.getAttribute('href')).toBe('/login?next=%2Fproducts%2Fcasual-t-shirt%23reviews');
  });

  it('never sends a signed-in customer to sign in when the check failed', () => {
    show({ viewer: 'signed_in' });

    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(screen.getByText(/couldn’t check your review/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe(
      '/products/casual-t-shirt#reviews',
    );
  });

  it('opens the form for an eligible buyer, and shows the review once it exists', () => {
    const { unmount } = show({ mine: eligible, csrf, viewer: 'signed_in' });
    expect(screen.getByRole('heading', { name: 'Write a review' })).toBeTruthy();
    unmount();

    show({ mine: written, csrf, viewer: 'signed_in' });
    expect(screen.getByRole('heading', { name: 'Your review' })).toBeTruthy();
    expect(screen.getByText(/Waiting for the store to check it/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Write a review' })).toBeNull();
  });

  it('explains the purchase requirement to a signed-in visitor who is not eligible', () => {
    show({ mine: { eligible: false, review: null }, csrf, viewer: 'signed_in' });

    expect(screen.getByText(/once an order containing it has been delivered/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });
});
