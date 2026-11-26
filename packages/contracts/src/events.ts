import { z } from 'zod';

/*
 * Domain events: what happened, in the order it happened, as recorded by the database in the same
 * transaction as the change (see migration 20261231103000). The same shape arrives live over the
 * socket and through GET /me/events, so a client handles both with one function and ignores any
 * `seq` it has already seen (delivery is at-least-once, never "exactly once").
 *
 * An event says WHAT changed, never the details: a client that needs the order, the notification
 * or the return reads it through the authorised REST endpoint.
 */

export const DOMAIN_EVENT_TYPES = [
  'order.placed',
  'order.confirmed',
  'order.processing',
  'order.shipped',
  'order.delivered',
  'order.cancelled',
  'payment.collected',
  'return.requested',
  'staff_notification.created',
  'customer_notification.created',
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

/** The socket event every domain event is delivered on. */
export const DOMAIN_EVENT_SOCKET_EVENT = 'nilzora:event';

export const domainEventSchema = z.object({
  /** Store-wide order; resume after the highest one you processed. */
  seq: z.number().int().positive(),
  id: z.uuid(),
  /** Known types are listed above; a newer server may send others, which clients should skip. */
  type: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
  version: z.number().int().positive(),
  aggregateType: z.string(),
  aggregateId: z.string(),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.iso.datetime(),
});

export type DomainEvent = z.infer<typeof domainEventSchema>;

/** GET /me/events?after=<seq>&limit=<n> */
export const domainEventsQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const domainEventListResponseSchema = z.object({
  events: z.array(domainEventSchema),
  /** The seq to ask after next time (the last one returned, or `after` when there were none). */
  cursor: z.number().int().nonnegative(),
  /** True when the page was full: ask again with `cursor` for the rest. */
  hasMore: z.boolean(),
});

/** GET /me/events/cursor: where a fresh client starts listening, without replaying history. */
export const domainEventCursorResponseSchema = z.object({ cursor: z.number().int().nonnegative() });

export type DomainEventListResponse = z.infer<typeof domainEventListResponseSchema>;
