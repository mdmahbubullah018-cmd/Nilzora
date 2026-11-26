import type { DomainEvent } from '@nilzora/contracts';
import type { Pool } from 'pg';
import { withServiceRole, withUser } from '../../db/user-context';

/** A row of public.domain_events as the worker sees it. */
export interface OutboxEvent extends DomainEvent {
  recipientUserId: string | null;
  audiencePermission: string | null;
  attempts: number;
}

export interface OutboxStats {
  pending: number;
  deadLettered: number;
  oldestPendingSeconds: number | null;
  publishedLastHour: number;
}

export interface DomainEventStore {
  claim(limit: number, leaseSeconds: number): Promise<OutboxEvent[]>;
  complete(id: string): Promise<void>;
  /** Resolves true when the event was dead-lettered by this failure. */
  fail(id: string, error: string, maxAttempts: number): Promise<boolean>;
  processedConsumers(id: string): Promise<string[]>;
  /** False when the consumer had already processed it (a duplicate delivery). */
  recordProcessed(consumer: string, id: string): Promise<boolean>;
  stats(): Promise<OutboxStats>;
  prune(olderThanDays: number): Promise<number>;
  /** The caller's own and permission-addressed events after a cursor (RLS-free, via the function). */
  forUser(userId: string, after: number, limit: number): Promise<DomainEvent[]>;
  cursor(userId: string): Promise<number>;
}

interface EventRow {
  id: string;
  seq: string | number;
  event_type: string;
  event_version: number;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  occurred_at: Date | string;
  recipient_user_id?: string | null;
  audience_permission?: string | null;
  attempts?: number;
  event_id?: string;
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function toEvent(row: EventRow): DomainEvent {
  return {
    seq: Number(row.seq),
    id: row.event_id ?? row.id,
    type: row.event_type,
    version: row.event_version,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    payload: row.payload,
    occurredAt: iso(row.occurred_at),
  };
}

export function createPostgresDomainEventStore(pool: Pool): DomainEventStore {
  const service = <T>(run: Parameters<typeof withServiceRole<T>>[1]) => withServiceRole(pool, run);
  return {
    claim: (limit, leaseSeconds) =>
      service(async (client) => {
        const result = await client.query<EventRow>(
          'select * from public.claim_domain_events($1, $2)',
          [limit, leaseSeconds],
        );
        return result.rows.map((row) => ({
          ...toEvent(row),
          recipientUserId: row.recipient_user_id ?? null,
          audiencePermission: row.audience_permission ?? null,
          attempts: row.attempts ?? 0,
        }));
      }),
    complete: (id) =>
      service(async (client) => {
        await client.query('select public.complete_domain_event($1::uuid)', [id]);
      }),
    fail: (id, error, maxAttempts) =>
      service(async (client) => {
        const result = await client.query<{ dead: boolean }>(
          'select public.fail_domain_event($1::uuid, $2, $3) as dead',
          [id, error.slice(0, 300), maxAttempts],
        );
        return result.rows[0]?.dead === true;
      }),
    processedConsumers: (id) =>
      service(async (client) => {
        const result = await client.query<{ consumers: string[] }>(
          'select public.processed_consumers($1::uuid) as consumers',
          [id],
        );
        return result.rows[0]?.consumers ?? [];
      }),
    recordProcessed: (consumer, id) =>
      service(async (client) => {
        const result = await client.query<{ fresh: boolean }>(
          'select public.record_processed_event($1, $2::uuid) as fresh',
          [consumer, id],
        );
        return result.rows[0]?.fresh === true;
      }),
    stats: () =>
      service(async (client) => {
        const result = await client.query<{
          pending: string;
          dead_lettered: string;
          oldest_pending_seconds: number | null;
          published_last_hour: string;
        }>('select * from public.domain_event_stats()');
        const row = result.rows[0];
        return {
          pending: Number(row?.pending ?? 0),
          deadLettered: Number(row?.dead_lettered ?? 0),
          oldestPendingSeconds: row?.oldest_pending_seconds ?? null,
          publishedLastHour: Number(row?.published_last_hour ?? 0),
        };
      }),
    prune: (olderThanDays) =>
      service(async (client) => {
        const result = await client.query<{ count: number }>(
          'select public.prune_domain_events($1) as count',
          [olderThanDays],
        );
        return result.rows[0]?.count ?? 0;
      }),
    forUser: (userId, after, limit) =>
      withUser(pool, userId, async (client) => {
        const result = await client.query<EventRow>(
          'select * from public.my_domain_events($1, $2)',
          [after, limit],
        );
        return result.rows.map(toEvent);
      }),
    cursor: (userId) =>
      withUser(pool, userId, async (client) => {
        const result = await client.query<{ cursor: string }>(
          'select public.domain_event_cursor() as cursor',
        );
        return Number(result.rows[0]?.cursor ?? 0);
      }),
  };
}
