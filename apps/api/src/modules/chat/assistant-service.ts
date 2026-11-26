import {
  chatMessageSchema,
  ORDER_STATUSES,
  type ChatMessage,
  type OrderStatus,
} from '@nilzora/contracts';
import type { Logger } from 'pino';
import type { Pool } from 'pg';
import { withServiceRole } from '../../db/user-context';
import type { ChatNotifier } from '../../realtime/notifier';
import { noopNotifier } from '../../realtime/notifier';
import {
  ASSISTANT_FALLBACK,
  orderNumberIn,
  resolveAssistantReply,
  type AssistantOrderFact,
  type AssistantPaymentStatus,
  type AssistantReply,
  type AssistantZone,
} from './assistant';

/*
 * The support assistant
 * ---------------------
 * When a customer writes to support and no person is involved yet, the store answers once,
 * immediately, from facts it can actually check: the order they own, and the store profile.
 * A teammate keeps the conversation from then on.
 *
 * It is deliberately narrow. It never answers twice for the same customer message, never
 * steps into a thread a teammate has joined or been assigned, never touches internal or
 * moderation threads, and stays out of the way while automation is paused. Its reply is
 * stored as an `automated` message — the same kind the rules engine writes — so both sides
 * draw it as a normal incoming message and the customer can reply to it.
 *
 * Both calls are database functions granted to `service_role` alone (see
 * 20261119090000_chat_assistant.sql): the chat tables themselves stay closed to that role,
 * and the reply function re-checks every condition under a row lock, so two requests that
 * arrive together still produce one answer.
 */

export interface AssistantRequest {
  conversationId: string;
  /** The verified customer who wrote; the functions answer only for this account. */
  customerId: string;
  body: string;
}

export interface ChatAssistant {
  /**
   * Answers if the conversation calls for it. Never throws: an assistant that cannot reach
   * the database must not affect the message the customer already sent.
   */
  respond(request: AssistantRequest): Promise<void>;
}

/** The two calls this needs, abstracted so the behaviour can be tested without a database. */
export interface AssistantQueryRunner {
  rows<T>(sql: string, params: readonly unknown[]): Promise<T[]>;
}

/** An order as `public.chat_assistant_facts` returns it. */
interface RawOrderFact {
  orderNumber: string;
  status: string;
  paymentStatus?: string | null;
  deliveredAt?: string | null;
  returnEligible?: boolean | null;
  shipment?: { providerName?: string | null; trackingCode?: string | null } | null;
}

/** What `public.chat_assistant_facts` returns; fields added later may be missing. */
interface AssistantFacts {
  kind: string;
  status: string;
  assigneeId: string | null;
  automationPaused: boolean;
  storeName: string;
  businessHours: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  customerMessages: number;
  humanReplies: number;
  answered: boolean;
  order: RawOrderFact | null;
  recentOrders?: RawOrderFact[] | null;
  returnWindowDays: number | null;
  codEnabled: boolean | null;
  deliveryCharges?: { insideDhaka?: number | string | null; outsideDhaka?: number | string | null };
  defaultZone?: string | null;
  product: {
    name: string | null;
    status: string;
    stock: number;
    variants?: { options?: string[] | null; stock: number }[] | null;
  } | null;
}

interface StoredReply {
  id: string;
  seq: string | number;
  kind: string;
  body: string;
  metadata: Record<string, unknown>;
  createdAt: string | Date;
}

const FACTS_CALL = 'select public.chat_assistant_facts($1, $2, $3) as value';
const REPLY_CALL = 'select public.chat_assistant_reply($1, $2, $3, $4::jsonb) as value';

/** Only threads a customer is in are ever answered automatically. */
const ASSISTED_KINDS = new Set(['customer_support', 'order_support']);
const CLOSED_STATUSES = new Set(['resolved', 'closed']);

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asOrderStatus(status: string): OrderStatus | null {
  return (ORDER_STATUSES as readonly string[]).includes(status) ? (status as OrderStatus) : null;
}

const PAYMENT_STATUSES: readonly string[] = ['pending', 'collected', 'cancelled'];

/** An amount of poisha, or null when the store has not set it. */
function toMinor(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function toOrderFact(raw: RawOrderFact | null | undefined): AssistantOrderFact | null {
  if (raw === null || raw === undefined) return null;
  const status = asOrderStatus(raw.status);
  if (status === null) return null;
  const tracking = raw.shipment ?? null;
  return {
    orderNumber: raw.orderNumber,
    status,
    paymentStatus:
      raw.paymentStatus !== null &&
      raw.paymentStatus !== undefined &&
      PAYMENT_STATUSES.includes(raw.paymentStatus)
        ? (raw.paymentStatus as AssistantPaymentStatus)
        : null,
    deliveredAt: raw.deliveredAt ?? null,
    returnEligible: raw.returnEligible === true,
    shipment:
      tracking === null
        ? null
        : {
            providerName: tracking.providerName ?? null,
            trackingCode: tracking.trackingCode ?? null,
          },
  };
}

function toZone(value: string | null | undefined): AssistantZone | null {
  return value === 'inside_dhaka' || value === 'outside_dhaka' ? value : null;
}

export function createChatAssistant(options: {
  queries: AssistantQueryRunner;
  logger: Logger;
  notify?: ChatNotifier | undefined;
}): ChatAssistant {
  const { queries, logger } = options;
  const notify = options.notify ?? noopNotifier;

  return {
    async respond(request) {
      /*
       * Working out the answer. If the lookup itself fails, the customer is still owed the fixed
       * fallback instead of silence. That is safe because the reply function re-checks every
       * gate (this customer's thread, a customer-facing kind, not paused, no teammate, not
       * already answered) under a row lock: when any of them fails it stores nothing, so a
       * failed lookup can never produce a second answer or one in a thread a person handles.
       * If the database cannot be reached at all, storing the fallback fails too and the
       * assistant stays silent - the customer's own message is never affected.
       */
      let reply: AssistantReply | null;
      try {
        const facts =
          (
            await queries.rows<{ value: AssistantFacts | null }>(FACTS_CALL, [
              request.conversationId,
              request.customerId,
              orderNumberIn(request.body),
            ])
          )[0]?.value ?? null;
        // No facts means the thread is not this customer's: there is nothing to answer.
        if (facts === null) return;
        if (!ASSISTED_KINDS.has(facts.kind)) return;
        if (CLOSED_STATUSES.has(facts.status)) return;
        if (facts.automationPaused) return;
        // A person is already handling it: the assistant stays quiet.
        if (facts.assigneeId !== null) return;
        if (toNumber(facts.humanReplies) > 0) return;
        // Already answered this message: never two automatic replies for one question.
        if (facts.answered) return;

        reply = resolveAssistantReply({
          body: request.body,
          facts: {
            storeName: facts.storeName,
            businessHours: facts.businessHours,
            supportEmail: facts.supportEmail,
            supportPhone: facts.supportPhone,
            // A setting the database has never held arrives as null, which the resolver turns
            // into the fallback rather than into a claim about the store's policy.
            returnWindowDays:
              facts.returnWindowDays === null ? null : toNumber(facts.returnWindowDays),
            codEnabled: facts.codEnabled,
            deliveryCharges: {
              insideDhaka: toMinor(facts.deliveryCharges?.insideDhaka),
              outsideDhaka: toMinor(facts.deliveryCharges?.outsideDhaka),
            },
            defaultZone: toZone(facts.defaultZone),
            order: toOrderFact(facts.order),
            recentOrders: (facts.recentOrders ?? [])
              .map((order) => toOrderFact(order))
              .filter((order): order is AssistantOrderFact => order !== null),
            product:
              facts.product === null
                ? null
                : {
                    name: facts.product.name,
                    status: facts.product.status,
                    stock: toNumber(facts.product.stock),
                    variants: (facts.product.variants ?? []).map((variant) => ({
                      options: variant.options ?? [],
                      stock: toNumber(variant.stock),
                    })),
                  },
            firstContact: toNumber(facts.customerMessages) <= 1,
          },
        });
      } catch (error) {
        logger.warn(
          { err: error, conversationId: request.conversationId },
          'Support assistant could not look up its facts; sending the fallback',
        );
        reply = { intent: 'fallback', body: ASSISTANT_FALLBACK };
      }
      // A blank message is the only case with nothing to say; every other path answers, even
      // if that answer is the fallback.
      if (reply === null) return;

      try {
        const stored =
          (
            await queries.rows<{ value: StoredReply | null }>(REPLY_CALL, [
              request.conversationId,
              request.customerId,
              reply.body,
              JSON.stringify({ assistant: reply.intent }),
            ])
          )[0]?.value ?? null;
        // The function refused: a teammate arrived, or this message was already answered.
        if (stored === null) return;

        const message: ChatMessage = chatMessageSchema.parse({
          id: stored.id,
          seq: toNumber(stored.seq),
          senderId: null,
          senderRole: 'system',
          senderName: null,
          kind: 'automated',
          body: stored.body,
          replyToId: null,
          metadata: stored.metadata ?? {},
          editedAt: null,
          createdAt:
            stored.createdAt instanceof Date
              ? stored.createdAt.toISOString()
              : String(stored.createdAt),
          attachments: [],
        });
        // The answer is committed; telling the open sockets about it is best effort.
        notify.message(request.conversationId, message);
      } catch (error) {
        logger.warn(
          { err: error, conversationId: request.conversationId },
          'Support assistant failed',
        );
      }
    },
  };
}

/**
 * The production runner: each call runs with the service key, because the assistant is not a
 * signed-in account and the customer's token must never be reused for a message the customer
 * did not write.
 */
export function createPostgresChatAssistant(
  pool: Pool,
  options: { logger: Logger; notify?: ChatNotifier | undefined },
): ChatAssistant {
  return createChatAssistant({
    ...options,
    queries: {
      rows: <T>(sql: string, params: readonly unknown[]) =>
        withServiceRole(pool, async (client) => {
          const result = await client.query(sql, [...params]);
          return result.rows as T[];
        }),
    },
  });
}

/** A runner that answers nothing: used when the API runs without a database. */
export const silentAssistant: ChatAssistant = { respond: () => Promise.resolve() };
