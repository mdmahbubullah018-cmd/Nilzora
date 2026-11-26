import { authSessionSchema } from '@nilzora/contracts';
import * as SecureStore from 'expo-secure-store';
import { Platform, Settings } from 'react-native';

/**
 * What the app keeps between launches. `expiresAt` is Unix seconds by the device
 * clock (see the session manager for why), used only to refresh ahead of expiry.
 */
export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/**
 * Persistent home of the session tokens. The only implementation the app uses is
 * SecureStore. Property-style members: implementations are plain functions.
 */
export interface TokenStore {
  /**
   * The saved session, or null when there is none (or it was unusable and has been dropped).
   * Rejects with `SessionReadError` when the store cannot be read right now; nothing is
   * deleted then, so a later load can still succeed.
   */
  load: () => Promise<StoredSession | null>;
  save: (session: StoredSession) => Promise<void>;
  clear: () => Promise<void>;
}

/** One entry holds the whole session, so the two tokens can never be saved out of step. */
export const SESSION_KEY = 'nilzora.session.v1';

/**
 * iOS only: NSUserDefaults key (React Native `Settings`) marking that this installation has
 * started before. It only ever holds `INSTALLED`, never a token.
 */
export const INSTALL_MARKER_KEY = 'nilzora.installed.v1';
export const INSTALLED = 1;

/** The store could not be read right now (nothing was deleted); worth trying again later. */
export class SessionReadError extends Error {
  override readonly name = 'SessionReadError';

  constructor() {
    super('The saved session could not be read on this device');
  }
}

/**
 * iOS: readable after the first unlock (background refresh works) and never restored
 * to another device from a backup. Android keeps SecureStore values encrypted with a
 * Keystore key that does not leave the device; the expo-secure-store config plugin
 * (app.json) excludes them from Auto Backup.
 */
export const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const storedSessionSchema = authSessionSchema
  .pick({ accessToken: true, refreshToken: true, expiresAt: true })
  .strict();

/** Parses a saved entry; anything that is not exactly a stored session yields null. */
export function parseStoredSession(raw: string): StoredSession | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = storedSessionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function removeEntry(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY, SECURE_STORE_OPTIONS);
}

/**
 * iOS keeps keychain items when the app is uninstalled, so a reinstall would quietly resume
 * the previous owner's session. NSUserDefaults is removed with the app: while the marker is
 * missing, drop any saved session, and only then set the marker, so a failed removal is
 * tried again. Android removes SecureStore data on uninstall, so it skips this entirely.
 */
async function forgetPreviousInstallation(): Promise<void> {
  if (Platform.OS !== 'ios' || Settings.get(INSTALL_MARKER_KEY) === INSTALLED) return;
  await removeEntry();
  Settings.set({ [INSTALL_MARKER_KEY]: INSTALLED });
}

/** Tokens live in the platform keystore/keychain only, never in unencrypted app storage. */
export const secureTokenStore: TokenStore = {
  async load() {
    let raw: string | null;
    try {
      await forgetPreviousInstallation();
      raw = await SecureStore.getItemAsync(SESSION_KEY, SECURE_STORE_OPTIONS);
    } catch {
      // expo-secure-store already resolves null, dropping the entry where needed, when a
      // value can never be decrypted again (say, its Keystore key is gone). What still
      // rejects is often temporary (a busy keystore, a lost app context), so keep the entry
      // and let the caller try again. If it never clears, the app stays offline until the
      // user signs out, which deletes the entry. A failed reinstall check also lands here.
      throw new SessionReadError();
    }
    if (raw === null) return null;

    const session = parseStoredSession(raw);
    if (session === null) await removeEntry().catch(() => undefined);
    return session;
  },

  async save(session) {
    const value: StoredSession = {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
    };
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(value), SECURE_STORE_OPTIONS);
  },

  clear: removeEntry,
};
