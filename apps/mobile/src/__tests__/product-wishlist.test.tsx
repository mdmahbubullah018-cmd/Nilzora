import { screen } from '@testing-library/react-native';
import ProductScreen from '../../app/product/[slug]';
import { product } from '../features/catalog/test-fixtures';
import { createFakeApiClient, type FakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock, searchParams } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('@/test-utils/expo-router-mock'),
  Stack: { Screen: () => null },
}));

beforeEach(() => {
  resetRouterMock();
  searchParams.slug = 'cotton-shirt';
});

function productApi(): FakeApiClient {
  const api = createFakeApiClient();
  api.getProduct.mockResolvedValue({ product: product() });
  return api;
}

describe('Product wishlist action', () => {
  it('saves the product on this device when nobody is signed in', async () => {
    const { user, wishlistStore } = await renderWithProviders(<ProductScreen />, {
      api: productApi(),
      // A guest: there is no account to save to, so the device keeps the list.
      session: { status: 'signed_out' },
    });

    await user.press(await screen.findByRole('button', { name: 'Save to wishlist' }));

    expect(wishlistStore.getSnapshot().entries.map((entry) => entry.slug)).toEqual([
      'cotton-shirt',
    ]);
    expect(screen.getByRole('button', { name: 'Remove from wishlist' })).toBeOnTheScreen();
  });

  it('removes a product that was already saved on this device', async () => {
    const { user, wishlistStore } = await renderWithProviders(<ProductScreen />, {
      api: productApi(),
      session: { status: 'signed_out' },
      wishlist: ['cotton-shirt'],
    });

    await user.press(await screen.findByRole('button', { name: 'Remove from wishlist' }));

    expect(wishlistStore.getSnapshot().count).toBe(0);
    expect(screen.getByRole('button', { name: 'Save to wishlist' })).toBeOnTheScreen();
  });

  it('saves to the account, not the device, when a customer is signed in', async () => {
    const api = productApi();
    const saved = {
      items: [
        {
          productId: product().id,
          savedAt: '2026-11-05T10:00:00.000Z',
          product: product(),
        },
      ],
    };
    api.myWishlist.mockResolvedValue({ items: [] });
    api.addToWishlist.mockResolvedValue(saved);
    api.mergeWishlist.mockResolvedValue({ items: [] });

    const { user, wishlistStore } = await renderWithProviders(<ProductScreen />, { api });

    await user.press(await screen.findByRole('button', { name: 'Save to wishlist' }));

    expect(api.addToWishlist).toHaveBeenCalledWith(expect.any(String), product().id);
    // Nothing is written to the device list: the account owns it now.
    expect(wishlistStore.getSnapshot().count).toBe(0);
    expect(await screen.findByRole('button', { name: 'Remove from wishlist' })).toBeOnTheScreen();
  });
});
