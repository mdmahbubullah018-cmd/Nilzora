/*
 * Google Sign-In for the Android app
 * ----------------------------------
 * The app asks Google Identity Services for an ID token and hands it to the API, which
 * verifies it (signature, issuer, audience, expiry, verified email) and answers a Nilzora
 * session. No client secret is used and nothing Google says is trusted without that check.
 *
 * The native module is not a dependency of this workspace, so it is registered here from
 * one place instead of being imported by screens: until `registerGoogleIdTokenProvider`
 * runs, sign-in reports `unavailable` and the button explains itself rather than failing
 * inside a native module that is not part of the build.
 */

export type GoogleIdTokenFailure = 'cancelled' | 'unavailable' | 'failed';

export type GoogleIdTokenResult =
  { ok: true; idToken: string } | { ok: false; reason: GoogleIdTokenFailure };

/** The native half: shows Google's account picker and returns its ID token. */
export interface GoogleIdTokenProvider {
  requestIdToken(): Promise<GoogleIdTokenResult>;
  /**
   * Forgets the Google session on the device, so the next sign-in asks which account to
   * use instead of silently reusing the last one. Best effort: failure changes nothing.
   */
  signOut?(): Promise<void>;
}

let provider: GoogleIdTokenProvider | undefined;

/** Wires the native Google module in. Called once from the app's provider tree. */
export function registerGoogleIdTokenProvider(next: GoogleIdTokenProvider | undefined): void {
  provider = next;
}

/** True when this build can actually show Google's account picker. */
export function googleSignInAvailable(): boolean {
  return provider !== undefined;
}

/**
 * Requests an ID token. A provider that throws is reported as `failed`, so a native
 * exception can never reach a screen as an unhandled rejection.
 */
export async function requestGoogleIdToken(): Promise<GoogleIdTokenResult> {
  if (!provider) return { ok: false, reason: 'unavailable' };
  try {
    return await provider.requestIdToken();
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Forgets the provider. Tests only. */
export function resetGoogleIdTokenProvider(): void {
  provider = undefined;
}

/**
 * Signs out of Google on this device, so the next sign-in shows the account picker again.
 * Never throws: signing out of Nilzora must not depend on the Google module.
 */
export async function googleSignOut(): Promise<void> {
  try {
    await provider?.signOut?.();
  } catch {
    // Best effort: the Nilzora session is already gone, which is what matters.
  }
}
