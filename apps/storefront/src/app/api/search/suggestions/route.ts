import { ApiError } from '@nilzora/web-session';
import { NextResponse } from 'next/server';
import { parseSearchText } from '@/lib/catalog-query';
import {
  MIN_SUGGEST_LENGTH,
  SUGGEST_LIMIT,
  toSuggestion,
  type SuggestionResponse,
} from '@/lib/search-suggestions';
import { session } from '@/lib/session';

/*
 * GET /api/search/suggestions?q=…: the first few products the real search finds for the text
 * typed so far. It runs through the visitor's own API client, exactly like the search page, so
 * the API rate-limits each visitor on their own. Answers are never cached: they are per-visitor
 * reads of a live catalog.
 */

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function GET(request: Request) {
  const q = parseSearchText(new URL(request.url).searchParams.get('q') ?? undefined);
  if (Array.from(q).length < MIN_SUGGEST_LENGTH) {
    const empty: SuggestionResponse = { query: q, items: [], total: 0 };
    return NextResponse.json(empty, { headers: NO_STORE });
  }

  try {
    const page = await (await session.api()).listProducts({ q, page: 1, pageSize: SUGGEST_LIMIT });
    const body: SuggestionResponse = {
      query: q,
      items: page.items.map(toSuggestion),
      total: page.total,
    };
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (error) {
    // The visitor typing faster than the API allows: say so, and let them carry on typing.
    if (error instanceof ApiError && error.status === 429) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: NO_STORE });
    }
    // Anything else is the search being unavailable; its details stay on the server.
    return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: NO_STORE });
  }
}
