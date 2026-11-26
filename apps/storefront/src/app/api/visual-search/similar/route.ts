import { imageSearchQuerySchema, imageSearchSimilarRequestSchema } from '@nilzora/contracts';
import { NextResponse } from 'next/server';
import { session } from '@/lib/session';
import { visualSearchFailure } from '@/lib/visual-search-relay';

/*
 * POST /api/visual-search/similar
 * -------------------------------
 * "Find similar" on a product picture: no upload, because the store already has the picture
 * and its vector. The API searches with the stored embedding.
 */

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function POST(request: Request) {
  const body = imageSearchSimilarRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: NO_STORE });
  }
  const url = new URL(request.url);
  const query = imageSearchQuerySchema.safeParse({
    sort: url.searchParams.get('sort') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    client: 'web',
  });
  if (!query.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: NO_STORE });
  }

  try {
    const answer = await (await session.api()).findSimilarProducts(body.data, query.data);
    return NextResponse.json(answer, { headers: NO_STORE });
  } catch (error) {
    return visualSearchFailure(error);
  }
}
