import type { NotificationPreferences } from '@nilzora/contracts';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import SettingsScreen from '../../app/settings';
import { createFakeApiClient } from '../test-utils/api-fakes';
import { renderWithProviders } from '../test-utils/render-with-providers';
import { signedInState } from '../test-utils/session-fakes';

/*
 * Settings -> Notifications.
 *
 * The account's choices live on the server: the screen reads them, sends only the switch that
 * moved, and shows the server's answer rather than guessing. The device switches above the
 * card belong to the phone and are covered by the push-registration tests.
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, navigate: mockPush, replace: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => ({}),
  Link: 'Link',
}));
jest.mock('expo-notifications', () => ({}));

function preferences(overrides: Partial<NotificationPreferences> = {}): NotificationPreferences {
  return {
    orderUpdates: true,
    paymentUpdates: true,
    returnUpdates: true,
    refundUpdates: true,
    promotions: true,
    inApp: true,
    updatedAt: '2026-12-14T09:00:00.000Z',
    ...overrides,
  };
}

async function render(api = createFakeApiClient()) {
  api.notificationPreferences.mockResolvedValue({ preferences: preferences() });
  const view = await renderWithProviders(<SettingsScreen />, { api, session: signedInState() });
  return { ...view, api };
}

describe('Settings: notification choices', () => {
  it('shows the account’s saved choices, read with the session token', async () => {
    const api = createFakeApiClient();
    api.notificationPreferences.mockResolvedValue({
      preferences: preferences({ promotions: false, refundUpdates: false }),
    });

    await renderWithProviders(<SettingsScreen />, { api, session: signedInState() });

    const promotions = await screen.findByRole('switch', { name: 'Offers and new products' });
    await waitFor(() => expect(promotions.props.value).toBe(false));
    expect(screen.getByRole('switch', { name: 'Order updates' }).props.value).toBe(true);
    expect(screen.getByRole('switch', { name: 'Refunds' }).props.value).toBe(false);
    expect(api.notificationPreferences).toHaveBeenCalledWith(expect.any(String), expect.anything());
  });

  it('sends only the switch that moved, and shows what the server kept', async () => {
    const api = createFakeApiClient();
    api.saveNotificationPreferences.mockResolvedValue({
      preferences: preferences({ promotions: false }),
    });

    await render(api);
    const promotions = await screen.findByRole('switch', { name: 'Offers and new products' });
    await waitFor(() => expect(promotions.props.value).toBe(true));

    void fireEvent(promotions, 'valueChange', false);

    await waitFor(() =>
      expect(api.saveNotificationPreferences).toHaveBeenCalledWith(expect.any(String), {
        promotions: false,
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Offers and new products' }).props.value).toBe(
        false,
      ),
    );
    // Every other choice is untouched.
    expect(screen.getByRole('switch', { name: 'Order updates' }).props.value).toBe(true);
  });

  it('keeps the record switch separate from the news it records', async () => {
    const api = createFakeApiClient();
    api.saveNotificationPreferences.mockResolvedValue({
      preferences: preferences({ inApp: false }),
    });

    await render(api);
    const keep = await screen.findByRole('switch', { name: 'Keep a record in the app' });
    await waitFor(() => expect(keep.props.value).toBe(true));

    void fireEvent(keep, 'valueChange', false);

    await waitFor(() =>
      expect(api.saveNotificationPreferences).toHaveBeenCalledWith(expect.any(String), {
        inApp: false,
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Keep a record in the app' }).props.value).toBe(
        false,
      ),
    );
  });

  it('explains a failed read and offers a retry that works', async () => {
    const api = createFakeApiClient();
    api.notificationPreferences
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ preferences: preferences({ promotions: false }) });

    await renderWithProviders(<SettingsScreen />, { api, session: signedInState() });

    expect(await screen.findByText('Your choices could not be loaded.')).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Offers and new products' })).toBeNull();

    void fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

    const promotions = await screen.findByRole('switch', { name: 'Offers and new products' });
    await waitFor(() => expect(promotions.props.value).toBe(false));
  });

  it('says so when a change cannot be saved, without pretending it was', async () => {
    const api = createFakeApiClient();
    api.saveNotificationPreferences.mockRejectedValue(new Error('network'));

    await render(api);
    const promotions = await screen.findByRole('switch', { name: 'Offers and new products' });
    await waitFor(() => expect(promotions.props.value).toBe(true));

    void fireEvent(promotions, 'valueChange', false);

    expect(await screen.findByText('That change could not be saved. Try again.')).toBeTruthy();
    // The switch still shows the saved value, because the save never happened.
    expect(screen.getByRole('switch', { name: 'Offers and new products' }).props.value).toBe(true);
  });

  it('asks a signed-out visitor to sign in instead of showing choices that cannot be saved', async () => {
    const api = createFakeApiClient();

    await renderWithProviders(<SettingsScreen />, {
      api,
      session: { status: 'signed_out' },
    });

    expect(screen.getByRole('header', { name: 'Sign in to Nilzora' })).toBeOnTheScreen();
    expect(screen.queryByRole('switch', { name: 'Offers and new products' })).toBeNull();
    expect(api.notificationPreferences).not.toHaveBeenCalled();
  });
});
