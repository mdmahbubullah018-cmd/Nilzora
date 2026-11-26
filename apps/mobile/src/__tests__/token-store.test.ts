import * as SecureStore from 'expo-secure-store';
import { Platform, Settings } from 'react-native';
import {
  INSTALL_MARKER_KEY,
  INSTALLED,
  parseStoredSession,
  SECURE_STORE_OPTIONS,
  SESSION_KEY,
  SessionReadError,
  secureTokenStore,
  type StoredSession,
} from '../auth/token-store';

jest.mock('expo-secure-store', () => {
  const items = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK: 0,
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    WHEN_UNLOCKED: 5,
    __items: items,
    getItemAsync: jest.fn((key: string) => Promise.resolve(items.get(key) ?? null)),
    setItemAsync: jest.fn((key: string, value: string) => {
      items.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string) => {
      items.delete(key);
      return Promise.resolve();
    }),
  };
});

/** Only what the token store uses: a platform and Settings (NSUserDefaults on iOS). */
jest.mock('react-native', () => {
  const values = new Map<string, unknown>();
  return {
    Platform: { OS: 'ios' },
    Settings: {
      __values: values,
      get: jest.fn((key: string) => values.get(key)),
      set: jest.fn((settings: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(settings)) values.set(key, value);
      }),
    },
  };
});

const mocked = SecureStore as jest.Mocked<typeof SecureStore> & { __items: Map<string, string> };
const platform = Platform as { OS: string };
/** Function-valued properties, so `expect(settings.get)` is not an unbound method reference. */
const settings = Settings as unknown as {
  get: jest.Mock<unknown, [key: string]>;
  set: jest.Mock<void, [values: object]>;
  __values: Map<string, unknown>;
};

const session: StoredSession = {
  accessToken: 'header.payload.signature',
  refreshToken: 'refresh-token-value',
  expiresAt: 1_800_000_000,
};

beforeEach(() => {
  mocked.__items.clear();
  // An installation that has started before, unless a test says otherwise.
  platform.OS = 'ios';
  settings.__values.clear();
  settings.__values.set(INSTALL_MARKER_KEY, INSTALLED);
  jest.clearAllMocks();
});

describe('secureTokenStore', () => {
  it('keeps the session in one SecureStore entry that never leaves the device', async () => {
    await secureTokenStore.save(session);

    expect(SECURE_STORE_OPTIONS).toEqual({
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    expect(mocked.setItemAsync).toHaveBeenCalledTimes(1);
    expect(mocked.setItemAsync).toHaveBeenCalledWith(
      SESSION_KEY,
      JSON.stringify(session),
      SECURE_STORE_OPTIONS,
    );
    expect(SESSION_KEY).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('loads what it saved', async () => {
    await secureTokenStore.save(session);

    await expect(secureTokenStore.load()).resolves.toEqual(session);
    expect(mocked.getItemAsync).toHaveBeenCalledWith(SESSION_KEY, SECURE_STORE_OPTIONS);
  });

  it('saves only the three session fields', async () => {
    await secureTokenStore.save({ ...session, user: 'x' } as StoredSession);

    expect(JSON.parse(mocked.__items.get(SESSION_KEY) ?? '{}')).toEqual(session);
  });

  it('returns null when nothing is saved', async () => {
    await expect(secureTokenStore.load()).resolves.toBeNull();
    expect(mocked.deleteItemAsync).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{"accessToken":'],
    ['a missing refresh token', JSON.stringify({ accessToken: 'a', expiresAt: 1 })],
    ['an unexpected field', JSON.stringify({ ...session, role: 'admin' })],
    ['a non-numeric expiry', JSON.stringify({ ...session, expiresAt: 'soon' })],
    ['an empty token', JSON.stringify({ ...session, accessToken: '' })],
  ])('clears a corrupted entry (%s) and returns null', async (_, raw) => {
    mocked.__items.set(SESSION_KEY, raw);

    await expect(secureTokenStore.load()).resolves.toBeNull();
    expect(mocked.deleteItemAsync).toHaveBeenCalledWith(SESSION_KEY, SECURE_STORE_OPTIONS);
    expect(mocked.__items.has(SESSION_KEY)).toBe(false);
  });

  it('keeps an entry it cannot read right now and reports it, so a later load succeeds', async () => {
    // expo-secure-store resolves null itself for values that can never be decrypted again;
    // a rejection is what is left, and may be temporary.
    mocked.__items.set(SESSION_KEY, JSON.stringify(session));
    mocked.getItemAsync.mockRejectedValueOnce(new Error('KeyStoreException'));

    await expect(secureTokenStore.load()).rejects.toBeInstanceOf(SessionReadError);
    expect(mocked.deleteItemAsync).not.toHaveBeenCalled();
    expect(mocked.__items.get(SESSION_KEY)).toBe(JSON.stringify(session));

    await expect(secureTokenStore.load()).resolves.toEqual(session);
  });

  it('removes the entry on clear', async () => {
    await secureTokenStore.save(session);
    await secureTokenStore.clear();

    expect(mocked.deleteItemAsync).toHaveBeenCalledWith(SESSION_KEY, SECURE_STORE_OPTIONS);
    await expect(secureTokenStore.load()).resolves.toBeNull();
  });
});

describe('reinstall check', () => {
  it('on iOS without the install marker, drops the saved session, then sets the marker', async () => {
    mocked.__items.set(SESSION_KEY, JSON.stringify(session));
    settings.__values.clear();
    let markedAtDelete: boolean | undefined;
    mocked.deleteItemAsync.mockImplementationOnce((key: string) => {
      markedAtDelete = settings.__values.has(INSTALL_MARKER_KEY);
      mocked.__items.delete(key);
      return Promise.resolve();
    });

    await expect(secureTokenStore.load()).resolves.toBeNull();

    expect(markedAtDelete).toBe(false);
    expect(settings.__values.get(INSTALL_MARKER_KEY)).toBe(INSTALLED);
    expect(mocked.deleteItemAsync).toHaveBeenCalledWith(SESSION_KEY, SECURE_STORE_OPTIONS);
    expect(mocked.__items.has(SESSION_KEY)).toBe(false);
    // The marker is a plain number, never a token.
    expect(settings.set.mock.calls).toEqual([[{ [INSTALL_MARKER_KEY]: INSTALLED }]]);
    expect(typeof INSTALLED).toBe('number');

    // Later launches of the same installation keep what this one saves.
    await secureTokenStore.save(session);
    await expect(secureTokenStore.load()).resolves.toEqual(session);
    expect(mocked.deleteItemAsync).toHaveBeenCalledTimes(1);
  });

  it('on iOS with the install marker, keeps the saved session', async () => {
    mocked.__items.set(SESSION_KEY, JSON.stringify(session));

    await expect(secureTokenStore.load()).resolves.toEqual(session);

    expect(settings.get).toHaveBeenCalledWith(INSTALL_MARKER_KEY);
    expect(mocked.deleteItemAsync).not.toHaveBeenCalled();
    expect(settings.set).not.toHaveBeenCalled();
  });

  it('reads nothing and leaves the marker unset when the old session cannot be dropped', async () => {
    mocked.__items.set(SESSION_KEY, JSON.stringify(session));
    settings.__values.clear();
    mocked.deleteItemAsync.mockRejectedValueOnce(new Error('errSecInteractionNotAllowed'));

    await expect(secureTokenStore.load()).rejects.toBeInstanceOf(SessionReadError);
    expect(mocked.getItemAsync).not.toHaveBeenCalled();
    expect(settings.set).not.toHaveBeenCalled();

    // Tried again on the next load.
    await expect(secureTokenStore.load()).resolves.toBeNull();
    expect(mocked.__items.has(SESSION_KEY)).toBe(false);
    expect(settings.__values.get(INSTALL_MARKER_KEY)).toBe(INSTALLED);
  });

  it('never touches Settings on Android', async () => {
    platform.OS = 'android';
    settings.__values.clear();
    mocked.__items.set(SESSION_KEY, JSON.stringify(session));

    await expect(secureTokenStore.load()).resolves.toEqual(session);
    await secureTokenStore.save(session);
    await secureTokenStore.clear();

    expect(settings.get).not.toHaveBeenCalled();
    expect(settings.set).not.toHaveBeenCalled();
    expect(mocked.deleteItemAsync).toHaveBeenCalledTimes(1); // the explicit clear only
  });
});

describe('parseStoredSession', () => {
  it('accepts exactly a stored session', () => {
    expect(parseStoredSession(JSON.stringify(session))).toEqual(session);
    expect(parseStoredSession('null')).toBeNull();
    expect(parseStoredSession('[]')).toBeNull();
  });
});

/** Node's fs and path, typed here because the app's tsconfig has no Node types. */
const fs = jest.requireActual<{
  readdirSync(path: string): string[];
  readFileSync(path: string, encoding: 'utf8'): string;
}>('fs');
const path = jest.requireActual<{ join(...parts: string[]): string }>('path');
declare const __dirname: string;

describe('token storage boundary', () => {
  const authDir = path.join(__dirname, '..', 'auth');
  const sources = fs
    .readdirSync(authDir)
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => [name, fs.readFileSync(path.join(authDir, name), 'utf8')] as const);

  it('reads the auth sources', () => {
    expect(sources.map(([name]) => name)).toEqual(
      expect.arrayContaining(['session-manager.ts', 'token-store.ts']),
    );
  });

  it.each(sources)('%s never uses another storage for tokens', (_, source) => {
    expect(source).not.toMatch(
      /AsyncStorage|async-storage|localStorage|sessionStorage|expo-file-system|mmkv/i,
    );
  });

  it.each(sources)('%s never prints with console.log', (_, source) => {
    expect(source).not.toMatch(/console\.(log|info|debug)\(/);
  });
});
