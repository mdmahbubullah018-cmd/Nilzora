import { ZodError } from 'zod';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { createPostgresInboxStore } from '../modules/inbox/store';

/*
 * The staff inbox store maps database rows to the shared contract.
 *
 * Regression: the chat migrations added `chat_message`/`chat_escalation` to
 * `staff_notification_kind` and `conversation` to `staff_notifications.entity_type`, but
 * the contract still listed only the original five kinds. Because the store validates
 * every row, one chat notification made GET /api/v1/staff/notifications answer 500 for the
 * whole page instead of the rows the caller is entitled to.
 */

const USER = '068ac9f3-559a-4a05-bf8b-6f5c6161e619';
const AT = '2026-11-10T13:47:09.290Z';

interface Row {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  entity_type: string;
  entity_id: string;
  action_path: string | null;
  read_at: string | null;
  created_at: string;
  total_count?: number;
}

/** A pool whose one client answers the transaction preamble, the catalogue probe and the call. */
function poolReturning(rows: Row[]) {
  const statements: string[] = [];
  const client = {
    query: (sql: string) => {
      statements.push(sql);
      // A set-returning call is read as rows; a scalar one goes through functionCallSql.
      if (sql.includes('pg_catalog.pg_proc')) return Promise.resolve({ rows: [{ retset: false }] });
      if (sql.includes('from public.my_staff_notifications')) return Promise.resolve({ rows });
      if (sql.includes('my_unread_notification_count')) {
        return Promise.resolve({
          rows: [{ value: rows.filter((row) => row.read_at === null).length }],
        });
      }
      return Promise.resolve({ rows: [] });
    },
    release: () => undefined,
  } as unknown as PoolClient;
  const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;
  return { pool, statements };
}

const chatRow: Row = {
  id: 'c8b7b4b5-aedb-47d6-ac98-20aa64261311',
  kind: 'chat_message',
  title: 'New message from a customer',
  body: 'Where is my order?',
  entity_type: 'conversation',
  entity_id: '2e186311-5cbc-485c-a188-1705b09dfc8d',
  action_path: '/admin/communication?conversation=2e186311-5cbc-485c-a188-1705b09dfc8d',
  read_at: null,
  created_at: AT,
  total_count: 2,
};

const escalationRow: Row = {
  ...chatRow,
  id: '4d5e6f70-8192-4a3b-8c5d-6e7f8091a2b3',
  kind: 'chat_escalation',
  title: 'A chat needs an owner',
  entity_type: 'conversation',
  read_at: '2026-11-10T14:00:00.000Z',
};

const orderRow: Row = {
  id: '3b21b7b8-d589-432a-b0b7-a7db36ad8e39',
  kind: 'order_new',
  title: 'New order NZ100006',
  body: null,
  entity_type: 'order',
  entity_id: 'NZ100006',
  action_path: '/admin/orders/NZ100006',
  read_at: null,
  created_at: AT,
  total_count: 2,
};

const page = { limit: 25, offset: 0 };

describe('the staff inbox store', () => {
  it('reads a chat notification instead of failing the whole page', async () => {
    const { pool } = poolReturning([chatRow, escalationRow, orderRow]);

    const { notifications, total } = await createPostgresInboxStore(pool).list(
      'token',
      USER,
      {},
      page,
    );

    expect(total).toBe(2);
    expect(notifications).toHaveLength(3);
    expect(notifications[0]).toMatchObject({
      kind: 'chat_message',
      entityType: 'conversation',
      entityId: '2e186311-5cbc-485c-a188-1705b09dfc8d',
      actionPath: '/admin/communication?conversation=2e186311-5cbc-485c-a188-1705b09dfc8d',
      readAt: null,
    });
    expect(notifications[1]).toMatchObject({
      kind: 'chat_escalation',
      readAt: '2026-11-10T14:00:00.000Z',
    });
    expect(notifications[2]).toMatchObject({ kind: 'order_new', entityType: 'order', body: null });
  });

  it('still refuses a kind the contract does not know', async () => {
    // Validation stays strict: a value nobody has taught the API about is a fault, not
    // something to pass through to the browsers.
    const { pool } = poolReturning([{ ...orderRow, kind: 'something_new' }]);

    await expect(
      createPostgresInboxStore(pool).list('token', USER, {}, page),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it('counts the unread rows it was given', async () => {
    const { pool } = poolReturning([chatRow, escalationRow]);

    await expect(createPostgresInboxStore(pool).unreadCount('token', USER)).resolves.toBe(1);
  });
});
