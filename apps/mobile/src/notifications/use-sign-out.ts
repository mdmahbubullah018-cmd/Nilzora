import type { ApiClient } from '@nilzora/api-client';
import { useCallback, useRef, useState } from 'react';
import { getMobileApi } from '@/auth/api';
import { useSession } from '@/auth/session-context';
import type { SessionManager } from '@/auth/session-manager';
import { forgetRegisteredToken, readRegisteredToken } from './registered-token';

/**
 * How long sign-out waits for the server to forget this device. Signing out must never
 * hang on a bad connection, so the request is given up after this and sign-out goes on.
 */
export const SIGN_OUT_UNREGISTER_TIMEOUT_MS = 3000;

/**
 * Best effort: asks the API to forget the push token this device registered, so the
 * account that is leaving stops getting notifications here. It needs a valid access token,
 * so it must run BEFORE the session is cleared. Every failure (no connection, an expired
 * session, a refusal, the timeout) is ignored: the token then simply stays on the server
 * until another account registers it, which moves it.
 *
 * Resolves to whether the remembered token belonged to the account being signed out (the
 * caller then forgets it locally); a token remembered for another account is left alone.
 */
export async function unregisterThisDevice(
  manager: Pick<SessionManager, 'getState' | 'authorized'>,
  api: Pick<ApiClient, 'unregisterDevice'> | null,
  timeoutMs: number = SIGN_OUT_UNREGISTER_TIMEOUT_MS,
): Promise<boolean> {
  const remembered = await readRegisteredToken();
  if (remembered === null) return false;
  const state = manager.getState();
  if (state.status === 'signed_in' && state.user.id !== remembered.userId) return false;
  if (api === null) return true;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve();
    }, timeoutMs);
  });
  const attempt = manager
    .authorized((accessToken) =>
      api.unregisterDevice(accessToken, { token: remembered.token }, { signal: controller.signal }),
    )
    .then(
      () => undefined,
      () => undefined,
    );
  try {
    await Promise.race([attempt, timedOut]);
  } finally {
    clearTimeout(timer);
  }
  return true;
}

export interface SignOut {
  /** Removes this device from the account (best effort), then ends the session. */
  signOut: () => Promise<void>;
  signingOut: boolean;
}

/**
 * Signing out, with the push token cleaned up first. Use it for every "Sign out" button
 * instead of calling the session manager directly. Pressing it twice runs it once.
 */
export function useSignOut(): SignOut {
  const { manager } = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const busy = useRef(false);

  const signOut = useCallback(async () => {
    if (manager === null || busy.current) return;
    busy.current = true;
    setSigningOut(true);
    try {
      const mobileApi = getMobileApi();
      const own = await unregisterThisDevice(manager, mobileApi.ok ? mobileApi.api : null);
      await manager.signOut();
      if (own) await forgetRegisteredToken();
    } finally {
      busy.current = false;
      setSigningOut(false);
    }
  }, [manager]);

  return { signOut, signingOut };
}
