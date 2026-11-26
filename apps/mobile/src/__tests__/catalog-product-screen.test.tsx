import { ApiError } from '@nilzora/api-client';
import { MAX_CART_LINES } from '@nilzora/contracts';
import { screen } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { AccessibilityInfo, Share } from 'react-native';
import ProductScreen from '../../app/product/[slug]';
import { product, productId, productImage, pullToRefresh } from '../features/catalog/test-fixtures';
import { emptyReviews, myReview, reviewsResponse } from '../features/reviews/test-fixtures';
import { createFakeApiClient, type FakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock, router, searchParams } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('@/test-utils/expo-router-mock'),
  Stack: { Screen: jest.fn(() => null) },
}));

const stackScreen = Stack.Screen as unknown as jest.Mock<null, [{ options: { title: string } }]>;

let announce: jest.SpiedFunction<typeof AccessibilityInfo.announceForAccessibility>;

beforeEach(() => {
  resetRouterMock();
  stackScreen.mockClear();
  searchParams.slug = 'cotton-shirt';
  announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => undefined);
});

const SHIRT = product({
  description: 'Soft cotton, made for everyday wear.\n\nMachine washable.\nDo not bleach.',
});

function productApi(found = SHIRT): FakeApiClient {
  const api = createFakeApiClient();
  api.getProduct.mockResolvedValue({ product: found });
  // The product screen also shows the reviews section; these keep it in its quiet state.
  api.productReviews.mockResolvedValue(emptyReviews());
  api.myProductReview.mockResolvedValue(myReview());
  return api;
}

const ADD_BUTTON = { name: /^(Add to cart|Out of stock)/ };
const addButton = () => screen.findByRole('button', ADD_BUTTON);
const lastTitle = () => stackScreen.mock.lastCall?.[0].options.title;
const offline = () => new ApiError(0, 'network_error', 'offline');

describe('ProductScreen', () => {
  it('shows the product photos as a gallery, and the placeholder when there are none', async () => {
    const images = [productImage(1, { alt: 'Front of the shirt' }), productImage(2)];
    await renderWithProviders(<ProductScreen />, {
      api: productApi(product({ images, image: images[0] ?? null })),
    });

    const gallery = await screen.findByRole('adjustable', { name: 'Front of the shirt' });
    expect(gallery).toHaveAccessibilityValue({ text: '1 of 2' });
  });

  it('shows no gallery for a product without photos', async () => {
    await renderWithProviders(<ProductScreen />, { api: productApi() });

    expect(await screen.findByRole('header', { name: 'Cotton shirt' })).toBeOnTheScreen();
    expect(screen.queryByRole('adjustable')).not.toBeOnTheScreen();
  });

  it('shows the product the API returned, and its name in the header', async () => {
    const api = productApi();
    await renderWithProviders(<ProductScreen />, { api });

    expect(await screen.findByRole('header', { name: 'Cotton shirt' })).toBeOnTheScreen();
    expect(api.getProduct).toHaveBeenCalledWith('cotton-shirt', expect.anything());
    expect(lastTitle()).toBe('Cotton shirt');
    expect(screen.getByLabelText('Price 1,250 taka')).toBeOnTheScreen();
    expect(screen.getByLabelText('Availability: In stock')).toBeOnTheScreen();
    expect(screen.getByLabelText('Product code SHIRT-001')).toBeOnTheScreen();
    expect(screen.getByText('A soft everyday shirt.')).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'Fashion' })).toBeOnTheScreen();
    expect(screen.queryByText('Phase 8 skeleton route')).not.toBeOnTheScreen();
  });

  it('offers a share beside the wishlist, which opens the phone’s own sheet', async () => {
    process.env.EXPO_PUBLIC_STOREFRONT_URL = 'https://nilzora.com.bd';
    const api = productApi();
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.sharedAction } as never);
    try {
      const { user } = await renderWithProviders(<ProductScreen />, { api });

      const button = await screen.findByRole('button', { name: 'Share Cotton shirt' });
      await user.press(button);

      expect(shareSpy).toHaveBeenCalledWith({
        title: 'Cotton shirt',
        message: `Cotton shirt — A soft everyday shirt.\nhttps://nilzora.com.bd/products/cotton-shirt`,
        url: 'https://nilzora.com.bd/products/cotton-shirt',
      });
      // The wishlist heart is still there, unchanged, next to it.
      expect(screen.getByRole('button', { name: 'Save to wishlist' })).toBeOnTheScreen();
    } finally {
      shareSpy.mockRestore();
      delete process.env.EXPO_PUBLIC_STOREFRONT_URL;
    }
  });

  it('keeps reviews to one compact row, with the reviews themselves in a sheet', async () => {
    const api = productApi();
    api.productReviews.mockResolvedValue(reviewsResponse());
    const { user } = await renderWithProviders(<ProductScreen />, { api });

    // The rating is on the compact row; no review body or rating tally sits on the screen.
    const trigger = await screen.findByRole('button', {
      name: 'Reviews, 4.5 out of 5 from 1 review',
    });
    expect(screen.queryByText('Exactly as described')).not.toBeOnTheScreen();
    expect(screen.queryByLabelText('1 review gave 5 stars')).not.toBeOnTheScreen();

    await user.press(trigger);

    expect(screen.getByRole('header', { name: 'Reviews' })).toBeOnTheScreen();
    expect(await screen.findByText('Exactly as described')).toBeOnTheScreen();
    expect(screen.getByLabelText('1 review gave 5 stars')).toBeOnTheScreen();
  });

  it('shows the description in paragraphs, and only when there is one', async () => {
    const { unmount } = await renderWithProviders(<ProductScreen />, { api: productApi() });

    expect(await screen.findByRole('header', { name: 'About this product' })).toBeOnTheScreen();
    expect(screen.getByText('Soft cotton, made for everyday wear.')).toBeOnTheScreen();
    expect(screen.getByText('Machine washable.\nDo not bleach.')).toBeOnTheScreen();
    await unmount();

    await renderWithProviders(<ProductScreen />, {
      api: productApi(product({ description: null, summary: null })),
    });
    expect(await screen.findByRole('header', { name: 'Cotton shirt' })).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'About this product' })).not.toBeOnTheScreen();
  });

  it('states only what is true of every order: cash on delivery and delivery in Bangladesh', async () => {
    await renderWithProviders(<ProductScreen />, { api: productApi() });

    expect(await screen.findByText('Cash on delivery')).toBeOnTheScreen();
    expect(screen.getByText('Delivery within Bangladesh')).toBeOnTheScreen();
    expect(screen.getByText(/shown at checkout/)).toBeOnTheScreen();
  });

  it('shows the former price and the saving', async () => {
    const api = productApi(product({ priceMinor: 100_000, compareAtPriceMinor: 125_000 }));
    await renderWithProviders(<ProductScreen />, { api });

    expect(
      await screen.findByLabelText('Price 1,000 taka, was 1,250 taka, save 20 percent'),
    ).toBeOnTheScreen();
  });

  it('shows an accessible loading state, with the generic title', async () => {
    const api = createFakeApiClient();
    api.getProduct.mockReturnValue(new Promise(() => undefined));
    const { unmount } = await renderWithProviders(<ProductScreen />, { api });

    expect(screen.getByRole('progressbar', { name: 'Loading product' })).toBeBusy();
    expect(lastTitle()).toBe('Product');
    await unmount();
  });

  it('opens the category in the shop', async () => {
    const { user } = await renderWithProviders(<ProductScreen />, { api: productApi() });

    await user.press(await screen.findByRole('link', { name: 'Fashion' }));

    expect(router.navigate).toHaveBeenCalledWith({
      pathname: '/shop',
      params: { category: 'fashion' },
    });
  });

  it('refreshes on pull-to-refresh', async () => {
    const api = productApi();
    await renderWithProviders(<ProductScreen />, { api });
    await screen.findByRole('header', { name: 'Cotton shirt' });

    expect(api.getProduct).toHaveBeenCalledTimes(1);

    await pullToRefresh('product-scroll');

    expect(api.getProduct).toHaveBeenCalledTimes(2);
  });
});

describe('ProductScreen not found and errors', () => {
  it('says the product does not exist and leads back to the shop', async () => {
    const api = createFakeApiClient();
    api.getProduct.mockRejectedValue(new ApiError(404, 'not_found', 'Product not found'));
    const { user } = await renderWithProviders(<ProductScreen />, { api });

    expect(await screen.findByRole('header', { name: 'Product not found' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeOnTheScreen();
    expect(lastTitle()).toBe('Product');

    await user.press(screen.getByRole('button', { name: 'Browse the shop' }));
    expect(router.navigate).toHaveBeenCalledWith({ pathname: '/shop', params: {} });
  });

  it('does not ask the API about an address that cannot be a product', async () => {
    searchParams.slug = 'Not A Slug!';
    const api = createFakeApiClient();
    await renderWithProviders(<ProductScreen />, { api });

    expect(await screen.findByRole('header', { name: 'Product not found' })).toBeOnTheScreen();
    expect(api.getProduct).not.toHaveBeenCalled();
  });

  it('shows an error with a retry, then the product', async () => {
    const api = createFakeApiClient();
    api.getProduct.mockRejectedValue(offline());
    const { user } = await renderWithProviders(<ProductScreen />, { api });

    expect(await screen.findByText('Nilzora could not be reached')).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Product not found' })).not.toBeOnTheScreen();

    api.getProduct.mockResolvedValue({ product: SHIRT });
    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('header', { name: 'Cotton shirt' })).toBeOnTheScreen();
    expect(screen.queryByText('Nilzora could not be reached')).not.toBeOnTheScreen();
  });

  it('says the build is not set up when it has no API address', async () => {
    await renderWithProviders(<ProductScreen />, { api: null });

    expect(await screen.findByText('Nilzora is not set up')).toBeOnTheScreen();
  });
});

describe('ProductScreen add to cart', () => {
  it('adds one, confirms it, announces it and leads to the cart', async () => {
    const { user, cartStore } = await renderWithProviders(<ProductScreen />, {
      api: productApi(),
    });

    expect(await addButton()).toHaveAccessibleName('Add to cart, 1 item, total 1,250 taka');
    expect(screen.getByText('Add to cart · ৳1,250')).toBeOnTheScreen();
    await user.press(await addButton());

    expect(cartStore.getSnapshot().items).toEqual([{ productId: productId(1), quantity: 1 }]);
    expect(screen.getByText('Added 1 item to your cart.')).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith('Added 1 item to your cart.');
    expect(screen.getByText('1 already in your cart')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'View cart' }));
    expect(router.navigate).toHaveBeenCalledWith('/cart');
  });

  it('adds the chosen quantity, shows the display total, and starts again from one', async () => {
    const { user, cartStore } = await renderWithProviders(<ProductScreen />, {
      api: productApi(),
    });
    await addButton();

    await user.press(screen.getByRole('button', { name: 'Increase quantity of Cotton shirt' }));
    await user.press(screen.getByRole('button', { name: 'Increase quantity of Cotton shirt' }));
    expect(screen.getByLabelText('Quantity, 3')).toBeOnTheScreen();
    expect(await addButton()).toHaveAccessibleName('Add to cart, 3 items, total 3,750 taka');
    expect(screen.getByText('Add to cart · ৳3,750')).toBeOnTheScreen();

    await user.press(await addButton());

    expect(cartStore.getSnapshot().items).toEqual([{ productId: productId(1), quantity: 3 }]);
    expect(screen.getByText('Added 3 items to your cart.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Quantity, 1')).toBeOnTheScreen();
  });

  it('clears the confirmation when the quantity changes', async () => {
    const { user } = await renderWithProviders(<ProductScreen />, { api: productApi() });
    await user.press(await addButton());
    expect(screen.getByText('Added 1 item to your cart.')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Increase quantity of Cotton shirt' }));

    expect(screen.queryByText('Added 1 item to your cart.')).not.toBeOnTheScreen();
  });

  it('never lets the quantity pass what one order may hold', async () => {
    const api = productApi(product({ maxOrderQuantity: 2 }));
    const { user } = await renderWithProviders(<ProductScreen />, { api });
    await addButton();

    await user.press(screen.getByRole('button', { name: 'Increase quantity of Cotton shirt' }));

    expect(screen.getByLabelText('Quantity, 2')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Increase quantity of Cotton shirt' }),
    ).toBeDisabled();
  });

  it('explains when the cart took fewer than asked for', async () => {
    const api = productApi(product({ maxOrderQuantity: 3 }));
    const { user, cartStore } = await renderWithProviders(<ProductScreen />, {
      api,
      cart: [{ productId: productId(1), quantity: 2 }],
    });
    await addButton();
    expect(screen.getByText('2 already in your cart')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Increase quantity of Cotton shirt' }));

    await user.press(await addButton());

    expect(cartStore.getSnapshot().items).toEqual([{ productId: productId(1), quantity: 3 }]);
    expect(
      screen.getByText(
        'Added 1 item to your cart. The most you can order is 3, so you now have 3.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'View cart' })).toBeOnTheScreen();
  });

  it('tells the customer when the cart already holds the most it can', async () => {
    const api = productApi(product({ maxOrderQuantity: 3 }));
    const { user, cartStore } = await renderWithProviders(<ProductScreen />, {
      api,
      cart: [{ productId: productId(1), quantity: 3 }],
    });

    await user.press(await addButton());

    expect(cartStore.getSnapshot().items).toEqual([{ productId: productId(1), quantity: 3 }]);
    expect(
      screen.getByText('You already have 3 in your cart. The most you can order is 3.'),
    ).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith(
      'You already have 3 in your cart. The most you can order is 3.',
    );
    // The stepper starts from one even though nothing more fits: the message explains why.
    expect(screen.getByLabelText('Quantity, 1')).toBeOnTheScreen();
  });

  it('tells the customer when the cart is full', async () => {
    const full = Array.from({ length: MAX_CART_LINES }, (_, index) => ({
      productId: productId(100 + index),
      quantity: 1,
    }));
    const { user, cartStore } = await renderWithProviders(<ProductScreen />, {
      api: productApi(),
      cart: full,
    });

    await user.press(await addButton());

    expect(cartStore.getSnapshot().items).toHaveLength(MAX_CART_LINES);
    expect(
      screen.getByText(
        `Your cart is full (${MAX_CART_LINES} different products). Remove an item to add this one.`,
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'View cart' })).toBeOnTheScreen();
  });

  it('reports a product the cart cannot hold, without offering the cart', async () => {
    const api = productApi(product({ id: 'not-a-uuid' }));
    const { user, cartStore } = await renderWithProviders(<ProductScreen />, { api });

    await user.press(await addButton());

    expect(cartStore.getSnapshot().items).toEqual([]);
    expect(
      screen.getByText('We could not add this product to your cart. Please try again.'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'View cart' })).not.toBeOnTheScreen();
  });

  it('cannot add a product that is out of stock, and says why', async () => {
    const api = productApi(product({ availability: 'out_of_stock', maxOrderQuantity: 0 }));
    const { user, cartStore } = await renderWithProviders(<ProductScreen />, { api });

    const button = await screen.findByRole('button', { name: 'Out of stock' });
    expect(button).toBeDisabled();
    expect(screen.getByLabelText('Availability: Out of stock')).toBeOnTheScreen();
    expect(screen.getByText('This product cannot be ordered right now.')).toBeOnTheScreen();
    expect(screen.queryByLabelText(/^Quantity,/)).not.toBeOnTheScreen();

    await user.press(button);
    expect(cartStore.getSnapshot().items).toEqual([]);
  });

  it('treats a product with nothing orderable as out of stock', async () => {
    const api = productApi(product({ availability: 'in_stock', maxOrderQuantity: 0 }));
    await renderWithProviders(<ProductScreen />, { api });

    expect(await screen.findByRole('button', { name: 'Out of stock' })).toBeDisabled();
  });

  it('shows low stock in words', async () => {
    const api = productApi(product({ availability: 'low_stock', maxOrderQuantity: 2 }));
    await renderWithProviders(<ProductScreen />, { api });

    expect(await screen.findByLabelText('Availability: Only a few left')).toBeOnTheScreen();
    expect(await addButton()).toBeEnabled();
  });
});
