import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ServiceStrip } from './service-strip';

function strip() {
  return screen.getByRole('region', { name: 'Shopping with Nilzora' });
}

describe('ServiceStrip', () => {
  it('shows the four benefits in order and no threshold-based free shipping', () => {
    render(<ServiceStrip />);

    const buttons = within(strip()).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Fast Delivery',
      'Secure Checkout',
      'Easy Returns',
      'Customer Support',
    ]);
    expect(strip().textContent).not.toMatch(/free shipping|1,999/i);
  });

  it('opens a sheet explaining the benefit that was clicked, and closes it again', async () => {
    render(<ServiceStrip />);

    fireEvent.click(within(strip()).getByRole('button', { name: 'Fast Delivery' }));

    const dialog = await screen.findByRole('dialog', { name: 'Fast Delivery' });
    expect(within(dialog).getByText(/delivery charge for your area is shown/i)).not.toBeNull();
    // No delivery time is promised.
    expect(dialog.textContent).toMatch(/not fixed in advance/i);
    expect(within(dialog).getByRole('link', { name: 'Track my orders' }).getAttribute('href')).toBe(
      '/account/orders',
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('explains each of the other benefits truthfully', async () => {
    render(<ServiceStrip profile={null} />);

    for (const [title, text] of [
      ['Secure Checkout', /cash on delivery/i],
      ['Easy Returns', /set by the store/i],
      ['Customer Support', /Help & support/i],
    ] as const) {
      fireEvent.click(within(strip()).getByRole('button', { name: title }));
      const dialog = await screen.findByRole('dialog', { name: title });
      expect(dialog.textContent).toMatch(text);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    }
  });
});
