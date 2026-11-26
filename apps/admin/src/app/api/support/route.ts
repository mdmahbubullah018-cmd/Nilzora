import {
  chatAnalyticsQuerySchema,
  chatConversationListQuerySchema,
  chatConversationStatusSchema,
  chatPrioritySchema,
  chatQueueQuerySchema,
  chatReportActionSchema,
  chatReportStatusSchema,
  postChatMessageSchema,
  saveChatAutomationRuleSchema,
  saveChatSavedReplySchema,
  saveChatTagSchema,
  saveChatTemplateSchema,
  sendChatMessageRequestSchema,
  startInternalChatSchema,
} from '@nilzora/contracts';
import { getApiUrl } from '@nilzora/web-session';
import { uuidSchema } from '@nilzora/validation';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { support, type SupportResult } from '@/lib/support';

/*
 * /api/support — the Communication Center's server endpoint
 * ---------------------------------------------------------
 * The operator screens are client components driven by live socket events, so they read and
 * write here. Everything runs on the server with the operator's session cookies: the browser
 * never names an account and never holds a token, and the API decides which threads the
 * account may see and which queue operations it may perform.
 *
 * This is an internal endpoint of this app. The REST surface for integrations is
 * `/api/v1/chat` on the Nilzora API, which validates every field again.
 */

const idSchema = z.strictObject({ id: uuidSchema });
const readRequestSchema = z.strictObject({ id: uuidSchema, seq: z.number().int().nonnegative() });
const statusRequestSchema = z.strictObject({
  id: uuidSchema,
  status: chatConversationStatusSchema,
});
const assignRequestSchema = z.strictObject({
  id: uuidSchema,
  assigneeId: uuidSchema.nullable(),
  note: z.string().trim().max(300).optional(),
});
const priorityRequestSchema = z.strictObject({
  id: uuidSchema,
  priority: chatPrioritySchema,
});
const noteRequestSchema = z.strictObject({
  id: uuidSchema,
  body: z.string().trim().min(1).max(4000),
});
const messageRequestSchema = z.strictObject({ conversationId: uuidSchema, messageId: uuidSchema });
const reactionRequestSchema = z.strictObject({
  conversationId: uuidSchema,
  messageId: uuidSchema,
  emoji: z.string().trim().min(1).max(16),
});
const reportDecisionRequestSchema = z.strictObject({
  reportId: uuidSchema,
  status: chatReportStatusSchema.exclude(['open']),
  actionTaken: chatReportActionSchema.optional(),
  note: z.string().trim().max(300).optional(),
});
const templateSaveRequestSchema = saveChatTemplateSchema.extend({ op: z.literal('template-save') });
const templateRenderRequestSchema = z.strictObject({
  templateId: uuidSchema,
  conversationId: uuidSchema,
});
const savedReplySaveRequestSchema = saveChatSavedReplySchema.extend({
  op: z.literal('saved-reply-save'),
});
const tagSaveRequestSchema = saveChatTagSchema.extend({ op: z.literal('tag-save') });
const tagSetRequestSchema = z.strictObject({
  conversationId: uuidSchema,
  tagIds: z.array(uuidSchema).max(12),
});
const automationSaveRequestSchema = saveChatAutomationRuleSchema.extend({
  op: z.literal('automation-save'),
});
const automationToggleRequestSchema = z.strictObject({
  ruleId: uuidSchema,
  isActive: z.boolean(),
});
const automationPreviewRequestSchema = z.strictObject({
  ruleId: uuidSchema,
  conversationId: uuidSchema,
});

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;
const MAX_BODY_BYTES = 16 * 1024;

function answer<T>(result: SupportResult<T>, status = 200): NextResponse {
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.code, message: result.message } },
      { status: result.status, headers: NO_STORE },
    );
  }
  // A write the API answers with no content (pin, archive, save, delete) has nothing to
  // serialise: `NextResponse.json(undefined)` throws, and a 204 may not carry a body at all.
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

function badRequest(message: string): NextResponse {
  return NextResponse.json(
    { error: { code: 'validation_failed', message } },
    { status: 400, headers: NO_STORE },
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const op = params.get('op') ?? 'list';

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
  if (op === 'queue') {
    const parsed = chatQueueQuerySchema.safeParse({
      scope: params.get('scope') ?? undefined,
      status: params.get('status') ?? undefined,
      priority: params.get('priority') ?? undefined,
      search: params.get('q') ?? undefined,
      sort: params.get('sort') ?? undefined,
      page: params.get('page') ?? undefined,
      pageSize: params.get('pageSize') ?? undefined,
    });
    if (!parsed.success) return badRequest('That queue request is not valid.');
    return answer(await support.queue(parsed.data));
  }
  if (op === 'team') return answer(await support.team());
  if (op === 'ticket') {
    const ticket = await support.socketTicket();
    if (!ticket.ok) return answer(ticket);
    // The browser opens the socket directly against the API, so it needs the address.
    return answer({ ok: true, value: { ...ticket.value, url: getApiUrl('admin') } });
  }
  if (op === 'thread' || op === 'messages' || op === 'notes') {
    const id = uuidSchema.safeParse(params.get('id'));
    if (!id.success) return badRequest('That conversation is not valid.');
    if (op === 'thread') return answer(await support.conversation(id.data));
    const before = cursorOf(params.get('before'));
    if (op === 'notes') return answer(await support.notes(id.data, { limit: 40, before }));
    return answer(await support.messages(id.data, { limit: 40, before }));
  }
  if (op === 'pins' || op === 'reactions' || op === 'feedback') {
    const id = uuidSchema.safeParse(params.get('id'));
    if (!id.success) return badRequest('That conversation is not valid.');
    if (op === 'pins') return answer(await support.pinnedMessages(id.data));
    if (op === 'feedback') return answer(await support.messageFeedback(id.data));
    return answer(await support.reactionSummary(id.data));
  }
  if (op === 'templates') {
    return answer(await support.listTemplates({ includeArchived: params.get('archived') === '1' }));
  }
  if (op === 'saved-replies') return answer(await support.savedReplies());
  if (op === 'tags') return answer(await support.tags());
  if (op === 'reports') {
    const status = params.get('status') ?? 'open';
    if (status !== 'all' && !chatReportStatusSchema.safeParse(status).success) {
      return badRequest('That report status is not valid.');
    }
    return answer(
      await support.reports({
        status: status as 'open' | 'reviewing' | 'dismissed' | 'actioned' | 'all',
        limit: 50,
      }),
    );
  }
  if (op === 'internal') return answer(await support.internalChannels({ limit: 50 }));
  if (op === 'search') {
    const q = (params.get('q') ?? '').trim();
    if (q.length < 2) return badRequest('Search needs at least two characters.');
    return answer(await support.search({ q, limit: 30 }));
  }
  if (op === 'analytics') {
    const parsed = chatAnalyticsQuerySchema.safeParse({
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
    });
    if (!parsed.success) return badRequest('That date range is not valid.');
    return answer(await support.analytics(parsed.data));
  }
  if (op === 'automation') return answer(await support.automationRules());
  if (op === 'automation-runs') return answer(await support.automationRuns({ limit: 50 }));
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
  const { op: _op, ...fields } = body;

  switch (body.op) {
    case 'send': {
      const id = idSchema.safeParse({ id: fields.id });
      const message = sendChatMessageRequestSchema.safeParse({
        clientMessageId: body.clientMessageId,
        body: body.body,
        // An operator answering a particular message; the database checks it belongs here.
        ...(typeof body.replyToId === 'string' ? { replyToId: body.replyToId } : {}),
      });
      if (!id.success || !message.success) {
        return badRequest('Write a message between 1 and 4000 characters.');
      }
      return answer(await support.sendMessage(id.data.id, message.data), 201);
    }
    case 'post': {
      // A reply that carries uploads, stored with its message in one transaction so a file is
      // never attached to a message that failed, or left behind by one that succeeded.
      const parsed = postChatMessageSchema.safeParse({
        conversationId: body.id,
        clientMessageId: body.clientMessageId,
        body: body.body,
        attachmentIds: body.attachmentIds,
        ...(typeof body.replyToId === 'string' ? { replyToId: body.replyToId } : {}),
      });
      if (!parsed.success) {
        return badRequest('Write a message between 1 and 4000 characters, or attach a file.');
      }
      return answer(await support.postMessage(parsed.data), 201);
    }
    case 'discard-attachment': {
      const parsed = idSchema.safeParse(fields);
      if (!parsed.success) return badRequest('That attachment is not valid.');
      return answer(await support.discardAttachment(parsed.data.id), 200);
    }
    case 'read': {
      const parsed = readRequestSchema.safeParse(fields);
      if (!parsed.success) return badRequest('That read receipt is not valid.');
      return answer(await support.markRead(parsed.data.id, parsed.data.seq));
    }
    case 'status': {
      const parsed = statusRequestSchema.safeParse(fields);
      if (!parsed.success) return badRequest('That status is not valid.');
      return answer(await support.setStatus(parsed.data.id, parsed.data.status));
    }
    case 'assignee': {
      const parsed = assignRequestSchema.safeParse(fields);
      if (!parsed.success) return badRequest('Choose a teammate who can take conversations.');
      return answer(await support.assign(parsed.data.id, parsed.data.assigneeId, parsed.data.note));
    }
    case 'priority': {
      const parsed = priorityRequestSchema.safeParse(fields);
      if (!parsed.success) return badRequest('That priority is not valid.');
      return answer(await support.setPriority(parsed.data.id, parsed.data.priority));
    }
    case 'note': {
      const parsed = noteRequestSchema.safeParse(fields);
      if (!parsed.success) return badRequest('Write a note between 1 and 4000 characters.');
      return answer(await support.addNote(parsed.data.id, parsed.data.body), 201);
    }
    case 'pin':
    case 'unpin': {
      const parsed = messageRequestSchema.safeParse(fields);
      if (!parsed.success) return badRequest('That message is not valid.');
      const result =
        body.op === 'pin'
          ? await support.pinMessage(parsed.data.conversationId, parsed.data.messageId)
          : await support.unpinMessage(parsed.data.conversationId, parsed.data.messageId);
      return answer(result, 204);
    }
    case 'react': {
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
    case 'template-save': {
      const parsed = templateSaveRequestSchema.safeParse(body);
      if (!parsed.success) return badRequest('Check the template and try again.');
      const { op: _op, ...template } = parsed.data;
      return answer(await support.saveTemplate(template), body.id === undefined ? 201 : 200);
    }
    case 'template-archive': {
      const parsed = idSchema.safeParse({ id: body.id });
      if (!parsed.success) return badRequest('That template is not valid.');
      return answer(await support.archiveTemplate(parsed.data.id), 204);
    }
    case 'template-render': {
      const parsed = templateRenderRequestSchema.safeParse(fields);
      if (!parsed.success) return badRequest('That preview is not valid.');
      return answer(
        await support.renderTemplate({
          templateId: parsed.data.templateId,
          conversationId: parsed.data.conversationId,
        }),
      );
    }
    case 'saved-reply-save': {
      const parsed = savedReplySaveRequestSchema.safeParse(body);
      if (!parsed.success) return badRequest('Check the saved reply and try again.');
      const { op: _op, ...reply } = parsed.data;
      return answer(await support.saveSavedReply(reply), body.id === undefined ? 201 : 204);
    }
    case 'saved-reply-delete': {
      const parsed = idSchema.safeParse({ id: body.id });
      if (!parsed.success) return badRequest('That saved reply is not valid.');
      return answer(await support.deleteSavedReply(parsed.data.id), 204);
    }
    case 'tag-save': {
      const parsed = tagSaveRequestSchema.safeParse(body);
      if (!parsed.success) return badRequest('Use 2-32 lowercase letters, digits or dashes.');
      const { op: _op, ...tag } = parsed.data;
      return answer(await support.saveTag(tag), 204);
    }
    case 'tags-set': {
      const parsed = tagSetRequestSchema.safeParse(fields);
      if (!parsed.success) return badRequest('That tag list is not valid.');
      return answer(
        await support.setConversationTags(parsed.data.conversationId, parsed.data.tagIds),
        204,
      );
    }
    case 'report-decide': {
      const parsed = reportDecisionRequestSchema.safeParse(fields);
      if (!parsed.success) return badRequest('That decision is not valid.');
      return answer(
        await support.decideReport({
          reportId: parsed.data.reportId,
          status: parsed.data.status,
          actionTaken: parsed.data.actionTaken,
          note: parsed.data.note,
        }),
      );
    }
    case 'internal-start': {
      const parsed = startInternalChatSchema.safeParse(fields);
      if (!parsed.success) return badRequest('Choose a teammate and try again.');
      return answer(await support.startInternalChat(parsed.data), 201);
    }
    case 'automation-save': {
      const parsed = automationSaveRequestSchema.safeParse(body);
      if (!parsed.success) return badRequest('Check the rule and try again.');
      const { op: _op, ...rule } = parsed.data;
      return answer(await support.saveAutomationRule(rule), body.id === undefined ? 201 : 204);
    }
    case 'automation-toggle': {
      const parsed = automationToggleRequestSchema.safeParse(fields);
      if (!parsed.success) return badRequest('That rule is not valid.');
      return answer(
        await support.setAutomationRuleActive(parsed.data.ruleId, parsed.data.isActive),
        204,
      );
    }
    case 'automation-delete': {
      const parsed = idSchema.safeParse({ id: body.id });
      if (!parsed.success) return badRequest('That rule is not valid.');
      return answer(await support.deleteAutomationRule(parsed.data.id), 204);
    }
    case 'automation-preview': {
      const parsed = automationPreviewRequestSchema.safeParse(fields);
      if (!parsed.success) return badRequest('That preview is not valid.');
      return answer(
        await support.previewAutomationRule({
          ruleId: parsed.data.ruleId,
          conversationId: parsed.data.conversationId,
        }),
      );
    }
    default:
      return badRequest('Unknown operation.');
  }
}
