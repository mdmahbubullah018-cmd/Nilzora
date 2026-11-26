import { confirmEmailRequestSchema } from '@nilzora/contracts';

/** A page's resolved `searchParams`. */
export type SearchParams = Partial<Record<string, string | string[]>>;

/** A query parameter's value when it appears exactly once; repeated or missing → undefined. */
export function singleParam(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * A query parameter that may legitimately appear more than once (`?size=m&size=l`). A single
 * value still arrives as one entry, so callers always read a list.
 */
export function multiParam(params: SearchParams, name: string): string | string[] | undefined {
  const value = params[name];
  if (typeof value === 'string' || Array.isArray(value)) return value;
  return undefined;
}

export interface LoginNotice {
  tone: 'info' | 'warning';
  message: string;
}

/**
 * Fixed messages for the sign-in page, chosen by known flags. Query text is never
 * displayed, so a crafted link cannot put its own words on a Nilzora page.
 */
export function loginNoticeFrom(params: SearchParams): LoginNotice | undefined {
  if (singleParam(params, 'session') === 'expired') {
    return { tone: 'warning', message: 'Your session ended. Sign in again.' };
  }
  if (singleParam(params, 'signedOut') === '1') {
    return { tone: 'info', message: 'You have signed out.' };
  }
  if (singleParam(params, 'confirmed') === '1') {
    return { tone: 'info', message: 'Your email address is confirmed. Sign in to continue.' };
  }
  if (singleParam(params, 'reset') === '1') {
    return { tone: 'info', message: 'Your password has been changed. Sign in with the new one.' };
  }
  const google = singleParam(params, 'google');
  if (google === 'denied') {
    return {
      tone: 'warning',
      message: 'Google sign-in was cancelled. Try again or use your password.',
    };
  }
  if (google === 'invalid') {
    return {
      tone: 'warning',
      message: 'That Google sign-in could not be verified. Please try again.',
    };
  }
  if (google === 'suspended') {
    return {
      tone: 'warning',
      message: 'This account is suspended. Contact Nilzora support for help.',
    };
  }
  if (google === 'blocked') {
    return { tone: 'warning', message: 'This account cannot sign in here.' };
  }
  if (google === 'unavailable') {
    return {
      tone: 'warning',
      message: 'Google sign-in is unavailable right now. Try again shortly.',
    };
  }
  return undefined;
}

/** The confirmation link's token hash, only when it has the shape the API accepts. */
export function tokenHashFrom(params: SearchParams): string | undefined {
  const parsed = confirmEmailRequestSchema.shape.tokenHash.safeParse(
    singleParam(params, 'token_hash'),
  );
  return parsed.success ? parsed.data : undefined;
}

/** A prefill address from the URL, only when it looks like an email address. */
export function emailFrom(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const candidate = value.trim().toLowerCase();
  return candidate.length >= 3 &&
    candidate.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)
    ? candidate
    : undefined;
}
