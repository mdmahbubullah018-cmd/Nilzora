import { orderNumberSchema } from '@nilzora/contracts';
import { NextResponse } from 'next/server';
import { readAccount } from '@/lib/account-read';

/*
 * GET /account/orders/[orderNumber]/receipt/pdf
 * ---------------------------------------------
 * The receipt the customer is looking at, as the PDF the API builds from the same order
 * fields — so the download and the page can never disagree. The document is fetched with the
 * visitor's own access token and streamed back untouched: the storefront never renders or
 * rewrites a customer's document, and another customer's order number is a 404 here exactly
 * as it is on the receipt page.
 *
 * It is a private document: no shared cache, no indexing, and a filename the customer can
 * recognise in their downloads folder.
 */

const PRIVATE = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
} as const;

function refusal(message: string, status: number): NextResponse {
  return new NextResponse(message, {
    status,
    headers: { ...PRIVATE, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderNumber: string }> },
): Promise<NextResponse> {
  const parsed = orderNumberSchema.safeParse((await params).orderNumber);
  if (!parsed.success) return refusal('This receipt could not be found.', 404);

  const read = await readAccount((api, accessToken) =>
    api.orderReceiptPdf(accessToken, parsed.data),
  );

  if (read.kind === 'ok') {
    // A copy on a plain ArrayBuffer: the client may hand back a view on a shared buffer.
    return new NextResponse(read.value.bytes.slice(), {
      status: 200,
      headers: {
        ...PRIVATE,
        'Content-Type': read.value.contentType || 'application/pdf',
        'Content-Disposition': `attachment; filename="${read.value.fileName}"`,
        'Content-Length': String(read.value.bytes.byteLength),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  if (read.kind === 'signed_out') {
    // A download link is a plain navigation, so send the visitor to sign in and come back.
    const next = `/account/orders/${parsed.data}/receipt`;
    return NextResponse.redirect(new URL(`/login?next=${next}`, request.url), 303);
  }
  if (read.kind === 'not_found') return refusal('This receipt could not be found.', 404);
  if (read.kind === 'suspended') return refusal('This account is suspended.', 403);
  return refusal('The receipt could not be prepared. Please try again.', 503);
}
