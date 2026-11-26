// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLE_PERMISSIONS } from '@/test/fixtures';
import { CourierSettingsView } from './courier-settings';
import { courierConfig } from './fixtures';
import { needsLiveConfirmation } from './operations-form';

const actions = vi.hoisted(() => ({ operations: vi.fn(), settings: vi.fn() }));
vi.mock('@/lib/courier-actions', () => ({
  saveCourierOperationsAction: actions.operations,
  saveCourierSettingsAction: actions.settings,
  saveRateCardAction: vi.fn(),
  deleteRateCardAction: vi.fn(),
}));

if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

const csrf = { name: 'csrf_token', token: 'signed-test-token' };
const owner = ROLE_PERMISSIONS.super_admin;

beforeEach(() => {
  actions.operations.mockReset().mockResolvedValue({ status: 'idle' });
  actions.settings.mockReset().mockResolvedValue({ status: 'idle' });
});
afterEach(cleanup);

describe('needsLiveConfirmation', () => {
  it('asks only when a save turns on live mode or live bookings', () => {
    const off = { mode: 'off' as const, bookingEnabled: false };
    const live = { mode: 'live' as const, bookingEnabled: false };
    expect(needsLiveConfirmation(off, { mode: 'live', bookingEnabled: false })).toBe(true);
    expect(needsLiveConfirmation(live, { mode: 'live', bookingEnabled: true })).toBe(true);
    expect(needsLiveConfirmation(live, { mode: 'live', bookingEnabled: false })).toBe(false);
    expect(
      needsLiveConfirmation(
        { mode: 'live', bookingEnabled: true },
        { mode: 'live', bookingEnabled: true },
      ),
    ).toBe(false);
    expect(needsLiveConfirmation(live, { mode: 'off', bookingEnabled: true })).toBe(false);
  });
});

describe('CourierSettingsView', () => {
  it('disables test mode on a hosted database and says why', () => {
    render(
      <CourierSettingsView
        config={courierConfig({ databaseTarget: 'hosted', mockAllowed: false })}
        permissions={owner}
        csrf={csrf}
      />,
    );
    const mock = screen.getByRole('radio', { name: /Test \(mock\)/ });
    expect(mock).toHaveProperty('disabled', true);
    expect(screen.getAllByText(/test mode only runs against a local database/).length).toBe(1);
    expect(screen.getByText('Hosted database')).toBeTruthy();
    // A saved test mode that cannot run here starts the choice at Off.
    expect(screen.getByRole('radio', { name: /^Off/ })).toHaveProperty('checked', true);
  });

  it('shows the notice when the saved mode is not in effect', () => {
    render(
      <CourierSettingsView
        config={courierConfig({
          mode: 'off',
          modeNotice: 'Test mode is refused while the API uses a hosted database.',
        })}
        permissions={owner}
        csrf={csrf}
      />,
    );
    expect(screen.getByText('Saved mode (Test (mock)) is not in effect')).toBeTruthy();
    expect(
      screen.getByText(/Test mode is refused while the API uses a hosted database/),
    ).toBeTruthy();
  });

  it('saves without a dialog when nothing turns live on', async () => {
    render(<CourierSettingsView config={courierConfig()} permissions={owner} csrf={csrf} />);
    fireEvent.click(screen.getByRole('radio', { name: /^Off/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save operations' }));
    await waitFor(() => expect(actions.operations).toHaveBeenCalled());
    const sent = actions.operations.mock.calls[0]?.[1] as FormData;
    expect(sent.get('mode')).toBe('off');
    expect(sent.get('confirmation')).toBeNull();
    expect(sent.get('trackingSyncMinutes')).toBe('15');
    expect(sent.get('timeoutSeconds')).toBe('10');
  });

  it('requires the typed phrase before turning live on, and sends it', async () => {
    render(<CourierSettingsView config={courierConfig()} permissions={owner} csrf={csrf} />);
    fireEvent.click(screen.getByRole('radio', { name: /^Live/ }));
    expect(screen.queryByRole('button', { name: 'Save operations' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Save and turn on live couriers/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Turn on live couriers?' });
    const confirm = within(dialog).getByRole('button', { name: 'Turn on live couriers' });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(within(dialog).getByLabelText(/to confirm/), {
      target: { value: 'enable live' },
    });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(within(dialog).getByLabelText(/to confirm/), {
      target: { value: 'ENABLE LIVE COURIERS' },
    });
    expect(confirm).toHaveProperty('disabled', false);
    fireEvent.click(confirm);
    await waitFor(() => expect(actions.operations).toHaveBeenCalled());
    const sent = actions.operations.mock.calls[0]?.[1] as FormData;
    expect(sent.get('mode')).toBe('live');
    expect(sent.get('confirmation')).toBe('ENABLE LIVE COURIERS');
  });

  it('is read-only for an admin without couriers.configure', () => {
    render(
      <CourierSettingsView
        config={courierConfig({
          operations: { ...courierConfig().operations, trackingSyncEnabled: true },
        })}
        permissions={ROLE_PERMISSIONS.admin}
        csrf={csrf}
      />,
    );
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
    expect(screen.getByText('Every 15 minutes')).toBeTruthy();
    expect(screen.getByText(/Only the store owner/)).toBeTruthy();
  });

  it('links the rest of the courier setup', () => {
    render(<CourierSettingsView config={courierConfig()} permissions={owner} csrf={csrf} />);
    const nav = screen.getByRole('navigation', { name: 'More courier setup' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/admin/operations/providers',
      '/admin/operations/pricing',
      '/admin/operations/locations',
    ]);
  });
});
