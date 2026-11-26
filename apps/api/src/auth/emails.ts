/*
 * Nilzora account emails
 * ----------------------
 * One branded layout and one function per message the API really sends:
 *   - authCodeEmail: the six-digit code for verifying an address (sign-up) or resetting a password;
 *   - accountEmail: the welcome email (sent once, after the account genuinely exists) and the
 *     "your password was changed" notice;
 *   - accountExistsEmail: told to the owner of an address when someone tries to sign up with it.
 *
 * Rules this file follows, because a transactional email is a security message first:
 *  - the code subjects, the code and the expiry sentence of the text part are unchanged, so the
 *    flows and anything that reads them keep working;
 *  - the expiry is the real one the database issues (`interval '10 minutes'`);
 *  - no address, phone number, policy or business claim is written here: nothing can go stale
 *    or be invented. Cash on Delivery is mentioned because it is the payment the shop offers;
 *  - the logo is only rendered when `EMAIL_LOGO_URL` is configured (the official artwork, hosted
 *    publicly). Without it the wordmark is text in the brand colours, never a redrawn logo;
 *  - a button is only rendered when `EMAIL_SITE_URL` is configured, never a guessed link;
 *  - the layout is the shared email design family (../email/design.ts): table-based, inline
 *    styles, a ≤600px column on a white page, and a plain-text part with every message.
 */

import {
  BRAND,
  FONT,
  MONO,
  button,
  escapeHtml,
  greeting,
  layout,
  notice,
  paragraph,
  safeUrl,
  type EmailBranding,
} from '../email/design';

export { escapeHtml };

/** The lifetime the database gives an email code (`interval '10 minutes'`). */
export const AUTH_CODE_EXPIRY_MINUTES = 10;

export type AuthEmailKind = 'verify_email' | 'reset_password';
export type AccountEmailKind = 'welcome' | 'password_changed';

export interface AuthEmail {
  subject: string;
  text: string;
  html: string;
}

export type AuthEmailContext = EmailBranding;

export interface AccountEmailContext extends AuthEmailContext {
  /** The customer's name, when the account has one. */
  name?: string | null | undefined;
}

const CODE_COPY: Record<
  AuthEmailKind,
  { subject: string; heading: string; lead: string; preheader: string }
> = {
  verify_email: {
    subject: 'Your Nilzora verification code',
    heading: 'Verify your email address',
    lead: 'Use this code to verify your email address:',
    preheader: 'Your six-digit code to finish creating your Nilzora account.',
  },
  reset_password: {
    subject: 'Reset your Nilzora password',
    heading: 'Choose a new password',
    lead: 'Use this code to choose a new password:',
    preheader: 'Your six-digit code to choose a new Nilzora password.',
  },
};

/** The email for one code flow. `code` is the code the database issued. */
export function authCodeEmail(
  kind: AuthEmailKind,
  code: string,
  context: AuthEmailContext = {},
): AuthEmail {
  const copy = CODE_COPY[kind];
  // Unchanged from the message the API always sent (clients and tests read it).
  const text = `${copy.lead}\n\n${code}\n\nThis code expires in ${String(AUTH_CODE_EXPIRY_MINUTES)} minutes. If you did not ask for it, ignore this message.`;

  const digits = escapeHtml(code);
  const body = `${paragraph(escapeHtml(copy.lead), '0 0 18px 0')}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px 0;">
<tr><td align="center" style="background:${BRAND.soft};border-radius:12px;padding:18px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr><td style="font-family:${MONO};font-size:34px;line-height:40px;letter-spacing:10px;font-weight:700;color:${BRAND.navy};text-align:center;padding-left:10px;">${digits}</td></tr>
</table>
</td></tr>
</table>
<p style="margin:0 0 20px 0;font-family:${FONT};font-size:13px;line-height:20px;color:${BRAND.small};text-align:center;">This code expires in ${String(AUTH_CODE_EXPIRY_MINUTES)} minutes and works only once.</p>
${notice(
  'Keep this code to yourself',
  'Never share this code with anyone. Nilzora will never ask you for it by phone, chat or email. If you did not ask for it, ignore this message — nothing changes without the code.',
)}`;

  return {
    subject: copy.subject,
    text,
    html: layout(context, {
      heading: copy.heading,
      preheader: copy.preheader,
      body,
      reason:
        kind === 'verify_email'
          ? 'You received this because this address was used to create a Nilzora account.'
          : 'You received this because a password reset was requested for this address.',
    }),
  };
}

/** The welcome email or the password-changed notice for an account. */
export function accountEmail(kind: AccountEmailKind, context: AccountEmailContext = {}): AuthEmail {
  const hello = greeting(context.name);
  if (kind === 'welcome') {
    const shop = safeUrl(context.siteUrl);
    const text = [
      hello,
      '',
      'Welcome to Nilzora. Your account is ready.',
      '',
      'You can now save addresses, follow your orders and keep a wishlist. Orders are paid in cash when they are delivered.',
      ...(shop ? ['', `Start shopping: ${shop}`] : []),
      '',
      'If you did not create this account, reset your password or contact Nilzora support.',
    ].join('\n');
    // Deliberately short: a greeting, one line, one action.
    const body = `${paragraph(escapeHtml(hello))}
${paragraph('Welcome to Nilzora. Your account is ready — your orders, addresses and wishlist now live in one place, and orders are paid in cash on delivery.', '0 0 20px 0')}
${button('Start shopping', shop)}
<p style="margin:0;font-family:${FONT};font-size:13px;line-height:20px;color:${BRAND.small};">Did not create this account? Reset its password from the sign-in page.</p>`;
    return {
      subject: 'Welcome to Nilzora',
      text,
      html: layout(context, {
        heading: 'Your account is ready',
        preheader: 'Welcome to Nilzora — your account is ready.',
        body,
        reason: 'You received this because a Nilzora account was created with this address.',
      }),
    };
  }

  const signIn = safeUrl(context.siteUrl, 'login');
  const text = [
    hello,
    '',
    'The password for your Nilzora account was just changed, and every device that was signed in has been signed out.',
    '',
    'If you made this change, there is nothing else to do.',
    'If you did not, reset your password straight away and contact Nilzora support.',
    ...(signIn ? ['', `Sign in: ${signIn}`] : []),
  ].join('\n');
  const body = `${paragraph(escapeHtml(hello))}
${paragraph('The password for your Nilzora account was just changed. For your safety, every device that was signed in has been signed out.')}
${paragraph('If you made this change, there is nothing else to do.', '0 0 18px 0')}
${button('Sign in', signIn)}
${notice(
  'Did not change it?',
  'Reset your password straight away from the sign-in page, then contact Nilzora support.',
)}`;
  return {
    subject: 'Your Nilzora password was changed',
    text,
    html: layout(context, {
      heading: 'Your password was changed',
      preheader: 'The password for your Nilzora account was changed.',
      body,
      reason:
        'You received this because the password of the Nilzora account for this address changed.',
    }),
  };
}

/**
 * Sent to the owner of an address when someone tries to sign up with it. It gives no code
 * and changes nothing; it lets the owner know, and points them to their way back in.
 */
export function accountExistsEmail(context: AuthEmailContext = {}): AuthEmail {
  const signIn = safeUrl(context.siteUrl, 'login');
  const text = [
    'Someone just tried to create a Nilzora account with this email address, but it already has an account.',
    '',
    'If it was you, sign in instead. If you forgot your password, choose "Forgot password" on the sign-in page.',
    ...(signIn ? ['', `Sign in: ${signIn}`] : []),
    '',
    'If it was not you, you can ignore this message: nothing about your account has changed.',
  ].join('\n');
  const body = `${paragraph('Someone just tried to create a Nilzora account with this email address, but it already has an account.')}
${paragraph('If it was you, sign in instead. If you forgot your password, choose <strong>Forgot password</strong> on the sign-in page.', '0 0 18px 0')}
${button('Sign in', signIn)}
${notice(
  'Was not you?',
  'You can ignore this message. Nothing about your account has changed, and no one can create a second account with your address.',
  BRAND.primary,
)}`;
  return {
    subject: 'You already have a Nilzora account',
    text,
    html: layout(context, {
      heading: 'You already have an account',
      preheader: 'Someone tried to sign up with your email address.',
      body,
      reason: 'You received this because this address was used on the Nilzora sign-up form.',
    }),
  };
}
