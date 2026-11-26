import {
  moderationContentSchema,
  moderationReviewerSchema,
  moderationTaskDetailSchema,
  moderationTaskSummarySchema,
  type ModerationDecision,
  type ModerationReviewer,
  type ModerationScope,
  type ModerationTaskDetail,
  type ModerationTaskStatus,
  type ModerationTaskSummary,
} from '@nilzora/contracts';
import { z } from 'zod';
import type { Pool } from 'pg';
import { withUser } from '../../db/user-context';
import type { NilzoraSupabaseClient, SupabaseClients } from '../../supabase/clients';
import { conform, isoTimestamp, StoreUnavailableError } from '../commerce/errors';
import { toAdminStoreError } from './errors';
import {
  accountRef,
  RANGE_NOT_SATISFIABLE,
  sqlNull,
  staffNames,
  staffNamesForUser,
  type Page,
} from './shared';

/** A review as the caller may see it, before the caller-specific actions are added. */
export type ModerationTaskRecord = Omit<ModerationTaskDetail, 'canDecide'>;

export interface ModerationTaskFilters {
  scope: ModerationScope;
  status?: ModerationTaskStatus | undefined;
}

/**
 * Content reviews, as the signed-in caller. Row Level Security shows a moderator only
 * the reviews assigned to them (assigners and product editors see all), and the
 * database functions decide who may submit, assign, decide or withdraw.
 */
export interface ModerationStore {
  /** Pending reviews oldest first (a queue); other statuses newest first. */
  listTasks(
    accessToken: string,
    userId: string,
    filters: ModerationTaskFilters,
    page: Page,
  ): Promise<{ tasks: ModerationTaskSummary[]; total: number }>;
  getTask(
    accessToken: string,
    userId: string,
    taskId: string,
  ): Promise<ModerationTaskRecord | null>;
  assign(accessToken: string, userId: string, taskId: string, moderatorId: string): Promise<void>;
  decide(
    accessToken: string,
    userId: string,
    taskId: string,
    decision: ModerationDecision,
    note: string | undefined,
  ): Promise<void>;
  withdraw(accessToken: string, userId: string, taskId: string): Promise<void>;
  /** Active accounts that hold content.approve, with their open reviews, for assignment. */
  listReviewers(accessToken: string, userId: string): Promise<ModerationReviewer[]>;
}

const SUMMARY_COLUMNS =
  'id, product_id, status, content, submitted_by, submitted_at, assigned_to, assigned_at, decided_at';
const DETAIL_COLUMNS = `${SUMMARY_COLUMNS}, decided_by, decision_note, product:products(status, moderation_status), moderation_events(kind, actor_id, note, created_at)`;

interface SummaryRow {
  id: string;
  product_id: string;
  status: string;
  content: unknown;
  submitted_by: string | null;
  submitted_at: string | Date;
  assigned_to: string | null;
  assigned_at: string | Date | null;
  decided_at: string | Date | null;
}

interface DetailRow extends SummaryRow {
  decided_by: string | null;
  decision_note: string | null;
  /** Null when the caller may not see the product. */
  product: { status: string; moderation_status: string } | null;
  moderation_events: {
    kind: string;
    actor_id: string | null;
    note: string | null;
    created_at: string | Date;
  }[];
}

type Names = Awaited<ReturnType<typeof staffNames>>;

function toSummary(row: SummaryRow, names: Names) {
  const content = conform(moderationContentSchema, row.content, 'moderation_tasks');
  return {
    id: row.id,
    productId: row.product_id,
    productName: content.name,
    productSku: content.sku,
    status: row.status,
    submittedBy: accountRef(row.submitted_by, names),
    submittedAt: isoTimestamp(row.submitted_at),
    assignedTo: accountRef(row.assigned_to, names),
    assignedAt: row.assigned_at === null ? null : isoTimestamp(row.assigned_at),
    decidedAt: row.decided_at === null ? null : isoTimestamp(row.decided_at),
  };
}

const summariesSchema = z.array(moderationTaskSummarySchema);
const recordSchema = moderationTaskDetailSchema.omit({ canDecide: true });

async function rpc(
  call: PromiseLike<{ error: { code: string; message: string; details?: string | null } | null }>,
  operation: string,
): Promise<void> {
  const { error } = await call;
  if (error) throw toAdminStoreError(error, operation);
}

export function createSupabaseModerationStore(clients: SupabaseClients): ModerationStore {
  function listQuery(
    client: NilzoraSupabaseClient,
    callerId: string,
    filters: ModerationTaskFilters,
    columns: string,
    head: boolean,
  ) {
    let query = client.from('moderation_tasks').select(columns, { count: 'exact', head });
    if (filters.scope === 'mine') query = query.eq('assigned_to', callerId);
    if (filters.scope === 'unassigned') query = query.is('assigned_to', null);
    if (filters.status) query = query.eq('status', filters.status);
    return query;
  }

  return {
    async listTasks(accessToken, callerId, filters, { limit, offset }) {
      const client = clients.asUser(accessToken);
      const ascending = filters.status === 'pending';
      const { data, error, count } = await listQuery(
        client,
        callerId,
        filters,
        SUMMARY_COLUMNS,
        false,
      )
        .order('submitted_at', { ascending })
        .order('id', { ascending })
        .range(offset, offset + limit - 1)
        .overrideTypes<SummaryRow[], { merge: false }>();
      if (error?.code === RANGE_NOT_SATISFIABLE) {
        const counted = await listQuery(client, callerId, filters, 'id', true);
        if (counted.error) throw toAdminStoreError(counted.error, 'moderation_tasks');
        return { tasks: [], total: counted.count ?? 0 };
      }
      if (error) throw toAdminStoreError(error, 'moderation_tasks');
      const names = await staffNames(
        client,
        data.flatMap((row) => [row.submitted_by, row.assigned_to]),
      );
      return {
        tasks: conform(
          summariesSchema,
          data.map((row) => toSummary(row, names)),
          'moderation_tasks',
        ),
        total: count ?? data.length,
      };
    },

    async getTask(accessToken, _userId, taskId) {
      const client = clients.asUser(accessToken);
      const { data, error } = await client
        .from('moderation_tasks')
        .select(DETAIL_COLUMNS)
        .eq('id', taskId)
        .order('created_at', { referencedTable: 'moderation_events' })
        .maybeSingle()
        .overrideTypes<DetailRow | null, { merge: false }>();
      if (error) throw toAdminStoreError(error, 'moderation_tasks');
      if (!data) return null;
      const names = await staffNames(client, [
        data.submitted_by,
        data.assigned_to,
        data.decided_by,
        ...data.moderation_events.map((event) => event.actor_id),
      ]);
      return conform(
        recordSchema,
        {
          ...toSummary(data, names),
          content: data.content,
          decidedBy: accountRef(data.decided_by, names),
          decisionNote: data.decision_note,
          events: data.moderation_events.map((event) => ({
            kind: event.kind,
            actor: accountRef(event.actor_id, names),
            note: event.note,
            at: isoTimestamp(event.created_at),
          })),
          product: data.product
            ? { status: data.product.status, moderationStatus: data.product.moderation_status }
            : null,
        },
        'moderation_tasks',
      );
    },

    assign: (accessToken, _userId, taskId, moderatorId) =>
      rpc(
        clients
          .asUser(accessToken)
          .rpc('assign_moderation_task', { p_task_id: taskId, p_moderator: moderatorId }),
        'assign_moderation_task',
      ),

    decide: (accessToken, _userId, taskId, decision, note) =>
      rpc(
        clients.asUser(accessToken).rpc('decide_moderation_task', {
          p_task_id: taskId,
          p_decision: decision,
          p_note: sqlNull(note),
        }),
        'decide_moderation_task',
      ),

    withdraw: (accessToken, _userId, taskId) =>
      rpc(
        clients.asUser(accessToken).rpc('withdraw_moderation_task', { p_task_id: taskId }),
        'withdraw_moderation_task',
      ),

    async listReviewers(accessToken, _userId) {
      const { data, error } = await clients.asUser(accessToken).rpc('admin_list_reviewers');
      if (error) throw toAdminStoreError(error, 'admin_list_reviewers');
      const reviewers = data.map((row) => ({
        id: row.id,
        name: row.full_name ?? null,
        email: row.email ?? null,
        openReviews: row.open_reviews,
      }));
      return conform(z.array(moderationReviewerSchema), reviewers, 'admin_list_reviewers');
    },
  };
}

/** PostgreSQL exposes custom SQLSTATEs (`NZ4xx`, `23505`, `23514`) as a string `code`. */
function pgFailure(error: unknown): { code: string; message: string; details: string | null } {
  const fields = error as { code?: unknown; message?: unknown; detail?: unknown } | null;
  return {
    code: typeof fields?.code === 'string' ? fields.code : '',
    message: typeof fields?.message === 'string' ? fields.message : 'database request failed',
    details: typeof fields?.detail === 'string' ? fields.detail : null,
  };
}

const SQL_SUMMARY = `t.id, t.product_id, t.status, t.content, t.submitted_by, t.submitted_at,
  t.assigned_to, t.assigned_at, t.decided_at`;

interface SqlSummaryRow extends Omit<SummaryRow, 'submitted_at' | 'assigned_at' | 'decided_at'> {
  submitted_at: string | Date;
  assigned_at: string | Date | null;
  decided_at: string | Date | null;
}

interface SqlDetailRow extends SqlSummaryRow {
  decided_by: string | null;
  decision_note: string | null;
  product_status: string | null;
  product_moderation_status: string | null;
}

/**
 * Content reviews over a direct PostgreSQL connection. Row Level Security still decides
 * which reviews a moderator sees, the functions still decide who may assign, decide or
 * withdraw, and staff names come from `admin_account_names` — the same boundaries as
 * the PostgREST calls had.
 */
export function createPostgresModerationStore(pool: Pool): ModerationStore {
  function failure(error: unknown, operation: string): Error {
    if (error instanceof StoreUnavailableError) return error;
    return toAdminStoreError(pgFailure(error), operation);
  }

  return {
    async listTasks(_accessToken, userId, filters, { limit, offset }) {
      const where = ['true'];
      const parameters: unknown[] = [];
      if (filters.scope === 'mine') {
        parameters.push(userId);
        where.push(`t.assigned_to = $${parameters.length}::uuid`);
      }
      if (filters.scope === 'unassigned') where.push('t.assigned_to is null');
      if (filters.status) {
        parameters.push(filters.status);
        where.push(`t.status = $${parameters.length}::public.moderation_task_status`);
      }
      const ascending = filters.status === 'pending';
      parameters.push(limit, offset);
      const limitIndex = parameters.length - 1;
      const offsetIndex = parameters.length;
      const condition = where.join(' and ');

      try {
        return await withUser(pool, userId, async (client) => {
          const page = await client.query<SqlSummaryRow & { total: string }>(
            `select ${SQL_SUMMARY}, count(*) over () as total
               from public.moderation_tasks t
              where ${condition}
              order by t.submitted_at ${ascending ? 'asc' : 'desc'}, t.id ${ascending ? 'asc' : 'desc'}
              limit $${limitIndex} offset $${offsetIndex}`,
            parameters,
          );
          const rows = page.rows;
          const first = rows[0];
          if (!first) {
            const counted = await client.query<{ total: string }>(
              `select count(*) as total from public.moderation_tasks t where ${condition}`,
              parameters.slice(0, limitIndex - 1),
            );
            return { tasks: [], total: Number(counted.rows[0]?.total ?? 0) };
          }
          const names = await staffNamesForUser(
            pool,
            userId,
            rows.flatMap((row) => [row.submitted_by, row.assigned_to]),
          );
          return {
            tasks: conform(
              summariesSchema,
              rows.map((row) => toSummary(row, names)),
              'moderation_tasks',
            ),
            total: Number(first.total),
          };
        });
      } catch (error) {
        throw failure(error, 'moderation_tasks');
      }
    },

    async getTask(_accessToken, userId, taskId) {
      try {
        return await withUser(pool, userId, async (client) => {
          const tasks = await client.query<SqlDetailRow>(
            `select ${SQL_SUMMARY}, t.decided_by, t.decision_note,
                    p.status::text as product_status,
                    p.moderation_status::text as product_moderation_status
               from public.moderation_tasks t
               left join public.products p on p.id = t.product_id
              where t.id = $1::uuid`,
            [taskId],
          );
          const row = tasks.rows[0];
          if (!row) return null;

          const events = await client.query<{
            kind: string;
            actor_id: string | null;
            note: string | null;
            created_at: string | Date;
          }>(
            `select kind, actor_id, note, created_at
               from public.moderation_events
              where task_id = $1::uuid
              order by created_at, id`,
            [taskId],
          );
          const names = await staffNamesForUser(pool, userId, [
            row.submitted_by,
            row.assigned_to,
            row.decided_by,
            ...events.rows.map((event) => event.actor_id),
          ]);
          return conform(
            recordSchema,
            {
              ...toSummary(row, names),
              content: row.content,
              decidedBy: accountRef(row.decided_by, names),
              decisionNote: row.decision_note,
              events: events.rows.map((event) => ({
                kind: event.kind,
                actor: accountRef(event.actor_id, names),
                note: event.note,
                at: isoTimestamp(event.created_at),
              })),
              product:
                row.product_status === null
                  ? null
                  : {
                      status: row.product_status,
                      moderationStatus: row.product_moderation_status,
                    },
            },
            'moderation_tasks',
          );
        });
      } catch (error) {
        throw failure(error, 'moderation_tasks');
      }
    },

    async assign(_accessToken, userId, taskId, moderatorId) {
      try {
        await withUser(pool, userId, async (client) => {
          await client.query('select public.assign_moderation_task($1::uuid, $2::uuid)', [
            taskId,
            moderatorId,
          ]);
        });
      } catch (error) {
        throw failure(error, 'assign_moderation_task');
      }
    },

    async decide(_accessToken, userId, taskId, decision, note) {
      try {
        await withUser(pool, userId, async (client) => {
          await client.query(
            'select public.decide_moderation_task($1::uuid, $2::public.moderation_task_status, $3)',
            [taskId, decision, note ?? null],
          );
        });
      } catch (error) {
        throw failure(error, 'decide_moderation_task');
      }
    },

    async withdraw(_accessToken, userId, taskId) {
      try {
        await withUser(pool, userId, async (client) => {
          await client.query('select public.withdraw_moderation_task($1::uuid)', [taskId]);
        });
      } catch (error) {
        throw failure(error, 'withdraw_moderation_task');
      }
    },

    async listReviewers(_accessToken, userId) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{
            id: string;
            email: string;
            full_name: string | null;
            open_reviews: number | string;
          }>('select * from public.admin_list_reviewers()');
          const reviewers = result.rows.map((row) => ({
            id: row.id,
            name: row.full_name ?? null,
            email: row.email ?? null,
            openReviews: Number(row.open_reviews),
          }));
          return conform(z.array(moderationReviewerSchema), reviewers, 'admin_list_reviewers');
        });
      } catch (error) {
        throw failure(error, 'admin_list_reviewers');
      }
    },
  };
}
