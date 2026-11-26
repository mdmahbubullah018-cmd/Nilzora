import type { ApiErrorCode } from '@nilzora/contracts';
import type { Response } from 'express';
import { sendError } from '../../http/send-error';
import type { DatabaseFailure } from '../commerce/errors';
import { StoreUnavailableError } from '../commerce/errors';

/*
 * Chat refusals
 * -------------
 * The chat functions in `20261113090000_chat_conversations.sql` decide every rule that
 * matters — who may read a thread, whether it is still open, whether the caller may
 * assign it — and report a refusal with one of the SQLSTATEs below. Nothing in this
 * module re-derives those rules, so there is exactly one implementation of each.
 */

export type ChatRefusal =
  /** The thread does not exist, or the caller may not see it (deliberately the same). */
  | 'conversation_not_found'
  | 'conversation_closed'
  | 'message_not_found'
  | 'assignee_invalid'
  | 'too_many_messages'
  | 'message_invalid'
  | 'conversation_invalid'
  | 'participant_invalid'
  | 'bad_request'
  /** Phase 2: templates, saved replies, tags, reports, automation and attachments. */
  | 'template_not_found'
  | 'template_variable_invalid'
  | 'saved_reply_not_found'
  | 'tag_not_found'
  | 'report_not_found'
  | 'automation_rule_not_found'
  | 'attachment_not_found'
  | 'attachment_pending_limit'
  | 'attachment_type_unsupported'
  | 'attachment_invalid'
  | 'rating_not_open'
  /** The account is suspended, or holds no permission for what it asked. */
  | 'forbidden'
  | 'account_suspended';

export class ChatRefusalError extends Error {
  override readonly name = 'ChatRefusalError';
  readonly refusal: ChatRefusal;
  readonly details: unknown;

  constructor(refusal: ChatRefusal, details?: unknown) {
    super(`Refused by the database: ${refusal}`);
    this.refusal = refusal;
    this.details = details;
  }
}

const REFUSALS: Readonly<Record<string, ChatRefusal>> = {
  NZ403: 'forbidden',
  NZ410: 'account_suspended',
  NZ501: 'conversation_not_found',
  NZ502: 'conversation_closed',
  NZ503: 'message_not_found',
  NZ505: 'assignee_invalid',
  NZ506: 'too_many_messages',
  NZ508: 'message_invalid',
  NZ509: 'conversation_invalid',
  NZ511: 'participant_invalid',
  NZ512: 'template_variable_invalid',
  NZ513: 'template_not_found',
  NZ514: 'saved_reply_not_found',
  NZ515: 'tag_not_found',
  NZ516: 'attachment_type_unsupported',
  NZ517: 'attachment_invalid',
  NZ518: 'attachment_invalid',
  NZ519: 'attachment_pending_limit',
  NZ520: 'rating_not_open',
  NZ521: 'rating_not_open',
  NZ522: 'report_not_found',
  NZ523: 'automation_rule_not_found',
  NZ524: 'attachment_invalid',
  NZ525: 'attachment_not_found',
  NZ412: 'bad_request',
};

/** PostgreSQL "insufficient privilege" (a row-level refusal, or a missing execute grant). */
const INSUFFICIENT_PRIVILEGE = '42501';

/**
 * Turns a failed chat call into the error the routes understand: a refusal for the chat
 * SQLSTATEs, otherwise StoreUnavailableError (network failures, 5xx, a schema that has not
 * been migrated). A missing function must never look like a successful read.
 */
export function toChatError(failure: DatabaseFailure, operation: string): Error {
  const refusal = REFUSALS[failure.code];
  if (refusal) return new ChatRefusalError(refusal);
  if (failure.code === INSUFFICIENT_PRIVILEGE) return new ChatRefusalError('forbidden');
  return new StoreUnavailableError(`${operation} failed (${failure.code || 'network'})`, {
    cause: failure,
  });
}

const ANSWERS: Readonly<Record<ChatRefusal, readonly [number, ApiErrorCode, string]>> = {
  conversation_not_found: [404, 'conversation_not_found', 'That conversation is not available'],
  conversation_closed: [
    409,
    'conversation_closed',
    'This conversation is closed. Reopen it to send a message.',
  ],
  message_not_found: [404, 'message_not_found', 'That message is not available'],
  assignee_invalid: [400, 'assignee_invalid', 'Choose a teammate who can take conversations'],
  too_many_messages: [429, 'rate_limited', 'Too many messages. Wait a moment and try again.'],
  message_invalid: [400, 'bad_request', 'Write a message between 1 and 4000 characters'],
  conversation_invalid: [400, 'bad_request', 'That conversation cannot be started'],
  participant_invalid: [400, 'bad_request', 'Choose teammates who can join a conversation'],
  bad_request: [400, 'bad_request', 'That request is not valid'],
  template_not_found: [404, 'template_not_found', 'That template is not available'],
  template_variable_invalid: [
    400,
    'template_variable_invalid',
    'This template names a value Nilzora cannot fill in',
  ],
  saved_reply_not_found: [404, 'saved_reply_not_found', 'That saved reply is not available'],
  tag_not_found: [404, 'tag_not_found', 'That tag is not available'],
  report_not_found: [404, 'report_not_found', 'That report is not available'],
  automation_rule_not_found: [
    404,
    'automation_rule_not_found',
    'That automation rule is not available',
  ],
  attachment_not_found: [
    404,
    'attachment_not_found',
    'That upload is no longer available. Attach the file again.',
  ],
  /**
   * Five uploads are already waiting in this conversation. It is not a missing upload, which is
   * what it used to answer, and it is not a rate limit either: the operator has to finish or
   * discard what is there before reserving another slot.
   */
  attachment_pending_limit: [
    409,
    'attachment_invalid',
    'Finish or remove the uploads already waiting in this conversation',
  ],
  attachment_type_unsupported: [
    415,
    'attachment_type_unsupported',
    'Attach a picture, a PDF, TXT, CSV, DOCX or XLSX document, or a voice recording',
  ],
  attachment_invalid: [400, 'attachment_invalid', 'That upload cannot be attached here'],
  rating_not_open: [409, 'rating_not_open', 'This conversation is not ready to be rated'],
  forbidden: [403, 'forbidden', 'You do not have permission to do this'],
  account_suspended: [403, 'account_suspended', 'This account is suspended'],
};

/** Answers a chat refusal with its stable code; anything else is rethrown. */
export function sendChatFailure(res: Response, error: unknown): void {
  if (!(error instanceof ChatRefusalError)) throw error;
  const [status, code, message] = ANSWERS[error.refusal];
  sendError(res, status, code, message, error.details);
}

/**
 * The same answer as `sendChatFailure`, for the socket layer, which acknowledgements
 * instead of HTTP responses: one vocabulary for both transports.
 */
export function chatRefusalAnswer(error: unknown): { code: ApiErrorCode; message: string } | null {
  if (!(error instanceof ChatRefusalError)) return null;
  const [, code, message] = ANSWERS[error.refusal];
  return { code, message };
}
