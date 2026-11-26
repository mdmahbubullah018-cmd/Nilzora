import {
  chatConversationListQuerySchema,
  chatConversationStatusSchema,
  chatReportReasonSchema,
  orderNumberSchema,
  sendChatMessageRequestSchema,
  startChatConversationRequestSchema,
} from '@nilzora/contracts';
import { getApiUrl } from '@nilzora/web-session';
import { uuidSchema } from '@nilzora/validation';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { session } from '@/lib/session';
import { support, type SupportResult } from '@/lib/support';

/*
 * /api/support — the support widget's server endpoint
 * ---------------------------------------------------
 * The floating chat opens from any shop page, and most of those pages are cached and carry
 * no CSRF cookie, so a Server Action cannot be the entry point there. This route runs the
 * same gateway the account pages use, on the server, with the session cookies: the browser
 * never names an account and never sees a token.
 *
 * It is an internal endpoint of this app, not part of the public API: the REST surface a
 * client integrates with is `/api/v1/chat` on the Nilzora API, which validates every field
 * again and decides authorization from the caller's own credentials.
 */

const conversationIdSchema = z.strictObject({ id: uuidSchema });
const readRequestSchema = z.strictObject({ id: uuidSchema, seq: z.number().int().nonnegative() });
const reportRequestSchema = z.strictObject({
  messageId: uuidSchema,
  reason: chatReportReasonSchema,
  details: z.string().trim().max(500).optional(),
});
const messageRequestSchema = z.strictObject({ conversationId: uuidSchema, messageId: uuidSchema });
const reactionRequestSchema = z.strictObject({
  conversationId: uuidSchema,
  messageId: uuidSchema,
  emoji: z.string().trim().min(1).max(16),
});
/** A customer's verdict on one support reply; the API re-checks ownership and eligibility. */
const messageFeedbackRequestSchema = z.strictObject({
  messageId: uuidSchema,
  verdict: z.enum(['helpful', 'not_helpful']),
  comment: z.string().trim().max(500).optional(),
});
const ratingRequestSchema = z.strictObject({
  conversationId: uuidSchema,
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});
/** A customer may close their own thread or reopen it; the database refuses any other status. */
const statusRequestSchema = z.strictObject({
  id: uuidSchema,
  status: chatConversationStatusSchema.extract(['open', 'closed']),
});
const postRequestSchema = z.strictObject({
  conversationId: uuidSchema,
  clientMessageId: uuidSchema,
  body: z.string().trim().max(4000).optional(),
  attachmentIds: z.array(uuidSchema).max(5).optional(),
  /** The message this one answers; the API checks it belongs to the conversation. */
  replyToId: uuidSchema.nullable().optional(),
});

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;
/** A chat message is at most 4000 characters; this leaves generous room for the envelope. */
const MAX_BODY_BYTES = 16 * 1024;

function answer<T>(result: SupportResult<T>, status = 200): NextResponse {
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.code, message: result.message } },
      { status: result.status, headers: NO_STORE },
    );
  }
  // A write the API answers with no content (pin, unpin, discard) has nothing to serialise:
  // `NextResponse.json(undefined)` throws, and a 204 may not carry a body at all.
  if (result.value === undefined || status === 204) {
    return new NextResponse(null, { status: 204, headers: NO_STORE });
  }
  return NextResponse.json(result.value, { status, headers: NO_STORE });
}

/** A message-page cursor from the query string: a positive sequence, or none. */
function cursorOf(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * The customer's latest orders, so a new conversation can name one. Only what the picker shows
 * leaves the server; the API still checks the order belongs to this account when the thread
 * is started.
 */
async function recentOrders(): Promise<NextResponse> {
  try {
    const read = await session.read((api, accessToken) =>
      api.listOrders(accessToken, { page: 1, pageSize: 10 }),
    );
    if (read.kind === 'signed_out') {
      return NextResponse.json(
        { error: { code: 'signed_out', message: 'Sign in to use chat.' } },
        { status: 401, headers: NO_STORE },
      );
    }
    if (read.kind !== 'ok') throw new Error('unavailable');
    return NextResponse.json(
      {
        orders: read.value.orders.map((order) => ({
          orderNumber: order.orderNumber,
          status: order.status,
          itemCount: order.itemCount,
          totalMinor: order.totalMinor,
          placedAt: order.placedAt,
        })),
      },
      { headers: NO_STORE },
    );
  } catch {
    return NextResponse.json(
      { error: { code: 'unavailable', message: 'Your orders could not be loaded.' } },
      { status: 503, headers: NO_STORE },
    );
  }
}

/**
 * A review invitation for a support thread about one of the customer's orders: the first product
 * of that order the API lists as delivered and not yet reviewed by this account (or none). Only
 * the fields the card shows leave the server.
 */
async function reviewInvite(orderNumber: string, productId: string | null): Promise<NextResponse> {
  try {
    const read = await session.read((api, accessToken) => api.pendingReviews(accessToken));
    if (read.kind !== 'ok') return NextResponse.json({ item: null }, { headers: NO_STORE });
    const item =
      read.value.items.find(
        (candidate) =>
          candidate.orderNumber === orderNumber &&
          (productId === null || candidate.productId === productId),
      ) ?? null;
    return NextResponse.json(
      {
        item:
          item === null
            ? null
            : {
                productId: item.productId,
                productName: item.productName,
                orderNumber: item.orderNumber,
              },
      },
      { headers: NO_STORE },
    );
  } catch {
    return NextResponse.json({ item: null }, { headers: NO_STORE });
  }
}

function badRequest(message: string): NextResponse {
  return NextResponse.json(
    { error: { code: 'validation_failed', message } },
    { status: 400, headers: NO_STORE },
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const op = params.get('op') ?? 'list';

  if (op === 'unread') return answer(await support.unreadCount());
  if (op === 'orders') return recentOrders();
  if (op === 'review-invite') {
    const order = orderNumberSchema.safeParse(params.get('order'));
    if (!order.success) return badRequest('Unknown order.');
    const product = params.get('product');
    const productId = product === null ? null : uuidSchema.safeParse(product);
    if (productId !== null && !productId.success) return badRequest('Unknown product.');
    return reviewInvite(order.data, productId === null ? null : productId.data);
  }
  if (op === 'ticket') {
    const ticket = await support.socketTicket();
    if (!ticket.ok) return answer(ticket);
    // The browser opens the socket directly against the API, so it needs the address.
    return answer({ ok: true, value: { ...ticket.value, url: getApiUrl('storefront') } });
  }
  if (op === 'list') {
    const parsed = chatConversationListQuerySchema.safeParse({
      scope: params.get('scope') ?? undefined,
      status: params.get('status') ?? undefined,
      search: params.get('q') ?? undefined,
      page: params.get('page') ?? undefined,
      pageSize: params.get('pageSize') ?? undefined,
    });
    if (!parsed.success) return badRequest('That list request is not valid.');
    return answer(await support.listConversations(parsed.data));
  }
  if (op === 'thread' || op === 'messages') {
    const id = uuidSchema.safeParse(params.get('id'));
    if (!id.success) return badRequest('That conversation is not valid.');
    if (op === 'thread') return answer(await support.conversation(id.data));
    return answer(
      await support.messages(id.data, { limit: 40, before: cursorOf(params.get('before')) }),
    );
  }
  if (op === 'pins' || op === 'reactions' || op === 'my-feedback') {
    const id = uuidSchema.safeParse(params.get('id'));
    if (!id.success) return badRequest('That conversation is not valid.');
    if (op === 'pins') return answer(await support.pinnedMessages(id.data));
    // The customer's own verdicts on this thread's replies: never anyone else's, never a note.
    if (op === 'my-feedback') return answer(await support.myMessageFeedback(id.data));
    return answer(await support.reactionSummary(id.data));
  }
  if (op === 'search') {
    const q = (params.get('q') ?? '').trim();
    if (q.length < 2) return badRequest('Search needs at least two characters.');
    return answer(await support.search({ q, limit: 20 }));
  }
  return badRequest('Unknown operation.');
}

export async function POST(request: Request): Promise<NextResponse> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return badRequest('That message is too long.');
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest('The request could not be read.');
  }
  const body = (payload ?? {}) as Record<string, unknown>;
  // The operation name routes the request; it is not one of the operation's fields, and the
  // strict schemas below refuse any key they do not name, so it is set aside before parsing.
  const { op, ...fields } = body;

  if (op === 'start') {
    const parsed = startChatConversationRequestSchema.safeParse({
      kind: body.kind,
      ...(body.orderNumber ? { orderNumber: body.orderNumber } : {}),
      ...(body.productId ? { productId: body.productId } : {}),
      ...(body.subject ? { subject: body.subject } : {}),
      ...(body.body ? { body: body.body } : {}),
    });
    if (!parsed.success) return badRequest('Check the conversation details and try again.');
    return answer(await support.startConversation(parsed.data), 201);
  }

  if (op === 'send') {
    const conversation = conversationIdSchema.safeParse({ id: fields.id });
    const message = sendChatMessageRequestSchema.safeParse({
      clientMessageId: body.clientMessageId,
      body: body.body,
      ...(body.replyToId === undefined || body.replyToId === null
        ? {}
        : { replyToId: body.replyToId }),
    });
    if (!conversation.success || !message.success) {
      return badRequest('Write a message between 1 and 4000 characters.');
    }
    return answer(await support.sendMessage(conversation.data.id, message.data), 201);
  }

  if (op === 'read') {
    const parsed = readRequestSchema.safeParse(fields);
    if (!parsed.success) return badRequest('That read receipt is not valid.');
    return answer(await support.markRead(parsed.data.id, parsed.data.seq));
  }

  if (op === 'status') {
    const parsed = statusRequestSchema.safeParse(fields);
    if (!parsed.success) return badRequest('That change is not valid.');
    return answer(await support.setStatus(parsed.data.id, parsed.data.status));
  }

  if (op === 'report') {
    const parsed = reportRequestSchema.safeParse(fields);
    if (!parsed.success) return badRequest('Choose a reason for the report.');
    return answer(
      await support.reportMessage(parsed.data.messageId, parsed.data.reason, parsed.data.details),
      201,
    );
  }

  if (op === 'post') {
    const parsed = postRequestSchema.safeParse(fields);
    if (!parsed.success) return badRequest('Write a message or attach a picture.');
    return answer(
      await support.postMessage({
        conversationId: parsed.data.conversationId,
        clientMessageId: parsed.data.clientMessageId,
        body: parsed.data.body,
        attachmentIds: parsed.data.attachmentIds,
        ...(parsed.data.replyToId === undefined ? {} : { replyToId: parsed.data.replyToId }),
      }),
      201,
    );
  }

  if (op === 'rating') {
    const parsed = ratingRequestSchema.safeParse(fields);
    if (!parsed.success) return badRequest('Choose a rating from 1 to 5.');
    return answer(
      await support.submitRating(parsed.data.conversationId, {
        rating: parsed.data.rating,
        comment: parsed.data.comment,
      }),
      201,
    );
  }

  if (op === 'pin' || op === 'unpin') {
    const parsed = messageRequestSchema.safeParse(fields);
    if (!parsed.success) return badRequest('That message is not valid.');
    const result =
      op === 'pin'
        ? await support.pinMessage(parsed.data.conversationId, parsed.data.messageId)
        : await support.unpinMessage(parsed.data.conversationId, parsed.data.messageId);
    return answer(result, 204);
  }

  if (op === 'discard-attachment') {
    const parsed = conversationIdSchema.safeParse({ id: body.id });
    if (!parsed.success) return badRequest('That upload is not valid.');
    return answer(await support.discardAttachment(parsed.data.id), 204);
  }

  if (op === 'react') {
    const parsed = reactionRequestSchema.safeParse(fields);
    if (!parsed.success) return badRequest('That reaction is not valid.');
    return answer(
      await support.toggleReaction(
        parsed.data.conversationId,
        parsed.data.messageId,
        parsed.data.emoji,
      ),
    );
  }

  if (op === 'message-feedback') {
    const parsed = messageFeedbackRequestSchema.safeParse(fields);
    if (!parsed.success) return badRequest('Choose helpful or not helpful.');
    return answer(
      await support.submitMessageFeedback(
        parsed.data.messageId,
        parsed.data.comment === undefined
          ? { verdict: parsed.data.verdict }
          : { verdict: parsed.data.verdict, comment: parsed.data.comment },
      ),
    );
  }

  return badRequest('Unknown operation.');
}
