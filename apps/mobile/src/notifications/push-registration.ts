import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { useSession, useSignedInUserId } from '@/auth/session-context';
import { SessionEndedError, type SessionManager } from '@/auth/session-manager';
import { describeApiError } from '@/lib/errors';
import { useAuthorizedApi, type AuthorizedRun } from '@/query';
import {
  forgetRegisteredToken,
  readRegisteredToken,
  subscribeRegisteredToken,
  writeRegisteredToken,
} from './registered-token';
import {
  appVersion,
  getDeviceToken,
  getPermission,
  pushPlatform,
  PushUnavailableError,
  requestPermission,
  UNAVAILABLE_MESSAGE,
} from './push-service';

/*
 * Push registration
 * -----------------
 * Registering this device's push token with the signed-in account. Delivery is a later
 * phase; here the token only reaches the API (POST /me/devices) and is remembered locally.
 *
 *  - The permission prompt appears only when the customer taps "Turn on order updates".
 *  - Registration after sign-in (resumeRegistration) and after a token refresh
 *    (refreshRegistration) are silent: they never prompt, and do nothing for an account that
 *    has not turned notifications on.
 *  - Nothing here logs, renders or returns a token to a screen.
 */

export const PUSH_MESSAGES = {
  unavailable: UNAVAILABLE_MESSAGE,
  denied:
    'Notifications are turned off for Nilzora. Turn them on in your phone settings to get order updates.',
  enableFailed: 'Order updates could not be turned on.',
  disableFailed: 'Order updates could not be turned off.',
} as const;

type SessionReader = Pick<SessionManager, 'getState'>;

/** The signed-in account's id as the session manager reports it right now; null if nobody is. */
export function currentUserId(manager: SessionReader | null): string | null {
  const state = manager?.getState();
  return state?.status === 'signed_in' ? state.user.id : null;
}

/**
 * Makes `run` serve one account only. Registration work is asynchronous (the system can
 * take a while to hand out a token, a prompt waits for the customer) and the customer can
 * sign out and another account sign in meanwhile. A late call must not attach this device
 * to whoever is signed in by then, so the account is checked at the moment the request is
 * about to be made - the access token it is given belongs to that moment's session.
 * It rejects with SessionEndedError, like any call whose session is over.
 */
export function pinToUser(run: AuthorizedRun, manager: SessionReader | null, userId: string) {
  const pinned: AuthorizedRun = (call) =>
    run((api, accessToken) =>
      currentUserId(manager) === userId
        ? call(api, accessToken)
        : Promise.reject(new SessionEndedError()),
    );
  return pinned;
}

/** Registers (or refreshes) `token` for the signed-in account. */
export async function registerToken(run: AuthorizedRun, token: string): Promise<void> {
  const platform = pushPlatform();
  if (platform === null) throw new PushUnavailableError();
  await run((api, accessToken) =>
    api.registerDevice(accessToken, { token, platform, appVersion: appVersion() }),
  );
}

/** Removes `token` from the signed-in account's devices. Resolves even if it was not registered. */
export async function unregisterToken(
  run: AuthorizedRun,
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  await run((api, accessToken) => api.unregisterDevice(accessToken, { token }, { signal }));
}

export interface SilentRegistration {
  /** Should be pinned to `userId` (see pinToUser): the last line of defence. */
  run: AuthorizedRun;
  userId: string;
  /**
   * False once the account that started this work is gone (signed out, or another account
   * signed in). Checked after every wait and right before anything is sent or remembered.
   */
  isActive: () => boolean;
}

/**
 * After sign-in: if this account already turned notifications on and the system still
 * allows them, register the device's current token again, silently. If the customer has
 * since switched notifications off in the system settings, the token is removed instead and
 * the choice forgotten, so the app and the server stop disagreeing.
 */
export async function resumeRegistration({
  run,
  userId,
  isActive,
}: SilentRegistration): Promise<void> {
  const remembered = await readRegisteredToken();
  if (remembered === null || remembered.userId !== userId) return;

  const permission = await getPermission();
  if (!isActive()) return;
  if (permission.state !== 'granted') {
    await unregisterToken(run, remembered.token).catch(() => undefined);
    if (isActive()) await forgetRegisteredToken();
    return;
  }

  const token = await getDeviceToken();
  // The system may have taken a while: never register for an account that has gone.
  if (!isActive()) return;
  await registerToken(run, token);
  if (isActive()) await writeRegisteredToken({ token, userId });
}

/** When the platform rotates the token: register the new one, but only if it differs. */
export async function refreshRegistration({
  run,
  userId,
  isActive,
  token,
}: SilentRegistration & { token: string }): Promise<void> {
  const remembered = await readRegisteredToken();
  if (remembered === null || remembered.userId !== userId || remembered.token === token) return;
  if (!isActive()) return;

  await registerToken(run, token);
  if (isActive()) await writeRegisteredToken({ token, userId });
}

export type PushStatus =
  /** Reading the system permission and the saved choice. */
  | 'checking'
  /** This build cannot receive push notifications (Expo Go, no Firebase, web). */
  | 'unsupported'
  /** Not turned on for this account (the system may or may not allow it yet). */
  | 'off'
  /** Turned on: this device is registered for the signed-in account. */
  | 'on'
  /** The system forbids notifications for Nilzora; only the phone's settings can change that. */
  | 'denied';

async function readStatus(userId: string | null): Promise<PushStatus> {
  if (pushPlatform() === null) return 'unsupported';
  try {
    const permission = await getPermission();
    if (permission.state === 'denied') return 'denied';
    const remembered = await readRegisteredToken();
    const enabled = userId !== null && remembered !== null && remembered.userId === userId;
    return enabled && permission.state === 'granted' ? 'on' : 'off';
  } catch {
    return 'unsupported';
  }
}

export interface PushRegistration {
  status: PushStatus;
  /** True while turning notifications on or off. */
  busy: boolean;
  /** A fixed message about the last attempt that failed; null otherwise. */
  error: string | null;
  /** Asks permission, then registers this device. Call it only from a tap. */
  enable: () => Promise<void>;
  /** Removes this device from the account and forgets the choice. */
  disable: () => Promise<void>;
  /** Opens the phone's settings for Nilzora. */
  openSettings: () => void;
}

/**
 * State and actions behind the "Order updates" row of the Account tab. Reading the state
 * never prompts; `enable()` is the only thing that does.
 */
export function usePushRegistration(): PushRegistration {
  const authorized = useAuthorizedApi();
  const { manager } = useSession();
  const userId = useSignedInUserId();
  // Whatever the customer taps, the work below serves the account that was signed in then.
  const run = useMemo<AuthorizedRun>(
    () => (userId === null ? authorized : pinToUser(authorized, manager, userId)),
    [authorized, manager, userId],
  );
  const [status, setStatus] = useState<PushStatus>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void readStatus(userId).then((next) => {
        // enable() and disable() set the final status themselves.
        if (!cancelled && !working.current) setStatus(next);
      });
    };
    refresh();
    const stopWatching = subscribeRegisteredToken(refresh);
    // Coming back from the phone's settings: the permission may have changed.
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => {
      cancelled = true;
      stopWatching();
      appState.remove();
    };
  }, [userId]);

  const enable = useCallback(async () => {
    if (working.current || userId === null) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      const permission = await requestPermission();
      if (permission.state !== 'granted') {
        setStatus('denied');
        return;
      }
      const token = await getDeviceToken();
      // The prompt and the system can take a while; the account may have changed meanwhile.
      if (currentUserId(manager) !== userId) return;
      await registerToken(run, token);
      if (currentUserId(manager) !== userId) return;
      await writeRegisteredToken({ token, userId });
      setStatus('on');
    } catch (failure) {
      if (failure instanceof PushUnavailableError) {
        setStatus('unsupported');
      } else {
        setError(`${PUSH_MESSAGES.enableFailed} ${describeApiError(failure).message}`);
      }
    } finally {
      working.current = false;
      setBusy(false);
    }
  }, [manager, run, userId]);

  const disable = useCallback(async () => {
    if (working.current || userId === null) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      const remembered = await readRegisteredToken();
      // Only a failure to remove the token keeps the switch on: the server would still send.
      if (remembered !== null && remembered.userId === userId) {
        await unregisterToken(run, remembered.token);
      }
      await forgetRegisteredToken();
      setStatus('off');
    } catch (failure) {
      setError(`${PUSH_MESSAGES.disableFailed} ${describeApiError(failure).message}`);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }, [run, userId]);

  const openSettings = useCallback(() => {
    void Linking.openSettings().catch(() => undefined);
  }, []);

  return { status, busy, error, enable, disable, openSettings };
}
