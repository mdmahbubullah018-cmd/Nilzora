import { ApiError } from '@nilzora/web-session';
import { NextResponse } from 'next/server';

/**
 * The API's refusals, relayed to the browser with the status and code it already understands.
 * A route handler never invents a status: 429 stays 429 (so the client can count down), 400
 * stays 400 (so it can explain the photo), and anything unexpected is "unavailable".
 */
export const VISUAL_SEARCH_NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export function visualSearchFailure(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    const status = error.status === 0 ? 503 : error.status;
    return NextResponse.json(
      { error: error.code, message: error.message, details: error.details ?? null },
      { status, headers: VISUAL_SEARCH_NO_STORE },
    );
  }
  return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: VISUAL_SEARCH_NO_STORE });
}
