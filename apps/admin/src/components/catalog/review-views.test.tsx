// @vitest-environment jsdom
import type { AdminReview } from '@nilzora/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReviewListView } from './review-views';

vi.mock('./review-moderation', () => ({ ReviewModerationActions: () => null }));

/*
 * A pending review must reach this list, with everything a moderator decides by: the product,
 * the customer, the rating, the words, the date and the customer's photos. It is shown while
 * pending — nothing is published to make it appear.
 */

const pending: AdminReview = {
  id: '0399dbb1-19cd-43d2-9b73-766b12da9a9a',
  rating: 5,
  title: 'Good Product',
  body: 'Very Good Products',
  images: [
    {
      id: '4919e6ee-62b3-45ef-942f-362cae2c6fb3',
      url: 'https://media.example.com/review-images/r/1/full.webp',
      thumbUrl: 'https://media.example.com/review-images/r/1/thumb.webp',
    },
  ],
  // The database's own spelling: microseconds and a UTC offset.
  createdAt: '2026-11-10T14:27:03.575796+00:00',
  reply: null,
  helpfulCount: 0,
  notHelpfulCount: 0,
  viewerVote: null,
  productId: 'e61f0026-f136-45e6-94c2-bda2245edfbe',
  productName: 'Casual T Shirt',
  productSlug: 'casual-t-shirt',
  authorId: '59c10ff5-8cd6-48ca-95df-a2a6aa1edee6',
  authorName: 'Md Atik Ullah',
  authorEmail: 'customer@example.com',
  status: 'pending',
  moderatedAt: null,
  moderationNote: null,
};

describe('the review moderation list', () => {
  it('shows a pending review in full, with its photo', () => {
    const { container } = render(
      <ReviewListView
        reviews={[pending]}
        filters={{ status: 'pending' }}
        page={1}
        total={1}
        totalPages={1}
        pageSize={25}
        csrf={{ name: 'csrf_token', token: 'token' }}
      />,
    );

    const list = screen.getByRole('list', { name: 'Reviews' });
    const row = within(list).getAllByRole('listitem')[0] as HTMLElement;
    expect(within(row).getByText('Good Product')).toBeTruthy();
    expect(within(row).getByText('Very Good Products')).toBeTruthy();
    expect(within(row).getByLabelText('5 out of 5')).toBeTruthy();
    expect(within(row).getByRole('link', { name: 'Casual T Shirt' })).toBeTruthy();
    expect(within(row).getByText('Md Atik Ullah')).toBeTruthy();
    expect(within(row).getByText('Awaiting review')).toBeTruthy();

    const photo = within(row).getByRole('link', { name: /Photo 1 of the review/ });
    expect(photo.getAttribute('href')).toBe(
      'https://media.example.com/review-images/r/1/full.webp',
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://media.example.com/review-images/r/1/thumb.webp',
    );
  });
});
