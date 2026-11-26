import { ApiError } from '@nilzora/api-client';
import { screen } from '@testing-library/react-native';
import WishlistScreen from '../../app/(tabs)/wishlist';
import { product } from '../features/catalog/test-fixtures';
import { createFakeApiClient, type FakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock, router } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

beforeEach(resetRouterMock);

function wishlistApi(found = product()): FakeApiClient {
  const api = createFakeApiClient();
  api.getProduct.mockResolvedValue({ product: found });
  return api;
}

describe('WishlistScreen', () => {
  it('shows its own name and a way back, like the other pushed screens', async () => {
    const { user } = await renderWithProviders(<WishlistScreen />, {
      api: wishlistApi(),
      wishlist: ['cotton-shirt'],
    });
    await screen.findByText('Cotton shirt');

    expect(screen.getByRole('header', { name: 'Wishlist' })).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Go back' }));

    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('falls back to the home screen when the wishlist was opened directly', async () => {
    router.canGoBack.mockReturnValue(false);
    const { user } = await renderWithProviders(<WishlistScreen />, {
      api: wishlistApi(),
      wishlist: ['cotton-shirt'],
    });
    await screen.findByText('Cotton shirt');

    await user.press(screen.getByRole('button', { name: 'Go back' }));

    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('explains an empty wishlist and points at the shop', async () => {
    const { user } = await renderWithProviders(<WishlistScreen />, { api: wishlistApi() });

    expect(await screen.findByRole('header', { name: 'Your wishlist is empty' })).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Browse the shop' }));

    expect(router.navigate).toHaveBeenCalledWith('/shop');
  });

  it('says plainly that the list lives on this device only', async () => {
    await renderWithProviders(<WishlistScreen />, {
      api: wishlistApi(),
      wishlist: ['cotton-shirt'],
    });

    expect(await screen.findByText('Cotton shirt')).toBeOnTheScreen();
    expect(screen.getByText(/Saved on this device/)).toBeOnTheScreen();
  });

  it('fills each saved product from the live API, not from stored data', async () => {
    const api = wishlistApi();
    await renderWithProviders(<WishlistScreen />, { api, wishlist: ['cotton-shirt'] });

    expect(await screen.findByText('Cotton shirt')).toBeOnTheScreen();
    expect(api.getProduct).toHaveBeenCalledWith('cotton-shirt', expect.anything());
  });

  it('removes a saved product and returns to the empty state', async () => {
    const { user } = await renderWithProviders(<WishlistScreen />, {
      api: wishlistApi(),
      wishlist: ['cotton-shirt'],
    });

    await user.press(
      await screen.findByRole('button', { name: 'Remove Cotton shirt from your wishlist' }),
    );

    expect(await screen.findByRole('header', { name: 'Your wishlist is empty' })).toBeOnTheScreen();
  });

  it('marks a product the API no longer returns instead of inventing one', async () => {
    const api = createFakeApiClient();
    api.getProduct.mockRejectedValue(new ApiError(404, 'not_found', 'Product not found'));
    await renderWithProviders(<WishlistScreen />, { api, wishlist: ['cotton-shirt'] });

    expect(await screen.findByText('Product no longer available')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Remove Product no longer available from your wishlist' }),
    ).toBeOnTheScreen();
  });

  it('names a missing API address as a build problem, not a network one', async () => {
    await renderWithProviders(<WishlistScreen />, { api: null, wishlist: ['cotton-shirt'] });

    expect(await screen.findByRole('header', { name: 'Nilzora is not set up' })).toBeOnTheScreen();
    expect(screen.queryByText(/Pull down to try again/)).not.toBeOnTheScreen();
  });

  it('adds a saved product to the cart from the row', async () => {
    const found = product({ availability: 'in_stock', maxOrderQuantity: 5 });
    const { user } = await renderWithProviders(<WishlistScreen />, {
      api: wishlistApi(found),
      wishlist: ['cotton-shirt'],
    });

    await user.press(await screen.findByRole('button', { name: `Add ${found.name} to cart` }));

    // The same button now offers one more, which is the signal the cart holds it.
    expect(
      await screen.findByRole('button', { name: `Add one more ${found.name} to cart, 1 in cart` }),
    ).toBeOnTheScreen();
  });

  it('does not offer a sold-out product', async () => {
    const soldOut = product({ availability: 'out_of_stock' });
    await renderWithProviders(<WishlistScreen />, {
      api: wishlistApi(soldOut),
      wishlist: ['cotton-shirt'],
    });

    expect(await screen.findByText(soldOut.name)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: `Add ${soldOut.name} to cart` })).toBeNull();
  });
});
