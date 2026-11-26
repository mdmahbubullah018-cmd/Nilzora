import { uuidSchema } from '@nilzora/validation';
import { NextResponse } from 'next/server';
import { support } from '@/lib/support';

/*
 * /api/support/media/[attachmentId] — the bytes of one private chat attachment
 * ---------------------------------------------------------------------------
 * Customer support media is private. The browser never receives a bucket address or an object
 * key: it asks this same-origin route, which forwards the request to the API using this
 * browser's own session cookies. The API decides whether the signed-in account may read the
 * conversation the file belongs to, so a customer can only ever fetch their own conversation's
 * media, and staff only threads their permissions allow.
 *
 * This is deliberately not a general proxy: the path is one UUID, the upstream URL is fixed,
 * and there is no way to name another host, bucket or object.
 *
 * The answer is marked `private, no-store`: the same URL returns different bytes (or nothing)
 * to different accounts, so it must never be stored by a shared cache.
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
      // The bytes are handed over whole, so there is nothing to range over.
      'Accept-Ranges': 'none',
    },
  });
}
