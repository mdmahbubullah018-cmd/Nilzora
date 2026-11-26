'use server';

import {
  acceptInvitationRequestSchema,
  acceptStaffInvitationRequestSchema,
} from '@nilzora/contracts';
import { ApiError, FORM_EXPIRED, type FormState } from '@nilzora/web-session';
import { formText } from '@/components/admin-kit/act';
import { session } from './session';

/*
 * Accepting a staff invitation. The invitee has no session yet, so there is no CSRF
 * cookie tied to them: the post must come from this app's exact Origin, and the
 * one-time token from the invitation email is what authorises it. It sets a password
 * and signs nobody in; the invitee then signs in with it.
 */

const INVALID_LINK =
  'This invitation link is invalid, expired or already used. Ask the person who invited you to send a new invitation.';

const MESSAGES: Partial<Record<string, string>> = {
  invitation_invalid: INVALID_LINK,
  rate_limited: 'Too many attempts. Wait a few minutes, then try again.',
  auth_unavailable: 'Nilzora could not be reached. Please try again in a moment.',
};

export async function acceptInvitationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await session.isSameOrigin())) return FORM_EXPIRED;

  const password = formText(formData, 'password');
  const confirm = formText(formData, 'confirmPassword');
  const parsed = acceptInvitationRequestSchema.safeParse({
    tokenHash: formText(formData, 'tokenHash'),
    password,
  });
  if (!parsed.success) {
    const tokenIssue = parsed.error.issues.some((issue) => issue.path[0] === 'tokenHash');
    if (tokenIssue) return { status: 'error', message: INVALID_LINK };
    const passwordIssue = parsed.error.issues.find((issue) => issue.path[0] === 'password');
    return {
      status: 'error',
      message: 'Check the highlighted fields.',
      fieldErrors: { password: `${passwordIssue?.message ?? 'Choose another password'}.` },
    };
  }
  if (password !== confirm) {
    return {
      status: 'error',
      message: 'Check the highlighted fields.',
      fieldErrors: { confirmPassword: 'The passwords do not match.' },
    };
  }

  try {
    const api = await session.api();
    await api.acceptInvitation(parsed.data);
  } catch (error) {
    const code = error instanceof ApiError ? error.code : 'unexpected';
    if (code === 'weak_password' || code === 'validation_failed') {
      return {
        status: 'error',
        message: 'Check the highlighted fields.',
        fieldErrors: { password: 'Choose a stronger password.' },
      };
    }
    const message = MESSAGES[code];
    if (!message || code === 'auth_unavailable') {
      console.error('[nilzora] invitation acceptance failed', {
        code,
        status: error instanceof ApiError ? error.status : undefined,
        requestId: error instanceof ApiError ? error.requestId : undefined,
      });
    }
    return {
      status: 'error',
      message: message ?? 'Nilzora could not be reached. Please try again in a moment.',
    };
  }
  return { status: 'success', message: 'Your password is set. Sign in to start working.' };
}

/**
 * Accepting an invitation from the new link. The token in the hidden field is the whole
 * authorisation: the role is the one stored with the invitation, never anything this form sends.
 * A new address chooses a password; an address that already has an account proves itself with
 * that account's own password. Nobody is signed in: the invitee then signs in.
 */
export async function acceptStaffInvitationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await session.isSameOrigin())) return FORM_EXPIRED;

  const token = formText(formData, 'token');
  const password = formText(formData, 'password');
  const existing = formText(formData, 'accountExists') === 'true';
  const fullName = formText(formData, 'fullName').trim();
  const parsed = acceptStaffInvitationRequestSchema.safeParse({
    token,
    password,
    ...(fullName === '' || existing ? {} : { fullName }),
  });
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.path[0] === 'token')) {
      return { status: 'error', message: INVALID_LINK };
    }
    return {
      status: 'error',
      message: 'Check the highlighted fields.',
      fieldErrors: { password: 'Enter your password.' },
    };
  }
  if (!existing && password !== formText(formData, 'confirmPassword')) {
    return {
      status: 'error',
      message: 'Check the highlighted fields.',
      fieldErrors: { confirmPassword: 'The passwords do not match.' },
    };
  }

  try {
    const api = await session.api();
    await api.acceptStaffInvitation(parsed.data);
  } catch (error) {
    const code = error instanceof ApiError ? error.code : 'unexpected';
    if (code === 'invalid_credentials') {
      return {
        status: 'error',
        message: 'Check the highlighted fields.',
        fieldErrors: {
          password: 'That is not the password of the existing account for this address.',
        },
      };
    }
    if (code === 'bad_request' || code === 'validation_failed') {
      return {
        status: 'error',
        message: 'Check the highlighted fields.',
        fieldErrors: { password: 'Use at least 8 characters, with letters and numbers.' },
      };
    }
    if (code === 'invitation_invalid') {
      return {
        status: 'error',
        message:
          error instanceof ApiError && error.status === 409
            ? 'This account already has a role in the workspace, so this invitation cannot change it.'
            : INVALID_LINK,
      };
    }
    console.error('[nilzora] staff invitation acceptance failed', {
      code,
      status: error instanceof ApiError ? error.status : undefined,
      requestId: error instanceof ApiError ? error.requestId : undefined,
    });
    return {
      status: 'error',
      message: MESSAGES[code] ?? 'Nilzora could not be reached. Please try again in a moment.',
    };
  }
  return {
    status: 'success',
    message: existing
      ? 'Your invitation is accepted. Sign in with your existing password to start working.'
      : 'Your account is ready. Sign in with the password you just chose to start working.',
  };
}
