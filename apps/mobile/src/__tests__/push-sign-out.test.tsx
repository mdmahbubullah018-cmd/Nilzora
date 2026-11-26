import { ApiError } from '@nilzora/api-client';
import { act, screen } from '@testing-library/react-native';
import AccountScreen from '../../app/(tabs)/account';
import { SignedInGate } from '../auth/signed-in-gate';
import {
  SIGN_OUT_UNREGISTER_TIMEOUT_MS,
  unregisterThisDevice,
  useSignOut,
} from '../notifications/use-sign-out';
import { readRegisteredToken, writeRegisteredToken } from '../notifications/registered-token';
import { createFakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock } from '../test-utils/expo-router-mock';
import {
  renderHookWithProviders,
  renderWithProviders,
  resetAsyncStorage,
} from '../test-utils/render-with-providers';
import {
  createControllableManager,
  CUSTOMER,
  FAKE_ACCESS_TOKEN,
  signedInState,
} from '../test-utils/session-fakes';
import { Text } from 'react-native';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));
// The Account tab reads the notification permission; nothing here depends on it.
jest.mock('expo-notifications', () => ({}));

// Sign-out talks to the shared API client (the one the session manager uses), not to a provider.
const mockApi = createFakeApiClient();
jest.mock('@/auth/api', () => ({
  ...jest.requireActual<object>('@/auth/api'),
  getMobileApi: () => ({ ok: true, api: mockApi }),
}));

const USER_ID = CUSTOMER.user.id;
const OTHER_USER_ID = '11111111-2222-4333-8444-555555555555';
const TOKEN = 'fcm:APA91b-device-token-7f3a9c_example';

beforeEach(async () => {
  resetRouterMock();
  await resetAsyncStorage();
  mockApi.unregisterDevice.mockReset();
  mockApi.unregisterDevice.mockResolvedValue(undefined);
});

async function renderSignOut(session = createControllableManager(signedInState())) {
  const harness = await renderHookWithProviders(() => useSignOut(), { api: mockApi, session });
  return { ...harness, manager: session };
}

describe('useSignOut', () => {
  it('removes this device’s token with the live session first, then signs out and forgets it', async () => {
    await writeRegisteredToken({ token: TOKEN, userId: USER_ID });
    const { result, manager } = await renderSignOut();

    await act(() => result.current.signOut());

    expect(mockApi.unregisterDevice).toHaveBeenCalledTimes(1);
    expect(mockApi.unregisterDevice).toHaveBeenCalledWith(
      FAKE_ACCESS_TOKEN,
      { token: TOKEN },
      expect.objectContaining({ signal: expect.anything() as unknown }),
    );
    expect(manager.signOut).toHaveBeenCalledTimes(1);
    // The token must go while the access token still works.
    expect(mockApi.unregisterDevice.mock.invocationCallOrder[0]).toBeLessThan(
      manager.signOut.mock.invocationCallOrder[0] ?? 0,
    );
    expect(await readRegisteredToken()).toBeNull();
  });

  it('just signs out when no token was registered', async () => {
    const { result, manager } = await renderSignOut();

    await act(() => result.current.signOut());

    expect(mockApi.unregisterDevice).not.toHaveBeenCalled();
    expect(manager.signOut).toHaveBeenCalledTimes(1);
  });

  it('signs out anyway when the server refuses or cannot be reached', async () => {
    await writeRegisteredToken({ token: TOKEN, userId: USER_ID });
    mockApi.unregisterDevice.mockRejectedValue(new ApiError(0, 'network_error', 'offline'));
    const { result, manager } = await renderSignOut();

    await act(() => result.current.signOut());

    expect(mockApi.unregisterDevice).toHaveBeenCalledTimes(1);
    expect(manager.signOut).toHaveBeenCalledTimes(1);
    expect(await readRegisteredToken()).toBeNull();
  });

  it('signs out anyway when the session already ended, without calling the server', async () => {
    await writeRegisteredToken({ token: TOKEN, userId: USER_ID });
    const manager = createControllableManager(signedInState());
    const { result } = await renderSignOut(manager);
    // The session expired: authorized() rejects before any request is made.
    await act(() => {
      manager.setState({ status: 'offline' });
    });

    await act(() => result.current.signOut());

    expect(mockApi.unregisterDevice).not.toHaveBeenCalled();
    expect(manager.signOut).toHaveBeenCalledTimes(1);
    expect(await readRegisteredToken()).toBeNull();
  });

  it('does not wait for a server that never answers', async () => {
    await writeRegisteredToken({ token: TOKEN, userId: USER_ID });
    let signal: AbortSignal | undefined;
    mockApi.unregisterDevice.mockImplementation((_token, _body, options) => {
      signal = options?.signal;
      return new Promise(() => undefined);
    });
    const { result, manager } = await renderSignOut();

    jest.useFakeTimers();
    try {
      await act(async () => {
        const done = result.current.signOut();
        await jest.advanceTimersByTimeAsync(SIGN_OUT_UNREGISTER_TIMEOUT_MS - 1);
        expect(manager.signOut).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);
        await done;
      });
    } finally {
      jest.useRealTimers();
    }

    expect(SIGN_OUT_UNREGISTER_TIMEOUT_MS).toBe(3000);
    expect(signal?.aborted).toBe(true);
    expect(manager.signOut).toHaveBeenCalledTimes(1);
    expect(await readRegisteredToken()).toBeNull();
  });

  it('leaves a token that belongs to another account alone', async () => {
    await writeRegisteredToken({ token: TOKEN, userId: OTHER_USER_ID });
    const { result, manager } = await renderSignOut();

    await act(() => result.current.signOut());

    expect(mockApi.unregisterDevice).not.toHaveBeenCalled();
    expect(manager.signOut).toHaveBeenCalledTimes(1);
    expect(await readRegisteredToken()).toEqual({ token: TOKEN, userId: OTHER_USER_ID });
  });

  it('runs once however often it is pressed', async () => {
    await writeRegisteredToken({ token: TOKEN, userId: USER_ID });
    let release: () => void = () => undefined;
    mockApi.unregisterDevice.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const { result, manager } = await renderSignOut();

    await act(async () => {
      const first = result.current.signOut();
      const second = result.current.signOut();
      release();
      await Promise.all([first, second]);
    });

    expect(mockApi.unregisterDevice).toHaveBeenCalledTimes(1);
    expect(manager.signOut).toHaveBeenCalledTimes(1);
  });
});

describe('unregisterThisDevice', () => {
  it('gives up on a hanging request after the timeout and aborts it', async () => {
    await writeRegisteredToken({ token: TOKEN, userId: USER_ID });
    let signal: AbortSignal | undefined;
    const api = {
      unregisterDevice: jest.fn(
        (_token: string, _body: unknown, options?: { signal?: AbortSignal }) => {
          signal = options?.signal;
          return new Promise<void>(() => undefined);
        },
      ),
    };
    const manager = createControllableManager(signedInState());

    await expect(unregisterThisDevice(manager, api, 20)).resolves.toBe(true);

    expect(signal?.aborted).toBe(true);
    expect(api.unregisterDevice).toHaveBeenCalledTimes(1);
  });

  it('reports that a token was ours even when this build has no API client', async () => {
    await writeRegisteredToken({ token: TOKEN, userId: USER_ID });

    await expect(
      unregisterThisDevice(createControllableManager(signedInState()), null),
    ).resolves.toBe(true);
  });
});

describe('the Sign out buttons', () => {
  it('on the Account tab remove the token before the session is cleared', async () => {
    await writeRegisteredToken({ token: TOKEN, userId: USER_ID });
    const manager = createControllableManager(signedInState());
    const { user } = await renderWithProviders(<AccountScreen />, {
      api: mockApi,
      session: manager,
    });

    await user.press(await screen.findByRole('button', { name: 'Sign out' }));

    expect(mockApi.unregisterDevice).toHaveBeenCalledWith(
      FAKE_ACCESS_TOKEN,
      { token: TOKEN },
      expect.anything(),
    );
    expect(manager.signOut).toHaveBeenCalledTimes(1);
    expect(await readRegisteredToken()).toBeNull();
  });

  it('on the suspended-account screen of the sign-in gate sign out even though the server will refuse', async () => {
    await writeRegisteredToken({ token: TOKEN, userId: USER_ID });
    const manager = createControllableManager({ status: 'suspended' });
    const { user } = await renderWithProviders(
      <SignedInGate>
        <Text>private</Text>
      </SignedInGate>,
      { api: mockApi, session: manager },
    );

    await user.press(screen.getByRole('button', { name: 'Sign out' }));

    // No live session to authorise a request with: the attempt is skipped, sign-out is not.
    expect(mockApi.unregisterDevice).not.toHaveBeenCalled();
    expect(manager.signOut).toHaveBeenCalledTimes(1);
    expect(await readRegisteredToken()).toBeNull();
  });
});
