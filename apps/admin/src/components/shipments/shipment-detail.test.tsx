// @vitest-environment jsdom
import type { Permission } from '@nilzora/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROLE_PERMISSIONS } from '@/test/fixtures';
import { AT, event, LATER, provider, shipment } from './fixtures';
import { ShipmentDetailView, shipmentTimelineItems } from './shipment-detail';

vi.mock('@/lib/courier-actions', () => ({
  cancelShipmentAction: vi.fn(),
  recordCodAdjustmentAction: vi.fn(),
  recordCodCollectedAction: vi.fn(),
  recordShipmentStatusAction: vi.fn(),
  refreshShipmentAction: vi.fn(),
  resolveBookingAction: vi.fn(),
  setCodStateAction: vi.fn(),
}));

const csrf = { name: 'csrf_token', token: 'signed-test-token' };
afterEach(cleanup);

const events = [
  event({ id: 1, status: 'booked', occurredAt: AT }),
  event({ id: 2, status: 'in_transit', source: 'webhook', occurredAt: LATER }),
  // Arrived late and older than the current status: kept, not applied.
  event({
    id: 3,
    status: 'pickup_pending',
    source: 'webhook',
    occurredAt: '2026-11-14T10:10:00.000Z',
    recordedAt: '2026-11-14T11:00:00.000Z',
    applied: false,
  }),
];

const position = {
  expectedMinor: 125_000,
  collectedMinor: 0,
  deductionsMinor: 0,
  adjustmentsMinor: 0,
  expectedSettlementMinor: 0,
  settledMinor: 0,
  differenceMinor: 0,
  status: 'pending' as const,
  codState: 'open' as const,
};

function view(permissions: readonly Permission[], overrides: Parameters<typeof shipment>[0] = {}) {
  const canCod = permissions.includes('couriers.cod.read');
  return render(
    <ShipmentDetailView
      detail={{
        shipment: shipment(overrides),
        events,
        ledger: canCod ? [] : null,
        codPosition: canCod ? position : null,
      }}
      provider={provider({ provider: 'pathao', displayName: 'Pathao' })}
      permissions={permissions}
      csrf={csrf}
    />,
  );
}

describe('shipment timeline', () => {
  it('orders events by when they happened and marks the ones not applied', () => {
    const items = shipmentTimelineItems(events);
    expect(items.map((item) => [item.title, item.dimmed])).toEqual([
      ['Booked', false],
      ['Awaiting pickup', true],
      ['In transit', false],
    ]);
  });

  it('draws a not-applied event faded and says so in words', () => {
    view(ROLE_PERMISSIONS.admin);
    const timeline = screen.getByRole('list', { name: 'Shipment timeline' });
    const late = within(timeline).getByText('Awaiting pickup').closest('li');
    expect(late?.getAttribute('data-dimmed')).toBe('true');
    expect(within(late as HTMLElement).getByText(/Not applied/)).toBeTruthy();
    const applied = within(timeline).getByText('In transit').closest('li');
    expect(applied?.getAttribute('data-dimmed')).toBeNull();
  });
});

describe('ShipmentDetailView permissions', () => {
  it('offers tracking, manual status, cancel and COD steps to an admin', () => {
    view(ROLE_PERMISSIONS.admin);
    expect(screen.getByRole('button', { name: /Refresh tracking/ })).toBeTruthy();
    expect(screen.getByText('Record a status by hand')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Cancel shipment/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record courier collection' })).toBeTruthy();
    expect(screen.getByText('Expected delivery charge')).toBeTruthy();
  });

  it('shows a reader the shipment without any step, money or COD', () => {
    view(['admin_workspace.access', 'shipments.read']);
    expect(screen.queryByRole('button', { name: /Refresh tracking/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Cancel shipment/ })).toBeNull();
    expect(screen.queryByText('Cash on delivery')).toBeNull();
    expect(screen.getByText('Your account cannot change this shipment.')).toBeTruthy();
  });

  it('offers to resolve an uncertain booking only to whoever may book its kind', () => {
    view(['admin_workspace.access', 'shipments.read', 'shipments.create'], {
      status: 'booking_pending',
      bookingUncertain: true,
    });
    expect(screen.getByText('Booking not confirmed')).toBeTruthy();
    expect(screen.getByText('Resolve uncertain booking')).toBeTruthy();
    cleanup();
    view(['admin_workspace.access', 'shipments.read', 'shipments.create'], {
      status: 'booking_pending',
      bookingUncertain: true,
      kind: 'return_pickup',
    });
    expect(screen.queryByText('Resolve uncertain booking')).toBeNull();
  });

  it('flags a test shipment', () => {
    view(ROLE_PERMISSIONS.admin, { isMock: true });
    expect(screen.getByText('Test shipment')).toBeTruthy();
  });

  it('offers no steps on a finished shipment', () => {
    view(ROLE_PERMISSIONS.admin, { status: 'delivered' });
    expect(screen.queryByRole('button', { name: /Refresh tracking/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Cancel shipment/ })).toBeNull();
    expect(screen.getByText(/This shipment is finished/)).toBeTruthy();
  });
});
