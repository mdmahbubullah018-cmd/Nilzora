import { imageSearchClickRequestSchema } from '@nilzora/contracts';
import { NextResponse } from 'next/server';
import { session } from '@/lib/session';

/*
 * POST /api/visual-search/click
 * -----------------------------
 * Which image-search result a shopper opened. Best effort by design: a shopper's click must
 * never fail on a log write, so an API refusal is answered 202 rather than surfaced.
 */

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function POST(request: Request) {
  const body = imageSearchClickRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ recorded: false }, { status: 202, headers: NO_STORE });
  }
  try {
    const answer = await (await session.api()).recordImageSearchClick(body.data);
    return NextResponse.json(answer, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ recorded: false }, { status: 202, headers: NO_STORE });
  }
}
