'use server';

import type { FormState } from '@nilzora/web-session';
import { refresh } from 'next/cache';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { returnPathFrom } from '@/lib/auth-routes';
import { mergeGuestCartOnSignIn } from '@/lib/saved-cart';
import { session } from '@/lib/session';

/*
 * Storefront form actions. Each one is a separate POST entry point, so the session
 * helpers check the Origin header and CSRF token before doing anything else. They
 * return only FormState fields: the verified user and every token stay on the server.
 * redirect() throws by design, so it is never called inside try/catch.
 */

function toFormState({ status, message, fieldErrors, values }: FormState): FormState {
  return { status, message, fieldErrors, values };
}

export async function signInAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const result = await session.signIn(formData);
  if (result.status !== 'success') return toFormState(result);
  // A cart filled before signing in follows the customer into the account.
  await mergeGuestCartOnSignIn();
  redirect(returnPathFrom(formData.get('next')));
}

export async function registerAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const result = await session.register(formData);
  if (result.status !== 'success') return toFormState(result);
  // The account exists but is unusable until its address is verified: continue with the
  // six-digit code rather than leaving the visitor signed out on the form.
  const email = result.values?.email ?? '';
  redirect(`/verify-otp?email=${encodeURIComponent(email)}` as Route);
}

export async function verifyOtpAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = await session.verifyOtp(formData);
  if (result.status !== 'success') return toFormState(result);
  // Verifying the address is what completes registration, so the visitor is signed in.
  await mergeGuestCartOnSignIn();
  redirect(returnPathFrom(formData.get('next')));
}

export async function resendOtpAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(await session.resendOtp(formData));
}

export async function forgotPasswordAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(await session.requestPasswordReset(formData));
}

export async function resetPasswordAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = await session.resetPassword(formData);
  if (result.status !== 'success') return toFormState(result);
  // Every session for the account was revoked: sign in again with the new password.
  redirect('/login?reset=1');
}

/**
 * Sends the browser to Google. The URL comes from the API, which signs the state, the
 * nonce and the PKCE challenge; the storefront never builds an authorization URL itself.
 */
export async function googleSignInAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = await session.googleStart(formData);
  if (!result.ok) return toFormState({ status: 'error', message: result.message });
  redirect(result.url as Route);
}

export async function confirmEmailAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = await session.confirmEmail(formData);
  if (result.status !== 'success') return toFormState(result);
  // Confirming signs nobody in: the owner continues with their password.
  redirect('/login?confirmed=1');
}

export async function signOutAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const result = await session.signOut(formData);
  if (result.status !== 'success') return toFormState(result);
  // A shared device should not show the next person what was in the cart.
  await session.cartCookie.clear();
  redirect('/login?signedOut=1');
}

export async function updateProfileAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = await session.updateProfile(formData);
  if (result.status === 'signed_out') redirect('/login?next=/account&session=expired');
  // Re-render the account page so its overview shows the saved details too.
  if (result.status === 'success') refresh();
  return toFormState(result);
}
