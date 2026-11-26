import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announceCartChange } from '@/lib/cart-events';
import { cartLabel, CartLink } from './cart-link';

const fetchMock = vi.fn<typeof fetch>();

function answer(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function cartLink(): HTMLElement {
  return screen.getByRole('link', { name: /^Cart/ });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('cartLabel', () => {
  it('names the link with the count once known', () => {
    expect(cartLabel(null)).toBe('Cart');
    expect(cartLabel(0)).toBe('Cart, 0 items');
    expect(cartLabel(1)).toBe('Cart, 1 item');
    expect(cartLabel(12)).toBe('Cart, 12 items');
  });
});

describe('CartLink', () => {
  it('links to the cart and shows the count from /api/cart', async () => {
    fetchMock.mockImplementation(() => answer({ count: 3 }));
    render(<CartLink />);

    // Nothing is claimed before the count is known.
    expect(cartLink().getAttribute('aria-label')).toBe('Cart');
    expect(cartLink().getAttribute('href')).toBe('/cart');

    await waitFor(() => expect(cartLink().getAttribute('aria-label')).toBe('Cart, 3 items'));
    expect(cartLink().textContent).toBe('3');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cart',
      expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }),
    );
  });

  it('shows no number for an empty cart and caps large ones', async () => {
    fetchMock.mockImplementation(() => answer({ count: 0 }));
    const { unmount } = render(<CartLink />);
    await waitFor(() => expect(cartLink().getAttribute('aria-label')).toBe('Cart, 0 items'));
    expect(cartLink().textContent).toBe('');
    unmount();

    fetchMock.mockImplementation(() => answer({ count: 150 }));
    render(<CartLink />);
    await waitFor(() => expect(cartLink().textContent).toBe('99+'));
    expect(cartLink().getAttribute('aria-label')).toBe('Cart, 150 items');
  });

  it('uses the count a form on the page announces', async () => {
    fetchMock.mockImplementation(() => answer({ count: 1 }));
    render(<CartLink />);
    await waitFor(() => expect(cartLink().getAttribute('aria-label')).toBe('Cart, 1 item'));

    act(() => announceCartChange(4));

    expect(cartLink().getAttribute('aria-label')).toBe('Cart, 4 items');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks again after a change without a count and when the window regains focus', async () => {
    fetchMock.mockImplementation(() => answer({ count: 1 }));
    render(<CartLink />);
    await waitFor(() => expect(cartLink().getAttribute('aria-label')).toBe('Cart, 1 item'));

    fetchMock.mockImplementation(() => answer({ count: 2 }));
    act(() => announceCartChange());
    await waitFor(() => expect(cartLink().getAttribute('aria-label')).toBe('Cart, 2 items'));

    fetchMock.mockImplementation(() => answer({ count: 5 }));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(cartLink().getAttribute('aria-label')).toBe('Cart, 5 items'));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['a network failure', () => Promise.reject(new TypeError('offline'))],
    ['an error status', () => answer({ count: 9 }, 500)],
    ['a malformed body', () => Promise.resolve(new Response('not json'))],
    ['a negative count', () => answer({ count: -2 })],
    ['a fractional count', () => answer({ count: 1.5 })],
    ['a text count', () => answer({ count: '3' })],
  ])('keeps showing no number after %s', async (_name, reply) => {
    fetchMock.mockImplementation(reply);
    render(<CartLink />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(cartLink().getAttribute('aria-label')).toBe('Cart');
    expect(cartLink().textContent).toBe('');
  });

  it('stops listening when unmounted', async () => {
    fetchMock.mockImplementation(() => answer({ count: 1 }));
    const { unmount } = render(<CartLink />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    unmount();

    window.dispatchEvent(new Event('focus'));
    announceCartChange();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
