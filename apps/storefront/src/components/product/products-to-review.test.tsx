import type { ReviewableItem } from '@nilzora/contracts';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { daysSinceDelivery, deliveredAgoLabel, ProductsToReview } from './products-to-review';

const submitReview = vi.hoisted(() => vi.fn());
vi.mock('@/lib/review-actions', () => ({ submitReviewAction: submitReview }));

const csrf = { name: '__csrf', token: 'token-1' };
/** A fixed clock, so "days ago" is the same answer on every run. */
const NOW = '2026-11-20T06:00:00.000Z';

const shirt: ReviewableItem = {
  productId: '0f8fad5b-d9cb-469f-a165-70867728950e',
  productName: 'Casual T Shirt',
  productSlug: 'casual-t-shirt',
  variantLabel: 'Navy / L',
  image: {
    url: 'https://media.example.com/reviews/1/full.webp',
    thumbUrl: 'https://media.example.com/reviews/1/thumb.webp',
    alt: null,
  },
  orderNumber: 'NZ100042',
  deliveredAt: '2026-11-18T22:00:00.000Z',
};

const hoodie: ReviewableItem = {
  productId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  productName: 'Fleece Hoodie',
  productSlug: 'fleece-hoodie',
  variantLabel: null,
  image: null,
  orderNumber: 'NZ100039',
  deliveredAt: '2026-11-10T10:00:00.000Z',
};

beforeEach(() => {
  submitReview.mockReset();
});
afterEach(cleanup);

function renderSection(items: readonly ReviewableItem[] = [shirt, hoodie]) {
  return render(<ProductsToReview items={items} csrf={csrf} now={NOW} />);
}

describe('daysSinceDelivery', () => {
  it('counts whole days, never less than none', () => {
    expect(daysSinceDelivery('2026-11-20T05:00:00.000Z', NOW)).toBe(0);
    expect(daysSinceDelivery('2026-11-19T05:00:00.000Z', NOW)).toBe(1);
    expect(daysSinceDelivery('2026-11-10T10:00:00.000Z', NOW)).toBe(9);
    expect(daysSinceDelivery('2026-12-01T10:00:00.000Z', NOW)).toBe(0);
    expect(daysSinceDelivery('not a date', NOW)).toBe(0);
  });

  it('says "today" and "yesterday" rather than counting to one', () => {
    expect(deliveredAgoLabel(0)).toBe('Delivered today');
    expect(deliveredAgoLabel(1)).toBe('Delivered yesterday');
    expect(deliveredAgoLabel(9)).toBe('Delivered 9 days ago');
  });
});

describe('ProductsToReview', () => {
  it('names each product with the order it arrived in and how long ago', () => {
    renderSection();

    expect(screen.getByRole('heading', { name: /Products to review/ })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Casual T Shirt' }).getAttribute('href')).toBe(
      '/products/casual-t-shirt',
    );
    expect(screen.getByText('Navy / L')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Order NZ100042' }).getAttribute('href')).toBe(
      '/account/orders/NZ100042',
    );
    expect(screen.getByText('Delivered yesterday')).not.toBeNull();
    expect(screen.getByText('Delivered 9 days ago')).not.toBeNull();
  });

  it('marks the products that have been waiting past the reminder window', () => {
    renderSection();

    // One row is a day old, the other nine: only the second one is a reminder.
    expect(screen.getAllByText('Still waiting for your review')).toHaveLength(1);
    const reminded = screen.getByRole('link', { name: 'Fleece Hoodie' }).closest('li');
    expect(within(reminded as HTMLElement).getByText('Still waiting for your review')).not.toBeNull();
  });

  it('draws nothing at all when every product has been reviewed', () => {
    const { container } = renderSection([]);

    expect(container.textContent).toBe('');
  });

  it('opens the review form for the product whose button was pressed', () => {
    renderSection();

    fireEvent.click(screen.getAllByRole('button', { name: 'Write a review' })[1] as HTMLElement);

    const dialog = screen.getByRole('dialog', { name: 'Review Fleece Hoodie' });
    expect(within(dialog).getByText(/Bought in order NZ100039/)).not.toBeNull();
    expect(within(dialog).getByLabelText(/Your review/)).not.toBeNull();
  });
});
