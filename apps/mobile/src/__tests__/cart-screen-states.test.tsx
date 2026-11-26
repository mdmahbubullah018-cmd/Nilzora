import { ApiError } from '@nilzora/api-client';
import type { CartQuoteResponse } from '@nilzora/contracts';
import { screen, waitFor } from '@testing-library/react-native';
import { CartScreen } from '../features/cart/cart-screen';
import { createFakeApiClient } from '../test-utils/api-fakes';
import { createMemoryCartStorage, PRODUCT_A, PRODUCT_B } from '../test-utils/cart-fakes';
import { cartLine, cartQuote, LAMP, MUG } from '../test-utils/checkout-fakes';
import { resetRouterMock, router } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

beforeEach(resetRouterMock);

const BOTH_LINES = [
  { productId: PRODUCT_A, quantity: 2 },
  { productId: PRODUCT_B, quantity: 1 },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function quoteResponse(...lines: Parameters<typeof cartQuote>[0]): CartQuoteResponse {
  return { quote: cartQuote(lines) };
}

describe('CartScreen: empty and loading', () => {
  it('invites an empty cart to the shop without calling the API', async () => {
    const api = createFakeApiClient();
    const { user } = await renderWithProviders(<CartScreen />, { api });

    expect(screen.getByRole('header', { name: 'Your cart is empty' })).toBeOnTheScreen();
    expect(api.quoteCart).not.toHaveBeenCalled();
    await user.press(screen.getByRole('button', { name: 'Browse the shop' }));
    expect(router.navigate).toHaveBeenCalledWith('/shop');
  });

  it('shows a loading state, not an empty cart, until the saved cart has been read', async () => {
    const cartStorage = createMemoryCartStorage();
    cartStorage.getItem.mockReturnValue(new Promise(() => undefined));
    await renderWithProviders(<CartScreen />, {
      api: createFakeApiClient(),
      cartStorage,
      hydrateCart: false,
    });

    expect(screen.getByRole('progressbar', { name: 'Loading your cart' })).toBeOnTheScreen();
    expect(screen.queryByText('Your cart is empty')).not.toBeOnTheScreen();
  });

  it('shows an accessible placeholder while the cart is priced', async () => {
    const api = createFakeApiClient();
    api.quoteCart.mockReturnValue(new Promise(() => undefined));
    await renderWithProviders(<CartScreen />, { api, cart: BOTH_LINES });

    expect(screen.getByRole('progressbar', { name: 'Pricing your cart' })).toBeOnTheScreen();
  });

  it('explains a build without an API address instead of loading forever', async () => {
    await renderWithProviders(<CartScreen />, { api: null, cart: BOTH_LINES });

    expect(screen.getByRole('header', { name: 'Nilzora is not set up' })).toBeOnTheScreen();
  });

  it('shows the error with a retry, then the cart once the retry works', async () => {
    const api = createFakeApiClient();
    api.quoteCart
      .mockRejectedValueOnce(new ApiError(0, 'network_error', 'offline'))
      .mockResolvedValueOnce(quoteResponse(MUG, LAMP));
    const { user } = await renderWithProviders(<CartScreen />, { api, cart: BOTH_LINES });

    expect(
      await screen.findByRole('header', { name: 'Nilzora could not be reached' }),
    ).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Blue mug')).toBeOnTheScreen();
    expect(api.quoteCart).toHaveBeenCalledTimes(2);
  });
});

describe('CartScreen: priced lines', () => {
  it('shows what the server priced and opens checkout', async () => {
    const api = createFakeApiClient();
    api.quoteCart.mockResolvedValue(quoteResponse(MUG, LAMP));
    const { user } = await renderWithProviders(<CartScreen />, { api, cart: BOTH_LINES });

    expect(await screen.findByText('Blue mug')).toBeOnTheScreen();
    expect(screen.getByText('Desk lamp')).toBeOnTheScreen();
    expect(screen.getByLabelText('Line total: 1,000 taka')).toBeOnTheScreen();
    expect(screen.getByLabelText('Subtotal (3 items): 2,200 taka')).toBeOnTheScreen();
    expect(screen.getByText('Delivery charge is calculated at checkout')).toBeOnTheScreen();
    expect(screen.getByText('Cash on delivery — pay when your parcel arrives')).toBeOnTheScreen();
    // Only ids and quantities leave the device.
    expect(api.quoteCart).toHaveBeenCalledWith(BOTH_LINES, expect.anything());

    const checkout = screen.getByRole('button', { name: 'Checkout' });
    expect(checkout).toBeEnabled();
    await user.press(checkout);
    expect(router.push).toHaveBeenCalledWith('/checkout');
  });

  it('opens the product page from a line that has one', async () => {
    const api = createFakeApiClient();
    api.quoteCart.mockResolvedValue(quoteResponse(MUG, LAMP));
    const { user } = await renderWithProviders(<CartScreen />, { api, cart: BOTH_LINES });

    const link = await screen.findByRole('link', { name: 'Blue mug' });
    // A name on one short line is still a full-height (48dp) target.
    expect(link).toHaveStyle({ minHeight: 48 });
    await user.press(link);

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/product/[slug]',
      params: { slug: 'blue-mug' },
    });
  });

  it('limits the stepper to what the server can supply, and shows a fixed quantity when none', async () => {
    const api = createFakeApiClient();
    api.quoteCart.mockResolvedValue(
      quoteResponse(
        { ...MUG, quantity: 3, lineTotalMinor: 150_000, availableQuantity: 3 },
        {
          ...LAMP,
          problem: 'unavailable',
          availableQuantity: null,
          unitPriceMinor: null,
          lineTotalMinor: null,
          slug: null,
          name: null,
        },
      ),
    );
    await renderWithProviders(<CartScreen />, {
      api,
      cart: [
        { productId: PRODUCT_A, quantity: 3 },
        { productId: PRODUCT_B, quantity: 1 },
      ],
    });

    await screen.findByText('Blue mug');
    expect(screen.getByRole('button', { name: 'Increase quantity of Blue mug' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Decrease quantity of Blue mug' })).toBeEnabled();
    // A product that is gone has no stepper, only its quantity and a way to remove it.
    expect(screen.getByText('Quantity: 1')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Remove Product no longer available from your cart' }),
    ).toBeOnTheScreen();
  });
});

describe('CartScreen: editing', () => {
  it('changes the cart at once and prices it again, holding checkout meanwhile', async () => {
    const api = createFakeApiClient();
    const second = deferred<CartQuoteResponse>();
    api.quoteCart
      .mockResolvedValueOnce(quoteResponse(MUG, LAMP))
      .mockReturnValueOnce(second.promise);
    const { user, cartStore } = await renderWithProviders(<CartScreen />, {
      api,
      cart: BOTH_LINES,
    });
    await screen.findByText('Blue mug');

    await user.press(screen.getByRole('button', { name: 'Increase quantity of Blue mug' }));

    // The cart (and the tab badge) follow the tap immediately...
    expect(cartStore.getSnapshot().items).toEqual([
      { productId: PRODUCT_A, quantity: 3 },
      { productId: PRODUCT_B, quantity: 1 },
    ]);
    expect(screen.getByLabelText('Quantity, 3')).toBeOnTheScreen();
    // ...while prices are marked as updating and checkout waits for them.
    expect(await screen.findByText('Updating prices…')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Checkout' })).toBeDisabled();
    expect(screen.queryByLabelText('Line total: 1,000 taka')).not.toBeOnTheScreen();

    second.resolve(quoteResponse({ ...MUG, quantity: 3, lineTotalMinor: 150_000 }, LAMP));
    expect(await screen.findByLabelText('Line total: 1,500 taka')).toBeOnTheScreen();
    expect(screen.getByLabelText('Subtotal (4 items): 2,700 taka')).toBeOnTheScreen();
    expect(screen.queryByText('Updating prices…')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Checkout' })).toBeEnabled();
    expect(api.quoteCart).toHaveBeenLastCalledWith(
      [
        { productId: PRODUCT_A, quantity: 3 },
        { productId: PRODUCT_B, quantity: 1 },
      ],
      expect.anything(),
    );
  });

  it('steps a quantity down to one and no further', async () => {
    const api = createFakeApiClient();
    api.quoteCart.mockResolvedValue(quoteResponse({ ...LAMP }));
    const { user, cartStore } = await renderWithProviders(<CartScreen />, {
      api,
      cart: [{ productId: PRODUCT_B, quantity: 2 }],
    });
    await screen.findByText('Desk lamp');

    await user.press(screen.getByRole('button', { name: 'Decrease quantity of Desk lamp' }));

    expect(cartStore.getSnapshot().items).toEqual([{ productId: PRODUCT_B, quantity: 1 }]);
    expect(screen.getByRole('button', { name: 'Decrease quantity of Desk lamp' })).toBeDisabled();
  });

  it('removes a line from the cart', async () => {
    const api = createFakeApiClient();
    api.quoteCart.mockResolvedValue(quoteResponse(MUG, LAMP));
    const { user, cartStore } = await renderWithProviders(<CartScreen />, {
      api,
      cart: BOTH_LINES,
    });
    await screen.findByText('Blue mug');

    await user.press(screen.getByRole('button', { name: 'Remove Blue mug from your cart' }));

    expect(cartStore.getSnapshot().items).toEqual([{ productId: PRODUCT_B, quantity: 1 }]);
    expect(screen.queryByText('Blue mug')).not.toBeOnTheScreen();
    expect(screen.getByText('Desk lamp')).toBeOnTheScreen();
  });

  it('shows the empty cart after the last line is removed', async () => {
    const api = createFakeApiClient();
    api.quoteCart.mockResolvedValue(quoteResponse({ ...LAMP }));
    const { user } = await renderWithProviders(<CartScreen />, {
      api,
      cart: [{ productId: PRODUCT_B, quantity: 1 }],
    });
    await screen.findByText('Desk lamp');

    await user.press(screen.getByRole('button', { name: 'Remove Desk lamp from your cart' }));

    expect(screen.getByRole('header', { name: 'Your cart is empty' })).toBeOnTheScreen();
  });
});

describe('CartScreen: lines the server cannot order', () => {
  const stockProblem = cartLine({
    productId: PRODUCT_A,
    quantity: 2,
    lineTotalMinor: 100_000,
    availableQuantity: 1,
    problem: 'insufficient_stock',
  });
  const gone = cartLine({
    productId: PRODUCT_B,
    slug: null,
    name: null,
    unitPriceMinor: null,
    lineTotalMinor: null,
    availableQuantity: null,
    problem: 'unavailable',
  });

  it('explains each problem, leaves problem lines out of the total, and blocks checkout', async () => {
    const api = createFakeApiClient();
    api.quoteCart.mockResolvedValue(quoteResponse(stockProblem, gone));
    await renderWithProviders(<CartScreen />, { api, cart: BOTH_LINES });

    expect(await screen.findByText(/Only 1 left/)).toBeOnTheScreen();
    expect(screen.getByText(/No longer available/)).toBeOnTheScreen();
    expect(screen.getByText('Product no longer available')).toBeOnTheScreen();
    expect(screen.getAllByText(/Not included in your total/)).toHaveLength(2);
    expect(screen.queryByLabelText(/^Line total/)).not.toBeOnTheScreen();
    expect(screen.getByLabelText('Subtotal (0 items): 0 taka')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Checkout' })).toBeDisabled();
    expect(
      screen.getByText('Some items need attention. Fix your cart to continue.'),
    ).toBeOnTheScreen();
  });

  it('fixes the cart in one tap and prices it again', async () => {
    const api = createFakeApiClient();
    api.quoteCart
      .mockResolvedValueOnce(quoteResponse(stockProblem, gone))
      .mockResolvedValue(quoteResponse({ ...MUG, quantity: 1, lineTotalMinor: 50_000 }));
    const { user, cartStore } = await renderWithProviders(<CartScreen />, {
      api,
      cart: BOTH_LINES,
    });
    await screen.findByText(/Only 1 left/);

    await user.press(screen.getByRole('button', { name: 'Fix cart' }));

    expect(cartStore.getSnapshot().items).toEqual([{ productId: PRODUCT_A, quantity: 1 }]);
    expect(
      screen.getByText('Cart updated: 1 item was removed and 1 was lowered to what is available.'),
    ).toBeOnTheScreen();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Checkout' })).toBeEnabled();
    });
    expect(screen.queryByRole('button', { name: 'Fix cart' })).not.toBeOnTheScreen();
    expect(api.quoteCart).toHaveBeenLastCalledWith(
      [{ productId: PRODUCT_A, quantity: 1 }],
      expect.anything(),
    );
  });
});
