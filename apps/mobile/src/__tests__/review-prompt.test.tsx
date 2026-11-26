import { screen, waitFor } from '@testing-library/react-native';
import { ReviewPrompt } from '@/features/reviews/review-prompt';
import { createFakeApiClient } from '@/test-utils/api-fakes';
import { renderWithProviders } from '@/test-utils/render-with-providers';
import { FAKE_ACCESS_TOKEN } from '@/test-utils/session-fakes';

const PRODUCT_ID = '0b9f7f5e-6a14-4c43-8d63-2d1e8f3b7a01';

const ITEM = {
  productId: PRODUCT_ID,
  productName: 'Cotton kurta',
  productSlug: 'cotton-kurta',
  variantLabel: 'Size: M',
  image: null,
  orderNumber: 'NZ100042',
  deliveredAt: '2026-01-07T10:00:00.000Z',
};

describe('<ReviewPrompt>', () => {
  it('asks about the delivered product the server names, and "Not now" is recorded', async () => {
    const api = createFakeApiClient();
    api.reviewPrompt.mockResolvedValue({ item: ITEM });
    api.dismissReviewPrompt.mockResolvedValue(undefined);
    const { user } = await renderWithProviders(<ReviewPrompt />, { api });

    expect(await screen.findByText('How was your order?')).toBeOnTheScreen();
    expect(screen.getByText('Cotton kurta')).toBeOnTheScreen();
    expect(screen.getByText('Delivered · order NZ100042')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() =>
      expect(api.dismissReviewPrompt).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN, PRODUCT_ID),
    );
    await waitFor(() => expect(screen.queryByText('How was your order?')).not.toBeOnTheScreen());
  });

  it('shows nothing when there is nothing to ask, or the request fails', async () => {
    const api = createFakeApiClient();
    api.reviewPrompt.mockResolvedValue({ item: null });
    await renderWithProviders(<ReviewPrompt />, { api });
    await waitFor(() => expect(api.reviewPrompt).toHaveBeenCalled());
    expect(screen.queryByText('How was your order?')).not.toBeOnTheScreen();

    const failing = createFakeApiClient();
    failing.reviewPrompt.mockRejectedValue(new Error('offline'));
    await renderWithProviders(<ReviewPrompt />, { api: failing });
    await waitFor(() => expect(failing.reviewPrompt).toHaveBeenCalled());
    expect(screen.queryByText('How was your order?')).not.toBeOnTheScreen();
  });
});
