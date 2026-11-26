import type * as GoogleSigninTypes from '@react-native-google-signin/google-signin';

import {
  registerGoogleIdTokenProvider,
  type GoogleIdTokenProvider,
  type GoogleIdTokenResult,
} from './google-signin';

/*
 * The native half of Google Sign-In. It talks to Google through
 * @react-native-google-signin/google-signin (the legacy Android Google Sign-In SDK,
 * play-services-auth) and hands the resulting ID token to the seam in google-signin.ts.
 *
 * Kept apart from the seam so that google-signin.ts, and every screen behind it, stays
 * importable without a native module; this file is the only place that knows the library.
 *
 * Android needs a Google Cloud "Android" OAuth client for package com.nilzora.app with the
 * signing certificate's SHA-1, created in the same project as the *web* client id below.
 * That web client id is what makes Google address the ID token to this API, because it is
 * the audience the API verifies. No client secret is used or needed. Without
 * EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID nothing is configured and no provider is registered, so
 * the sign-in button stays hidden instead of failing at the account picker.
 */

type GoogleSigninModule = typeof GoogleSigninTypes;

/** A Google web client id looks like `1234567890-abc123.apps.googleusercontent.com`. */
const WEB_CLIENT_ID_PATTERN = /^\d{6,}-[a-z0-9]+\.apps\.googleusercontent\.com$/i;

/**
 * The configured web client id, or undefined when it is absent or malformed. Read in this
 * exact form because Expo only inlines `process.env.EXPO_PUBLIC_*` written out in full.
 */
export function googleWebClientId(): string | undefined {
  const value = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() ?? '';
  return WEB_CLIENT_ID_PATTERN.test(value) ? value : undefined;
}

/**
 * Loads the library, or nothing when this build has no such native module. The package
 * throws on import when the module is missing (Expo Go, or a build made before it was
 * added), and that must not take the app down at startup.
 */
function loadGoogleSignin(): GoogleSigninModule | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above; a static import would throw before the try block runs
    return require('@react-native-google-signin/google-signin') as GoogleSigninModule;
  } catch {
    return undefined;
  }
}

/** True when an error carries this Google Sign-In status code. */
function hasCode(code: string, error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === code;
}

/** The provider the seam calls: one account-picker round trip per request. */
export function createNativeGoogleProvider(
  googleSignin: GoogleSigninModule,
): GoogleIdTokenProvider {
  const { GoogleSignin, statusCodes } = googleSignin;

  return {
    async requestIdToken(): Promise<GoogleIdTokenResult> {
      try {
        // Google Sign-In needs Play Services; the picker would fail without it.
        const available = await GoogleSignin.hasPlayServices({
          showPlayServicesUpdateDialog: true,
        });
        if (!available) return { ok: false, reason: 'unavailable' };

        const response = await GoogleSignin.signIn();
        if (response.type !== 'success') return { ok: false, reason: 'cancelled' };

        const idToken: string | null = response.data.idToken;
        // The API verifies the token; without one there is nothing to verify.
        if (typeof idToken !== 'string' || idToken.length === 0) {
          return { ok: false, reason: 'failed' };
        }
        return { ok: true, idToken };
      } catch (error) {
        // A cancelled picker, or a second tap while one is open, is not an outage.
        if (hasCode(statusCodes.SIGN_IN_CANCELLED, error))
          return { ok: false, reason: 'cancelled' };
        if (hasCode(statusCodes.IN_PROGRESS, error)) return { ok: false, reason: 'cancelled' };
        if (hasCode(statusCodes.PLAY_SERVICES_NOT_AVAILABLE, error)) {
          return { ok: false, reason: 'unavailable' };
        }
        return { ok: false, reason: 'failed' };
      }
    },

    async signOut(): Promise<void> {
      // The call rejects when nothing is signed in; that is not an error for us.
      await GoogleSignin.signOut().catch(() => undefined);
    },
  };
}

/**
 * Configures the module and registers the provider. Returns false, and registers nothing,
 * when the web client id is missing or the native module is absent, which is what keeps
 * the button hidden in a build that cannot complete a sign-in.
 */
export function registerNativeGoogleSignIn(): boolean {
  const webClientId = googleWebClientId();
  if (!webClientId) return false;

  const googleSignin = loadGoogleSignin();
  if (!googleSignin) return false;

  googleSignin.GoogleSignin.configure({
    webClientId,
    // The app never calls Google APIs on the user's behalf, so no refresh token or
    // authorization code is requested; only the ID token is needed.
    offlineAccess: false,
  });
  registerGoogleIdTokenProvider(createNativeGoogleProvider(googleSignin));
  return true;
}
