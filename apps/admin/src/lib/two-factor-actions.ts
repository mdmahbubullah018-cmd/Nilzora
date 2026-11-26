'use server';

import type { ApiErrorCode } from '@nilzora/contracts';
import { safeRedirectPath } from '@nilzora/web-session';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { adminAct, formText, invalid, type ActionState } from '@/components/admin-kit/act';
import { WORKSPACE_PATHS } from './workspace-access';

/*
 * Two-factor authentication for the signed-in owner. No form names an account: the API acts on
 * the session's own account only, and it decides everything (codes, lockout, replay). The secret
 * and the recovery codes pass through these actions once, to the owner's own browser, and are
 * never stored or logged here.
 */

const MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  invalid_two_factor_code:
    'That code is not valid. Check the time on your phone and try the newest code.',
  two_factor_locked: 'Too many wrong codes. For your safety, wait 15 minutes and try again.',
  reauthentication_failed: 'That password is not correct.',
  two_factor_already_active: 'Two-factor authentication is already on for this account.',
  two_factor_not_enrolled: 'Set up two-factor authentication first.',
  two_factor_unavailable:
    'Two-factor authentication is not available right now. Try again shortly.',
  validation_failed: 'Check the code and try again.',
  rate_limited: 'Too many attempts. Wait a few minutes, then try again.',
};

const TWO_FACTOR_PATH = '/two-factor';

/** Where a verified owner goes next: only a path inside the workspaces survives. */
function nextPath(formData: FormData): Route {
  return (safeRedirectPath(formData.get('next'), WORKSPACE_PATHS, '') || '/') as Route;
}

const options = (label: string) => ({
  returnTo: TWO_FACTOR_PATH as Route,
  label,
  messages: MESSAGES,
});

/** Step 1: the password, then a new secret shown as a QR code (and as text for manual entry). */
export async function enrollTwoFactorAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const password = formText(formData, 'password');
  if (!password)
    return invalid('Enter your password to continue.', { password: 'Enter your password.' });
  const result = await adminAct(
    formData,
    (api, token) => api.twoFactorEnroll(token, password),
    options('2FA enrollment'),
  );
  if (!result.ok) return result.state;
  // Rendered here, on the server: the browser receives an image, and no third party sees the URI.
  const svg = await QRCode.toString(result.value.otpauthUri, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
  });
  return {
    status: 'success',
    values: {
      qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
      secret: result.value.secret,
    },
  };
}

/** Step 2: the first code turns 2FA on; the ten recovery codes come back once. */
export async function activateTwoFactorAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const code = formText(formData, 'code').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code))
    return invalid('Enter the 6-digit code.', { code: 'Enter the 6-digit code.' });
  const result = await adminAct(
    formData,
    (api, token) => api.twoFactorActivate(token, code),
    options('2FA activation'),
  );
  if (!result.ok) return result.state;
  return { status: 'success', values: { recoveryCodes: result.value.recoveryCodes.join(' ') } };
}

/** Every sign-in after that: a code passes 2FA for this session. */
export async function verifyTwoFactorAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const code = formText(formData, 'code').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code))
    return invalid('Enter the 6-digit code.', { code: 'Enter the 6-digit code.' });
  const result = await adminAct(
    formData,
    (api, token) => api.twoFactorVerify(token, code),
    options('2FA verification'),
  );
  if (!result.ok) return result.state;
  redirect(nextPath(formData));
}

/** Without the phone: one recovery code passes 2FA for this session, once. */
export async function recoverTwoFactorAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const recoveryCode = formText(formData, 'recoveryCode').trim();
  if (!/^[A-Za-z0-9]{4}[-\s]?[A-Za-z0-9]{4}[-\s]?[A-Za-z0-9]{4}$/.test(recoveryCode)) {
    return invalid('Enter a recovery code like ABCD-EFGH-JKMN.', {
      recoveryCode: 'Enter a recovery code.',
    });
  }
  const result = await adminAct(
    formData,
    (api, token) => api.twoFactorRecover(token, recoveryCode),
    {
      ...options('2FA recovery'),
      messages: {
        ...MESSAGES,
        invalid_two_factor_code: 'That recovery code is not valid, or it has already been used.',
      },
    },
  );
  if (!result.ok) return result.state;
  redirect(nextPath(formData));
}

/** From the profile: ten new recovery codes (a current code is required; old ones stop working). */
export async function replaceRecoveryCodesAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const code = formText(formData, 'code').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code))
    return invalid('Enter the 6-digit code.', { code: 'Enter the 6-digit code.' });
  const result = await adminAct(
    formData,
    (api, token) => api.twoFactorReplaceRecoveryCodes(token, code),
    { ...options('2FA recovery codes'), returnTo: '/admin/profile' },
  );
  if (!result.ok) return result.state;
  return { status: 'success', values: { recoveryCodes: result.value.recoveryCodes.join(' ') } };
}

/**
 * From the profile: removes 2FA (a new phone). The password and a current or recovery code are
 * required; the owner is sent to set it up again at once, since no privileged page opens until then.
 */
export async function resetTwoFactorAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const password = formText(formData, 'password');
  const code = formText(formData, 'code').trim();
  if (!password) return invalid('Enter your password.', { password: 'Enter your password.' });
  if (!code) return invalid('Enter a current code or a recovery code.', { code: 'Enter a code.' });
  const result = await adminAct(
    formData,
    (api, token) => api.twoFactorReset(token, { password, code }),
    { ...options('2FA reset'), returnTo: '/admin/profile' },
  );
  if (!result.ok) return result.state;
  redirect(TWO_FACTOR_PATH as Route);
}
