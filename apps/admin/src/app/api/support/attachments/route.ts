import {
  CHAT_ATTACHMENT_TYPES,
  CHAT_AUDIO_MAX_DURATION_MS,
  chatAttachmentTypeSchema,
  chatMediaKindOf,
  chatMediaMaxBytes,
  chatMediaMaxLabel,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { support } from '@/lib/support';

/*
 * /api/support/attachments — one picture, document or voice recording for one conversation
 * ---------------------------------------------------------------------------------------
 * The Communication Center's upload path, and the same one the storefront uses: the body is the
 * file itself, the request names the conversation, and the API decides whether this operator may
 * attach anything to it, whether the bytes really are the type they claim, and where the object
 * key may live. There is no admin-only upload backend — an operator's attachment travels exactly
 * the route a customer's does, so an internal thread's media is protected by the same
 * conversation-membership check that protects its messages.
 *
 * The ceiling is the contract's, per kind (10 MB for a picture or a recording, 20 MB for a
 * document), so a file the composer accepted is never refused here after the whole transfer.
 *
 * The API answers 503 `media_unavailable` when object storage is not configured; that is passed
 * on unchanged so the composer can say uploads are off instead of failing silently.
 */

const TYPES: readonly string[] = CHAT_ATTACHMENT_TYPES;
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

const requestSchema = z.object({
  conversationId: uuidSchema,
  fileName: z.string().trim().min(1).max(200),
  contentType: chatAttachmentTypeSchema,
  /** Only a recording has one; absent for every other kind. */
  durationMs: z.coerce.number().int().min(1).max(CHAT_AUDIO_MAX_DURATION_MS).optional(),
});

function badRequest(message: string): NextResponse {
  return NextResponse.json(
    { error: { code: 'validation_failed', message } },
    { status: 400, headers: NO_STORE },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const claimed = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  const parsed = requestSchema.safeParse({
    conversationId: params.get('conversationId'),
    fileName: params.get('fileName'),
    contentType: claimed,
    durationMs: params.get('durationMs') ?? undefined,
  });
  if (!parsed.success) {
    return badRequest(
      claimed !== undefined && TYPES.includes(claimed)
        ? 'That attachment could not be read. Reload the page and try again.'
        : 'Attach a picture, a PDF, TXT, CSV, DOCX or XLSX file, or a voice recording.',
    );
  }
  const kind = chatMediaKindOf(parsed.data.contentType);
  if (kind === null) return badRequest('That file type cannot be attached.');
  const maxBytes = chatMediaMaxBytes(kind);
  const maxLabel = chatMediaMaxLabel(kind);

  const declared = Number(request.headers.get('content-length'));
  if (!Number.isFinite(declared) || declared <= 0) {
    return badRequest('That file could not be read.');
  }
  if (declared > maxBytes) {
    return badRequest(`That file is larger than ${maxLabel}.`);
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
    return badRequest(`That file is larger than ${maxLabel}.`);
  }

  const result = await support.uploadAttachment({
    conversationId: parsed.data.conversationId,
    fileName: parsed.data.fileName,
    contentType: parsed.data.contentType,
    body: bytes,
    durationMs: kind === 'audio' ? parsed.data.durationMs : undefined,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.code, message: result.message } },
      { status: result.status, headers: NO_STORE },
    );
  }
  return NextResponse.json(result.value, { status: 201, headers: NO_STORE });
}
