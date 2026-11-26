import { IMAGE_SEARCH_MAX_UPLOAD_BYTES, imageSearchQuerySchema } from '@nilzora/contracts';
import { NextResponse } from 'next/server';
import { session } from '@/lib/session';
import { visualSearchFailure } from '@/lib/visual-search-relay';

/*
 * POST /api/visual-search
 * -----------------------
 * The browser's photograph, relayed to the API. The picture is never written to disk here:
 * it is read out of the form, passed to the API as a Blob and forgotten. The API does the
 * validating, so this route only refuses the obviously impossible (no file, too large) and
 * forwards the sort and paging.
 *
 * Nothing is cached: a result depends on the photograph and on the live catalogue.
 */

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: NO_STORE });
  }

  const file = form.get('file');
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: 'image_missing' }, { status: 400, headers: NO_STORE });
  }
  if (file.size > IMAGE_SEARCH_MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'image_too_large' }, { status: 413, headers: NO_STORE });
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
    const answer = await (await session.api()).searchProductsByImage(file, query.data);
    return NextResponse.json(answer, { headers: NO_STORE });
  } catch (error) {
    return visualSearchFailure(error);
  }
}
