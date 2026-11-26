import { fireEvent, render, screen, within } from '@testing-library/react';
import type { FormState } from '@nilzora/web-session';
import { describe, expect, it, vi } from 'vitest';
import {
  address,
  cartLine,
  checkoutQuote,
  HOME_ID,
  MUG_ID,
  OFFICE_ID,
  officeAddress,
  ORDER_KEY,
} from '@/testing/commerce-fixtures';
import type { CsrfField, FormAction } from '../auth/form-kit';
import { ORDER_NOT_CONFIRMED } from '@/lib/checkout-messages';
import { UnavailableState } from './account-states';
import { CheckoutItemsCard, DeliveryAddressCard } from './checkout-sections';
import { itemCountLabel, SummaryList, SummaryRow } from './page-parts';
import { PlaceOrderForm, PlaceOrderFormView } from './place-order-form';

const csrf: CsrfField = { name: 'csrf_token', token: 'signed-csrf-value' };
const idle: FormState = { status: 'idle' };
const noop = () => undefined;
const FRESH_KEY = '0c9d8e7f-6a5b-4c3d-8e1f-a2b3c4d5e6f7';

function hiddenValue(container: HTMLElement, name: string): string | undefined {
  const element = container.querySelector(`input[type="hidden"][name="${name}"]`);
  return element instanceof HTMLInputElement ? element.value : undefined;
}

function controlNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('input, select, textarea'), (element) =>
    element.getAttribute('name'),
  ).filter((name): name is string => name !== null);
}

describe('PlaceOrderFormView', () => {
  const fields = {
    csrf,
    addressId: HOME_ID,
    expectedTotalMinor: 256_000,
    idempotencyKey: FRESH_KEY,
  };

  it('posts the reviewed total, the address and this checkout key, never items or prices', () => {
    const { container } = render(
      <PlaceOrderFormView {...fields} state={idle} formAction={noop} pending={false} />,
    );

    expect(controlNames(container).sort()).toEqual([
      'addressId',
      'csrf_token',
      'expectedTotalMinor',
      'idempotencyKey',
      'note',
    ]);
    expect(hiddenValue(container, 'csrf_token')).toBe('signed-csrf-value');
    expect(hiddenValue(container, 'addressId')).toBe(HOME_ID);
    expect(hiddenValue(container, 'expectedTotalMinor')).toBe('256000');
    expect(hiddenValue(container, 'idempotencyKey')).toBe(FRESH_KEY);
    expect(screen.getByText('You pay ৳2,560 in cash when your order is delivered.')).not.toBeNull();
    const note = screen.getByLabelText(/^Note for delivery/);
    expect(note.getAttribute('maxlength')).toBe('500');
  });

  it('keeps the key the action echoed, so a retry cannot place a second order', () => {
    const { container } = render(
      <PlaceOrderFormView
        {...fields}
        state={{
          status: 'error',
          message:
            'We could not confirm your order. It may already be placed: check Your orders first. Trying again from this page will not create a second order.',
          values: { idempotencyKey: ORDER_KEY, note: 'Call first' },
        }}
        formAction={noop}
        pending={false}
      />,
    );

    expect(hiddenValue(container, 'idempotencyKey')).toBe(ORDER_KEY);
    expect(screen.getByRole('alert').textContent).toContain('will not create a second order');
    expect(screen.getByLabelText<HTMLTextAreaElement>(/^Note for delivery/).value).toBe(
      'Call first',
    );
  });

  it('drops a message about another address once the customer chose a different one', () => {
    const { container } = render(
      <PlaceOrderFormView
        {...fields}
        state={{
          status: 'error',
          message: 'Delivery is not available for this address yet. Choose another address.',
          values: { idempotencyKey: ORDER_KEY, addressId: OFFICE_ID, note: '' },
        }}
        formAction={noop}
        pending={false}
      />,
    );

    expect(screen.queryByRole('alert')).toBeNull();
    // The key is kept regardless: an order that may exist can never be placed twice.
    expect(hiddenValue(container, 'idempotencyKey')).toBe(ORDER_KEY);
  });

  it('marks the note and blocks repeat submits while placing', () => {
    render(
      <PlaceOrderFormView
        {...fields}
        state={{
          status: 'error',
          message: 'Check the highlighted field.',
          fieldErrors: { note: 'Keep the note under 500 characters.' },
          values: { idempotencyKey: ORDER_KEY, note: 'x' },
        }}
        formAction={noop}
        pending
      />,
    );

    const note = screen.getByLabelText(/^Note for delivery/);
    expect(note.getAttribute('aria-invalid')).toBe('true');
    expect(note.getAttribute('aria-describedby')).toBe('checkout-note-hint checkout-note-error');
    expect(screen.getByRole('button', { name: 'Place order' })).toHaveProperty('disabled', true);
  });

  it('points an unconfirmed order at the orders list instead of leaving a dead end', () => {
    render(
      <PlaceOrderFormView
        {...fields}
        state={{
          status: 'error',
          message: ORDER_NOT_CONFIRMED,
          values: { idempotencyKey: ORDER_KEY, addressId: HOME_ID, note: '' },
        }}
        formAction={noop}
        pending={false}
      />,
    );

    expect(screen.getByRole('link', { name: 'Open Your orders' }).getAttribute('href')).toBe(
      '/account/orders',
    );
  });

  it('offers no such link when the order was refused outright', () => {
    render(
      <PlaceOrderFormView
        {...fields}
        state={{
          status: 'error',
          message: 'Your order could not be placed. Check the details below, then try again.',
          values: { idempotencyKey: ORDER_KEY, addressId: HOME_ID, note: '' },
        }}
        formAction={noop}
        pending={false}
      />,
    );

    expect(screen.queryByRole('link', { name: 'Open Your orders' })).toBeNull();
  });
});

describe('PlaceOrderForm', () => {
  it('retries with the echoed key even when the page renders a new one', async () => {
    const action = vi.fn<FormAction>(() =>
      Promise.resolve({
        status: 'error',
        message:
          'We could not confirm your order. It may already be placed: check Your orders first. Trying again from this page will not create a second order.',
        values: { idempotencyKey: FRESH_KEY, note: '' },
      }),
    );
    const props = { action, csrf, addressId: HOME_ID, expectedTotalMinor: 256_000 };
    const { container, rerender } = render(
      <PlaceOrderForm {...props} idempotencyKey={FRESH_KEY} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
    await screen.findByRole('alert');
    // A refreshed page brings a new key; the attempt in progress keeps its own.
    rerender(<PlaceOrderForm {...props} idempotencyKey={ORDER_KEY} />);
    fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(2));

    const keys = action.mock.calls.map(([, formData]) => formData.get('idempotencyKey'));
    expect(keys).toEqual([FRESH_KEY, FRESH_KEY]);
    expect(hiddenValue(container, 'idempotencyKey')).toBe(FRESH_KEY);
  });
});

describe('DeliveryAddressCard', () => {
  it('shows the selected address and offers the others', () => {
    render(<DeliveryAddressCard selected={address()} addresses={[address(), officeAddress()]} />);

    expect(screen.getByText('Rahima Khatun', { selector: 'p.font-semibold' })).not.toBeNull();
    expect(screen.getByText('Dhanmondi, Dhaka 1205')).not.toBeNull();
    expect(screen.getByText('01712-345678')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Edit this address' }).getAttribute('href')).toBe(
      `/account/addresses/${HOME_ID}/edit?next=/checkout`,
    );
    expect(screen.getByRole('link', { name: 'Add a new address' }).getAttribute('href')).toBe(
      '/account/addresses/new?next=/checkout',
    );
    const other = screen.getByRole('link', { name: 'Deliver here: Office · Agrabad, Chattogram' });
    expect(other.getAttribute('href')).toBe(`/checkout?address=${OFFICE_ID}`);
  });

  it('offers no new address once the address book is full', () => {
    const many = Array.from({ length: 10 }, (_, index) =>
      address({ id: `ad000000-0000-4000-8000-${String(index).padStart(12, '0')}` }),
    );
    render(<DeliveryAddressCard selected={many[0] ?? address()} addresses={many} />);
    expect(screen.queryByRole('link', { name: 'Add a new address' })).toBeNull();
  });
});

describe('CheckoutItemsCard', () => {
  it('lists the priced lines and points back to the cart', () => {
    render(
      <CheckoutItemsCard
        quote={checkoutQuote({
          lines: [
            cartLine(),
            cartLine({
              productId: MUG_ID,
              name: 'Ceramic mug',
              quantity: 3,
              availableQuantity: 1,
              problem: 'insufficient_stock',
            }),
          ],
        })}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Items (5 items)' })).not.toBeNull();
    expect(screen.getByText('Qty 2 · ৳1,250 each')).not.toBeNull();
    expect(screen.getAllByText(/Line total/)).toHaveLength(1);
    expect(screen.getByText('Only 1 left')).not.toBeNull();
    expect(
      screen.getByRole('link', { name: 'Change items in your cart' }).getAttribute('href'),
    ).toBe('/cart');
  });

  it('shows each line’s picture and the chosen variant', () => {
    const image = {
      url: 'https://media.nilzora.test/products/lamp/full.webp',
      thumbUrl: 'https://media.nilzora.test/products/lamp/thumb.webp',
      alt: null,
    };
    const { container } = render(
      <CheckoutItemsCard
        quote={checkoutQuote({
          lines: [
            cartLine({
              variantId: '22222222-2222-4222-8222-222222222222',
              variantLabel: 'Colour: Navy / Size: M',
              image,
            }),
            cartLine({ productId: MUG_ID, name: 'Ceramic mug', image: null }),
          ],
        })}
      />,
    );

    const pictures = container.querySelectorAll('img');
    expect(pictures).toHaveLength(1);
    expect(pictures[0]?.getAttribute('src')).toBe(image.thumbUrl);
    expect(screen.getByText('Colour: Navy / Size: M')).not.toBeNull();
  });

  it('keeps the thumbnail compact and the row horizontal', () => {
    const image = {
      url: 'https://media.nilzora.test/products/lamp/full.webp',
      thumbUrl: 'https://media.nilzora.test/products/lamp/thumb.webp',
      alt: null,
    };
    const { container } = render(
      <CheckoutItemsCard quote={checkoutQuote({ lines: [cartLine({ image })] })} />,
    );

    const row = container.querySelector('li');
    const frame = container.querySelector('img')?.parentElement;

    // One row per item: picture beside the details, never stacked or stretched.
    expect(row?.className).toContain('flex');
    expect(row?.className).toContain('items-start');
    // 64px on a phone, 72px from sm: a medium square, not a full-width picture.
    const classes = frame?.className.split(/\s+/) ?? [];
    expect(classes).toContain('size-16');
    expect(classes).toContain('sm:size-18');
    expect(classes).toContain('shrink-0');
    expect(classes).toContain('rounded-lg');
    expect(classes).not.toContain('w-full');
  });

  it('sizes the placeholder tile like the picture it stands in for', () => {
    const { container } = render(
      <CheckoutItemsCard quote={checkoutQuote({ lines: [cartLine({ image: null })] })} />,
    );

    const tile = container.querySelector('li > div');
    expect(tile?.className).toContain('size-16');
    expect(tile?.className).toContain('sm:size-18');
  });
});

describe('page parts', () => {
  it('lays out summary rows as a description list', () => {
    const { container } = render(
      <SummaryList>
        <SummaryRow label="Subtotal">৳2,500</SummaryRow>
        <SummaryRow label="Total" total>
          ৳2,560
        </SummaryRow>
      </SummaryList>,
    );
    const list = container.querySelector('dl');
    if (!list) throw new Error('no description list');
    expect(
      within(list)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['Subtotal', 'Total']);
    expect(
      within(list)
        .getAllByRole('definition')
        .map((value) => value.textContent),
    ).toEqual(['৳2,500', '৳2,560']);
  });

  it('counts items in words', () => {
    expect(itemCountLabel(1)).toBe('1 item');
    expect(itemCountLabel(0)).toBe('0 items');
    expect(itemCountLabel(12)).toBe('12 items');
  });

  it('offers a retry when the API is unreachable', () => {
    render(<UnavailableState title="We could not open checkout" retryHref="/checkout" />);
    expect(screen.getByText('We could not open checkout')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe('/checkout');
  });
});
