'use server';

import { safeRedirectPath, type FormState } from '@nilzora/web-session';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { session } from './session';
import { landingPath, WORKSPACE_PATHS, WORKSPACE_PERMISSION } from './workspace-access';

/*
 * Server Actions are public POST endpoints. The session helpers check the Origin and
 * CSRF token before anything else, and only fixed messages return to the browser.
 */

/**
 * Signs in staff and moderators. An account without either workspace permission (such
 * as a customer) is signed straight back out by the session helper, and no cookie is
 * left behind.
 */
export async function signInAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const result = await session.signIn(formData, {
    requireAnyPermission: [WORKSPACE_PERMISSION.admin, WORKSPACE_PERMISSION.moderator],
    deniedMessage: 'This account does not have access to the Nilzora workspaces.',
  });
  const { user, ...state } = result;
  if (state.status !== 'success' || !user) return state;

  // `next` is untrusted: only a path inside the workspaces survives, and only when this
  // account may enter that workspace; otherwise it lands in its default workspace.
  const requested = safeRedirectPath(formData.get('next'), WORKSPACE_PATHS, '');
  redirect((landingPath(user, requested) ?? '/') as Route);
}

export async function signOutAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const result = await session.signOut(formData);
  if (result.status !== 'success') return result;
  redirect('/login?signedOut=1');
}

/**
 * Emails a password-reset code. The answer is identical whether or not the address has
 * an account, so this form cannot be used to discover staff addresses.
 */
export async function forgotPasswordAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return session.requestPasswordReset(formData);
}

/**
 * Sets a new password from a reset code, then sends the visitor back to sign in: the API
 * ends every session for the account, so this browser cannot stay signed in.
 */
export async function resetPasswordAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = await session.resetPassword(formData);
  if (result.status !== 'success') return result;
  redirect('/login?reset=1');
}
