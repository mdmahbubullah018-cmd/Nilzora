import { scanResolveRequestSchema } from '@nilzora/contracts';
import { ApiError } from '@nilzora/web-session';
import { NextResponse } from 'next/server';
import { session } from '@/lib/session';

/*
 * POST /api/scan/resolve
 * ----------------------
 * A decoded QR code or barcode, resolved by the API to a product (by SKU or slug) or to a
 * search phrase. The camera decodes in the browser; the decision about what the text means
 * belongs to the server.
 */

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function POST(request: Request) {
  const body = scanResolveRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: NO_STORE });
  }
  try {
    const answer = await (await session.api()).resolveScan(body.data);
    return NextResponse.json(answer, { headers: NO_STORE });
  } catch (error) {
    const status = error instanceof ApiError && error.status !== 0 ? error.status : 503;
    return NextResponse.json({ error: 'unavailable' }, { status, headers: NO_STORE });
  }
}
