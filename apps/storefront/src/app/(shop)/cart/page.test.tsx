import { render, screen } from '@testing-library/react';
import type { CartItem, CartQuoteResponse } from '@nilzora/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchParams } from '@/lib/auth-params';
import { apiError, cartLine, cartQuote, LAMP_ID, MUG_ID } from '@/testing/commerce-fixtures';
import CartPage from './page';

const browser = vi.hoisted(() => ({
  cart: undefined as string | undefined,
  quoteCart: vi.fn<(items: CartItem[]) => Promise<CartQuoteResponse>>(),
}));

vi.mock('@/lib/session', () => ({
  session: {
    cartCookie: { get: () => Promise.resolve(browser.cart) },
    api: () => Promise.resolve({ quoteCart: browser.quoteCart }),
  },
}));
vi.mock('@/lib/cart-actions', () => ({
  updateCartLineAction: vi.fn(),
  removeCartLineAction: vi.fn(),
}));

async function renderPage(params: SearchParams = {}) {
  return render(await CartPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  browser.cart = `${LAMP_ID}:2`;
  browser.quoteCart.mockReset();
  browser.quoteCart.mockResolvedValue({ quote: cartQuote() });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('CartPage', () => {
  it('shows an empty cart without asking the API', async () => {
    browser.cart = undefined;

    await renderPage();

    expect(screen.getByText('Your cart is empty')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Continue shopping' }).getAttribute('href')).toBe(
      '/products',
    );
    expect(browser.quoteCart).not.toHaveBeenCalled();
  });

  it('prices only valid cookie entries with the API and shows its amounts', async () => {
    // A tampered cookie: a malformed entry, a repeat and a price that is ignored.
    browser.cart = `${LAMP_ID}:2,not-a-product:1,${LAMP_ID}:9,${MUG_ID}:1:999`;

    await renderPage();

    expect(browser.quoteCart).toHaveBeenCalledWith([{ productId: LAMP_ID, quantity: 2 }]);
    expect(screen.getByRole('heading', { level: 1, name: 'Your cart' })).not.toBeNull();
    expect(screen.getByText(/2 items in your cart/)).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Brass table lamp' })).not.toBeNull();
    expect(screen.getByText('Subtotal (2 items)')).not.toBeNull();
    expect(screen.getAllByText('৳2,500').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Proceed to checkout' }).getAttribute('href')).toBe(
      '/checkout',
    );
    const keepShopping = screen.getByRole('link', { name: 'Continue shopping' });
    expect(keepShopping.getAttribute('href')).toBe('/products');
    // A bare text link is 20px tall: 44px on a phone and on any touch screen.
    expect(keepShopping.className).toContain('min-h-11');
    expect(keepShopping.className).toContain('pointer-coarse:min-h-11');
  });

  it('explains why checkout sent the customer back while the cart needs attention', async () => {
    browser.quoteCart.mockResolvedValue({
      quote: cartQuote({
        lines: [cartLine({ quantity: 6, availableQuantity: 2, problem: 'insufficient_stock' })],
        itemCount: 0,
        subtotalMinor: 0,
        purchasable: false,
      }),
    });

    await renderPage({ issue: 'stock' });

    expect(screen.getByText(/Some items no longer have enough stock/)).not.toBeNull();
    expect(screen.getByText('Only 2 left')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Proceed to checkout' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('tells the customer to choose options when a line lacks the variant it needs', async () => {
    browser.quoteCart.mockResolvedValue({
      quote: cartQuote({
        lines: [cartLine({ problem: 'variant_required' })],
        itemCount: 0,
        subtotalMinor: 0,
        purchasable: false,
      }),
    });

    await renderPage({ issue: 'options' });

    expect(screen.getByText(/need a size, colour or other option/)).not.toBeNull();
  });

  it('drops the notice once the cart can be checked out again', async () => {
    await renderPage({ issue: 'stock' });
    expect(screen.queryByText(/Some items no longer have enough stock/)).toBeNull();
  });

  it.each([
    ['an unknown flag', { issue: '<b>Free money</b>' }],
    ['a repeated flag', { issue: ['stock', 'stock'] }],
    ['an inherited name', { issue: 'constructor' }],
  ])('never shows text from the query, such as %s', async (_label, params) => {
    browser.quoteCart.mockResolvedValue({ quote: cartQuote({ purchasable: false }) });

    await renderPage(params);

    expect(screen.queryByText(/Free money/)).toBeNull();
    expect(screen.queryByText(/check out again/)).toBeNull();
  });

  it('keeps the cart and offers a retry when the API cannot price it', async () => {
    browser.quoteCart.mockRejectedValue(apiError(0, 'network_error'));

    await renderPage();

    expect(screen.getByText('We could not load your cart')).not.toBeNull();
    expect(screen.getByText(/Your items are still saved/)).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe('/cart');
  });

  it('lets errors that are not API answers reach the error boundary', async () => {
    browser.quoteCart.mockRejectedValue(new TypeError('bug'));
    await expect(renderPage()).rejects.toThrow('bug');
  });
});
