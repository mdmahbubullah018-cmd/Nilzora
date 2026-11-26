import { NextResponse } from 'next/server';
import { session } from '@/lib/session';

/*
 * POST /api/notifications/read-all
 *
 * The storefront's own endpoint behind the "Mark all read" button on the notifications page.
 * It runs on the server with the session cookies, so the browser never names an account and
 * never sees a token; the API decides ownership from the session itself. The answer is a
 * redirect back to the page, because the caller is a plain HTML form.
 */
export async function POST(request: Request): Promise<NextResponse> {
  await session.read((api, accessToken) => api.markAllMyNotificationsRead(accessToken));
  return NextResponse.redirect(new URL('/account/notifications', request.url), { status: 303 });
}
