import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { customerShipment } from '@/testing/commerce-fixtures';
import { deliveryShipments, returnPickups, trackingHref, trackingSteps } from '@/lib/shipment-view';
import { ShipmentTrackingCard } from './shipment-tracking';

/*
 * Courier tracking as the customer sees it: who has the parcel, its courier status, the
 * tracking code and the courier's updates. It reads only the customer contract, so it can
 * never show a cost; a tracking link appears only for an ordinary web address.
 */

const RETURN_ID = '4b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f';

function card(shipments = [customerShipment()], returnLinks = false) {
  return render(
    <ShipmentTrackingCard
      title="Delivery tracking"
      shipments={shipments}
      returnLinks={returnLinks}
    />,
  );
}

describe('ShipmentTrackingCard', () => {
  it('shows the courier, its status, the tracking code and the updates, newest first', () => {
    card();

    expect(screen.getByRole('heading', { level: 2, name: 'Delivery tracking' })).not.toBeNull();
    const parcel = screen.getByRole('region', { name: 'Your parcel with Steadfast Courier' });
    expect(within(parcel).getByText('Steadfast Courier')).not.toBeNull();
    expect(within(parcel).getByText('Courier status:').parentElement?.textContent).toBe(
      'Courier status: In transit',
    );
    expect(within(parcel).getByText('SF123456789')).not.toBeNull();
    const steps = within(screen.getByRole('list', { name: 'Courier updates, newest first' }))
      .getAllByRole('listitem')
      .map((item) => item.querySelector('p')?.textContent);
    expect(steps).toEqual(['In transit', 'Picked up', 'Booked']);
    expect(screen.getByText('26 October 2026 at 08:15')).not.toBeNull();
    expect(screen.queryByText('Test shipment')).toBeNull();
  });

  it('links to the courier’s own tracking page in a new tab, without an opener', () => {
    card();

    const link = screen.getByRole('link', { name: /Track on Steadfast Courier/ });
    expect(link.getAttribute('href')).toBe('https://steadfast.com.bd/t/SF123456789');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it.each([
    ['no tracking page', null],
    ['a script address', 'javascript:alert(1)'],
    ['a relative path', '/t/SF123'],
  ])('offers no tracking link for %s', (_label, trackingUrl) => {
    card([customerShipment({ trackingUrl })]);
    expect(screen.queryByRole('link', { name: /Track on/ })).toBeNull();
    // The code is still there to read and copy.
    expect(screen.getByText('SF123456789')).not.toBeNull();
  });

  it('marks a test shipment, and says when the parcel was delivered', () => {
    card([
      customerShipment({
        isTest: true,
        status: 'delivered',
        deliveredAt: '2026-10-27T08:00:00.000Z',
        events: [{ status: 'delivered', occurredAt: '2026-10-27T08:00:00.000Z' }],
      }),
    ]);

    expect(screen.getByText('Test shipment')).not.toBeNull();
    expect(screen.getByText(/Delivered on/).textContent).toBe('Delivered on 27 October 2026');
  });

  it('copies the tracking code', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    card();

    fireEvent.click(screen.getByRole('button', { name: 'Copy tracking code SF123456789' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('SF123456789'));
    expect(await screen.findByText('Tracking code copied.')).not.toBeNull();
  });

  it('folds long histories behind "Show earlier updates"', () => {
    const events = (
      ['booked', 'picked_up', 'in_transit', 'on_hold', 'in_transit', 'out_for_delivery'] as const
    ).map((status, index) => ({ status, occurredAt: `2026-10-2${String(index)}T06:00:00.000Z` }));
    card([customerShipment({ events, status: 'out_for_delivery' })]);

    expect(screen.getByText('Show 2 earlier updates')).not.toBeNull();
    const earlier = screen.getByRole('list', { name: 'Earlier courier updates', hidden: true });
    expect(within(earlier).getAllByRole('listitem', { hidden: true })).toHaveLength(2);
  });

  it('links a return pickup to its return on the order page', () => {
    card(
      [
        customerShipment({
          kind: 'return_pickup',
          returnRequestId: RETURN_ID,
          status: 'picked_up',
        }),
      ],
      true,
    );

    expect(
      screen.getByRole('region', { name: 'Return pickup with Steadfast Courier' }),
    ).not.toBeNull();
    expect(screen.getAllByText('Collected from you').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'View the return' }).getAttribute('href')).toBe(
      `/account/returns/${RETURN_ID}`,
    );
  });

  it('renders nothing without shipments', () => {
    const { container } = card([]);
    expect(container.innerHTML).toBe('');
  });

  it('never shows money', () => {
    const { container } = card([
      customerShipment(),
      customerShipment({ id: '5e000000-0000-4000-8000-000000000002', kind: 'exchange' }),
    ]);
    expect(container.textContent).not.toMatch(/৳|taka|BDT|charge|\bfees?\b|cash|settle/i);
  });
});

describe('shipment view rules', () => {
  it('keeps parcels to the customer, dropping a cancelled booking that was replaced', () => {
    const cancelled = customerShipment({
      id: '5e000000-0000-4000-8000-00000000000a',
      status: 'cancelled',
    });
    const live = customerShipment();
    const pickup = customerShipment({
      id: '5e000000-0000-4000-8000-00000000000b',
      kind: 'return_pickup',
    });

    expect(deliveryShipments([live, cancelled, pickup])).toEqual([live]);
    // When every booking was cancelled, the customer still sees that.
    expect(deliveryShipments([cancelled, pickup])).toEqual([cancelled]);
    expect(returnPickups([live, pickup])).toEqual([pickup]);
    expect(returnPickups([pickup], RETURN_ID)).toEqual([]);
  });

  it('accepts only web addresses as tracking links', () => {
    expect(trackingHref('https://merchant.pathao.com/tracking?c=1')).toBe(
      'https://merchant.pathao.com/tracking?c=1',
    );
    expect(trackingHref('data:text/html,hi')).toBeNull();
    expect(trackingHref('not a url')).toBeNull();
  });

  it('shows the booking when the courier has sent no update yet', () => {
    expect(trackingSteps(customerShipment({ events: [] }))).toEqual([
      { status: 'booked', at: '2026-10-25T04:00:00.000Z' },
    ]);
    expect(trackingSteps(customerShipment({ events: [], bookedAt: null }))).toEqual([]);
  });
});
