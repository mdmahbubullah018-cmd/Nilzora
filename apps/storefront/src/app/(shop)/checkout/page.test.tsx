import { render, screen } from '@testing-library/react';
import type { Address, CartQuoteResponse, CheckoutQuoteRequest } from '@nilzora/contracts';
import type { SessionCall, SessionRead, SessionState } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchParams } from '@/lib/auth-params';
import {
  address,
  apiError,
  cartLine,
  checkoutQuote,
  fakeRead,
  HOME_ID,
  LAMP_ID,
  OFFICE_ID,
  officeAddress,
  redirectedTo,
  signedIn,
} from '@/testing/commerce-fixtures';
import CheckoutPage from './page';

const browser = vi.hoisted(() => {
  const holder: { session: SessionState; cart: string | undefined } = {
    session: { status: 'unavailable' },
    cart: undefined,
  };
  return holder;
});
const api = vi.hoisted(() => ({
  listAddresses: vi.fn<(token: string) => Promise<{ addresses: Address[] }>>(),
  quoteCheckout: vi.fn<(token: string, body: CheckoutQuoteRequest) => Promise<CartQuoteResponse>>(),
  // The page offers the signed-in customer's collected vouchers; none are needed here.
  myVouchers: vi.fn<(token: string) => Promise<{ vouchers: never[] }>>(),
}));
const store = vi.hoisted(() => ({ codAvailable: true }));

vi.mock('@/lib/session', () => ({
  session: {
    getSession: () => Promise.resolve(browser.session),
    csrfToken: () => Promise.resolve('signed-csrf-value'),
    cartCookie: { get: () => Promise.resolve(browser.cart) },
    read: <T,>(call: SessionCall<T>): Promise<SessionRead<T>> => fakeRead(api as never, call),
  },
}));
vi.mock('@/lib/checkout-actions', () => ({ placeOrderAction: vi.fn() }));
// The store's own answer to "is cash on delivery open?". The page reads it on every render,
// and the order function reads the same flag inside the database.
vi.mock('@/lib/seo', () => ({
  storeProfile: () => Promise.resolve({ codAvailable: store.codAvailable }),
}));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function renderPage(params: SearchParams = {}) {
  return render(await CheckoutPage({ searchParams: Promise.resolve(params) }));
}

function hiddenValue(container: HTMLElement, name: string): string | undefined {
  const element = container.querySelector(`input[type="hidden"][name="${name}"]`);
  return element instanceof HTMLInputElement ? element.value : undefined;
}

beforeEach(() => {
  browser.session = signedIn;
  browser.cart = `${LAMP_ID}:2`;
  store.codAvailable = true;
  api.listAddresses.mockReset();
  api.listAddresses.mockResolvedValue({ addresses: [address(), officeAddress()] });
  api.quoteCheckout.mockReset();
  api.quoteCheckout.mockResolvedValue({ quote: checkoutQuote() });
  api.myVouchers.mockReset();
  api.myVouchers.mockResolvedValue({ vouchers: [] });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('CheckoutPage: who may check out', () => {
  it('sends a signed-out visitor to sign in and back to checkout', async () => {
    browser.session = { status: 'signed_out' };

    await expect(CheckoutPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject(
      redirectedTo('/login?next=/checkout'),
    );
    expect(api.listAddresses).not.toHaveBeenCalled();
  });

  it('explains a suspended account and reads nothing else', async () => {
    browser.session = { status: 'suspended' };

    await renderPage();

    expect(screen.getByText('This account is suspended')).not.toBeNull();
    expect(api.listAddresses).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Place order' })).toBeNull();
  });

  it('offers a retry when the session cannot be checked', async () => {
    browser.session = { status: 'unavailable' };

    await renderPage();

    expect(screen.getByText('We could not open checkout')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe('/checkout');
  });

  it('sends a session that ends mid-way to sign in', async () => {
    api.listAddresses.mockRejectedValue(apiError(401, 'unauthenticated'));

    await expect(CheckoutPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject(
      redirectedTo('/login?next=/checkout'),
    );
  });
});

describe('CheckoutPage: before the order', () => {
  it('points an empty cart back to the cart page', async () => {
    browser.cart = undefined;

    await renderPage();

    expect(screen.getByText('Your cart is empty')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Go to your cart' }).getAttribute('href')).toBe(
      '/cart',
    );
    expect(api.listAddresses).not.toHaveBeenCalled();
  });

  it('asks for a delivery address first, returning here afterwards', async () => {
    api.listAddresses.mockResolvedValue({ addresses: [] });

    await renderPage();

    expect(screen.getByRole('link', { name: 'Add a delivery address' }).getAttribute('href')).toBe(
      '/account/addresses/new?next=/checkout',
    );
    expect(api.quoteCheckout).not.toHaveBeenCalled();
  });

  it('shows the state when addresses or prices cannot be loaded', async () => {
    api.listAddresses.mockRejectedValueOnce(apiError(503, 'service_unavailable'));
    const { unmount } = await renderPage();
    expect(screen.getByText('We could not load your addresses')).not.toBeNull();
    unmount();

    api.quoteCheckout.mockRejectedValueOnce(apiError(0, 'timeout'));
    await renderPage();
    expect(screen.getByText('We could not price your order')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Place order' })).toBeNull();
  });

  it('explains a suspension the API reports while pricing', async () => {
    api.quoteCheckout.mockRejectedValue(apiError(403, 'account_suspended'));

    await renderPage();

    expect(screen.getByText('This account is suspended')).not.toBeNull();
  });
});

describe('CheckoutPage: the order form', () => {
  it('prices the cart for the default address and carries that quote into the form', async () => {
    const { container } = await renderPage();

    expect(api.quoteCheckout).toHaveBeenCalledWith('access-token', {
      items: [{ productId: LAMP_ID, quantity: 2 }],
      addressId: HOME_ID,
    });
    expect(screen.getByText('Delivery (Inside Dhaka)')).not.toBeNull();
    expect(screen.getByText('৳60')).not.toBeNull();
    expect(screen.getByText('Total')).not.toBeNull();
    expect(screen.getAllByText('৳2,560').length).toBeGreaterThan(0);
    expect(screen.getByRole('radio', { name: /Cash on Delivery/ })).toHaveProperty('checked', true);

    expect(hiddenValue(container, 'addressId')).toBe(HOME_ID);
    expect(hiddenValue(container, 'expectedTotalMinor')).toBe('256000');
    expect(hiddenValue(container, 'idempotencyKey')).toMatch(UUID);
    expect(hiddenValue(container, 'csrf_token')).toBe('signed-csrf-value');
    expect(screen.getByRole('button', { name: 'Place order' })).toHaveProperty('type', 'submit');
  });

  it('starts a new checkout attempt on every render', async () => {
    const first = hiddenValue((await renderPage()).container, 'idempotencyKey');
    const second = hiddenValue((await renderPage()).container, 'idempotencyKey');
    expect(first).toMatch(UUID);
    expect(second).toMatch(UUID);
    expect(second).not.toBe(first);
  });

  it('delivers to another saved address when asked', async () => {
    const { container } = await renderPage({ address: OFFICE_ID });

    expect(api.quoteCheckout.mock.calls[0]?.[1].addressId).toBe(OFFICE_ID);
    expect(hiddenValue(container, 'addressId')).toBe(OFFICE_ID);
    expect(
      screen
        .getByRole('link', { name: 'Deliver here: Home · Dhanmondi, Dhaka' })
        .getAttribute('href'),
    ).toBe(`/checkout?address=${HOME_ID}`);
  });

  it.each([
    ['an address of someone else', 'ad000000-0000-4000-8000-0000000000ff'],
    ['a malformed address', '../admin'],
    ['a repeated parameter', [OFFICE_ID, OFFICE_ID]],
  ])('falls back to the default address for %s', async (_label, requested) => {
    const { container } = await renderPage({ address: requested });
    expect(hiddenValue(container, 'addressId')).toBe(HOME_ID);
  });

  it('sends the customer to the cart when items need attention', async () => {
    api.quoteCheckout.mockResolvedValue({
      quote: checkoutQuote({
        lines: [cartLine({ quantity: 4, availableQuantity: 1, problem: 'insufficient_stock' })],
        itemCount: 0,
        subtotalMinor: 0,
        totalMinor: 6_000,
        purchasable: false,
      }),
    });

    await renderPage();

    expect(screen.getByText('Some items need attention')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Review your cart' }).getAttribute('href')).toBe(
      '/cart',
    );
    expect(screen.queryByRole('button', { name: 'Place order' })).toBeNull();
  });

  it('explains an address the store cannot deliver to yet', async () => {
    api.quoteCheckout.mockResolvedValue({
      quote: checkoutQuote({ shippingFeeMinor: null, totalMinor: null, purchasable: false }),
    });

    await renderPage();

    expect(screen.getByText('Delivery is not available here yet')).not.toBeNull();
    expect(screen.getByText('Not available')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Place order' })).toBeNull();
  });
});

describe('CheckoutPage: ways to pay', () => {
  function radios(container: HTMLElement): HTMLInputElement[] {
    return Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  }

  it('offers cash on delivery and shows the wallets as coming soon, unchosen', async () => {
    const { container } = await renderPage();

    const methods = radios(container).filter((radio) => radio.name === 'payment-method-choice');
    expect(methods.map((radio) => radio.value)).toEqual(['cod', 'bkash', 'nagad']);
    expect(methods.map((radio) => radio.checked)).toEqual([true, false, false]);
    expect(methods.map((radio) => radio.disabled)).toEqual([false, true, true]);
    // No name on the group, so the choices can never be submitted with the order.
    expect(methods.every((radio) => radio.form === null)).toBe(true);
    expect(screen.getAllByText('Coming soon')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Place order' })).not.toBeNull();
  });

  it('closes the checkout while the store cannot take a cash order', async () => {
    store.codAvailable = false;

    const { container } = await renderPage();

    const methods = radios(container).filter((radio) => radio.name === 'payment-method-choice');
    expect(methods.map((radio) => radio.disabled)).toEqual([true, true, true]);
    expect(methods.some((radio) => radio.checked)).toBe(false);
    // The badge follows the store's switch, not just the fact that cash exists as a method.
    expect(screen.queryByText('Available')).toBeNull();
    expect(screen.getByText('Off')).not.toBeNull();
    expect(screen.getByText('Checkout is temporarily unavailable')).not.toBeNull();
    expect(screen.getByText(/Payment is paused right now/)).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Place order' })).toBeNull();
    expect(hiddenValue(container, 'idempotencyKey')).toBeUndefined();
  });
});
