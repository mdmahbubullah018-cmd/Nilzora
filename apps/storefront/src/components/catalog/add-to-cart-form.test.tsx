import { MAX_LINE_QUANTITY } from '@nilzora/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FormState } from '@nilzora/web-session';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CART_CHANGED_EVENT, type CartChangedDetail } from '@/lib/cart-events';
import { addedCount, AddToCartForm, AddToCartFormView } from './add-to-cart-form';

const PRODUCT = '0d000000-0000-4000-8000-000000000001';
const idle: FormState = { status: 'idle' };
const noop = () => undefined;

function hidden(container: HTMLElement, name: string): string | undefined {
  return container.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)?.value;
}

function stepper(): HTMLElement {
  return screen.getByRole('group', { name: 'Quantity' });
}

function shownQuantity(): string {
  return within(stepper()).getByRole('status').textContent ?? '';
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AddToCartFormView', () => {
  it('posts only the product id, a quantity and the limit hint', () => {
    const { container } = render(
      <AddToCartFormView
        productId={PRODUCT}
        maxOrderQuantity={3}
        state={idle}
        formAction={noop}
        pending={false}
      />,
    );

    const names = Array.from(
      container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'),
      (element) => element.name,
    );
    expect(names.sort()).toEqual(['limit', 'productId', 'quantity']);
    expect(hidden(container, 'productId')).toBe(PRODUCT);
    expect(hidden(container, 'limit')).toBe('3');
    // Never a price: the API prices the cart on every view and again at checkout.
    expect(container.innerHTML).not.toMatch(/price/i);
    expect(shownQuantity()).toBe('1');
    expect(screen.getByRole('button', { name: 'Decrease quantity' })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(shownQuantity()).toBe('2');
    expect(within(stepper()).getByRole('status').getAttribute('aria-describedby')).toBe(
      'add-to-cart-limit',
    );
    expect(screen.getByText('You can order up to 3 of this product at a time.')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Add to cart' }).getAttribute('type')).toBe('submit');
  });

  it('caps the list at the most one cart line may hold', () => {
    render(
      <AddToCartFormView
        productId={PRODUCT}
        maxOrderQuantity={500}
        state={idle}
        formAction={noop}
        pending={false}
      />,
    );
    const increase = screen.getByRole('button', { name: 'Increase quantity' });
    for (let step = 1; step < MAX_LINE_QUANTITY; step += 1) fireEvent.click(increase);
    expect(shownQuantity()).toBe(String(MAX_LINE_QUANTITY));
    expect(increase).toHaveProperty('disabled', true);
  });

  it.each([0, -1, Number.NaN])(
    'disables adding and says why when nothing can be ordered (%s)',
    (maxOrderQuantity) => {
      const { container } = render(
        <AddToCartFormView
          productId={PRODUCT}
          maxOrderQuantity={maxOrderQuantity}
          state={idle}
          formAction={noop}
          pending={false}
        />,
      );

      expect(container.querySelector('form')).toBeNull();
      const button = screen.getByRole('button', { name: 'Add to cart' });
      expect(button).toHaveProperty('disabled', true);
      const reason = document.getElementById(button.getAttribute('aria-describedby') ?? '');
      expect(reason?.textContent).toContain('out of stock');
    },
  );

  it('confirms an add with a link to the cart', () => {
    render(
      <AddToCartFormView
        productId={PRODUCT}
        maxOrderQuantity={3}
        state={{ status: 'success', message: 'Added to your cart.', values: { count: '2' } }}
        formAction={noop}
        pending={false}
      />,
    );

    const status = screen
      .getAllByRole('status')
      .find((element) => element.textContent?.includes('Added to your cart.'));
    expect(status).toBeDefined();
    expect(
      within(status as HTMLElement)
        .getByRole('link', { name: 'View your cart' })
        .getAttribute('href'),
    ).toBe('/cart');
  });

  it('announces a refusal at once', () => {
    render(
      <AddToCartFormView
        productId={PRODUCT}
        maxOrderQuantity={3}
        state={{ status: 'error', message: 'Your cart is full.' }}
        formAction={noop}
        pending={false}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('Your cart is full.');
    expect(screen.queryByRole('link', { name: 'View your cart' })).toBeNull();
  });

  it('blocks repeat submissions while pending', () => {
    render(
      <AddToCartFormView
        productId={PRODUCT}
        maxOrderQuantity={3}
        state={idle}
        formAction={noop}
        pending
      />,
    );
    expect(screen.getByRole('button', { name: 'Add to cart' })).toHaveProperty('disabled', true);
  });
});

describe('addedCount', () => {
  it('reads a whole, non-negative count from a success only', () => {
    expect(addedCount({ status: 'success', values: { count: '4' } })).toBe(4);
    expect(addedCount({ status: 'success', values: { count: 'lots' } })).toBeUndefined();
    expect(addedCount({ status: 'success', values: { count: '-1' } })).toBeUndefined();
    expect(addedCount({ status: 'success' })).toBeUndefined();
    expect(addedCount({ status: 'error', values: { count: '4' } })).toBeUndefined();
  });
});

describe('AddToCartForm', () => {
  it('runs the action and tells the header the new count', async () => {
    const action = vi.fn((_previous: FormState, formData: FormData): Promise<FormState> =>
      Promise.resolve({
        status: 'success',
        message: 'Added to your cart.',
        values: { count: String(Number(formData.get('quantity')) + 1) },
      }),
    );
    const announced: (number | undefined)[] = [];
    const listener = (event: Event) =>
      announced.push((event as CustomEvent<CartChangedDetail>).detail.count);
    window.addEventListener(CART_CHANGED_EVENT, listener);

    try {
      render(<AddToCartForm action={action} productId={PRODUCT} maxOrderQuantity={5} />);
      fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
      fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));

      await waitFor(() =>
        expect(screen.getAllByRole('status').some((el) => el.textContent?.includes('Added'))).toBe(
          true,
        ),
      );
      expect(action).toHaveBeenCalledTimes(1);
      const formData = action.mock.calls[0]?.[1];
      expect(formData?.get('productId')).toBe(PRODUCT);
      expect(formData?.get('quantity')).toBe('2');
      expect(formData?.get('limit')).toBe('5');
      // The announcement runs in an effect after the message is shown.
      await waitFor(() => expect(announced).toEqual([3]));
    } finally {
      window.removeEventListener(CART_CHANGED_EVENT, listener);
    }
  });

  it('announces nothing when the add is refused', async () => {
    const action = vi.fn((): Promise<FormState> =>
      Promise.resolve({ status: 'error', message: 'Expired.' }),
    );
    const listener = vi.fn();
    window.addEventListener(CART_CHANGED_EVENT, listener);

    try {
      render(<AddToCartForm action={action} productId={PRODUCT} maxOrderQuantity={5} />);
      fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));

      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Expired.'));
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(CART_CHANGED_EVENT, listener);
    }
  });
});
