import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createPostgresChatStore, postgresChatRpc } from './store';

/*
 * The direct-Postgres call path must send arguments the way PostgREST does: a null is an
 * explicit SQL NULL, an undefined argument is left to the function's default. Dropping nulls
 * made every "create" of a template, saved reply, tag or automation rule call a signature that
 * does not exist (p_id has no default), and turned the report queue's "every status" (null)
 * into its default, "open".
 */

const USER = '11111111-1111-4111-8111-111111111111';

function fakePool() {
  const calls: { sql: string; params: unknown[] | undefined }[] = [];
  const client = {
    query: vi.fn((sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return Promise.resolve({ rows: [] });
    }),
    release: vi.fn(),
  };
  const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;
  return { pool, calls };
}

describe('postgresChatRpc', () => {
  it('sends null as SQL NULL and leaves undefined to the default', async () => {
    const { pool, calls } = fakePool();
    await postgresChatRpc(pool)(USER)(
      'chat_report_queue',
      { p_status: null, p_limit: 50, p_offset: undefined },
      true,
    );
    const call = calls.find((entry) => entry.sql.includes('chat_report_queue'));
    expect(call?.sql).toBe('select * from public.chat_report_queue(p_status => $1, p_limit => $2)');
    expect(call?.params).toEqual([null, 50]);
  });

  it('serialises objects as JSON but never turns null into the string "null"', async () => {
    const { pool, calls } = fakePool();
    await postgresChatRpc(pool)(USER)(
      'chat_support_queue',
      { p_id: null, p_conditions: { keywords: ['refund'] } },
      true,
    );
    const call = calls.find((entry) => entry.sql.includes('chat_support_queue'));
    expect(call?.params).toEqual([null, '{"keywords":["refund"]}']);
  });
});

describe('send: the stored message', () => {
  it('has no edit time when the function does not return one (it used to read "undefined")', async () => {
    const row = {
      id: '22222222-2222-4222-8222-222222222222',
      seq: 3,
      sender_id: USER,
      sender_role: 'staff',
      sender_name: 'Agent',
      kind: 'text',
      body: 'Hello',
      reply_to_id: null,
      metadata: {},
      // `send_chat_message` does not return `edited_at`, so the column is absent, not null.
      created_at: '2026-11-09T05:51:59.679Z',
      duplicate: false,
      unread_count: 0,
    };
    const pool = {
      connect: () =>
        Promise.resolve({
          query: vi.fn(() => Promise.resolve({ rows: [row] })),
          release: vi.fn(),
        }),
    } as unknown as Pool;
    const store = createPostgresChatStore(pool, {});
    const sent = await store.send('', USER, '33333333-3333-4333-8333-333333333333', {
      clientMessageId: '44444444-4444-4444-8444-444444444444',
      body: 'Hello',
    });
    expect(sent.message.editedAt).toBeNull();
  });
});
