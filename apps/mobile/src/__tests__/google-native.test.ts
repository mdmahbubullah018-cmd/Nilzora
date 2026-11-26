import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import type * as GoogleSigninTypes from '@react-native-google-signin/google-signin';

import {
  createNativeGoogleProvider,
  googleWebClientId,
  registerNativeGoogleSignIn,
} from '../auth/google-native';
import {
  googleSignOut,
  googleSignInAvailable,
  resetGoogleIdTokenProvider,
} from '../auth/google-signin';

// The library is native-only, so it is replaced wholesale here; everything below is the
// adapter's own mapping from Google's responses onto the seam.
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(),
    signIn: jest.fn(),
    signOut: jest.fn(),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
    SIGN_IN_REQUIRED: 'SIGN_IN_REQUIRED',
    NULL_PRESENTER: 'NULL_PRESENTER',
  },
}));

const native = GoogleSignin as jest.Mocked<typeof GoogleSignin>;
const nativeModule = { GoogleSignin, statusCodes } as unknown as typeof GoogleSigninTypes;
const hasPlayServices = jest.mocked(GoogleSignin.hasPlayServices);
const signIn = jest.mocked(GoogleSignin.signIn);
const signOut = jest.mocked(GoogleSignin.signOut);

const WEB_CLIENT_ID = '123456789012-abcdef123456.apps.googleusercontent.com';

function signedIn(idToken: string | null) {
  return {
    type: 'success',
    data: { idToken, user: { id: 'google-user-1', email: 'shopper@example.com' } },
  } as never;
}

function googleError(code: string) {
  return Object.assign(new Error(`google: ${code}`), { code });
}

function setWebClientId(value: string | undefined) {
  if (value === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  else process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = value;
}

const originalEnv = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

beforeEach(() => {
  jest.clearAllMocks();
  resetGoogleIdTokenProvider();
  hasPlayServices.mockResolvedValue(true);
  signOut.mockResolvedValue(undefined as never);
  setWebClientId(WEB_CLIENT_ID);
});

afterEach(() => {
  resetGoogleIdTokenProvider();
  setWebClientId(originalEnv);
});

describe('googleWebClientId', () => {
  it('returns the configured web client id', () => {
    expect(googleWebClientId()).toBe(WEB_CLIENT_ID);
  });

  it.each([
    ['missing', undefined],
    ['blank', '   '],
    ['an IOS-flavoured id', '123456789012-abcdef123456.apps.googleusercontent.com.ios'],
    ['a placeholder', 'replace-me'],
  ])('ignores a %s value', (_label, value) => {
    setWebClientId(value);
    expect(googleWebClientId()).toBeUndefined();
  });

  it('trims surrounding whitespace', () => {
    setWebClientId(`  ${WEB_CLIENT_ID}  `);
    expect(googleWebClientId()).toBe(WEB_CLIENT_ID);
  });
});

describe('registerNativeGoogleSignIn', () => {
  it('configures the module and registers the provider', () => {
    expect(registerNativeGoogleSignIn()).toBe(true);
    expect(GoogleSignin.configure).toHaveBeenCalledWith({
      webClientId: WEB_CLIENT_ID,
      offlineAccess: false,
    });
    expect(googleSignInAvailable()).toBe(true);
  });

  it('registers nothing when the web client id is missing', () => {
    setWebClientId(undefined);
    expect(registerNativeGoogleSignIn()).toBe(false);
    expect(GoogleSignin.configure).not.toHaveBeenCalled();
    expect(googleSignInAvailable()).toBe(false);
  });

  it('registers nothing when the web client id is a placeholder', () => {
    setWebClientId('replace-me');
    expect(registerNativeGoogleSignIn()).toBe(false);
    expect(GoogleSignin.configure).not.toHaveBeenCalled();
  });

  it('keeps the module instance intact', () => {
    expect(native.configure).toBe(GoogleSignin.configure);
  });
});

describe('native Google provider', () => {
  it('returns the ID token from a completed sign-in', async () => {
    signIn.mockResolvedValue(signedIn('header.payload.signature'));
    const provider = createNativeGoogleProvider(nativeModule);
    await expect(provider.requestIdToken()).resolves.toEqual({
      ok: true,
      idToken: 'header.payload.signature',
    });
    expect(hasPlayServices).toHaveBeenCalledWith({ showPlayServicesUpdateDialog: true });
  });

  it('reports a dismissed account picker as cancelled', async () => {
    signIn.mockResolvedValue({ type: 'cancelled', data: null } as never);
    const provider = createNativeGoogleProvider(nativeModule);
    await expect(provider.requestIdToken()).resolves.toEqual({ ok: false, reason: 'cancelled' });
  });

  it('treats a success without an ID token as a failure', async () => {
    signIn.mockResolvedValue(signedIn(null));
    const provider = createNativeGoogleProvider(nativeModule);
    await expect(provider.requestIdToken()).resolves.toEqual({ ok: false, reason: 'failed' });
  });

  it('treats an empty ID token as a failure', async () => {
    signIn.mockResolvedValue(signedIn(''));
    const provider = createNativeGoogleProvider(nativeModule);
    await expect(provider.requestIdToken()).resolves.toEqual({ ok: false, reason: 'failed' });
  });

  it('reports missing Play Services as unavailable', async () => {
    hasPlayServices.mockResolvedValue(false);
    const provider = createNativeGoogleProvider(nativeModule);
    await expect(provider.requestIdToken()).resolves.toEqual({ ok: false, reason: 'unavailable' });
    expect(signIn).not.toHaveBeenCalled();
  });

  it('maps a cancelled sign-in error to cancelled', async () => {
    signIn.mockRejectedValue(googleError(statusCodes.SIGN_IN_CANCELLED));
    const provider = createNativeGoogleProvider(nativeModule);
    await expect(provider.requestIdToken()).resolves.toEqual({ ok: false, reason: 'cancelled' });
  });

  it('maps a second tap to cancelled rather than an error', async () => {
    signIn.mockRejectedValue(googleError(statusCodes.IN_PROGRESS));
    const provider = createNativeGoogleProvider(nativeModule);
    await expect(provider.requestIdToken()).resolves.toEqual({ ok: false, reason: 'cancelled' });
  });

  it('maps a Play Services error thrown during sign-in to unavailable', async () => {
    signIn.mockRejectedValue(googleError(statusCodes.PLAY_SERVICES_NOT_AVAILABLE));
    const provider = createNativeGoogleProvider(nativeModule);
    await expect(provider.requestIdToken()).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('maps an unknown error to failed', async () => {
    signIn.mockRejectedValue(new Error('boom'));
    const provider = createNativeGoogleProvider(nativeModule);
    await expect(provider.requestIdToken()).resolves.toEqual({ ok: false, reason: 'failed' });
  });

  it('signs out of Google, tolerating a rejection', async () => {
    const provider = createNativeGoogleProvider(nativeModule);
    await expect(provider.signOut?.()).resolves.toBeUndefined();
    expect(signOut).toHaveBeenCalledTimes(1);

    signOut.mockRejectedValue(googleError(statusCodes.SIGN_IN_REQUIRED));
    await expect(provider.signOut?.()).resolves.toBeUndefined();
  });
});

describe('googleSignOut', () => {
  it('does nothing when no provider is registered', async () => {
    await expect(googleSignOut()).resolves.toBeUndefined();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('delegates to the registered provider', async () => {
    registerNativeGoogleSignIn();
    await googleSignOut();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('never throws, even when the provider does', async () => {
    registerNativeGoogleSignIn();
    signOut.mockRejectedValue(new Error('native module missing'));
    await expect(googleSignOut()).resolves.toBeUndefined();
  });
});
