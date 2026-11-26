import AsyncStorage from '@react-native-async-storage/async-storage';
import { deviceTokenSchema } from '@nilzora/contracts';

/*
 * The push token this device registered, and for whom
 * ----------------------------------------------------
 * Remembered so that:
 *  - a token the platform rotates is registered again only when it really changed,
 *  - the app can register silently after sign-in for an account that already turned
 *    notifications on (without asking again), and
 *  - sign-out knows which token to remove from the server.
 *
 * It lives in AsyncStorage, not SecureStore: a device push token is an address, not a
 * credential (it cannot read anything, and the API never returns it). It is never logged,
 * rendered or sent anywhere except the API's device endpoints. Failures to read or write
 * are swallowed: the worst outcome is asking the customer to turn notifications on again.
 */

const STORAGE_KEY = 'nilzora.push.registered';

export interface RegisteredToken {
  token: string;
  /** The account that registered it; another account never inherits the choice. */
  userId: string;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Calls `listener` whenever the remembered token changes (so screens can stay current). */
export function subscribeRegisteredToken(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function parse(raw: string | null): RegisteredToken | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { token, userId } = value as Record<string, unknown>;
    if (typeof userId !== 'string' || userId === '') return null;
    const parsed = deviceTokenSchema.safeParse(token);
    return parsed.success ? { token: parsed.data, userId } : null;
  } catch {
    return null;
  }
}

export async function readRegisteredToken(): Promise<RegisteredToken | null> {
  try {
    return parse(await AsyncStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export async function writeRegisteredToken(value: RegisteredToken): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Not remembered: the customer may be asked to turn notifications on again.
  }
  notify();
}

export async function forgetRegisteredToken(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing more can be done.
  }
  notify();
}
