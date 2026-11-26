import { ApiError } from '@nilzora/api-client';
import { screen } from '@testing-library/react-native';
import { ProductReviews } from '../features/reviews/product-reviews';
import {
  emptyReviews,
  myReview,
  productId,
  publicReview,
  reviewsResponse,
} from '../features/reviews/test-fixtures';
import { createFakeApiClient } from '../test-utils/api-fakes';
import { renderWithProviders } from '../test-utils/render-with-providers';
import { picture } from '../test-utils/upload-fakes';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

const SLUG = 'cotton-shirt';

/** The three calls the section makes, stubbed so each test only chooses the interesting one. */
function reviewsApi(options: {
  reviews?: ReturnType<typeof reviewsResponse>;
  mine?: ReturnType<typeof myReview>;
}) {
  const api = createFakeApiClient();
  api.productReviews.mockResolvedValue(options.reviews ?? reviewsResponse());
  api.myProductReview.mockResolvedValue(options.mine ?? myReview());
  api.submitProductReview.mockResolvedValue({ reviewId: productId });
  return api;
}

const render = (
  api: ReturnType<typeof reviewsApi>,
  session?: Parameters<typeof renderWithProviders>[1],
) =>
  renderWithProviders(<ProductReviews productId={productId} slug={SLUG} />, {
    api,
    ...session,
  });

describe('ProductReviews', () => {
  it('shows the rating summary counted by the API and the published reviews', async () => {
    const api = reviewsApi({
      reviews: reviewsResponse({
        reviews: [
          publicReview({ id: '11111111-1111-4111-8111-111111111111', rating: 5 }),
          publicReview({
            id: '22222222-2222-4222-8222-222222222222',
            rating: 4,
            title: null,
            authorName: 'Tanvir A.',
          }),
        ],
      }),
    });
    await render(api);

    expect(await screen.findByText('Exactly as described')).toBeOnTheScreen();
    expect(screen.getByLabelText('4.5 out of 5 stars')).toBeOnTheScreen();
    expect(screen.getByText('2 reviews')).toBeOnTheScreen();
    expect(screen.getByText('Tanvir A.')).toBeOnTheScreen();
    expect(screen.queryByText('Write a review')).not.toBeOnTheScreen();
  });

  it('says so when nothing is published yet, instead of inventing a rating', async () => {
    await render(reviewsApi({ reviews: emptyReviews() }));

    expect(
      await screen.findByText('No reviews yet. Buyers can review a product once they receive it.'),
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText(/out of 5 stars/)).not.toBeOnTheScreen();
  });

  it('offers the form only to a customer the API said may review the product', async () => {
    await render(reviewsApi({ mine: myReview({ eligible: true }) }));

    expect(await screen.findByText('Write a review')).toBeOnTheScreen();
    expect(screen.getByLabelText('5 stars out of 5')).toBeOnTheScreen();
    expect(screen.getByLabelText('Post review')).toBeOnTheScreen();
  });

  it('explains that delivery is what makes a product reviewable', async () => {
    await render(reviewsApi({ mine: myReview({ eligible: false }) }));

    expect(
      await screen.findByText(
        'You can review this product once an order containing it has been delivered.',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByText('Write a review')).not.toBeOnTheScreen();
  });

  it('shows the customer their own review and its moderation state', async () => {
    await render(
      reviewsApi({
        mine: myReview({
          eligible: true,
          review: {
            id: '33333333-3333-4333-8333-333333333333',
            rating: 3,
            title: 'Small fit',
            body: 'Nice fabric but I would take one size up.',
            status: 'pending',
            moderationNote: null,
            images: [],
            createdAt: '2026-01-06T10:00:00.000Z',
            updatedAt: '2026-01-06T10:00:00.000Z',
          },
        }),
      }),
    );

    expect(await screen.findByText('Your review')).toBeOnTheScreen();
    expect(screen.getByText('Waiting for the store to check it.')).toBeOnTheScreen();
    expect(screen.queryByText('Write a review')).not.toBeOnTheScreen();
  });

  it('sends a review the API accepts as waiting for approval', async () => {
    const api = reviewsApi({ mine: myReview({ eligible: true }) });
    const { user } = await render(api);

    await user.press(await screen.findByLabelText('4 stars out of 5'));
    await user.type(screen.getByLabelText('Your review'), 'Very comfortable to wear all day.');
    await user.press(screen.getByLabelText('Post review'));

    expect(api.submitProductReview).toHaveBeenCalledWith(expect.any(String), productId, {
      rating: 4,
      body: 'Very comfortable to wear all day.',
    });
  });

  it('checks the rating and the length of the text before calling the API', async () => {
    const api = reviewsApi({ mine: myReview({ eligible: true }) });
    const { user } = await render(api);

    await user.press(await screen.findByLabelText('Post review'));

    expect(await screen.findByText('Write at least 10 characters')).toBeOnTheScreen();
    expect(api.submitProductReview).not.toHaveBeenCalled();
  });

  it('tells a refused review what the store decided, in its own words', async () => {
    const api = reviewsApi({ mine: myReview({ eligible: true }) });
    api.submitProductReview.mockRejectedValue(
      new ApiError(403, 'review_not_eligible', 'Only customers who received this product'),
    );
    const { user } = await render(api);

    await user.press(await screen.findByLabelText('5 stars out of 5'));
    await user.type(screen.getByLabelText('Your review'), 'A lovely shirt, very good value.');
    await user.press(screen.getByLabelText('Post review'));

    expect(
      await screen.findByText('Only customers who received this product can review it.'),
    ).toBeOnTheScreen();
  });

  it('shows the photos a customer attached, and opens one larger when tapped', async () => {
    const { user } = await render(
      reviewsApi({
        reviews: reviewsResponse({
          reviews: [
            publicReview({
              authorName: 'Ayesha R.',
              images: [
                { id: '55555555-5555-4555-8555-555555555555', ...picture },
                {
                  id: '66666666-6666-4666-8666-666666666666',
                  url: 'https://media.example.test/reviews/2/full.webp',
                  thumbUrl: 'https://media.example.test/reviews/2/thumb.webp',
                },
              ],
            }),
          ],
        }),
      }),
    );

    const first = await screen.findByLabelText('Photo 1 of 2 from Ayesha R., open it larger');
    expect(screen.getByLabelText('Photo 2 of 2 from Ayesha R., open it larger')).toBeOnTheScreen();
    expect(screen.queryByText('Photo 1 of 2')).not.toBeOnTheScreen();

    await user.press(first);

    expect(await screen.findByText('Photo 1 of 2')).toBeOnTheScreen();
    expect(screen.getByLabelText('Review photo 1 of 2')).toBeOnTheScreen();
  });

  it('shows no photo strip for a review written without photos', async () => {
    await render(reviewsApi({}));

    expect(await screen.findByText('Exactly as described')).toBeOnTheScreen();
    expect(screen.queryByLabelText(/^Photo 1 of/)).not.toBeOnTheScreen();
  });

  it('asks a signed-out visitor to sign in, and never calls the account endpoints', async () => {
    const api = reviewsApi({});
    await render(api, { session: { status: 'signed_out' } });

    expect(
      await screen.findByText('Sign in to review a product you have received.'),
    ).toBeOnTheScreen();
    expect(api.myProductReview).not.toHaveBeenCalled();
  });
});
