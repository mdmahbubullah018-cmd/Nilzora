// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingForm, BookingOutcomeNotice, OrderCourierPanel } from './booking-panel';
import type { BookingState } from './courier-state';
import { comparison, courierContext, SHIPMENT_ID } from './fixtures';

const actions = vi.hoisted(() => ({ compare: vi.fn(), book: vi.fn(), portal: vi.fn() }));
vi.mock('@/lib/courier-actions', () => ({
  compareCouriersAction: actions.compare,
  bookShipmentAction: actions.book,
  recordPortalBookingAction: actions.portal,
}));

const csrf = { name: 'csrf_token', token: 'signed-test-token' };
const KEY = '7b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f09';
const PORTAL_KEY = '8b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f08';
const names = { steadfast: 'Steadfast', pathao: 'Pathao' };

beforeEach(() => {
  actions.compare.mockReset().mockResolvedValue({ status: 'idle' });
  actions.book.mockReset().mockResolvedValue({ status: 'idle' });
  actions.portal.mockReset().mockResolvedValue({ status: 'idle' });
});
afterEach(cleanup);

function keyInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[name="bookingKey"]');
  if (!input) throw new Error('booking key missing');
  return input;
}

function bookingForm(overrides: Partial<Parameters<typeof BookingForm>[0]> = {}) {
  const props = {
    orderNumber: 'NZ100001',
    csrf,
    context: courierContext(),
    comparison: comparison(),
    initialBookingKey: KEY,
    names,
    state: { status: 'idle' } as BookingState,
    action: vi.fn(),
    onNewAttempt: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<BookingForm {...props} />) };
}

describe('BookingForm', () => {
  it('keeps the same booking key across re-renders of the same form', () => {
    const { container, rerender, props } = bookingForm();
    expect(keyInput(container).value).toBe(KEY);
    // A page refresh hands new props (and even a different initial key): the form keeps its own.
    rerender(
      <BookingForm
        {...props}
        initialBookingKey="00000000-0000-4000-8000-000000000000"
        state={{ status: 'error', message: 'Nilzora could not be reached.', bookingKey: KEY }}
      />,
    );
    expect(keyInput(container).value).toBe(KEY);
  });

  it('defaults to the recommended courier and shows the preview before booking', () => {
    bookingForm();
    expect(screen.getByRole('radio', { name: /Pathao/ })).toHaveProperty('checked', true);
    const preview = screen.getByRole('region', { name: 'Booking preview' });
    expect(within(preview).getByText('Mirpur, Dhaka (Dhaka)')).toBeTruthy();
    expect(within(preview).getByText('৳1,250')).toBeTruthy(); // cash to collect
    expect(within(preview).getByText('0.5 kg')).toBeTruthy();
    expect(within(preview).getByText('৳72.50')).toBeTruthy(); // delivery 60 + COD fee 12.50
    expect(within(preview).getByText('Live quote')).toBeTruthy();
    expect(within(preview).getByText('৳80')).toBeTruthy(); // the customer's own shipping charge
    expect(screen.getByRole('button', { name: /Book with Pathao/ })).toBeTruthy();
    expect(screen.queryByLabelText(/Why Pathao/)).toBeNull();
  });

  it('asks for a reason when another courier is chosen', () => {
    bookingForm();
    fireEvent.click(screen.getByRole('radio', { name: /Steadfast/ }));
    const reason = screen.getByLabelText(/Why Steadfast instead of Pathao/);
    expect(reason).toHaveProperty('required', true);
    expect(screen.getByRole('button', { name: /Book with Steadfast/ })).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'Booking preview' })).getByText(
        'Internal Estimate',
      ),
    ).toBeTruthy();
  });

  it('offers a new attempt (with a new key) only after a refusal', () => {
    const onNewAttempt = vi.fn();
    const { container } = bookingForm({
      state: { status: 'error', outcome: 'failed', message: 'Refused', bookingKey: KEY },
      onNewAttempt,
    });
    expect(screen.queryByRole('button', { name: /Book with/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start a new booking attempt' }));
    expect(onNewAttempt).toHaveBeenCalled();
    expect(keyInput(container).value).not.toBe(KEY);
    expect(keyInput(container).value).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByRole('button', { name: /Book with Pathao/ })).toBeTruthy();
  });

  it('never offers to book again after an uncertain answer', () => {
    bookingForm({
      state: { status: 'error', outcome: 'uncertain', message: 'Check', bookingKey: KEY },
    });
    expect(screen.queryByRole('button', { name: /Book with/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /new booking attempt/ })).toBeNull();
  });
});

describe('BookingOutcomeNotice', () => {
  it.each([
    ['booked', 'Booked'],
    ['failed', 'Booking failed'],
    ['uncertain', 'Check the courier portal, then resolve'],
    ['in_progress', 'Booking in progress'],
  ] as const)('names a %s outcome and links to the shipment', (outcome, title) => {
    render(
      <BookingOutcomeNotice
        state={{ status: 'success', outcome, message: 'Words', shipmentId: SHIPMENT_ID }}
        canOpenShipment
      />,
    );
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the shipment' }).getAttribute('href')).toBe(
      `/admin/operations/shipments/${SHIPMENT_ID}`,
    );
  });
});

describe('OrderCourierPanel', () => {
  const panel = (overrides: Partial<Parameters<typeof OrderCourierPanel>[0]> = {}) =>
    render(
      <OrderCourierPanel
        orderNumber="NZ100001"
        csrf={csrf}
        context={courierContext()}
        mode="mock"
        bookingEnabled={false}
        names={names}
        canBook
        canOpenShipments
        apiBookable
        portalBookingKey={PORTAL_KEY}
        providerOptions={[
          { value: 'steadfast', label: 'Steadfast' },
          { value: 'pathao', label: 'Pathao' },
        ]}
        {...overrides}
      />,
    );

  it('compares first, then opens the booking form with the key from the comparison', async () => {
    actions.compare.mockResolvedValue({
      status: 'success',
      comparison: comparison(),
      bookingKey: KEY,
      values: { weight: '0.5' },
    });
    const { container } = panel();
    expect(screen.getAllByLabelText(/Parcel weight/)[0]).toHaveProperty('value', '0.5');
    expect(screen.queryByRole('region', { name: 'Booking preview' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Compare couriers/ }));

    await screen.findByRole('region', { name: 'Booking preview' });
    expect(keyInput(container).value).toBe(KEY);
    expect(screen.getByRole('table', { name: 'Courier prices for this parcel' })).toBeTruthy();
    expect(screen.getByText('Recommended: Pathao')).toBeTruthy();
    const sent = actions.compare.mock.calls[0]?.[1] as FormData;
    expect(sent.get('weight')).toBe('0.5');
    expect(sent.get('csrf_token')).toBe('signed-test-token');
  });

  it('keeps showing the outcome after a booking', async () => {
    actions.compare.mockResolvedValue({
      status: 'success',
      comparison: comparison(),
      bookingKey: KEY,
    });
    actions.book.mockResolvedValue({
      status: 'success',
      outcome: 'booked',
      message: 'Booked with Pathao (consignment PA-123).',
      shipmentId: SHIPMENT_ID,
      bookingKey: KEY,
    });
    panel();
    fireEvent.click(screen.getByRole('button', { name: /Compare couriers/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Book with Pathao/ }));
    await waitFor(() => expect(screen.getByText(/consignment PA-123/)).toBeTruthy());
    const sent = actions.book.mock.calls[0]?.[1] as FormData;
    expect(sent.get('bookingKey')).toBe(KEY);
    expect(sent.get('provider')).toBe('pathao');
    expect(sent.get('recommendedProvider')).toBe('pathao');
  });

  it('puts the portal booking first when API booking is unavailable', () => {
    panel({ mode: 'off', apiBookable: false });
    expect(
      screen.getByRole('heading', { name: 'Book in the courier portal, then record it here' }),
    ).toBeTruthy();
    expect(screen.getByText(/switched off on this server/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Compare couriers/ })).toBeNull();
    const form = screen.getByRole('form', { name: 'Record a portal booking' });
    expect(form.closest('details')).toBeNull();
    expect(form.querySelector<HTMLInputElement>('input[name="bookingKey"]')?.value).toBe(
      PORTAL_KEY,
    );
  });

  it('explains live mode without a verified booking API, with the portal form first', () => {
    panel({ mode: 'live', bookingEnabled: true, apiBookable: false });
    expect(screen.getByText(/awaiting verified API documentation/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Record portal booking/ })).toBeTruthy();
  });

  it('keeps the portal booking as a secondary option when API booking works', () => {
    panel({ mode: 'mock', apiBookable: true });
    expect(screen.getByRole('button', { name: /Compare couriers/ })).toBeTruthy();
    const form = screen.getByRole('form', { name: 'Record a portal booking' });
    expect(form.closest('details')?.hasAttribute('open')).toBe(false);
    expect(screen.getByText('Booked in the courier portal instead?')).toBeTruthy();
  });

  it('offers no portal booking without shipments.create', () => {
    panel({ apiBookable: false, canBook: false });
    expect(screen.queryByRole('form', { name: 'Record a portal booking' })).toBeNull();
  });

  it('hides compare and book from an account without shipments.create', () => {
    panel({ canBook: false });
    expect(screen.queryByRole('button', { name: /Compare couriers/ })).toBeNull();
    expect(screen.getByText(/cannot book couriers/)).toBeTruthy();
  });

  it('flags test mode', () => {
    panel();
    expect(screen.getByText('Test')).toBeTruthy();
    expect(screen.getByText(/Test mode — no real parcels/)).toBeTruthy();
  });
});
