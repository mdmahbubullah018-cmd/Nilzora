// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLE_PERMISSIONS } from '@/test/fixtures';
import { courierConfig, provider, shipment, SHIPMENT_ID } from './fixtures';
import { PortalBookingForm } from './portal-booking-form';
import { ReturnCourierView } from './return-courier-section';

const actions = vi.hoisted(() => ({ portal: vi.fn(), returnBooking: vi.fn() }));
vi.mock('@/lib/courier-actions', () => ({
  recordPortalBookingAction: actions.portal,
  bookReturnShipmentAction: actions.returnBooking,
}));
// The section's loader reads the API on the server; the view under test does not.
vi.mock('@/components/admin-kit/read', () => ({ adminRead: vi.fn() }));

const csrf = { name: 'csrf_token', token: 'signed-test-token' };
const KEY = '8b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f08';
const RETURN_ID = '4b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f';
const providers = [
  { value: 'steadfast', label: 'Steadfast' },
  { value: 'pathao', label: 'Pathao' },
];

beforeEach(() => {
  actions.portal.mockReset().mockResolvedValue({ status: 'idle' });
  actions.returnBooking.mockReset().mockResolvedValue({ status: 'idle' });
});
afterEach(cleanup);

function keyOf(container: HTMLElement): string | undefined {
  return container.querySelector<HTMLInputElement>('input[name="bookingKey"]')?.value;
}

function form(overrides: Partial<Parameters<typeof PortalBookingForm>[0]> = {}) {
  const props = {
    orderNumber: 'NZ100001',
    csrf,
    initialBookingKey: KEY,
    providers,
    defaultWeightKg: '0.5',
    canOpenShipment: true,
    ...overrides,
  };
  return { props, ...render(<PortalBookingForm {...props} />) };
}

describe('PortalBookingForm', () => {
  it('sends the courier, consignment, weight, charge, note and the form’s key', async () => {
    form();
    fireEvent.change(screen.getByLabelText(/Consignment id/), { target: { value: 'PA-998' } });
    fireEvent.change(screen.getByLabelText(/Courier charge/), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText(/Where and how it was booked/), {
      target: { value: 'Booked in the Pathao portal' },
    });
    fireEvent.change(screen.getByLabelText(/^Courier\*?$/), { target: { value: 'pathao' } });
    fireEvent.click(screen.getByRole('button', { name: /Record portal booking/ }));
    await waitFor(() => expect(actions.portal).toHaveBeenCalled());
    const sent = actions.portal.mock.calls[0]?.[1] as FormData;
    expect(Object.fromEntries(sent.entries())).toMatchObject({
      orderNumber: 'NZ100001',
      bookingKey: KEY,
      provider: 'pathao',
      weight: '0.5',
      consignmentId: 'PA-998',
      charge: '60',
      note: 'Booked in the Pathao portal',
      csrf_token: 'signed-test-token',
    });
    expect(sent.get('returnId')).toBeNull();
  });

  it('keeps its key across re-renders and after a refusal, so a retry records once', () => {
    const { container, rerender, props } = form();
    rerender(
      <PortalBookingForm
        {...props}
        initialBookingKey="00000000-0000-4000-8000-000000000000"
        state={{
          status: 'error',
          message: 'Check the highlighted fields.',
          fieldErrors: { consignmentId: 'Enter the consignment id the courier portal shows.' },
          bookingKey: KEY,
        }}
      />,
    );
    expect(keyOf(container)).toBe(KEY);
    expect(screen.getByText('Enter the consignment id the courier portal shows.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Record portal booking/ })).toBeTruthy();
  });

  it('requires a reason when the courier differs from the recommendation', () => {
    form({ recommendedProvider: 'pathao' });
    expect(screen.getByLabelText(/^Courier\*?$/)).toHaveProperty('value', 'pathao');
    expect(screen.queryByLabelText(/Why Steadfast/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Courier\*?$/), { target: { value: 'steadfast' } });
    expect(screen.getByLabelText(/Why Steadfast instead of Pathao/)).toHaveProperty(
      'required',
      true,
    );
  });

  it('shows the recorded shipment and offers no second record', () => {
    form({
      state: {
        status: 'success',
        outcome: 'booked',
        message: 'Recorded the Pathao portal booking (consignment PA-998).',
        shipmentId: SHIPMENT_ID,
        bookingKey: KEY,
      },
      action: vi.fn(),
    });
    expect(screen.getByText(/Recorded the Pathao portal booking/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the shipment' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Record portal booking/ })).toBeNull();
  });
});

describe('ReturnCourierView portal pickup', () => {
  const config = (live: boolean) =>
    courierConfig({
      mode: live ? 'live' : 'mock',
      bookingEnabled: true,
      providers: [provider({ isEnabled: true })],
    });
  const view = (overrides: Partial<Parameters<typeof ReturnCourierView>[0]> = {}) =>
    render(
      <ReturnCourierView
        returnId={RETURN_ID}
        orderNumber="NZ100001"
        status="approved"
        shipments={[]}
        config={config(true)}
        permissions={ROLE_PERMISSIONS.admin}
        csrf={csrf}
        keys={{ pickup: 'k1', exchange: 'k2', portal: KEY }}
        {...overrides}
      />,
    );

  it('leads with the portal pickup when the return-pickup API is not verified', () => {
    const { container } = view();
    expect(
      screen.getByRole('heading', {
        name: 'Book the pickup in the courier portal, then record it here',
      }),
    ).toBeTruthy();
    expect(screen.queryByText('Book a return pickup')).toBeNull();
    const portal = screen.getByRole('form', { name: 'Record a portal return pickup' });
    expect(portal.querySelector<HTMLInputElement>('input[name="returnId"]')?.value).toBe(RETURN_ID);
    expect(portal.querySelector<HTMLInputElement>('input[name="orderNumber"]')?.value).toBe(
      'NZ100001',
    );
    expect(keyOf(container)).toBeDefined();
  });

  it('offers it as a secondary option where API pickups work', () => {
    view({ config: config(false) });
    expect(screen.getByText('Book a return pickup')).toBeTruthy();
    expect(screen.getByText('Pickup booked in the courier portal instead?')).toBeTruthy();
  });

  it('needs shipments.returns.manage and an approved return without an active pickup', () => {
    view({ permissions: ['admin_workspace.access', 'shipments.read'] });
    expect(screen.queryByRole('form', { name: 'Record a portal return pickup' })).toBeNull();
    cleanup();
    view({ status: 'requested' });
    expect(screen.queryByRole('form', { name: 'Record a portal return pickup' })).toBeNull();
    cleanup();
    view({ shipments: [shipment({ kind: 'return_pickup', status: 'pickup_pending' })] });
    expect(screen.queryByRole('form', { name: 'Record a portal return pickup' })).toBeNull();
  });
});
