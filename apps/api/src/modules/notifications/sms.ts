/*
 * SMS channel (provider-neutral)
 * ------------------------------
 * Nilzora has no SMS provider yet. This is the one seam a Bangladesh provider plugs into later:
 * business code asks for an `SmsSender` and never imports a provider SDK. Until a provider is
 * configured the sender is `disabled`, which refuses every message with a clear status, so no
 * caller can believe a text was sent.
 *
 * Rules any provider adapter must keep:
 *   - `accepted` means the provider queued the message, NOT that it was delivered; `delivered`
 *     is only ever recorded from the provider's own delivery report;
 *   - the idempotency key (the domain event id or the outbox row id) is passed through, so a retry
 *     cannot send the same text twice when the provider supports it;
 *   - message text is rendered from a fixed template with validated variables (renderSmsTemplate),
 *     never from free text in a request, and customer messages are English (the launch policy);
 *   - SMS is never an automatic fallback for a failed push: paid messages are sent only for the
 *     events a template is explicitly enabled for.
 */

export type SmsSendResult =
  | { status: 'accepted'; providerMessageId: string }
  | { status: 'rejected'; reason: 'disabled' | 'invalid_number' | 'provider_refused' }
  | { status: 'failed'; retryable: boolean };

export interface SmsMessage {
  /** E.164, Bangladesh mobile numbers only (+8801XXXXXXXXX). */
  to: string;
  text: string;
  idempotencyKey: string;
}

export interface SmsSender {
  readonly provider: string;
  send(message: SmsMessage): Promise<SmsSendResult>;
}

const BD_MOBILE = /^\+8801[3-9]\d{8}$/;

export function isBangladeshMobile(number: string): boolean {
  return BD_MOBILE.test(number);
}

/** The sender until a provider is configured: it never sends and says so. */
export const disabledSmsSender: SmsSender = {
  provider: 'disabled',
  send: (message) =>
    Promise.resolve(
      isBangladeshMobile(message.to)
        ? { status: 'rejected', reason: 'disabled' }
        : { status: 'rejected', reason: 'invalid_number' },
    ),
};

export class SmsTemplateError extends Error {
  override readonly name = 'SmsTemplateError';
}

/**
 * Renders `{{name}}` placeholders from `variables`. No expressions, no code, no HTML: a missing or
 * unexpected variable is an error (never an empty gap), values are single-line and length-capped,
 * and the result must fit in two SMS segments.
 */
export function renderSmsTemplate(
  template: string,
  variables: Readonly<Record<string, string>>,
): string {
  const used = new Set<string>();
  const text = template.replace(
    /\{\{\s*([a-zA-Z][a-zA-Z0-9_]{0,40})\s*\}\}/g,
    (_match, name: string) => {
      const value = variables[name];
      if (value === undefined) throw new SmsTemplateError(`missing variable ${name}`);
      used.add(name);
      return value.replace(/[\r\n\t]+/g, ' ').slice(0, 60);
    },
  );
  if (/\{\{|\}\}/.test(text)) throw new SmsTemplateError('malformed placeholder');
  const unused = Object.keys(variables).filter((name) => !used.has(name));
  if (unused.length > 0) throw new SmsTemplateError(`unexpected variables: ${unused.join(', ')}`);
  if (text.length > 306) throw new SmsTemplateError('message longer than two SMS segments');
  return text;
}
