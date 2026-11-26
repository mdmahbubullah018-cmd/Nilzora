import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createDatabasePool } from '../../db/pool';
import { withUser, withServiceRole } from '../../db/user-context';

/*
 * Real integration tests for the two privilege questions the API depends on:
 *
 *  - S1: a signed-in account must not be able to read `profiles.password_hash`. The
 *    `authenticated` role holds a column-level SELECT grant, so this proves the grant is
 *    actually narrow rather than merely believed to be.
 *  - S2: `withUser` demotes the pooled connection for one transaction only. These tests
 *    prove the demotion is undone on success and on failure, so a later borrower of the
 *    same physical connection never inherits another account's identity.
 */

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 1 });

const run = randomUUID().slice(0, 8);
const created: string[] = [];

async function createAccount(label: string): Promise<string> {
  const id = randomUUID();
  await pool.query('select public.provision_account($1::uuid, $2, $3, null, null, true)', [
    id,
    `sec-${run}-${label}@example.com`,
    `Security ${label}`,
  ]);
  created.push(id);
  return id;
}

afterAll(async () => {
  for (const id of created) {
    await pool.query('delete from auth.users where id = $1::uuid', [id]).catch(() => undefined);
  }
  await pool.end();
});

describe('S1: password_hash is not readable by a signed-in account', () => {
  it('refuses a direct select of password_hash as authenticated', async () => {
    const userId = await createAccount('hash-direct');

    await expect(
      withUser(pool, userId, (client) =>
        client.query('select password_hash from public.profiles where id = $1::uuid', [userId]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('refuses select * as authenticated, which would include the hash', async () => {
    const userId = await createAccount('hash-star');

    await expect(
      withUser(pool, userId, (client) => client.query('select * from public.profiles')),
    ).rejects.toThrow(/permission denied/i);
  });

  it('still serves the profile columns the account screen needs', async () => {
    const userId = await createAccount('hash-allowed');

    const result = await withUser(pool, userId, (client) =>
      client.query<{ full_name: string | null; status: string }>(
        'select full_name, phone, status, created_at, updated_at from public.profiles where id = $1::uuid',
        [userId],
      ),
    );

    expect(result.rows[0]?.full_name).toBe('Security hash-allowed');
    expect(result.rows[0]?.status).toBe('active');
  });

  it('still lets the account update its own editable columns', async () => {
    const userId = await createAccount('hash-update');

    const result = await withUser(pool, userId, (client) =>
      client.query<{ full_name: string }>(
        'update public.profiles set full_name = $2 where id = $1::uuid returning full_name',
        [userId, 'Renamed by owner'],
      ),
    );

    expect(result.rows[0]?.full_name).toBe('Renamed by owner');
  });

  it('never exposes password_hash to an anonymous caller', async () => {
    // Each check needs its own transaction: a permission error aborts the current one, so a
    // second assertion inside the same block would only see "transaction is aborted".
    const asAnon = async (sql: string): Promise<void> => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query('set local role anon');
        await client.query(sql);
      } finally {
        await client.query('rollback').catch(() => undefined);
        client.release();
      }
    };

    await expect(asAnon('select password_hash from public.profiles')).rejects.toThrow(
      /permission denied/i,
    );
    await expect(asAnon('select count(*) from public.profiles')).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('keeps the hash reachable for the server-side login path', async () => {
    const userId = await createAccount('hash-service');

    // The value is null for an account provisioned without a password; what matters here is
    // that the service role may still select the column at all.
    const result = await withServiceRole(pool, (client) =>
      client.query<{ password_hash: string | null }>(
        'select password_hash from public.profiles where id = $1::uuid',
        [userId],
      ),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.password_hash).toBeNull();
  });
});

describe('S2: the identity assumed by withUser never outlives its transaction', () => {
  it('restores the connection owner after a successful transaction', async () => {
    const userId = await createAccount('leak-success');

    await withUser(pool, userId, (client) => client.query('select 1'));

    // The pool holds one connection, so this is the same physical session.
    const after = await pool.query<{ who: string }>('select current_user as who');
    expect(after.rows[0]?.who).not.toBe('authenticated');
  });

  it('restores the connection owner after the callback throws', async () => {
    const userId = await createAccount('leak-failure');

    await expect(
      withUser(pool, userId, () => {
        throw new Error('deliberate failure inside the transaction');
      }),
    ).rejects.toThrow('deliberate failure');

    const after = await pool.query<{ who: string }>('select current_user as who');
    expect(after.rows[0]?.who).not.toBe('authenticated');
  });

  it('does not let a later request read another account private row', async () => {
    const owner = await createAccount('leak-owner');
    const stranger = await createAccount('leak-stranger');

    // Leave an unclaimed JWT claim behind on the shared connection, then borrow it again
    // as a different account: the stranger must see only the stranger's own row.
    await withUser(pool, owner, (client) =>
      client.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: owner, role: 'authenticated' }),
      ]),
    );

    const seen = await withUser(pool, stranger, (client) =>
      client.query<{ id: string }>('select id from public.profiles'),
    );

    expect(seen.rows.map((row) => row.id)).toStrictEqual([stranger]);
  });

  it('rejects a userId that is not a UUID before touching the database', async () => {
    await expect(withUser(pool, 'not-a-uuid', (client) => client.query('select 1'))).rejects.toThrow(
      TypeError,
    );
    const after = await pool.query('select 1');
    expect(after.rowCount).toBe(1);
  });
});
