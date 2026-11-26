'use client';

/*
 * The Communication Center's browser-side calls
 * --------------------------------------------
 * Every panel under `/admin/communication` talks to this app's own `/api/support` route and
 * nothing else. The route runs on the server with the operator's session cookies and calls
 * the API, so the browser never holds a token and never names an account.
 *
 * One helper for reads and one for writes keeps the panels free of fetch details and means
 * an error is always turned into the same shape: the API's fixed message when it sent one,
 * a plain fallback when the network failed.
 */

export type ApiResult<T> = { ok: true; value: T } | { ok: false; status: number; message: string };

const UNREACHABLE = 'Nilzora could not be reached. Try again in a moment.';

function failure(status: number, payload: unknown): ApiResult<never> {
  const message =
    (payload as { error?: { message?: string } } | null)?.error?.message ?? UNREACHABLE;
  return { ok: false, status, message };
}

export async function apiGet<T>(query: string): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`/api/support${query}`, { cache: 'no-store' });
    // 204 has no body, which is a successful answer for the operations that use it.
    const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) return failure(response.status, payload);
    return { ok: true, value: payload as T };
  } catch {
    return { ok: false, status: 0, message: UNREACHABLE };
  }
}

export async function apiPost<T>(body: unknown): Promise<ApiResult<T>> {
  try {
    const response = await fetch('/api/support', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) return failure(response.status, payload);
    return { ok: true, value: payload as T };
  } catch {
    return { ok: false, status: 0, message: UNREACHABLE };
  }
}

/** A date range for the analytics screen, defaulting to the last thirty days. */
export function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** A duration in seconds as something a person reads, for the response-time figures. */
export function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${String(Math.round(seconds))}s`;
  if (seconds < 3600) return `${String(Math.round(seconds / 60))}m`;
  if (seconds < 86_400) return `${String(Math.round(seconds / 3600))}h`;
  return `${String(Math.round(seconds / 86_400))}d`;
}
