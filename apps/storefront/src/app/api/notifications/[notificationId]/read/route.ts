import { uuidSchema } from '@nilzora/validation';
import { NextResponse } from 'next/server';
import { session } from '@/lib/session';

/*
 * POST /api/notifications/<id>/read
 *
 * Marks one of the signed-in customer's own notifications read. The id is checked as a uuid
 * here and ownership is checked by the API (`mark_my_notification_read` refuses a row that is
 * not the caller's with NZ496), so a hand-written id can never touch another account's row.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ notificationId: string }> },
): Promise<NextResponse> {
  const { notificationId } = await context.params;
  const parsed = uuidSchema.safeParse(notificationId);
  if (!parsed.success) {
    return NextResponse.redirect(new URL('/account/notifications', request.url), { status: 303 });
  }
  await session.read((api, accessToken) => api.markMyNotificationRead(accessToken, parsed.data));
  return NextResponse.redirect(new URL('/account/notifications', request.url), { status: 303 });
}
