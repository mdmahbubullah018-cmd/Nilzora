import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { getMobileApi } from './api';
import { createSessionManager, type SessionManager, type SessionState } from './session-manager';
import { secureTokenStore } from './token-store';

/** `unconfigured`: this build has no usable API address, so nobody can sign in. */
export type AppSessionState = SessionState | { status: 'unconfigured' };

const UNCONFIGURED: AppSessionState = { status: 'unconfigured' };

/** `null` = the app is not configured; `undefined` = no provider above (a programming error). */
const SessionContext = createContext<SessionManager | null | undefined>(undefined);

function createAppSessionManager(): SessionManager | null {
  const mobileApi = getMobileApi();
  if (!mobileApi.ok) {
    console.warn(`[nilzora] sign-in is disabled: EXPO_PUBLIC_API_BASE_URL is ${mobileApi.problem}`);
    return null;
  }
  return createSessionManager({ api: mobileApi.api, store: secureTokenStore });
}

export interface SessionProviderProps {
  children: ReactNode;
  /** Tests inject a manager (or `null` for an unconfigured build). */
  manager?: SessionManager | null;
}

/** Creates the session manager once and restores the saved session on start. */
export function SessionProvider({ children, manager: injected }: SessionProviderProps) {
  const [manager] = useState(() => (injected === undefined ? createAppSessionManager() : injected));

  useEffect(() => {
    void manager?.restore();
  }, [manager]);

  return <SessionContext.Provider value={manager}>{children}</SessionContext.Provider>;
}

const subscribeNothing = () => () => undefined;
const getUnconfigured = () => UNCONFIGURED;

export interface SessionHandle {
  state: AppSessionState;
  /** Actions; `null` when the app is not configured. */
  manager: SessionManager | null;
}

/** Current session state (never containing tokens) plus the actions that change it. */
export function useSession(): SessionHandle {
  const manager = useContext(SessionContext);
  if (manager === undefined) throw new Error('useSession() must be used inside <SessionProvider>');
  const state = useSyncExternalStore<AppSessionState>(
    manager?.subscribe ?? subscribeNothing,
    manager?.getState ?? getUnconfigured,
  );
  return { state, manager };
}

/**
 * The signed-in account's id, or null in every other state (restoring, offline, suspended,
 * signed out, unconfigured). Authenticated queries put it in their key and stay disabled
 * while it is null.
 */
export function useSignedInUserId(): string | null {
  const { state } = useSession();
  return state.status === 'signed_in' ? state.user.id : null;
}
