import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabasePool } from '../../db/pool';
import { createPostgresOnboardingStore } from '../../modules/onboarding/store';

/*
 * Onboarding against the local database (migrations 20261107090000 and 20261231093000):
 * creating a campaign and a slide through the real store (a new record has no id yet, which
 * must still reach the function), slides with no words, the order sent as a uuid[], and what
 * a customer is served — only enabled slides, in order.
 */

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 4 });
const store = createPostgresOnboardingStore(pool);
const NO_TOKEN = 'direct-connection';
const run = randomUUID().slice(0, 8);
const campaigns: string[] = [];
let owner: string;

const slide = (name: string, extra: Record<string, unknown> = {}) => ({
  internalName: `it-slide-${run}-${name}`,
  heading: '',
  description: '',
  imageKey: null,
  icon: null,
  ctaLabel: null,
  ctaPath: null,
  altText: null,
  isActive: true,
  ...extra,
});

beforeAll(async () => {
  owner = randomUUID();
  await pool.query('select public.provision_account($1::uuid, $2, $3, null, null, true)', [
    owner,
    `it-onboarding-${run}@example.com`,
    'Onboarding owner',
  ]);
  await pool.query("update public.user_roles set role = 'super_admin' where user_id = $1", [owner]);
});

afterAll(async () => {
  if (campaigns.length > 0)
    await pool.query('delete from public.onboarding_campaigns where id = any($1::uuid[])', [
      campaigns,
    ]);
  await pool.query('delete from public.profiles where id = $1', [owner]);
  await pool.end();
});

describe('managing a campaign and its slides', () => {
  it('creates a campaign and slides that have no id yet, and reads them back', async () => {
    const campaignId = await store.saveCampaign(NO_TOKEN, owner, null, {
      internalName: `it-campaign-${run}`,
      kind: 'promotion',
      audience: 'all',
      frequency: 'every_launch',
      repeatDays: null,
      slideSeconds: 5,
      startsAt: '2030-01-01T00:00:00.000Z',
      endsAt: '2030-02-01T00:00:00.000Z',
      isActive: false,
    });
    campaigns.push(campaignId);

    const first = await store.saveSlide(
      NO_TOKEN,
      owner,
      null,
      campaignId,
      slide('words', { description: 'A description and nothing else.' }),
    );
    const second = await store.saveSlide(
      NO_TOKEN,
      owner,
      null,
      campaignId,
      slide('words-2', { heading: 'A heading', description: 'More.' }),
    );
    expect(first.heading).toBe('');
    expect(first.position).toBe(1);
    expect(second.position).toBe(2);

    const campaign = await store.get(NO_TOKEN, owner, campaignId);
    // The database writes timestamps with an offset; the contract has them in the Z form.
    expect(campaign.startsAt).toBe('2030-01-01T00:00:00.000Z');
    expect(campaign.endsAt).toBe('2030-02-01T00:00:00.000Z');
    expect(campaign.slides.map((entry) => entry.internalName)).toEqual([
      `it-slide-${run}-words`,
      `it-slide-${run}-words-2`,
    ]);
  });

  it('refuses a slide with no heading, no description and no picture', async () => {
    const campaignId = campaigns[0];
    if (campaignId === undefined) throw new Error('the first test creates the campaign');

    await expect(
      store.saveSlide(NO_TOKEN, owner, null, campaignId, slide('empty')),
    ).rejects.toThrow();
  });

  it('reorders the slides with a list of ids, and refuses an incomplete list', async () => {
    const campaignId = campaigns[0];
    if (campaignId === undefined) throw new Error('the first test creates the campaign');
    const before = await store.get(NO_TOKEN, owner, campaignId);
    const ids = before.slides.map((entry) => entry.id);

    await store.reorder(NO_TOKEN, owner, campaignId, [...ids].reverse());
    const after = await store.get(NO_TOKEN, owner, campaignId);
    expect(after.slides.map((entry) => entry.id)).toEqual([...ids].reverse());

    await expect(store.reorder(NO_TOKEN, owner, campaignId, ids.slice(0, 1))).rejects.toThrow();
  });

  it('shows a customer only the enabled slides, in order', async () => {
    const campaignId = campaigns[0];
    if (campaignId === undefined) throw new Error('the first test creates the campaign');
    const detail = await store.get(NO_TOKEN, owner, campaignId);
    const [firstSlide, secondSlide] = detail.slides;
    if (firstSlide === undefined || secondSlide === undefined) throw new Error('two slides');

    // Switch the first slide off: the preview (what a customer would be served) loses it.
    await store.saveSlide(NO_TOKEN, owner, firstSlide.id, campaignId, {
      ...slide(firstSlide.internalName.replace(`it-slide-${run}-`, '')),
      heading: firstSlide.heading,
      description: firstSlide.description,
      isActive: false,
    });

    const preview = await store.preview(NO_TOKEN, owner, campaignId);
    expect(preview.slides.map((entry) => entry.id)).toEqual([secondSlide.id]);
  });
});
