import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabasePool } from '../../db/pool';
import { createPostgresCustomerNotificationStore } from '../../modules/inbox/customer-store';

/*
 * Deleting from the notification centre against the local database (migration 20261231096000):
 * a customer removes only their own entries, a cut-off clears only what existed at that moment,
 * and nothing but the notification-centre row is touched.
 */

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 4 });
const store = createPostgresCustomerNotificationStore(pool);
const NO_TOKEN = 'direct-connection';
const run = randomUUID().slice(0, 8);
const users: string[] = [];
let mine: string;
let theirs: string;

async function addUser(label: string): Promise<string> {
  const id = randomUUID();
  await pool.query('select public.provision_account($1::uuid, $2, $3, null, null, true)', [
    id,
    `it-nc-${run}-${label}@example.com`,
    `Notices ${label}`,
  ]);
  users.push(id);
  return id;
}

async function addNotice(user: string, minutesAgo: number): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into public.customer_notifications
       (user_id, kind, title, entity_type, entity_id, dedupe_key, created_at)
     values ($1, 'order_update', 'Order update', 'order', $2, $3, now() - make_interval(mins => $4))
     returning id`,
    [user, randomUUID(), `nc-${run}-${randomUUID()}`, minutesAgo],
  );
  return (result.rows[0] as { id: string }).id;
}

const countFor = async (user: string): Promise<number> =>
  Number(
    (
      await pool.query<{ n: string }>(
        'select count(*) as n from public.customer_notifications where user_id = $1',
        [user],
      )
    ).rows[0]?.n,
  );

beforeAll(async () => {
  mine = await addUser('mine');
  theirs = await addUser('theirs');
});

afterAll(async () => {
  await pool.query('delete from public.customer_notifications where user_id = any($1::uuid[])', [
    users,
  ]);
  await pool.query('delete from public.profiles where id = any($1::uuid[])', [users]);
  await pool.end();
});

describe('deleting notification-centre entries', () => {
  it('deletes the caller’s own entries and never another customer’s', async () => {
    const own = await addNotice(mine, 5);
    const keep = await addNotice(mine, 4);
    const foreign = await addNotice(theirs, 5);

    // Naming someone else's entry in the same request deletes nothing of theirs.
    const deleted = await store.remove(NO_TOKEN, mine, [own, foreign]);

    expect(deleted).toBe(1);
    expect(await countFor(mine)).toBe(1);
    expect(await countFor(theirs)).toBe(1);
    const left = await pool.query(
      'select id from public.customer_notifications where id = any($1::uuid[])',
      [[keep, foreign]],
    );
    expect(left.rowCount).toBe(2);
  });

  it('is exact: deleting an entry again, or one that never existed, counts nothing', async () => {
    const id = await addNotice(mine, 3);
    expect(await store.remove(NO_TOKEN, mine, [id])).toBe(1);
    expect(await store.remove(NO_TOKEN, mine, [id, randomUUID()])).toBe(0);
  });

  it('clears everything up to a cut-off, and leaves a newer entry alone', async () => {
    const before = new Date().toISOString();
    await addNotice(mine, 2);
    const newer = await pool.query<{ id: string }>(
      `insert into public.customer_notifications
         (user_id, kind, title, entity_type, entity_id, dedupe_key, created_at)
       values ($1, 'order_update', 'Arrived after', 'order', $2, $3, now() + interval '1 minute')
       returning id`,
      [mine, randomUUID(), `nc-${run}-${randomUUID()}`],
    );

    const cleared = await store.clear(NO_TOKEN, mine, before);

    expect(cleared).toBeGreaterThanOrEqual(1);
    const remaining = await pool.query<{ id: string }>(
      'select id from public.customer_notifications where user_id = $1',
      [mine],
    );
    expect(remaining.rows.map((row) => row.id)).toEqual([(newer.rows[0] as { id: string }).id]);
    // Another customer's centre is never swept.
    expect(await countFor(theirs)).toBe(1);
  });

  it('refuses the database functions without a signed-in account', async () => {
    await expect(
      pool.query('select public.delete_my_customer_notifications($1::uuid[])', [[randomUUID()]]),
    ).rejects.toBeTruthy();
    await expect(
      pool.query('select public.clear_my_customer_notifications(now())'),
    ).rejects.toBeTruthy();
  });
});
