import { ApiError } from '@nilzora/api-client';
import { MAX_ADDRESSES, type CheckoutQuoteResponse } from '@nilzora/contracts';
import { screen } from '@testing-library/react-native';
import CheckoutRoute from '../../app/checkout';
import { CheckoutScreen } from '../features/checkout/checkout-screen';
import { PRODUCT_A, PRODUCT_B } from '../test-utils/cart-fakes';
import {
  ADDRESS_HOME,
  ADDRESS_HOME_ID,
  ADDRESS_OFFICE,
  ADDRESS_OFFICE_ID,
  cartLine,
  CHECKOUT_ITEMS,
  checkoutQuote,
  createCheckoutApi,
  LAMP,
  MUG,
  renderCommerce,
  resetCheckoutAttempts,
} from '../test-utils/checkout-fakes';
import { resetRouterMock, router, searchParams } from '../test-utils/expo-router-mock';
import { resetLeaveGuard } from '../test-utils/leave-guard-mock';
import { FAKE_ACCESS_TOKEN } from '../test-utils/session-fakes';

jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('@/test-utils/expo-router-mock'),
  ...jest.requireActual<{ leaveGuardMock: object }>('@/test-utils/leave-guard-mock').leaveGuardMock,
}));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000001'),
}));

beforeEach(async () => {
  resetRouterMock();
  resetLeaveGuard();
  await resetCheckoutAttempts();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// What a screen reader says; the visible label is "Place order · ৳2,260".
const PLACE_HOME = 'Place order, total 2,260 taka';
const PLACE_OFFICE = 'Place order, total 2,320 taka';

describe('CheckoutScreen: before the order can be reviewed', () => {
  it('sends a signed-out customer to sign in and brings them back to checkout', async () => {
    const api = createCheckoutApi();
    const { user } = await renderCommerce(<CheckoutRoute />, {
      api,
      session: { status: 'signed_out' },
      cart: CHECKOUT_ITEMS,
    });

    expect(screen.getByText(/to place your order/)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /Place order/ })).not.toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/checkout' },
    });
    expect(api.listAddresses).not.toHaveBeenCalled();
    expect(api.quoteCheckout).not.toHaveBeenCalled();
  });

  it('shows a suspended account the gate’s explanation, not checkout', async () => {
    await renderCommerce(<CheckoutRoute />, {
      api: createCheckoutApi(),
      session: { status: 'suspended' },
      cart: CHECKOUT_ITEMS,
    });

    expect(screen.getByText('Account suspended')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /Place order/ })).not.toBeOnTheScreen();
  });

  it('blocks an empty cart and points to the cart', async () => {
    const api = createCheckoutApi();
    const { user } = await renderCommerce(<CheckoutScreen />, { api });

    expect(screen.getByRole('header', { name: 'Your cart is empty' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /Place order/ })).not.toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Go to your cart' }));
    expect(router.navigate).toHaveBeenCalledWith('/cart');
    expect(api.quoteCheckout).not.toHaveBeenCalled();
  });

  it('asks for an address first when there is none, and returns to checkout after adding it', async () => {
    const api = createCheckoutApi({ addresses: [] });
    const { user } = await renderCommerce(<CheckoutScreen />, { api, cart: CHECKOUT_ITEMS });

    expect(await screen.findByRole('header', { name: 'Add a delivery address' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /Place order/ })).not.toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Add a delivery address' }));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/addresses/new',
      params: { returnTo: '/checkout' },
    });
    expect(api.quoteCheckout).not.toHaveBeenCalled();
  });

  it('shows the error with a retry when the addresses cannot be loaded', async () => {
    const api = createCheckoutApi();
    api.listAddresses
      .mockRejectedValueOnce(new ApiError(0, 'network_error', 'offline'))
      .mockResolvedValue({ addresses: [ADDRESS_HOME] });
    const { user } = await renderCommerce(<CheckoutScreen />, { api, cart: CHECKOUT_ITEMS });

    expect(await screen.findByText('Nilzora could not be reached')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: PLACE_HOME })).toBeOnTheScreen();
  });

  it('shows the error with a retry when the order cannot be priced', async () => {
    const api = createCheckoutApi();
    api.quoteCheckout
      .mockRejectedValueOnce(new ApiError(503, 'service_unavailable', 'down'))
      .mockResolvedValue({ quote: checkoutQuote([MUG, LAMP]) });
    const { user } = await renderCommerce(<CheckoutScreen />, { api, cart: CHECKOUT_ITEMS });

    expect(await screen.findByText('Nilzora is unavailable right now')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: PLACE_HOME })).toBeOnTheScreen();
  });
});

describe('CheckoutScreen: the order as the server prices it', () => {
  it('preselects the default address and shows items, payment and totals from the quote', async () => {
    // The default is not the first in the list.
    const api = createCheckoutApi({ addresses: [ADDRESS_OFFICE, ADDRESS_HOME] });
    await renderCommerce(<CheckoutScreen />, { api, cart: CHECKOUT_ITEMS });

    expect(await screen.findByRole('button', { name: PLACE_HOME })).toBeEnabled();
    expect(api.quoteCheckout).toHaveBeenCalledWith(
      FAKE_ACCESS_TOKEN,
      { items: CHECKOUT_ITEMS, addressId: ADDRESS_HOME_ID },
      expect.anything(),
    );
    expect(screen.getByRole('header', { name: 'Delivery address' })).toBeOnTheScreen();
    expect(screen.getByText('Default')).toBeOnTheScreen();
    expect(screen.getByText('Delivery zone: Inside Dhaka')).toBeOnTheScreen();
    // Items: names, quantities and line totals, all the API's.
    expect(screen.getByRole('header', { name: 'Items (3 items)' })).toBeOnTheScreen();
    expect(screen.getByText('Blue mug')).toBeOnTheScreen();
    expect(screen.getByText('Qty 2 · ৳500 each')).toBeOnTheScreen();
    expect(screen.getByLabelText('Line total: 1,000 taka')).toBeOnTheScreen();
    expect(screen.getByLabelText('Line total: 1,200 taka')).toBeOnTheScreen();
    // Summary: subtotal, delivery with its zone, total. No discount unless the quote has one.
    expect(screen.getByLabelText('Subtotal (3 items): 2,200 taka')).toBeOnTheScreen();
    expect(screen.getByLabelText('Delivery (Inside Dhaka): 60 taka')).toBeOnTheScreen();
    expect(screen.getByLabelText('Total: 2,260 taka')).toBeOnTheScreen();
    expect(screen.queryByText(/discount/i)).not.toBeOnTheScreen();
    expect(
      screen.getByText('You pay ৳2,260 in cash when your order is delivered.'),
    ).toBeOnTheScreen();
  });

  it('offers Cash on Delivery and shows bKash and Nagad as coming soon, with no way to pay online', async () => {
    await renderCommerce(<CheckoutScreen />, {
      api: createCheckoutApi({ codAvailable: true }),
      cart: CHECKOUT_ITEMS,
    });
    await screen.findByRole('button', { name: PLACE_HOME });

    expect(screen.getByRole('header', { name: 'Payment' })).toBeOnTheScreen();
    expect(screen.getByLabelText(/^Cash on Delivery\. available\./)).toBeOnTheScreen();
    // The two wallets are visible so a shopper knows they are planned, and neither is a choice.
    expect(screen.getByLabelText(/^bKash\. coming soon, not available\./)).toBeOnTheScreen();
    expect(screen.getByLabelText(/^Nagad\. coming soon, not available\./)).toBeOnTheScreen();
    expect(screen.getByText('bKash')).toBeOnTheScreen();
    expect(screen.getByText('Nagad')).toBeOnTheScreen();
    // Nothing here claims a payment can be made in the app.
    expect(screen.queryByText(/pay now|card number|cvv|online payment/i)).not.toBeOnTheScreen();
  });

  it('closes checkout and keeps the place-order button away while cash on delivery is off', async () => {
    const api = createCheckoutApi({ codAvailable: false });
    await renderCommerce(<CheckoutScreen />, { api, cart: CHECKOUT_ITEMS });

    // The button stays where it is, disabled and stating why, as with any other blocked checkout.
    expect(await screen.findByRole('button', { name: /^Place order/ })).toBeDisabled();
    expect(
      screen.getByText('Checkout is closed: cash on delivery is switched off right now.'),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText(/^Cash on Delivery\. switched off\./)).toBeOnTheScreen();
    // Nothing was sent: the refusal is decided before the request, not after it.
    expect(api.placeOrder).not.toHaveBeenCalled();
  });

  it('lets the customer pick another address and prices the order for it again', async () => {
    const api = createCheckoutApi();
    const { user } = await renderCommerce(<CheckoutScreen />, { api, cart: CHECKOUT_ITEMS });
    await screen.findByRole('button', { name: PLACE_HOME });

    await user.press(screen.getByRole('button', { name: 'Change the delivery address' }));
    expect(screen.getByRole('radio', { name: 'Home, Dhanmondi, Dhaka' })).toBeChecked();
    await user.press(screen.getByRole('radio', { name: 'Rahim Uddin, Kotbari, Cumilla' }));

    expect(await screen.findByRole('button', { name: PLACE_OFFICE })).toBeEnabled();
    expect(api.quoteCheckout).toHaveBeenLastCalledWith(
      FAKE_ACCESS_TOKEN,
      { items: CHECKOUT_ITEMS, addressId: ADDRESS_OFFICE_ID },
      expect.anything(),
    );
    expect(screen.getByLabelText('Delivery (Outside Dhaka): 120 taka')).toBeOnTheScreen();
    expect(screen.getByLabelText('Total: 2,320 taka')).toBeOnTheScreen();
    expect(screen.getByText('Delivery zone: Outside Dhaka')).toBeOnTheScreen();
    // The list closes once an address is chosen.
    expect(screen.queryByRole('radio')).not.toBeOnTheScreen();
  });

  it('shows prices as updating, and cannot be confirmed, while another address is priced', async () => {
    const api = createCheckoutApi();
    const later = deferred<CheckoutQuoteResponse>();
    const { user } = await renderCommerce(<CheckoutScreen />, { api, cart: CHECKOUT_ITEMS });
    await screen.findByRole('button', { name: PLACE_HOME });
    api.quoteCheckout.mockReturnValueOnce(later.promise);

    await user.press(screen.getByRole('button', { name: 'Change the delivery address' }));
    await user.press(screen.getByRole('radio', { name: 'Rahim Uddin, Kotbari, Cumilla' }));

    expect(await screen.findByText('Updating…')).toBeOnTheScreen();
    // The old total is shown for reference only: the button no longer offers it.
    const button = screen.getByRole('button', { name: 'Place order' });
    expect(button).toBeDisabled();
    expect(screen.getByText('Updating prices…')).toBeOnTheScreen();
    await user.press(button);
    expect(api.placeOrder).not.toHaveBeenCalled();

    later.resolve({
      quote: checkoutQuote([MUG, LAMP], { zone: 'outside_dhaka', feeMinor: 12_000 }),
    });
    expect(await screen.findByRole('button', { name: PLACE_OFFICE })).toBeEnabled();
    expect(screen.queryByText('Updating…')).not.toBeOnTheScreen();
  });

  it('selects the address just saved from checkout (the address parameter)', async () => {
    searchParams.address = ADDRESS_OFFICE_ID;
    const api = createCheckoutApi();
    await renderCommerce(<CheckoutScreen />, { api, cart: CHECKOUT_ITEMS });

    expect(await screen.findByRole('button', { name: PLACE_OFFICE })).toBeEnabled();
    expect(api.quoteCheckout).toHaveBeenCalledWith(
      FAKE_ACCESS_TOKEN,
      { items: CHECKOUT_ITEMS, addressId: ADDRESS_OFFICE_ID },
      expect.anything(),
    );
  });

  it('ignores an address parameter that is not one of the customer’s addresses', async () => {
    searchParams.address = '11111111-2222-4333-8444-555555555555';
    await renderCommerce(<CheckoutScreen />, { api: createCheckoutApi(), cart: CHECKOUT_ITEMS });

    expect(await screen.findByRole('button', { name: PLACE_HOME })).toBeEnabled();
  });

  it('offers to add an address, which returns to checkout, unless the limit is reached', async () => {
    const api = createCheckoutApi();
    const { user } = await renderCommerce(<CheckoutScreen />, { api, cart: CHECKOUT_ITEMS });
    await screen.findByRole('button', { name: PLACE_HOME });

    await user.press(screen.getByRole('button', { name: 'Add a new address' }));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/addresses/new',
      params: { returnTo: '/checkout' },
    });
  });

  it('offers no second address to choose when there is only one, and no more at the limit', async () => {
    const one = await renderCommerce(<CheckoutScreen />, {
      api: createCheckoutApi({ addresses: [ADDRESS_HOME] }),
      cart: CHECKOUT_ITEMS,
    });
    await screen.findByRole('button', { name: PLACE_HOME });
    expect(
      screen.queryByRole('button', { name: 'Change the delivery address' }),
    ).not.toBeOnTheScreen();
    await one.unmount();

    const full = Array.from({ length: MAX_ADDRESSES }, (_, index) => ({
      ...ADDRESS_HOME,
      id: `aaaaaaaa-1111-4222-8333-4444444444${String(index).padStart(2, '0')}`,
      isDefault: index === 0,
    }));
    await renderCommerce(<CheckoutScreen />, {
      api: createCheckoutApi({ addresses: full }),
      cart: CHECKOUT_ITEMS,
    });
    await screen.findByRole('button', { name: PLACE_HOME });
    expect(screen.getByRole('button', { name: 'Change the delivery address' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Add a new address' })).not.toBeOnTheScreen();
  });

  it('counts the characters of the note', async () => {
    const { user } = await renderCommerce(<CheckoutScreen />, {
      api: createCheckoutApi(),
      cart: CHECKOUT_ITEMS,
    });
    await screen.findByRole('button', { name: PLACE_HOME });
    const note = screen.getByLabelText('Note for the order');

    expect(screen.getByText('0/500')).toBeOnTheScreen();
    expect(note).toHaveProp('maxLength', 500);
    await user.type(note, 'Call me first');

    expect(screen.getByText('13/500')).toBeOnTheScreen();
    expect(screen.getByLabelText('13 of 500 characters used')).toBeOnTheScreen();
  });
});

describe('CheckoutScreen: orders that cannot be placed as they are', () => {
  const stockProblem = cartLine({
    productId: PRODUCT_A,
    quantity: 2,
    lineTotalMinor: 100_000,
    availableQuantity: 1,
    problem: 'insufficient_stock',
  });

  it('explains the problem, blocks the order, and fixes the cart in one tap', async () => {
    const api = createCheckoutApi();
    api.quoteCheckout
      .mockResolvedValueOnce({
        quote: checkoutQuote([stockProblem, LAMP], undefined, { purchasable: false }),
      })
      .mockResolvedValue({
        quote: checkoutQuote([{ ...MUG, quantity: 1, lineTotalMinor: 50_000 }, LAMP]),
      });
    const { user, cartStore } = await renderCommerce(<CheckoutScreen />, {
      api,
      cart: CHECKOUT_ITEMS,
    });

    expect(await screen.findByText('Some items need attention')).toBeOnTheScreen();
    expect(screen.getByText(/Only 1 left/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Place order' })).toBeDisabled();
    expect(
      screen.getByText('Some items need attention. Fix your cart to continue.'),
    ).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Fix cart' }));

    expect(cartStore.getSnapshot().items).toEqual([
      { productId: PRODUCT_A, quantity: 1 },
      { productId: PRODUCT_B, quantity: 1 },
    ]);
    expect(screen.getByText('Cart updated: 1 was lowered to what is available.')).toBeOnTheScreen();
    expect(
      await screen.findByRole('button', { name: 'Place order, total 1,760 taka' }),
    ).toBeEnabled();
    expect(api.placeOrder).not.toHaveBeenCalled();
  });

  it('sends the customer to the cart to review it', async () => {
    const api = createCheckoutApi();
    api.quoteCheckout.mockResolvedValue({
      quote: checkoutQuote([stockProblem, LAMP], undefined, { purchasable: false }),
    });
    const { user } = await renderCommerce(<CheckoutScreen />, { api, cart: CHECKOUT_ITEMS });

    await user.press(await screen.findByRole('button', { name: 'Review your cart' }));

    expect(router.navigate).toHaveBeenCalledWith('/cart');
  });

  it('explains when delivery is not set up for the address', async () => {
    const api = createCheckoutApi();
    api.quoteCheckout.mockResolvedValue({
      quote: checkoutQuote(
        [MUG, LAMP],
        { zone: 'inside_dhaka', feeMinor: 0 },
        {
          shippingFeeMinor: null,
          totalMinor: null,
          purchasable: false,
        },
      ),
    });
    await renderCommerce(<CheckoutScreen />, { api, cart: CHECKOUT_ITEMS });

    expect(
      await screen.findByText(
        'Delivery is not available for this address yet. Choose another address.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Place order' })).toBeDisabled();
    expect(screen.getByLabelText('Delivery (Inside Dhaka): not available')).toBeOnTheScreen();
  });
});
