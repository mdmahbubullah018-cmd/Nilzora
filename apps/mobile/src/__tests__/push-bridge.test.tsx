import { ApiError } from '@nilzora/api-client';
import { act, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { SessionEndedError } from '../auth/session-manager';
import { NotificationBridge } from '../notifications/notification-bridge';
import { orderNumberFromData } from '../notifications/notification-links';
import { pinToUser } from '../notifications/push-registration';
import { readRegisteredToken, writeRegisteredToken } from '../notifications/registered-token';
import { createFakeApiClient, type FakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock, router } from '../test-utils/expo-router-mock';
import { renderWithProviders, resetAsyncStorage } from '../test-utils/render-with-providers';
import {
  createControllableManager,
  CUSTOMER,
  FAKE_ACCESS_TOKEN,
  signedInState,
} from '../test-utils/session-fakes';

let mockNavigationReady = true;
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('@/test-utils/expo-router-mock'),
  useRootNavigationState: () => (mockNavigationReady ? { key: 'root' } : undefined),
}));

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
const OLD_TOKEN = 'fcm:APA91b-old-device-token-1111_example';
const NEW_TOKEN = 'fcm:APA91b-new-device-token-2222_example';

function permission(granted: boolean) {
  return {
    status: granted ? 'granted' : 'denied',
    granted,
    canAskAgain: !granted,
    expires: 'never',
  } as Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>;
}

function deviceToken(data: string) {
  return { type: 'android', data } as Awaited<
    ReturnType<typeof Notifications.getDevicePushTokenAsync>
  >;
}

function tapOf(data: unknown) {
  return { notification: { request: { content: { data } } } } as Notifications.NotificationResponse;
}

type TokenListener = Parameters<typeof Notifications.addPushTokenListener>[0];
type TapListener = Parameters<typeof Notifications.addNotificationResponseReceivedListener>[0];

let tokenListener: TokenListener | undefined;
let tapListener: TapListener | undefined;
const removeTokenListener = jest.fn();
const removeTapListener = jest.fn();
let restorePlatform: { restore: () => void };

beforeEach(async () => {
  resetRouterMock();
  mockNavigationReady = true;
  await resetAsyncStorage();
  tokenListener = undefined;
  tapListener = undefined;
  removeTokenListener.mockReset();
  removeTapListener.mockReset();
  for (const fn of [
    notifications.getPermissionsAsync,
    notifications.requestPermissionsAsync,
    notifications.getDevicePushTokenAsync,
    notifications.addPushTokenListener,
    notifications.addNotificationResponseReceivedListener,
    notifications.setNotificationHandler,
    notifications.getLastNotificationResponse,
    notifications.clearLastNotificationResponse,
    notifications.setNotificationChannelAsync,
  ]) {
    fn.mockReset();
  }
  notifications.getPermissionsAsync.mockResolvedValue(permission(true));
  notifications.getDevicePushTokenAsync.mockResolvedValue(deviceToken(OLD_TOKEN));
  notifications.getLastNotificationResponse.mockReturnValue(null);
  notifications.addPushTokenListener.mockImplementation((listener) => {
    tokenListener = listener;
    return { remove: removeTokenListener };
  });
  notifications.addNotificationResponseReceivedListener.mockImplementation((listener) => {
    tapListener = listener;
    return { remove: removeTapListener };
  });
  restorePlatform = jest.replaceProperty(Platform, 'OS', 'android');
});

afterEach(() => {
  restorePlatform.restore();
});

function fakeApi(): FakeApiClient {
  const api = createFakeApiClient();
  api.registerDevice.mockResolvedValue({ device: { id: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f' } });
  api.unregisterDevice.mockResolvedValue(undefined);
  return api;
}

async function renderBridge(options: Parameters<typeof renderWithProviders>[1] = {}) {
  const api = options.api === undefined ? fakeApi() : options.api;
  const harness = await renderWithProviders(<NotificationBridge />, { ...options, api });
  return { ...harness, api: api as FakeApiClient };
}

/** Lets the bridge's queued, fire-and-forget registration work finish. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setImmediate(() => resolve(undefined)));
  });
}

describe('NotificationBridge: foreground notifications', () => {
  it('shows notifications that arrive while the app is open, quietly', async () => {
    await renderBridge();

    expect(notifications.setNotificationHandler).toHaveBeenCalledTimes(1);
    const handler = notifications.setNotificationHandler.mock.calls[0]?.[0];
    await expect(handler?.handleNotification({} as Notifications.Notification)).resolves.toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
  });

  it('never asks for permission on its own', async () => {
    await writeRegisteredToken({ token: OLD_TOKEN, userId: USER_ID });
    await renderBridge();
    await settle();

    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('NotificationBridge: registering again after sign-in', () => {
  it('registers silently for an account that already turned order updates on', async () => {
    await writeRegisteredToken({ token: OLD_TOKEN, userId: USER_ID });
    notifications.getDevicePushTokenAsync.mockResolvedValue(deviceToken(NEW_TOKEN));
    const { api } = await renderBridge();

    await waitFor(() => {
      expect(api.registerDevice).toHaveBeenCalledTimes(1);
    });
    expect(api.registerDevice).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN, {
      token: NEW_TOKEN,
      platform: 'android',
      appVersion: '0.1.0',
    });
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    await waitFor(async () => {
      expect(await readRegisteredToken()).toEqual({ token: NEW_TOKEN, userId: USER_ID });
    });
  });

  it('waits for the sign-in, then registers', async () => {
    await writeRegisteredToken({ token: OLD_TOKEN, userId: USER_ID });
    const { api, setSession } = await renderBridge({ session: { status: 'signed_out' } });
    await settle();
    expect(api.registerDevice).not.toHaveBeenCalled();
    expect(notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(tokenListener).toBeUndefined();

    await setSession({ status: 'signed_in', user: CUSTOMER.user });

    await waitFor(() => {
      expect(api.registerDevice).toHaveBeenCalledWith(
        FAKE_ACCESS_TOKEN,
        expect.objectContaining({ token: OLD_TOKEN }),
      );
    });
  });

  it('does nothing for an account that never turned notifications on', async () => {
    const { api } = await renderBridge();
    await settle();

    expect(api.registerDevice).not.toHaveBeenCalled();
    expect(notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('does not register this phone for an account that did not turn it on (another account did)', async () => {
    await writeRegisteredToken({ token: OLD_TOKEN, userId: OTHER_USER_ID });
    const { api } = await renderBridge();
    await settle();

    expect(api.registerDevice).not.toHaveBeenCalled();
    expect(await readRegisteredToken()).toEqual({ token: OLD_TOKEN, userId: OTHER_USER_ID });
  });

  it('removes the token and forgets the choice when the system has since forbidden notifications', async () => {
    await writeRegisteredToken({ token: OLD_TOKEN, userId: USER_ID });
    notifications.getPermissionsAsync.mockResolvedValue(permission(false));
    const { api } = await renderBridge();

    await waitFor(() => {
      expect(api.unregisterDevice).toHaveBeenCalledWith(
        FAKE_ACCESS_TOKEN,
        { token: OLD_TOKEN },
        expect.anything(),
      );
    });
    await waitFor(async () => {
      expect(await readRegisteredToken()).toBeNull();
    });
    expect(api.registerDevice).not.toHaveBeenCalled();
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('ignores a build without push and a failing API, without crashing or forgetting the choice', async () => {
    await writeRegisteredToken({ token: OLD_TOKEN, userId: USER_ID });
    notifications.getDevicePushTokenAsync.mockRejectedValueOnce(new Error('no Firebase'));
    const first = await renderBridge();
    await settle();
    expect(first.api.registerDevice).not.toHaveBeenCalled();
    await first.unmount();

    const api = fakeApi();
    api.registerDevice.mockRejectedValue(new ApiError(0, 'network_error', 'offline'));
    await renderBridge({ api });
    await settle();

    expect(api.registerDevice).toHaveBeenCalledTimes(1);
    expect(await readRegisteredToken()).toEqual({ token: OLD_TOKEN, userId: USER_ID });
  });
});

describe('NotificationBridge: a token the platform rotates', () => {
  async function setup() {
    await writeRegisteredToken({ token: OLD_TOKEN, userId: USER_ID });
    const harness = await renderBridge();
    // The sign-in registration (same token) goes first.
    await waitFor(() => {
      expect(harness.api.registerDevice).toHaveBeenCalledTimes(1);
    });
    await settle();
    harness.api.registerDevice.mockClear();
    return harness;
  }

  it('registers the new token, once, and remembers it', async () => {
    const { api } = await setup();

    await act(() => {
      tokenListener?.({ type: 'android', data: NEW_TOKEN });
    });
    await waitFor(() => {
      expect(api.registerDevice).toHaveBeenCalledTimes(1);
    });
    expect(api.registerDevice).toHaveBeenCalledWith(FAKE_ACCESS_TOKEN, {
      token: NEW_TOKEN,
      platform: 'android',
      appVersion: '0.1.0',
    });
    await waitFor(async () => {
      expect(await readRegisteredToken()).toEqual({ token: NEW_TOKEN, userId: USER_ID });
    });

    // The same token announced again is not registered again.
    await act(() => {
      tokenListener?.({ type: 'android', data: NEW_TOKEN });
    });
    await settle();
    expect(api.registerDevice).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the token has not changed', async () => {
    const { api } = await setup();

    await act(() => {
      tokenListener?.({ type: 'android', data: OLD_TOKEN });
    });
    await settle();

    expect(api.registerDevice).not.toHaveBeenCalled();
  });

  it('ignores a token that is not a valid device token', async () => {
    const { api } = await setup();

    await act(() => {
      tokenListener?.({ type: 'android', data: 'has spaces and <markup>' });
      tokenListener?.({ type: 'android', data: { endpoint: 'x' } });
    });
    await settle();

    expect(api.registerDevice).not.toHaveBeenCalled();
  });

  it('is ignored for an account that never turned notifications on', async () => {
    const { api } = await renderBridge();
    await settle();

    await act(() => {
      tokenListener?.({ type: 'android', data: NEW_TOKEN });
    });
    await settle();

    expect(api.registerDevice).not.toHaveBeenCalled();
    expect(await readRegisteredToken()).toBeNull();
  });

  it('stops listening when the customer signs out', async () => {
    const { setSession } = await setup();

    await setSession({ status: 'signed_out' });

    expect(removeTokenListener).toHaveBeenCalled();
  });
});

describe('NotificationBridge: the account changes while a registration is under way', () => {
  /** A token read that stays pending until the test releases it. */
  function stalledToken() {
    let release: (token: string) => void = () => undefined;
    notifications.getDevicePushTokenAsync.mockReturnValue(
      new Promise((resolve) => {
        release = (token) => {
          resolve(deviceToken(token));
        };
      }),
    );
    return (token: string) => release(token);
  }

  it('never attaches this phone to the account that signed in meanwhile', async () => {
    await writeRegisteredToken({ token: OLD_TOKEN, userId: USER_ID });
    const release = stalledToken();
    const { api, setSession } = await renderBridge();
    await waitFor(() => {
      expect(notifications.getDevicePushTokenAsync).toHaveBeenCalledTimes(1);
    });

    // The customer signs out and somebody else signs in while the system is still busy.
    await setSession({ status: 'signed_out' });
    await setSession(signedInState(OTHER_USER_ID));
    await act(() => {
      release(NEW_TOKEN);
    });
    await settle();

    expect(api.registerDevice).not.toHaveBeenCalled();
    // The first account's choice is left exactly as it was.
    expect(await readRegisteredToken()).toEqual({ token: OLD_TOKEN, userId: USER_ID });
  });

  it('also drops a rotated token that was waiting behind the stalled registration', async () => {
    await writeRegisteredToken({ token: OLD_TOKEN, userId: USER_ID });
    const release = stalledToken();
    const { api, setSession } = await renderBridge();
    await waitFor(() => {
      expect(tokenListener).toBeDefined();
    });
    await act(() => {
      tokenListener?.({ type: 'android', data: NEW_TOKEN });
    });

    await setSession({ status: 'signed_out' });
    await setSession(signedInState(OTHER_USER_ID));
    await act(() => {
      release(OLD_TOKEN);
    });
    await settle();

    expect(api.registerDevice).not.toHaveBeenCalled();
    expect(await readRegisteredToken()).toEqual({ token: OLD_TOKEN, userId: USER_ID });
  });

  it('does not remove a token on behalf of an account that has gone', async () => {
    await writeRegisteredToken({ token: OLD_TOKEN, userId: USER_ID });
    let answer: (value: ReturnType<typeof permission>) => void = () => undefined;
    notifications.getPermissionsAsync.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { api, setSession } = await renderBridge();
    await waitFor(() => {
      expect(notifications.getPermissionsAsync).toHaveBeenCalledTimes(1);
    });

    await setSession({ status: 'signed_out' });
    await setSession(signedInState(OTHER_USER_ID));
    await act(() => {
      answer(permission(false));
    });
    await settle();

    expect(api.unregisterDevice).not.toHaveBeenCalled();
    expect(api.registerDevice).not.toHaveBeenCalled();
    expect(await readRegisteredToken()).toEqual({ token: OLD_TOKEN, userId: USER_ID });
  });
});

describe('pinToUser', () => {
  const run = <T,>(call: (api: never, accessToken: string) => Promise<T>) =>
    call(undefined as never, FAKE_ACCESS_TOKEN);

  it('lets a call through while its account is the one signed in', async () => {
    const manager = createControllableManager(signedInState(USER_ID));
    const call = jest.fn(() => Promise.resolve('sent'));

    await expect(pinToUser(run, manager, USER_ID)(call)).resolves.toBe('sent');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['another account is signed in', signedInState(OTHER_USER_ID)],
    ['nobody is signed in', { status: 'signed_out' } as const],
    ['the session is suspended', { status: 'suspended' } as const],
  ])('refuses to make the call once %s', async (_name, state) => {
    const manager = createControllableManager(signedInState(USER_ID));
    const pinned = pinToUser(run, manager, USER_ID);
    manager.setState(state);
    const call = jest.fn(() => Promise.resolve('sent'));

    await expect(pinned(call)).rejects.toBeInstanceOf(SessionEndedError);
    expect(call).not.toHaveBeenCalled();
  });
});

describe('NotificationBridge: tapping a notification', () => {
  it('opens the order named in the notification', async () => {
    await renderBridge();

    await act(() => {
      tapListener?.(tapOf({ orderNumber: 'NZ100042' }));
    });

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/order/[orderNumber]',
      params: { orderNumber: 'NZ100042' },
    });
  });

  it('opens the order when the payload also carries the notification identity', async () => {
    // The sender adds `tag` (the notification's own identity on Android) beside the order
    // number; a tap still opens the order and nothing else.
    await renderBridge();

    await act(() => {
      tapListener?.(
        tapOf({ orderNumber: 'NZ100042', tag: '0a000000-0000-4000-8000-000000000001' }),
      );
    });

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/order/[orderNumber]',
      params: { orderNumber: 'NZ100042' },
    });
  });

  it.each([
    ['no data', undefined],
    ['null data', null],
    ['a string instead of an object', 'NZ100042'],
    ['an empty object', {}],
    ['another key', { order: 'NZ100042' }],
    ['a number', { orderNumber: 100042 }],
    ['a list', { orderNumber: ['NZ100042'] }],
    ['lower case', { orderNumber: 'nz100042' }],
    ['too few digits', { orderNumber: 'NZ12' }],
    ['too many digits', { orderNumber: 'NZ1234567890123' }],
    ['trailing space', { orderNumber: 'NZ100042 ' }],
    ['trailing newline', { orderNumber: 'NZ100042\n' }],
    ['a path', { orderNumber: '/checkout' }],
    ['a traversal', { orderNumber: 'NZ100042/../addresses' }],
    ['a query', { orderNumber: 'NZ100042?placed=1' }],
    ['a url', { orderNumber: 'https://evil.example/NZ100042' }],
    ['a screen instead of an order', { screen: '/checkout', url: 'nilzora://checkout' }],
  ])('does not navigate for %s', async (_name, data) => {
    await renderBridge();

    await act(() => {
      tapListener?.(tapOf(data));
    });

    expect(router.push).not.toHaveBeenCalled();
    expect(orderNumberFromData(data)).toBeNull();
  });

  it('opens the order of the notification that started the app, once', async () => {
    notifications.getLastNotificationResponse.mockReturnValue(tapOf({ orderNumber: 'NZ100043' }));
    await renderBridge();

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/order/[orderNumber]',
      params: { orderNumber: 'NZ100043' },
    });
    expect(notifications.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
  });

  it('ignores a launch notification without a valid order number', async () => {
    notifications.getLastNotificationResponse.mockReturnValue(tapOf({ orderNumber: '../x' }));
    await renderBridge();

    expect(router.push).not.toHaveBeenCalled();
  });

  it('waits until the navigator exists before opening anything', async () => {
    mockNavigationReady = false;
    notifications.getLastNotificationResponse.mockReturnValue(tapOf({ orderNumber: 'NZ100043' }));
    const { rerender } = await renderBridge();
    expect(router.push).not.toHaveBeenCalled();
    expect(notifications.addNotificationResponseReceivedListener).not.toHaveBeenCalled();

    mockNavigationReady = true;
    await rerender(<NotificationBridge />);

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/order/[orderNumber]',
      params: { orderNumber: 'NZ100043' },
    });
    expect(notifications.addNotificationResponseReceivedListener).toHaveBeenCalledTimes(1);
  });

  it('stops listening for taps when it unmounts', async () => {
    const { unmount } = await renderBridge();

    await unmount();

    expect(removeTapListener).toHaveBeenCalledTimes(1);
  });
});
