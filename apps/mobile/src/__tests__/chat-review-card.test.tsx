import type { ChatConversationDetail } from '@nilzora/contracts';
import { screen, waitFor } from '@testing-library/react-native';
import { ChatReviewCard } from '@/features/support/chat-review-card';
import { createFakeApiClient } from '@/test-utils/api-fakes';
import { renderWithProviders } from '@/test-utils/render-with-providers';

const PRODUCT_ID = '0b9f7f5e-6a14-4c43-8d63-2d1e8f3b7a01';

function detail(status: string, number = 'NZ100042'): ChatConversationDetail {
  return {
    order: {
      id: '5a3c2f10-9d88-4b0e-a1d4-7e6f2c9b1b02',
      number,
      status,
      paymentStatus: 'collected',
      totalMinor: 50_000,
      itemCount: 1,
      placedAt: '2026-01-05T10:00:00.000Z',
      items: [],
    },
    product: null,
  } as unknown as ChatConversationDetail;
}

const PENDING = {
  items: [
    {
      productId: PRODUCT_ID,
      productName: 'Cotton kurta',
      productSlug: 'cotton-kurta',
      variantLabel: null,
      image: null,
      orderNumber: 'NZ100042',
      deliveredAt: '2026-01-07T10:00:00.000Z',
    },
  ],
};

describe('<ChatReviewCard>', () => {
  it('invites a review in a thread about a delivered order with an unreviewed product', async () => {
    const api = createFakeApiClient();
    api.pendingReviews.mockResolvedValue(PENDING);
    await renderWithProviders(<ChatReviewCard detail={detail('delivered')} />, { api });
    expect(await screen.findByText('How was Cotton kurta?')).toBeOnTheScreen();
  });

  it('stays away from another order, and never asks before delivery', async () => {
    const api = createFakeApiClient();
    api.pendingReviews.mockResolvedValue(PENDING);
    await renderWithProviders(<ChatReviewCard detail={detail('delivered', 'NZ999999')} />, { api });
    await waitFor(() => expect(api.pendingReviews).toHaveBeenCalled());
    expect(screen.queryByTestId('chat-review-card')).not.toBeOnTheScreen();

    const early = createFakeApiClient();
    await renderWithProviders(<ChatReviewCard detail={detail('shipped')} />, { api: early });
    expect(screen.queryByTestId('chat-review-card')).not.toBeOnTheScreen();
    expect(early.pendingReviews).not.toHaveBeenCalled();
  });
});
