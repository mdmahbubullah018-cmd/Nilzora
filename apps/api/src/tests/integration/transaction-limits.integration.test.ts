import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createDatabasePool } from '../../db/pool';
import { withServiceRole, withUser } from '../../db/user-context';

/*
 * Every transaction the API opens carries its own statement and idle-in-transaction limits
 * (db/user-context.ts), set transaction-locally so they never leak to the next request that
 * reuses the pooled connection.
 */

const { dbUrl } = inject('supabase');
// One connection, so the "does not leak" check reads the very connection that ran the limits.
const pool = createDatabasePool({ connectionString: dbUrl, max: 1 });

afterAll(async () => {
  await pool.end();
});

const setting = async (name: string) =>
  (await pool.query<{ value: string }>('select current_setting($1) as value', [name])).rows[0]
    ?.value;

describe('transaction limits', () => {
  it('apply to a request run as a customer', async () => {
    const values = await withUser(pool, randomUUID(), async (client) => {
      const result = await client.query<{ statement: string; idle: string; role: string }>(
        "select current_setting('statement_timeout') as statement, current_setting('idle_in_transaction_session_timeout') as idle, current_user as role",
      );
      return result.rows[0];
    });
    expect(values).toEqual({ statement: '30s', idle: '1min', role: 'authenticated' });
  });

  it('cancel a statement that runs past the limit, and the error is the standard one', async () => {
    await expect(
      withServiceRole(
        pool,
        async (client) => {
          await client.query('select pg_sleep(2)');
        },
        { statementTimeoutMs: 200, idleInTransactionTimeoutMs: 5_000 },
      ),
    ).rejects.toMatchObject({ code: '57014' });
  });

  it('end with the transaction: the next user of the connection has the server defaults', async () => {
    const before = await setting('statement_timeout');
    await withServiceRole(pool, async (client) => {
      const inside = await client.query<{ role: string }>('select current_user as role');
      expect(inside.rows[0]?.role).toBe('service_role');
    });
    expect(await setting('statement_timeout')).toBe(before);
    expect(await setting('idle_in_transaction_session_timeout')).toBe('0');
    expect(
      (await pool.query<{ role: string }>('select current_user as role')).rows[0]?.role,
    ).not.toBe('service_role');
  });
});
