import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CART_CHANGED_EVENT } from '@/lib/cart-events';
import { CartEmptiedSignal, noteCartRemoval } from './cart-emptied-signal';

function Page() {
  return (
    <main>
      <h1>Your cart</h1>
      <CartEmptiedSignal />
    </main>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CartEmptiedSignal', () => {
  it('asks the header badge to re-read the cart, without moving focus on a plain visit', () => {
    const heard = vi.fn();
    window.addEventListener(CART_CHANGED_EVENT, heard);
    render(<Page />);
    window.removeEventListener(CART_CHANGED_EVENT, heard);

    expect(heard).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(document.body);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('after removing the last line, moves focus to the heading and announces it once', () => {
    noteCartRemoval();
    const { unmount } = render(<Page />);

    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Your cart' }));
    expect(screen.getByRole('status').textContent).toBe(
      'Removed from your cart. Your cart is now empty.',
    );
    unmount();

    // The note is used up: the next plain visit announces nothing.
    render(<Page />);
    expect(screen.getByRole('status').textContent).toBe('');
  });
});
