import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabasePool } from '../../db/pool';
import { createPostgresBroadcastStore } from '../../modules/admin/broadcast-routes';

/*
 * Push settings and broadcasts against the local database (migration 20261231094000): the
 * switch and templates for automatic product announcements, and what a broadcast may carry.
 */

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 4 });
const broadcasts = createPostgresBroadcastStore(pool);
const NO_TOKEN = 'direct-connection';
const run = randomUUID().slice(0, 8);
let owner: string;
let original: { auto: boolean; title: string; body: string };

beforeAll(async () => {
  owner = randomUUID();
  await pool.query('select public.provision_account($1::uuid, $2, $3, null, null, true)', [
    owner,
    `it-push-${run}@example.com`,
    'Push owner',
  ]);
  await pool.query("update public.user_roles set role = 'super_admin' where user_id = $1", [owner]);
  const current = await broadcasts.getSettings(NO_TOKEN, owner);
  original = {
    auto: current.autoAnnounceProducts,
    title: current.productTitleTemplate,
    body: current.productBodyTemplate,
  };
});

afterAll(async () => {
  await broadcasts.saveSettings(NO_TOKEN, owner, {
    autoAnnounceProducts: original.auto,
    productTitleTemplate: original.title,
    productBodyTemplate: original.body,
  });
  await pool.query('delete from public.product_announcements where created_by = $1', [owner]);
  await pool.query('delete from public.profiles where id = $1', [owner]);
  await pool.end();
});

describe('push settings', () => {
  it('reads and saves the switch and the templates', async () => {
    const saved = await broadcasts.saveSettings(NO_TOKEN, owner, {
      autoAnnounceProducts: false,
      productTitleTemplate: 'Fresh: {name}',
      productBodyTemplate: 'Meet {name}',
    });
    expect(saved).toMatchObject({
      autoAnnounceProducts: false,
      productTitleTemplate: 'Fresh: {name}',
    });
    expect(await broadcasts.getSettings(NO_TOKEN, owner)).toMatchObject({
      autoAnnounceProducts: false,
    });
  });

  it('refuses a customer, and an over-long template', async () => {
    const customer = randomUUID();
    await pool.query('select public.provision_account($1::uuid, $2, $3, null, null, true)', [
      customer,
      `it-push-c-${run}@example.com`,
      'Customer',
    ]);
    await expect(broadcasts.getSettings(NO_TOKEN, customer)).rejects.toBeDefined();
    await expect(
      broadcasts.saveSettings(NO_TOKEN, owner, {
        autoAnnounceProducts: true,
        productTitleTemplate: 'x'.repeat(66),
        productBodyTemplate: 'ok',
      }),
    ).rejects.toBeDefined();
    await pool.query('delete from public.profiles where id = $1', [customer]);
  });
});

describe('a broadcast', () => {
  it('can carry a picture, a store link and a send time, and is listed with them', async () => {
    const later = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const created = await broadcasts.create(NO_TOKEN, owner, {
      title: `Verify ${run}`,
      body: 'Scheduled with a picture',
      productId: null,
      imageKey: 'library/0e000000-0000-4000-8000-000000000001',
      linkPath: '/categories/fashion',
      scheduledFor: later,
    });
    expect(created.recipients).toBeGreaterThanOrEqual(0);

    const listed = await broadcasts.list(NO_TOKEN, owner);
    expect(listed.broadcasts.find((item) => item.id === created.id)).toMatchObject({
      linkPath: '/categories/fashion',
      imageKey: 'library/0e000000-0000-4000-8000-000000000001',
    });
  });

  it('refuses a send time in the past or far away, a bad picture key and an off-site link', async () => {
    const base = {
      title: 'x',
      body: 'y',
      productId: null,
      imageKey: null,
      linkPath: null,
      scheduledFor: null,
    };
    await pool.query(
      "delete from public.product_announcements where kind = 'broadcast' and created_by = $1",
      [owner],
    );
    for (const bad of [
      { scheduledFor: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
      { scheduledFor: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString() },
      { imageKey: '../secret' },
      { linkPath: '//evil.example' },
    ]) {
      await expect(broadcasts.create(NO_TOKEN, owner, { ...base, ...bad })).rejects.toBeDefined();
    }
  });
});
