import type { Pool, PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { createPostgresOnboardingStore } from '../modules/onboarding/store';

/*
 * Whose identity the database sees when the pool-backed store runs onboarding.
 *
 * The audience rule and the account's own history are applied inside the database from
 * auth.uid(), so a signed-in customer must be asked about as `authenticated` with their own
 * `sub` claim, and a guest as `anon` with none. These tests record the exact statements the
 * store sends and prove that, without a database: they show which identity is assumed, not
 * that the SQL rules are right (those live in the migration).
 */

const USER = '3f1c9c5e-9a52-4a52-8f0a-2a3a6f0e1111';
const OTHER = '9b7d2d3a-4c1e-4f55-9d2b-5e8d1c0a2222';
const CAMPAIGN = '0d000000-0000-4000-8000-000000000001';
const SLIDE = '0d000000-0000-4000-8000-000000000002';

const payload = {
  id: CAMPAIGN,
  kind: 'welcome',
  frequency: 'first_launch',
  repeatDays: null,
  slideSeconds: 5,
  endsAt: null,
  slides: [
    {
      id: SLIDE,
      heading: 'Discover Nilzora',
      description: 'One shop.',
      imageKey: null,
      icon: 'shop',
      ctaLabel: null,
      ctaPath: null,
      altText: null,
      position: 1,
    },
  ],
};

interface Recorded {
  sql: string;
  values: unknown[];
}

/** A pool whose one client records every statement and answers function calls with `answer`. */
function recordingPool(answer: unknown) {
  const statements: Recorded[] = [];
  const client = {
    query: (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (sql.startsWith('select public.')) return Promise.resolve({ rows: [{ value: answer }] });
      // A set-returning call (select * from public.fn(...)) answers its rows directly.
      if (sql.startsWith('select * from public.')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    },
    release: () => undefined,
  } as unknown as PoolClient;
  const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;
  return { pool, statements };
}

/** The role and claims of the identity assumed for the transaction. */
function assumed(statements: readonly Recorded[]) {
  const setup = statements.find((entry) => entry.sql.includes("set_config('role'"));
  if (!setup) return null;
  const [role, claims] = setup.values as [string, string];
  return { role, claims: JSON.parse(claims) as Record<string, unknown> };
}

const functionCall = (statements: readonly Recorded[]) =>
  statements.find(
    (entry) =>
      entry.sql.startsWith('select public.') || entry.sql.startsWith('select * from public.'),
  );

describe('onboarding through the database pool', () => {
  it('asks as an anonymous visitor for a guest, with no account claim', async () => {
    const { pool, statements } = recordingPool(payload);

    const campaign = await createPostgresOnboardingStore(pool).publicCampaign(null, null);

    expect(campaign?.id).toBe(CAMPAIGN);
    expect(assumed(statements)).toEqual({ role: 'anon', claims: { role: 'anon' } });
    expect(functionCall(statements)?.sql).toContain('public.public_onboarding(');
  });

  it('asks as the signed-in customer: authenticated, with their own account as `sub`', async () => {
    const { pool, statements } = recordingPool(payload);

    await createPostgresOnboardingStore(pool).publicCampaign('access-token', USER);

    expect(assumed(statements)).toEqual({
      role: 'authenticated',
      claims: { sub: USER, role: 'authenticated' },
    });
    expect(functionCall(statements)?.sql).toContain('public.public_onboarding(');
  });

  it('records completion under the signed-in customer, for the campaign asked about', async () => {
    const { pool, statements } = recordingPool(null);

    await createPostgresOnboardingStore(pool).complete('access-token', USER, CAMPAIGN);

    expect(assumed(statements)).toEqual({
      role: 'authenticated',
      claims: { sub: USER, role: 'authenticated' },
    });
    const call = functionCall(statements);
    expect(call?.sql).toContain('public.complete_onboarding(');
    expect(call?.values).toEqual([CAMPAIGN]);
    // The account is only ever the claim: it is never a parameter a caller could swap.
    expect(JSON.stringify(call?.values)).not.toContain(USER);
  });

  it('keeps two customers apart: each sees only their own identity', async () => {
    const first = recordingPool(payload);
    const second = recordingPool(payload);

    await createPostgresOnboardingStore(first.pool).complete('token-a', USER, CAMPAIGN);
    await createPostgresOnboardingStore(second.pool).complete('token-b', OTHER, CAMPAIGN);

    expect(assumed(first.statements)?.claims.sub).toBe(USER);
    expect(assumed(second.statements)?.claims.sub).toBe(OTHER);
  });

  it('never downgrades a token to a guest: a call without the verified account id is refused', async () => {
    const { pool, statements } = recordingPool(payload);
    const store = createPostgresOnboardingStore(pool);

    await expect(store.publicCampaign('access-token', null)).rejects.toThrow(TypeError);
    // Nothing reached the database, not even a transaction.
    expect(statements).toEqual([]);
  });

  it('refuses an account id that is not a UUID before any statement runs', async () => {
    const { pool, statements } = recordingPool(payload);

    await expect(
      createPostgresOnboardingStore(pool).complete(
        'access-token',
        "x'; drop table y; --",
        CAMPAIGN,
      ),
    ).rejects.toThrow();
    expect(statements).toEqual([]);
  });

  it('refuses a campaign id that is not a UUID before any statement runs', async () => {
    const { pool, statements } = recordingPool(null);

    await expect(
      createPostgresOnboardingStore(pool).complete('access-token', USER, 'not-a-uuid'),
    ).rejects.toThrow();
    expect(statements).toEqual([]);
  });

  it('keeps admin management on the signed-in account too', async () => {
    const { pool, statements } = recordingPool([]);

    await createPostgresOnboardingStore(pool).list('access-token', USER);

    expect(assumed(statements)?.claims.sub).toBe(USER);
    expect(functionCall(statements)?.sql).toContain('admin_list_onboarding');
  });

  it('reads a campaign whose timestamps carry the database offset (+00:00)', async () => {
    const stored = {
      id: CAMPAIGN,
      internalName: 'Welcome sequence',
      kind: 'promotion',
      audience: 'all',
      frequency: 'first_launch',
      repeatDays: null,
      slideSeconds: 5,
      startsAt: '2026-11-21T08:00:00.123456+00:00',
      endsAt: '2026-11-30T08:00:00+00:00',
      isActive: true,
      updatedAt: '2026-11-21T09:15:30.5+00:00',
      slides: [
        {
          id: SLIDE,
          campaignId: CAMPAIGN,
          internalName: 'Picture only',
          heading: '',
          description: '',
          imageKey: null,
          icon: null,
          ctaLabel: null,
          ctaPath: null,
          altText: null,
          position: 1,
          isActive: true,
        },
      ],
    };
    const { pool } = recordingPool(stored);
    const store = createPostgresOnboardingStore(pool);

    const campaign = await store.get('access-token', USER, CAMPAIGN);

    expect(campaign.updatedAt).toBe('2026-11-21T09:15:30.500Z');
    expect(campaign.startsAt).toBe('2026-11-21T08:00:00.123Z');
    expect(campaign.endsAt).toBe('2026-11-30T08:00:00.000Z');
    // A slide with no words is a legal slide.
    expect(campaign.slides[0]?.heading).toBe('');
  });

  it('serves a promotion’s end time to customers in the Z form the contract wants', async () => {
    const { pool } = recordingPool({ ...payload, endsAt: '2026-11-30T08:00:00+00:00' });

    const campaign = await createPostgresOnboardingStore(pool).publicCampaign('access-token', USER);

    expect(campaign?.endsAt).toBe('2026-11-30T08:00:00.000Z');
  });

  it('answers no campaign when the database answers null', async () => {
    const { pool } = recordingPool(null);
    await expect(
      createPostgresOnboardingStore(pool).publicCampaign('access-token', USER),
    ).resolves.toBeNull();
  });
});
