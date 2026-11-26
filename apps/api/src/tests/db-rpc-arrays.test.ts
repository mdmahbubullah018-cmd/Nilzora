import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { bindArguments } from '../modules/db-rpc';
import { createPostgresChatAdminStore } from '../modules/chat/admin-store';
import { postgresChatRpc } from '../modules/chat/store';

/*
 * How array arguments reach Postgres. `post_chat_message(p_attachment_ids uuid[])` used to get
 * the text '["<id>"]' (every object, arrays included, was JSON.stringify'd), which a uuid[]
 * parameter refuses (22P02): the upload succeeded, the message was never created. An array
 * for an array-typed parameter must travel as a JS array (which `pg` encodes as a Postgres
 * array); a JSON document for a json/jsonb parameter must still travel as JSON text.
 */

const USER = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';

interface Signature {
  names: string[];
  types: string[];
  modes?: string[] | null;
}

const SIGNATURES: Record<string, Signature> = {
  post_chat_message: {
    names: [
      'p_conversation_id',
      'p_client_message_id',
      'p_body',
      'p_attachment_ids',
      'p_reply_to_id',
    ],
    types: ['uuid', 'uuid', 'text', 'uuid[]', 'uuid'],
  },
  chat_message_summaries: {
    names: ['p_conversation_id', 'p_message_ids', 'id', 'body'],
    types: ['uuid', 'uuid[]', 'uuid', 'text'],
    modes: ['i', 'i', 't', 't'],
  },
  set_chat_conversation_tags: {
    names: ['p_conversation_id', 'p_tag_ids'],
    types: ['uuid', 'uuid[]'],
  },
  start_chat_conversation: {
    names: ['p_kind', 'p_participants'],
    types: ['chat_conversation_type', 'uuid[]'],
  },
  save_chat_automation_rule: {
    names: ['p_name', 'p_conditions', 'p_actions'],
    types: ['text', 'jsonb', 'jsonb'],
  },
};

/** A pool whose catalogue answers from SIGNATURES and whose function calls are recorded. */
function fakePool() {
  const calls: { sql: string; params: unknown[] | undefined }[] = [];
  const query = vi.fn((sql: string, params?: unknown[]) => {
    if (sql.includes('pg_catalog.pg_proc') && sql.includes('proargnames')) {
      const signature = SIGNATURES[String(params?.[0])];
      return Promise.resolve({
        rows: signature
          ? [{ names: signature.names, types: signature.types, modes: signature.modes ?? null }]
          : [],
      });
    }
    calls.push({ sql, params });
    return Promise.resolve({ rows: [{ value: null }] });
  });
  const client = { query, release: vi.fn() };
  const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;
  return { pool, calls, query };
}

describe('array arguments to the chat functions', () => {
  it('passes a uuid[] parameter as an array, not as JSON text', async () => {
    const { pool, calls } = fakePool();
    await postgresChatRpc(pool)(USER)('post_chat_message', {
      p_conversation_id: ID,
      p_client_message_id: ID,
      p_body: 'photo',
      p_attachment_ids: [ID],
      p_reply_to_id: null,
    });
    const call = calls.find((entry) => entry.sql.includes('post_chat_message'));
    expect(call?.params).toEqual([ID, ID, 'photo', [ID], null]);
    expect(Array.isArray(call?.params?.[3])).toBe(true);
  });

  it.each([
    ['chat_message_summaries', { p_conversation_id: ID, p_message_ids: [ID] }],
    ['set_chat_conversation_tags', { p_conversation_id: ID, p_tag_ids: [ID] }],
    ['start_chat_conversation', { p_kind: 'internal_group', p_participants: [ID] }],
  ])('passes the array of %s as an array', async (name, args) => {
    const { pool, calls } = fakePool();
    await postgresChatRpc(pool)(USER)(name, args);
    const call = calls.find((entry) => entry.sql.includes(name));
    expect(call?.params).toEqual(Object.values(args));
  });

  it('still sends a JSON document (an array or an object) to a jsonb parameter as text', async () => {
    const { pool, calls } = fakePool();
    await postgresChatRpc(pool)(USER)('save_chat_automation_rule', {
      p_name: 'Rule',
      p_conditions: { keywords: ['refund'] },
      p_actions: [{ type: 'pause_automation' }],
    });
    const call = calls.find((entry) => entry.sql.includes('save_chat_automation_rule'));
    expect(call?.params).toEqual([
      'Rule',
      '{"keywords":["refund"]}',
      '[{"type":"pause_automation"}]',
    ]);
  });

  it('sends an empty array to an array parameter as an empty array', async () => {
    const { pool, calls } = fakePool();
    await postgresChatRpc(pool)(USER)('set_chat_conversation_tags', {
      p_conversation_id: ID,
      p_tag_ids: [],
    });
    const call = calls.find((entry) => entry.sql.includes('set_chat_conversation_tags'));
    expect(call?.params).toEqual([ID, []]);
  });

  it('keeps the previous behaviour (JSON text) for a function the catalogue does not describe', async () => {
    const { pool, calls } = fakePool();
    await postgresChatRpc(pool)(USER)('unknown_function', { p_list: [ID] });
    const call = calls.find((entry) => entry.sql.includes('unknown_function'));
    expect(call?.params).toEqual([JSON.stringify([ID])]);
  });

  it('reads the catalogue only when an array is sent, and once per function', async () => {
    const { query } = fakePool();
    const client = { query } as unknown as Parameters<typeof bindArguments>[0];
    const lookups = () => query.mock.calls.filter(([sql]) => String(sql).includes('proargnames'));

    await bindArguments(client, 'post_chat_message', [['p_body', 'text']]);
    expect(lookups()).toHaveLength(0);

    await bindArguments(client, 'post_chat_message', [['p_attachment_ids', [ID]]]);
    await bindArguments(client, 'post_chat_message', [['p_attachment_ids', [ID]]]);
    expect(lookups().length).toBeLessThanOrEqual(1);
  });

  it('reaches the real caller: attaching files and quoting a reply through the admin store', async () => {
    const { pool, calls } = fakePool();
    const store = createPostgresChatAdminStore(pool);
    await store
      .postMessage('', USER, {
        conversationId: ID,
        clientMessageId: ID,
        body: 'photo',
        attachmentIds: [ID],
      })
      .catch(() => undefined);
    const call = calls.find((entry) => entry.sql.includes('post_chat_message'));
    expect(call?.params?.[3]).toEqual([ID]);
  });
});
