import { orderNumberSchema } from '@nilzora/contracts';
import { ApiError } from '@nilzora/web-session';
import { NextResponse, type NextRequest } from 'next/server';
import { fileResponse, isCrossSite, refusal } from '@/lib/download';
import { session } from '@/lib/session';
import { signInPath } from '@/lib/workspace-access';

const DOCUMENTS = { 'invoice.pdf': 'invoice', 'packing-slip.pdf': 'packing-slip' } as const;

/*
 * GET /api/orders/:orderNumber/invoice.pdf | packing-slip.pdf
 * -------------------------------------------------------------
 * The order's invoice or packing slip, built by the API (orders.read, audited) and streamed
 * back as an attachment.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ orderNumber: string; document: string }> },
) {
  if (isCrossSite(request)) return refusal(403, 'Downloads must start from the Nilzora admin.');
  const { orderNumber, document } = await context.params;
  const kind = DOCUMENTS[document as keyof typeof DOCUMENTS] as
    | (typeof DOCUMENTS)[keyof typeof DOCUMENTS]
    | undefined;
  if (!kind || !orderNumberSchema.safeParse(orderNumber).success) return refusal(404, 'There is no such document.');

  try {
    const result = await session.read((api, token) =>
      kind === 'invoice'
        ? api.adminOrderInvoice(token, orderNumber)
        : api.adminOrderPackingSlip(token, orderNumber),
    );
    if (result.kind === 'signed_out') {
      return NextResponse.redirect(
        new URL(signInPath(`/admin/orders/${orderNumber}`), request.url),
      );
    }
    if (result.kind !== 'ok') {
      return refusal(503, 'The API could not be reached. Try again in a moment.');
    }
    return fileResponse(result.value, `${kind}-${orderNumber.toLowerCase()}.pdf`);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404) return refusal(404, 'This order does not exist.');
      if (error.status === 403) return refusal(403, 'Your account may not open this order.');
      if (error.status === 429) return refusal(429, 'Too many downloads. Wait a moment, then try again.');
    }
    return refusal(503, 'The document could not be created right now. Try again in a moment.');
  }
}
