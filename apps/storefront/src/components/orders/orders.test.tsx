import { fireEvent, render, screen } from '@testing-library/react';
import { ORDER_STATUSES, PAYMENT_STATUSES } from '@nilzora/contracts';
import type { FormState } from '@nilzora/web-session';
import { describe, expect, it, vi } from 'vitest';
import { CART_CHANGED_EVENT, type CartChangedDetail } from '@/lib/cart-events';
import type { CsrfField, FormAction } from '../auth/form-kit';
import { CancelOrderForm, CancelOrderFormView } from './cancel-order-form';
import { CartClearedSignal } from './cart-cleared-signal';
import {
  formatEventTime,
  ORDER_EVENT_LABELS,
  ORDER_STATUS_LABELS,
  OrderStatusBadge,
  PAYMENT_STATUS_DESCRIPTIONS,
  PAYMENT_STATUS_LABELS,
  PaymentStatusBadge,
} from './order-status';

const csrf: CsrfField = { name: 'csrf_token', token: 'signed-csrf-value' };
const idle: FormState = { status: 'idle' };
const noop = () => undefined;

describe('order status words', () => {
  it('has customer-facing words for every order and payment status', () => {
    for (const status of ORDER_STATUSES) {
      expect(ORDER_STATUS_LABELS[status]).toMatch(/\w/);
      expect(ORDER_EVENT_LABELS[status]).toMatch(/\w/);
    }
    for (const status of PAYMENT_STATUSES) {
      expect(PAYMENT_STATUS_LABELS[status]).toMatch(/\w/);
      expect(PAYMENT_STATUS_DESCRIPTIONS[status]).toMatch(/\w/);
    }
  });

  it('shows status badges in words', () => {
    render(
      <>
        <OrderStatusBadge status="pending" />
        <PaymentStatusBadge status="collected" />
      </>,
    );
    expect(screen.getByText('Awaiting confirmation')).not.toBeNull();
    expect(screen.getByText('Paid')).not.toBeNull();
  });

  it('formats event times on the Bangladesh clock', () => {
    expect(formatEventTime('2026-10-24T08:05:00.000Z')).toBe('24 October 2026 at 14:05');
    expect(formatEventTime('not a date')).toBe('');
  });
});

describe('CancelOrderFormView', () => {
  it('asks for a deliberate second step before cancelling', () => {
    const { container } = render(
      <CancelOrderFormView
        csrf={csrf}
        orderNumber="NZ100042"
        state={idle}
        formAction={noop}
        pending={false}
      />,
    );

    const details = container.querySelector('details');
    expect(details?.open).toBe(false);
    expect(container.querySelector('summary')?.textContent).toBe('Cancel this order');
    expect(
      container.querySelector<HTMLInputElement>('input[type="hidden"][name="orderNumber"]')?.value,
    ).toBe('NZ100042');
    expect(
      container.querySelector<HTMLInputElement>('input[type="hidden"][name="csrf_token"]')?.value,
    ).toBe('signed-csrf-value');
    expect(screen.getByLabelText(/^Reason/).getAttribute('maxlength')).toBe('300');
    expect(
      screen.getByRole('button', { name: 'Yes, cancel order NZ100042', hidden: true }),
    ).toHaveProperty('type', 'submit');
  });

  it('stays open after an error so the message is seen', () => {
    const { container } = render(
      <CancelOrderFormView
        csrf={csrf}
        orderNumber="NZ100042"
        state={{
          status: 'error',
          message: 'This order can no longer be cancelled.',
          fieldErrors: { reason: 'Keep the reason under 300 characters.' },
          values: { reason: 'Too late' },
        }}
        formAction={noop}
        pending
      />,
    );

    expect(container.querySelector('details')?.open).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe('This order can no longer be cancelled.');
    expect(screen.getByLabelText<HTMLTextAreaElement>(/^Reason/).value).toBe('Too late');
    expect(screen.getByRole('button', { name: 'Yes, cancel order NZ100042' })).toHaveProperty(
      'disabled',
      true,
    );
  });
});

describe('CancelOrderForm', () => {
  it('posts the order number, reason and CSRF token', async () => {
    const action = vi.fn<FormAction>(() =>
      Promise.resolve({ status: 'error', message: 'This order could not be found.' }),
    );
    const { container } = render(
      <CancelOrderForm action={action} csrf={csrf} orderNumber="NZ100042" />,
    );

    fireEvent.click(container.querySelector('summary') as HTMLElement);
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'Ordered twice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel order NZ100042' }));

    expect((await screen.findByRole('alert')).textContent).toBe('This order could not be found.');
    const submitted = action.mock.calls[0]?.[1];
    expect(submitted?.get('orderNumber')).toBe('NZ100042');
    expect(submitted?.get('reason')).toBe('Ordered twice');
    expect(submitted?.get('csrf_token')).toBe('signed-csrf-value');
  });
});

describe('CartClearedSignal', () => {
  it('asks the header badge to read the cart again, once', () => {
    const details: CartChangedDetail[] = [];
    const listener = (event: Event) =>
      details.push((event as CustomEvent<CartChangedDetail>).detail);
    window.addEventListener(CART_CHANGED_EVENT, listener);

    const { container, rerender } = render(<CartClearedSignal />);
    rerender(<CartClearedSignal />);

    window.removeEventListener(CART_CHANGED_EVENT, listener);
    // No count: a reload after starting a new cart must not show it as empty.
    expect(details).toEqual([{ count: undefined }]);
    expect(container.innerHTML).toBe('');
  });
});
