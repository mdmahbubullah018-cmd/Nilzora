import 'server-only';
import { ApiError, type SessionCall } from '@nilzora/web-session';
import { session } from '@/lib/session';

/** What an account or checkout page can show for one authenticated read. */
export type AccountRead<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'signed_out' }
  | { kind: 'suspended' }
  /** 404: missing, or another customer's (the API answers both the same way). */
  | { kind: 'not_found' }
  /** The API could not be reached or failed; the visitor is neither confirmed nor refused. */
  | { kind: 'unavailable' };

/**
 * session.read() for the account pages, with the errors it leaves to its caller mapped
 * once: a suspended account, a 404, and any other refusal (logged, then treated as
 * unavailable, so a page never shows an API message). Only use it on routes under
 * the proxy matcher, which refreshes the session before the page renders.
 */
export async function readAccount<T>(call: SessionCall<T>): Promise<AccountRead<T>> {
  try {
    return await session.read(call);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.code === 'account_suspended') return { kind: 'suspended' };
    if (error.status === 404) return { kind: 'not_found' };
    console.error('[nilzora] account read failed', {
      code: error.code,
      status: error.status,
      requestId: error.requestId,
    });
    return { kind: 'unavailable' };
  }
}
