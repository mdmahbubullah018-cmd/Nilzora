import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabasePool } from '../../db/pool';
import { createPostgresPopupStore } from '../../modules/popups/store';

/*
 * Popups against the local database (migrations 20261230090000 and 20261231092000): creating
 * one through the real store (a new popup has no id yet, which must still reach the function),
 * targeting, several popups live at once ranked by priority, and the public read by platform.
 */

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 4 });
const store = createPostgresPopupStore(pool, { mediaBaseUrl: 'https://media.example.test' });
const NO_TOKEN = 'direct-connection';
const run = randomUUID().slice(0, 8);
const ids: string[] = [];
let owner: string;

const payload = (name: string, extra: Record<string, unknown> = {}) => ({
  internalName: `it-popup-${run}-${name}`,
  displayMode: 'artwork',
  delaySeconds: 0,
  frequency: 'once_ever',
  platform: 'both',
  audience: 'all',
  priority: 0,
  isActive: false,
  ...extra,
});

/** A still artwork record, as the upload route would store it. */
async function giveArtwork(id: string): Promise<void> {
  await store.setArtwork(NO_TOKEN, owner, id, {
    key: `popups/${id}/${randomUUID()}`,
    kind: 'still',
    width: 800,
    height: 600,
    bytes: 1000,
    format: 'webp',
  });
}

beforeAll(async () => {
  owner = randomUUID();
  await pool.query('select public.provision_account($1::uuid, $2, $3, null, null, true)', [
    owner,
    `it-popup-${run}@example.com`,
    'Popup owner',
  ]);
  await pool.query("update public.user_roles set role = 'super_admin' where user_id = $1", [owner]);
});

afterAll(async () => {
  if (ids.length > 0)
    await pool.query('delete from public.popups where id = any($1::uuid[])', [ids]);
  await pool.query('delete from public.profiles where id = $1', [owner]);
  await pool.end();
});

describe('creating and targeting popups', () => {
  it('creates a popup that has no id yet, with the targeting it was given', async () => {
    const id = await store.save(
      NO_TOKEN,
      owner,
      null,
      payload('app-guests', { platform: 'app', audience: 'guests', priority: 40 }),
    );
    ids.push(id);

    const saved = await store.get(NO_TOKEN, owner, id);
    expect(saved).toMatchObject({
      platform: 'app',
      audience: 'guests',
      priority: 40,
      isActive: false,
    });
  });

  it('refuses a popup without artwork going live, and an unknown platform', async () => {
    const id = await store.save(NO_TOKEN, owner, null, payload('no-art'));
    ids.push(id);
    await expect(store.setActive(NO_TOKEN, owner, id, true)).rejects.toBeDefined();
    await expect(
      store.save(NO_TOKEN, owner, id, payload('no-art', { platform: 'tv' })),
    ).rejects.toBeDefined();
  });

  it('lets several popups be live, and serves them per platform, best priority first', async () => {
    const low = await store.save(
      NO_TOKEN,
      owner,
      null,
      payload('low', { platform: 'website', priority: 1 }),
    );
    const high = await store.save(
      NO_TOKEN,
      owner,
      null,
      payload('high', { platform: 'both', priority: 90 }),
    );
    const appOnly = await store.save(
      NO_TOKEN,
      owner,
      null,
      payload('app-only', { platform: 'app', priority: 50 }),
    );
    ids.push(low, high, appOnly);
    for (const id of [low, high, appOnly]) {
      await giveArtwork(id);
      await store.setActive(NO_TOKEN, owner, id, true);
    }

    const website = (await store.publicPopups('website')).map((popup) => popup.id);
    const app = (await store.publicPopups('app')).map((popup) => popup.id);

    expect(website.filter((id) => [low, high, appOnly].includes(id))).toEqual([high, low]);
    expect(app.filter((id) => [low, high, appOnly].includes(id))).toEqual([high, appOnly]);
  });

  it('never serves a popup that is off or outside its window', async () => {
    const off = await store.save(NO_TOKEN, owner, null, payload('off'));
    const past = await store.save(
      NO_TOKEN,
      owner,
      null,
      payload('past', { startsAt: '2020-01-01T00:00:00.000Z', endsAt: '2020-01-02T00:00:00.000Z' }),
    );
    ids.push(off, past);
    await giveArtwork(off);
    await giveArtwork(past);
    await store.setActive(NO_TOKEN, owner, past, true);

    const served = (await store.publicPopups('website')).map((popup) => popup.id);
    expect(served).not.toContain(off);
    expect(served).not.toContain(past);
  });
});
