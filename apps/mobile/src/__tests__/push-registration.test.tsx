import { ApiError } from '@nilzora/api-client';
import { act, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import { OrderUpdatesCard } from '../notifications/order-updates-card';
import { readRegisteredToken, writeRegisteredToken } from '../notifications/registered-token';
import { createFakeApiClient } from '../test-utils/api-fakes';
import { renderWithProviders, resetAsyncStorage } from '../test-utils/render-with-providers';
import { CUSTOMER, FAKE_ACCESS_TOKEN, signedInState } from '../test-utils/session-fakes';

// The app version the device record carries (the real value comes from app.json).
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '0.1.0' } },
}));

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
  addPushTokenListener: jest.fn(),
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  getLastNotificationResponse: jest.fn(),
  clearLastNotificationResponse: jest.fn(),
}));

const notifications = jest.mocked(Notifications);

const USER_ID = CUSTOMER.user.id;
const OTHER_USER_ID = '11111111-2222-4333-8444-555555555555';
/** Recognisable, so a test can prove it never reaches the screen or a log. */
const TOKEN = 'fcm:APA91b-device-token-7f3a9c_example';

type PermissionStatus = 'granted' | 'denied' | 'undetermined';

function permission(status: PermissionStatus, canAskAgain = true) {
  return {
    status,
    granted: status === 'granted',
    canAskAgain,
    expires: 'never' as const,
  } as Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>;
}

function deviceToken(data: string = TOKEN) {
  return { type: 'android', data } as Awaited<
    ReturnType<typeof Notifications.getDevicePushTokenAsync>
  >;
}

let restorePlatform: { restore: () => void };

beforeEach(async () => {
  await resetAsyncStorage();
  for (const fn of [
    notifications.setNotificationChannelAsync,
    notifications.getPermissionsAsync,
    notifications.requestPermissionsAsync,
    notifications.getDevicePushTokenAsync,
  ]) {
    fn.mockReset();
  }
  notifications.getPermissionsAsync.mockResolvedValue(permission('undetermined'));
  // Like the system: once the customer allows it, the permission reads as granted.
  notifications.requestPermissionsAsync.mockImplementation(() => {
    notifications.getPermissionsAsync.mockResolvedValue(permission('granted'));
    return Promise.resolve(permission('granted'));
  });
  notifications.getDevicePushTokenAsync.mockResolvedValue(deviceToken());
  notifications.setNotificationChannelAsync.mockResolvedValue(null);
  restorePlatform = jest.replaceProperty(Platform, 'OS', 'android');
});

afterEach(() => {
  restorePlatform.restore();
});

function fakeApi() {
  const api = createFakeApiClient();
  api.registerDevice.mockResolvedValue({ device: { id: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f' } });
  api.unregisterDevice.mockResolvedValue(undefined);
  return api;
}

describe('Order updates card: turning notifications on', () => {
  it('asks for nothing until the customer taps, and then only on that tap', async () => {
    const api = fakeApi();
    const { user } = await renderWithProviders(<OrderUpdatesCard />, { api });

    const turnOn = await screen.findByRole('button', { name: 'Turn on order updates' });

    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
    expect(notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(api.registerDevice).not.toHaveBeenCalled();

    await user.press(turnOn);

    expect(await screen.findByText('Order updates are on for this device.')).toBeOnTheScreen();
    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('creates the channel, asks permission, reads the native token and registers it', async () => {
    const api = fakeApi();
    const { user } = await renderWithProviders(<OrderUpdatesCard />, { api });

    await user.press(await screen.findByRole('button', { name: 'Turn on order updates' }));
    await screen.findByRole('button', { name: 'Turn off order updates' });

    expect(notifications.setNotificationChannelAsync).toHaveBeenCalledWith('default', {
      name: 'Order updates',
      importance: 3,
    });
    // The channel exists before the prompt, and the token is read after permission.
    const order = [
      notifications.setNotificationChannelAsync,
      notifications.requestPermissionsAsync,
      notifications.getDevicePushTokenAsync,
      api.registerDevice,
    ].map((fn) => fn.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => (a ?? 0) - (b ?? 0)));
    expect(api.registerDevice).toHaveBeenCalledTimes(1);
    expect(api.registerDevice).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN, {
      token: TOKEN,
      platform: 'android',
      appVersion: '0.1.0',
    });
    expect(await readRegisteredToken()).toEqual({ token: TOKEN, userId: USER_ID });
  });

  it('registers an iPhone as ios, without an Android channel', async () => {
    restorePlatform.restore();
    restorePlatform = jest.replaceProperty(Platform, 'OS', 'ios');
    const api = fakeApi();
    const { user } = await renderWithProviders(<OrderUpdatesCard />, { api });

    await user.press(await screen.findByRole('button', { name: 'Turn on order updates' }));
    await screen.findByRole('button', { name: 'Turn off order updates' });

    expect(api.registerDevice).toHaveBeenCalledWith(
      FAKE_ACCESS_TOKEN,
      expect.objectContaining({ token: TOKEN, platform: 'ios' }),
    );
    expect(notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  });

  it('never renders or logs the token', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    const api = fakeApi();
    const { user } = await renderWithProviders(<OrderUpdatesCard />, { api });

    await user.press(await screen.findByRole('button', { name: 'Turn on order updates' }));
    await screen.findByRole('button', { name: 'Turn off order updates' });

    expect(JSON.stringify(screen.toJSON())).not.toContain(TOKEN);
    expect(JSON.stringify(spies.map((spy) => spy.mock.calls))).not.toContain(TOKEN);
    for (const spy of spies) spy.mockRestore();
  });

  it('explains a refusal and points to the phone settings', async () => {
    notifications.requestPermissionsAsync.mockResolvedValue(permission('denied', false));
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const api = fakeApi();
    const { user } = await renderWithProviders(<OrderUpdatesCard />, { api });

    await user.press(await screen.findByRole('button', { name: 'Turn on order updates' }));

    expect(
      await screen.findByText(
        'Notifications are turned off for Nilzora. Turn them on in your phone settings to get order updates.',
      ),
    ).toBeOnTheScreen();
    expect(notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(api.registerDevice).not.toHaveBeenCalled();
    expect(await readRegisteredToken()).toBeNull();

    await user.press(screen.getByRole('button', { name: 'Open phone settings' }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();
  });

  it('shows the settings hint at once when the system already forbids notifications, without prompting', async () => {
    notifications.getPermissionsAsync.mockResolvedValue(permission('denied', false));
    await renderWithProviders(<OrderUpdatesCard />, { api: fakeApi() });

    expect(await screen.findByRole('button', { name: 'Open phone settings' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Turn on order updates' })).not.toBeOnTheScreen();
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('says notifications are not available in a build without Firebase, and does not crash', async () => {
    notifications.getDevicePushTokenAsync.mockRejectedValue(
      new Error('Default FirebaseApp is not initialized in this process'),
    );
    const api = fakeApi();
    const { user } = await renderWithProviders(<OrderUpdatesCard />, { api });

    await user.press(await screen.findByRole('button', { name: 'Turn on order updates' }));

    expect(
      await screen.findByText('Notifications are not available in this build.'),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/FirebaseApp/)).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Turn on order updates' })).not.toBeOnTheScreen();
    expect(api.registerDevice).not.toHaveBeenCalled();
    expect(await readRegisteredToken()).toBeNull();
  });

  it('treats a native token it cannot use as an unavailable build', async () => {
    notifications.getDevicePushTokenAsync.mockResolvedValue(deviceToken('not a valid token!'));
    const api = fakeApi();
    const { user } = await renderWithProviders(<OrderUpdatesCard />, { api });

    await user.press(await screen.findByRole('button', { name: 'Turn on order updates' }));

    expect(
      await screen.findByText('Notifications are not available in this build.'),
    ).toBeOnTheScreen();
    expect(api.registerDevice).not.toHaveBeenCalled();
  });

  it('shows "not available" up front when the notification module itself fails', async () => {
    notifications.getPermissionsAsync.mockRejectedValue(new Error('module missing'));
    await renderWithProviders(<OrderUpdatesCard />, { api: fakeApi() });

    expect(
      await screen.findByText('Notifications are not available in this build.'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /order updates/ })).not.toBeOnTheScreen();
  });

  it('keeps it off, says why, and allows a retry when the API cannot be reached', async () => {
    const api = fakeApi();
    api.registerDevice.mockRejectedValueOnce(new ApiError(0, 'network_error', 'offline'));
    const { user } = await renderWithProviders(<OrderUpdatesCard />, { api });

    await user.press(await screen.findByRole('button', { name: 'Turn on order updates' }));

    expect(
      await screen.findByText(
        'Order updates could not be turned on. Check your internet connection, then try again.',
      ),
    ).toBeOnTheScreen();
    expect(await readRegisteredToken()).toBeNull();

    await user.press(screen.getByRole('button', { name: 'Turn on order updates' }));

    expect(await screen.findByRole('button', { name: 'Turn off order updates' })).toBeOnTheScreen();
    expect(screen.queryByText(/could not be turned on/)).not.toBeOnTheScreen();
    expect(api.registerDevice).toHaveBeenCalledTimes(2);
  });
});

describe('Order updates card: the account changes while turning on', () => {
  it('never attaches this phone to the account that signed in meanwhile', async () => {
    // The system is slow to hand out the token (or the permission prompt is still open).
    let release: (token: string) => void = () => undefined;
    notifications.getDevicePushTokenAsync.mockReturnValue(
      new Promise((resolve) => {
        release = (token) => {
          resolve(deviceToken(token));
        };
      }),
    );
    const api = fakeApi();
    const { user, setSession } = await renderWithProviders(<OrderUpdatesCard />, { api });

    await user.press(await screen.findByRole('button', { name: 'Turn on order updates' }));
    await waitFor(() => {
      expect(notifications.getDevicePushTokenAsync).toHaveBeenCalledTimes(1);
    });
    await setSession({ status: 'signed_out' });
    await setSession(signedInState(OTHER_USER_ID));
    await act(() => {
      release(TOKEN);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Turn on order updates' })).toBeEnabled();
    });
    expect(api.registerDevice).not.toHaveBeenCalled();
    expect(await readRegisteredToken()).toBeNull();
  });
});

describe('Order updates card: what it shows on arrival', () => {
  it('is on for the account that turned it on, while the system still allows it', async () => {
    await writeRegisteredToken({ token: TOKEN, userId: USER_ID });
    notifications.getPermissionsAsync.mockResolvedValue(permission('granted'));
    const api = fakeApi();
    await renderWithProviders(<OrderUpdatesCard />, { api });

    expect(await screen.findByText('Order updates are on for this device.')).toBeOnTheScreen();
    expect(api.registerDevice).not.toHaveBeenCalled();
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('is off for another account on the same phone', async () => {
    await writeRegisteredToken({ token: TOKEN, userId: OTHER_USER_ID });
    notifications.getPermissionsAsync.mockResolvedValue(permission('granted'));
    await renderWithProviders(<OrderUpdatesCard />, { api: fakeApi() });

    expect(await screen.findByRole('button', { name: 'Turn on order updates' })).toBeOnTheScreen();
  });

  it('is not shown as on once the system forbids notifications', async () => {
    await writeRegisteredToken({ token: TOKEN, userId: USER_ID });
    notifications.getPermissionsAsync.mockResolvedValue(permission('denied', false));
    await renderWithProviders(<OrderUpdatesCard />, { api: fakeApi() });

    expect(await screen.findByRole('button', { name: 'Open phone settings' })).toBeOnTheScreen();
    expect(screen.queryByText('Order updates are on for this device.')).not.toBeOnTheScreen();
  });

  it('shows a checking state first', async () => {
    notifications.getPermissionsAsync.mockReturnValue(new Promise(() => undefined));
    await renderWithProviders(<OrderUpdatesCard />, { api: fakeApi() });

    expect(
      await screen.findByRole('progressbar', { name: 'Checking notification settings' }),
    ).toBeOnTheScreen();
  });
});

describe('Order updates card: turning notifications off', () => {
  async function renderOn(api = fakeApi()) {
    await writeRegisteredToken({ token: TOKEN, userId: USER_ID });
    notifications.getPermissionsAsync.mockResolvedValue(permission('granted'));
    const harness = await renderWithProviders(<OrderUpdatesCard />, { api });
    await screen.findByRole('button', { name: 'Turn off order updates' });
    return { ...harness, api };
  }

  it('removes this device from the account and forgets the choice', async () => {
    const { api, user } = await renderOn();

    await user.press(screen.getByRole('button', { name: 'Turn off order updates' }));

    expect(await screen.findByRole('button', { name: 'Turn on order updates' })).toBeOnTheScreen();
    expect(api.unregisterDevice).toHaveBeenCalledWith(
      FAKE_ACCESS_TOKEN,
      { token: TOKEN },
      expect.anything(),
    );
    expect(await readRegisteredToken()).toBeNull();
  });

  it('stays on, and says so, when the server could not be told', async () => {
    const api = fakeApi();
    api.unregisterDevice.mockRejectedValue(new ApiError(0, 'network_error', 'offline'));
    const { user } = await renderOn(api);

    await user.press(screen.getByRole('button', { name: 'Turn off order updates' }));

    expect(
      await screen.findByText(
        'Order updates could not be turned off. Check your internet connection, then try again.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Turn off order updates' })).toBeOnTheScreen();
    await waitFor(async () => {
      expect(await readRegisteredToken()).toEqual({ token: TOKEN, userId: USER_ID });
    });
  });
});
