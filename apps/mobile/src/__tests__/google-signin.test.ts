import {
  googleSignInAvailable,
  registerGoogleIdTokenProvider,
  requestGoogleIdToken,
  resetGoogleIdTokenProvider,
} from '../auth/google-signin';

/*
 * The seam between the app and the native Google module. Until a provider is registered the
 * button must report itself unavailable rather than fail inside a module the build lacks.
 */
afterEach(() => {
  resetGoogleIdTokenProvider();
});

describe('without a native module', () => {
  it('reports Google sign-in as unavailable', () => {
    expect(googleSignInAvailable()).toBe(false);
  });

  it('returns an unavailable result instead of throwing', async () => {
    await expect(requestGoogleIdToken()).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('with a native module', () => {
  it('passes the ID token through', async () => {
    registerGoogleIdTokenProvider({
      requestIdToken: () => Promise.resolve({ ok: true, idToken: 'abc.def.ghi' }),
    });

    expect(googleSignInAvailable()).toBe(true);
    await expect(requestGoogleIdToken()).resolves.toEqual({ ok: true, idToken: 'abc.def.ghi' });
  });

  it('passes a cancellation through unchanged', async () => {
    registerGoogleIdTokenProvider({
      requestIdToken: () => Promise.resolve({ ok: false, reason: 'cancelled' }),
    });

    await expect(requestGoogleIdToken()).resolves.toEqual({ ok: false, reason: 'cancelled' });
  });

  it('reports a native exception as a failure, never as an unhandled rejection', async () => {
    registerGoogleIdTokenProvider({
      requestIdToken: () => Promise.reject(new Error('native boom')),
    });

    await expect(requestGoogleIdToken()).resolves.toEqual({ ok: false, reason: 'failed' });
  });

  it('can be unregistered again', () => {
    registerGoogleIdTokenProvider({
      requestIdToken: () => Promise.resolve({ ok: true, idToken: 'x' }),
    });
    resetGoogleIdTokenProvider();

    expect(googleSignInAvailable()).toBe(false);
  });
});
