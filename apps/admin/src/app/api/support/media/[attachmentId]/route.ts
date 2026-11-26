import { uuidSchema } from '@nilzora/validation';
import { NextResponse } from 'next/server';
import { support } from '@/lib/support';

/*
 * /api/support/media/[attachmentId] — the bytes of one private chat attachment
 * ---------------------------------------------------------------------------
 * The staff workspace's counterpart of the storefront route: the browser asks this same-origin
 * path with its staff session cookies, and the API decides whether this account may read the
 * conversation. A moderator or agent therefore sees exactly the media their permissions allow,
 * and an attachment from a thread they cannot open is refused by the database, not by the UI.
 *
 * The path is one UUID and the upstream address is fixed, so this cannot be used to fetch an
 * arbitrary object. The answer is `private, no-store` because its content depends on the caller.
 */

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function GET(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
): Promise<NextResponse> {
  const { attachmentId } = await context.params;
  const parsed = uuidSchema.safeParse(attachmentId);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'That file is not available' } },
      { status: 404, headers: NO_STORE },
    );
  }

  const variant = new URL(request.url).searchParams.get('variant') === 'thumb' ? 'thumb' : 'full';
  const result = await support.media(parsed.data, variant);
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.code, message: result.message } },
      { status: result.status, headers: NO_STORE },
    );
  }

  return new NextResponse(Buffer.from(result.value.bytes), {
    status: 200,
    headers: {
      ...NO_STORE,
      'Content-Type': result.value.contentType,
      'Content-Length': String(result.value.bytes.byteLength),
      'Content-Disposition': `inline; filename="${result.value.fileName.replace(/["\\\r\n]/g, '_')}"`,
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'none',
    },
  });
}
