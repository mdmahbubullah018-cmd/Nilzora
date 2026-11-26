import { screen, within } from '@testing-library/react-native';
import { ProductReviewsSheet } from '../features/reviews/product-reviews-sheet';
import { myReview, productId, reviewsResponse } from '../features/reviews/test-fixtures';
import { createFakeApiClient } from '../test-utils/api-fakes';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

const SLUG = 'cotton-shirt';

function sheetApi() {
  const api = createFakeApiClient();
  api.productReviews.mockResolvedValue(reviewsResponse());
  api.myProductReview.mockResolvedValue(myReview());
  return api;
}

const render = (api: ReturnType<typeof sheetApi>) =>
  renderWithProviders(<ProductReviewsSheet productId={productId} slug={SLUG} />, { api });

describe('ProductReviewsSheet', () => {
  it('keeps the reviews to one compact row until it is opened', async () => {
    const api = sheetApi();
    await render(api);

    expect(
      await screen.findByRole('button', {
        name: 'Reviews, 4.5 out of 5 from 1 review',
      }),
    ).toBeOnTheScreen();
    expect(api.productReviews.mock.calls[0]?.[0]).toBe(SLUG);
    // Nothing from the panel is on screen yet.
    expect(screen.queryByText('Exactly as described')).not.toBeOnTheScreen();
    expect(screen.queryByText('Write a review')).not.toBeOnTheScreen();
  });

  it('opens the reviews of this product in a sheet', async () => {
    const { user } = await render(sheetApi());

    await user.press(
      await screen.findByRole('button', { name: 'Reviews, 4.5 out of 5 from 1 review' }),
    );

    expect(screen.getByRole('header', { name: 'Reviews' })).toBeOnTheScreen();
    expect(await screen.findByText('Exactly as described')).toBeOnTheScreen();
    const sheet = within(screen.getByTestId('reviews-sheet'));
    expect(sheet.getByText('4.5')).toBeOnTheScreen();
    expect(sheet.getByLabelText('1 review gave 5 stars')).toBeOnTheScreen();
  });

  it('closes the sheet again from its close button', async () => {
    const { user } = await render(sheetApi());

    await user.press(
      await screen.findByRole('button', { name: 'Reviews, 4.5 out of 5 from 1 review' }),
    );
    await user.press(screen.getByRole('button', { name: 'Close reviews' }));

    expect(screen.queryByText('Exactly as described')).not.toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Reviews' })).not.toBeOnTheScreen();
  });

  it('says there are no reviews yet instead of inventing a rating', async () => {
    const api = createFakeApiClient();
    api.productReviews.mockResolvedValue(
      reviewsResponse({
        reviews: [],
        summary: {
          averageRating: 0,
          reviewCount: 0,
          distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
        },
        total: 0,
        totalPages: 0,
      }),
    );
    api.myProductReview.mockResolvedValue(myReview());
    const { user } = await render(api);

    await user.press(await screen.findByRole('button', { name: 'Reviews' }));

    expect(
      await screen.findByText('No reviews yet. Buyers can review a product once they receive it.'),
    ).toBeOnTheScreen();
  });
});
