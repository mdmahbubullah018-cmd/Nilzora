import { NextResponse, type NextRequest } from 'next/server';
import { returnPathFrom } from '@/lib/auth-routes';
import { session } from '@/lib/session';

/**
 * Google's redirect target for the storefront.
 *
 * The code and state arrive in the query string and are relayed to the API from this
 * server only: they never reach browser script, and the tokens the API returns become
 * this app's HttpOnly session cookies. The API validates the state signature, its expiry,
 * the nonce and the PKCE verifier, so a forged, replayed or foreign callback is refused
 * before any session is created.
 *
 * Every failure lands on the sign-in page with a fixed flag; no API text is ever shown.
 */
const FAILURE_PATHS: Record<string, string> = {
  denied: '/login?google=denied',
  invalid: '/login?google=invalid',
  unavailable: '/login?google=unavailable',
  suspended: '/login?google=suspended',
  blocked: '/login?google=blocked',
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;

  const outcome = await session.completeGoogleSignIn({
    code: params.get('code') ?? undefined,
    state: params.get('state') ?? undefined,
    // Google sends the issuer (RFC 9207) and the API checks it: forward it unchanged.
    iss: params.get('iss') ?? undefined,
    error: params.get('error') ?? undefined,
  });

  const target = outcome.ok
    ? returnPathFrom(outcome.returnTo)
    : (FAILURE_PATHS[outcome.reason] ?? '/login?google=invalid');
  const response = NextResponse.redirect(new URL(target, request.url));
  // The callback URL carries a one-time code: never cache or index it.
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
