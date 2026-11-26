import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createDatabasePool } from '../../db/pool';
import { withUser } from '../../db/user-context';
import { createPostgresAccountStore, RoleAssignmentError } from '../../modules/users/accounts';

/*
 * Real integration test for the direct-PostgreSQL identity store: no Supabase Auth and
 * no PostgREST, only a connection that assumes each account's identity exactly as
 * PostgREST did (`set local role authenticated` plus the JWT claims). Fixtures are real
 * `auth.users` rows, whose trigger creates the profile, and are deleted afterwards.
 */

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 4 });
const accounts = createPostgresAccountStore(pool);

/** The shared store interface still passes an access token; the direct connection does not use it. */
const NO_TOKEN = 'direct-connection';

const run = randomUUID().slice(0, 8);
const created: string[] = [];

async function createAccount(label: string, role?: 'super_admin' | 'admin'): Promise<string> {
  const id = randomUUID();
  await pool.query('select public.provision_account($1::uuid, $2, $3, null, null, true)', [
    id,
    `it-${run}-${label}@example.com`,
    `Account ${label}`,
  ]);
  if (role) {
    await pool.query('update public.user_roles set role = $1 where user_id = $2', [role, id]);
  }
  created.push(id);
  return id;
}

afterAll(async () => {
  if (created.length > 0) {
    await pool.query('delete from public.profiles where id = any($1::uuid[])', [created]);
  }
  await pool.end();
});

describe('identity data over the direct connection', () => {
  it('reports the account role, status and permissions through my_access()', async () => {
    const customer = await createAccount('customer');
    await expect(accounts.loadAccess(NO_TOKEN, customer)).resolves.toEqual({
      role: 'customer',
      status: 'active',
      permissions: new Set(),
    });
  });

  it('keeps one account from reading or changing another', async () => {
    const alice = await createAccount('alice');
    const bob = await createAccount('bob');

    const visible = await withUser(pool, alice, async (client) => {
      const result = await client.query<{ id: string }>('select id from public.profiles');
      return result.rows.map((row) => row.id);
    });
    expect(visible).toEqual([alice]);

    // A write aimed at another account matches no rows instead of changing them.
    const changed = await withUser(pool, alice, async (client) => {
      const result = await client.query(
        "update public.profiles set full_name = 'Hijacked' where id = $1",
        [bob],
      );
      return result.rowCount;
    });
    expect(changed).toBe(0);

    const rows = await pool.query<{ full_name: string }>(
      'select full_name from public.profiles where id = $1',
      [bob],
    );
    expect(rows.rows[0]?.full_name).toBe('Account bob');
  });

  it('reads and updates only the caller profile', async () => {
    const account = await createAccount('profile');

    await expect(accounts.getProfile(NO_TOKEN, account)).resolves.toMatchObject({
      fullName: 'Account profile',
      phone: null,
      status: 'active',
    });
    await expect(
      accounts.updateProfile(NO_TOKEN, account, {
        fullName: 'Renamed',
        phone: '+8801712345678',
      }),
    ).resolves.toMatchObject({ fullName: 'Renamed', phone: '+8801712345678' });
  });

  it('refuses a role change from an account that may not assign roles', async () => {
    const customer = await createAccount('nobody');
    const target = await createAccount('target');

    await expect(accounts.assignRole(customer, target, 'admin')).rejects.toMatchObject({
      name: 'RoleAssignmentError',
      refusal: 'actor_not_permitted',
    });
  });

  it('lets an owner grant a role, and the grant applies to the next request', async () => {
    const owner = await createAccount('owner', 'super_admin');
    const target = await createAccount('promoted');

    await expect(accounts.assignRole(owner, target, 'admin')).resolves.toMatchObject({
      userId: target,
      role: 'admin',
    });
    const access = await accounts.loadAccess(NO_TOKEN, target);
    expect(access?.role).toBe('admin');
    await expect(accounts.assignRole(owner, owner, 'admin')).rejects.toBeInstanceOf(
      RoleAssignmentError,
    );
  });
});
