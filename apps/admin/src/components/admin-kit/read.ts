import 'server-only';
import { ApiError, type SessionCall } from '@nilzora/web-session';
import { session } from '@/lib/session';
import type { ReadFailure } from './states';

/**
 * What an admin page read produced, or why there is nothing to show. Pages render a
 * state for every kind (see states.tsx) and never fall back to made-up data:
 *
 * - `signed_out`: the session lapsed mid-page; send the visitor to sign in.
 * - `unavailable`: the API could not be reached or failed (UnavailableState).
 * - `rate_limited`: the API refused too many requests (429); waiting fixes it.
 * - `forbidden`: the API refused this account (403; ForbiddenState).
 * - `not_found`: no such record, or one this account may not see (404; NotFoundState).
 * - `invalid`: the API refused the request's input (400/422), e.g. a hand-edited filter.
 */
export type AdminRead<T> =
  { kind: 'ok'; value: T } | { kind: 'signed_out' } | { kind: ReadFailure };

/**
 * An authenticated API read for a Server Component, with every refusal mapped to a
 * renderable outcome. Errors that mean a bug (anything else) are rethrown.
 *
 *   const result = await adminRead((api, token) => api.adminListOrders(token, query));
 *   if (result.kind === 'signed_out') redirect(signInPath('/admin/orders'));
 *   if (result.kind !== 'ok') return <ReadState failure={result.kind} retryHref="/admin/orders" />;
 */
export async function adminRead<T>(call: SessionCall<T>): Promise<AdminRead<T>> {
  try {
    return await session.read(call);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 429) return { kind: 'rate_limited' };
      if (error.status === 403) return { kind: 'forbidden' };
      if (error.status === 404) return { kind: 'not_found' };
      if (error.status === 400 || error.status === 422 || error.code === 'invalid_request') {
        return { kind: 'invalid' };
      }
    }
    throw error;
  }
}
