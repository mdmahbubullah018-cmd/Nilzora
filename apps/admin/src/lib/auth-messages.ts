/**
 * Messages the sign-in form recognises in the server's answer. A copy, so the client bundle
 * never imports @nilzora/web-session (server code); auth-messages.test.ts keeps it in step.
 */
export const SIGN_IN_RATE_LIMITED = 'Too many attempts. Wait a few minutes, then try again.';
