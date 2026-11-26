import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createDatabasePool } from '../../db/pool';
import { withUser } from '../../db/user-context';

/*
 * Replying to one message, over the real database
 * -----------------------------------------------
 * Two things are checked that no adapter test can: a message that carries a file really stores
 * the id of the message it quotes, and a quote aimed at another conversation is refused. The
 * second is the one that matters for safety — a reply reference must never become a way to read
 * across threads.
 */

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 4 });

const run = randomUUID().slice(0, 8);
const created: string[] = [];

async function account(label: string): Promise<string> {
  const id = randomUUID();
  await pool.query('select public.provision_account($1::uuid, $2, $3, null, null, true)', [
    id,
    `it-reply-${run}-${label}-${id.slice(0, 8)}@example.com`,
    `Reply ${label}`,
  ]);
  created.push(id);
  return id;
}

/** A conversation of the caller's own, opened with one message. */
async function openConversation(
  userId: string,
): Promise<{ conversationId: string; messageId: string }> {
  const detail = await withUser(pool, userId, async (client) => {
    const result = await client.query<{ detail: Record<string, unknown> }>(
      "select public.start_chat_conversation('customer_support', null, null, 'Reply test', 'First message', null) as detail",
    );
    return result.rows[0]?.detail;
  });
  const conversationId = (detail?.conversation as { id: string }).id;
  const messages = await withUser(pool, userId, async (client) => {
    const result = await client.query<{ id: string }>(
      'select id from public.chat_messages($1::uuid, null, 30)',
      [conversationId],
    );
    return result.rows;
  });
  return { conversationId, messageId: messages[0]?.id ?? '' };
}

afterAll(async () => {
  if (created.length > 0) {
    await pool.query('delete from public.chat_conversations where customer_id = any($1::uuid[])', [
      created,
    ]);
    await pool.query('delete from public.profiles where id = any($1::uuid[])', [created]);
  }
  await pool.end();
});

describe('replying with a file message', () => {
  it('stores the quoted message on a message that carries an attachment', async () => {
    const customer = await account('customer');
    const { conversationId, messageId } = await openConversation(customer);
    expect(messageId).not.toBe('');

    const file = await withUser(pool, customer, async (client) => {
      const result = await client.query<{ row: Record<string, unknown> }>(
        'select public.begin_chat_attachment($1::uuid, $2, $3, $4, $5, $6, $7) as row',
        [
          conversationId,
          `chat/${conversationId}/${randomUUID()}/full.webp`,
          'parcel.webp',
          'image/webp',
          2048,
          800,
          600,
        ],
      );
      return result.rows[0]?.row;
    });

    const posted = await withUser(pool, customer, async (client) => {
      const result = await client.query<{ row: { message: Record<string, unknown> } }>(
        'select public.post_chat_message($1::uuid, $2::uuid, $3, $4::uuid[], $5::uuid) as row',
        [conversationId, randomUUID(), 'Here is the parcel', [file?.id], messageId],
      );
      return result.rows[0]?.row;
    });
    if (posted === undefined) throw new Error('the message was not stored');

    expect(posted.message.replyToId).toBe(messageId);
    // The file still lands on the new message, not on the one it quotes.
    const stored = await withUser(pool, customer, async (client) => {
      const result = await client.query<{ message_id: string | null }>(
        'select message_id from public.chat_attachments($1::uuid)',
        [conversationId],
      );
      return result.rows;
    });
    expect(stored).toEqual([{ message_id: posted.message.id }]);
  });

  it('refuses to quote a message from another conversation', async () => {
    // Two accounts, so the two threads are certainly different conversations: the API continues a
    // caller's own live thread, which would make a same-account pair ambiguous.
    const owner = await account('owner');
    const other = await account('other');
    const theirs = await openConversation(owner);
    const mine = await openConversation(other);
    expect(mine.conversationId).not.toBe(theirs.conversationId);

    await expect(
      withUser(pool, other, async (client) => {
        await client.query(
          'select public.post_chat_message($1::uuid, $2::uuid, $3, null, $4::uuid)',
          [mine.conversationId, randomUUID(), 'Across threads', theirs.messageId],
        );
      }),
    ).rejects.toThrow(/message not found/i);
  });

  it('describes a quoted message for a reader, and marks a deleted one', async () => {
    const customer = await account('customer');
    const { conversationId, messageId } = await openConversation(customer);

    const summaries = await withUser(pool, customer, async (client) => {
      const result = await client.query<{
        id: string;
        body: string | null;
        deleted: boolean;
        has_attachment: boolean;
      }>('select * from public.chat_message_summaries($1::uuid, $2::uuid[])', [
        conversationId,
        [messageId],
      ]);
      return result.rows;
    });
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.body).toBe('First message');
    expect(summaries[0]?.deleted).toBe(false);
    expect(summaries[0]?.has_attachment).toBe(false);
  });

  it('never describes a message from a conversation the caller cannot read', async () => {
    const owner = await account('owner');
    const stranger = await account('stranger');
    const { conversationId, messageId } = await openConversation(owner);

    await expect(
      withUser(pool, stranger, async (client) => {
        await client.query('select * from public.chat_message_summaries($1::uuid, $2::uuid[])', [
          conversationId,
          [messageId],
        ]);
      }),
    ).rejects.toThrow(/not found|missing permission/i);
  });
});
