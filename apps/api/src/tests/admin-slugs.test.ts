import { slugAvailabilityResponseSchema } from '@nilzora/contracts';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  createPostgresAdminCatalogStore,
  createSupabaseAdminCatalogStore,
} from '../modules/admin/catalog-store';
import { StoreUnavailableError } from '../modules/commerce/errors';
import type { SupabaseClients } from '../supabase/clients';
import { adminSetup, errorOf } from './admin-helpers';

/*
 * GET /admin/slugs/availability: validation, the answer's shape, and how both catalog
 * stores call admin_slug_availability. The rules themselves (lengths, reserved brand
 * paths, redirects, suggestions) live in the database function and are covered by
 * supabase/tests/catalog_admin.test.sql; the fake mirrors them for route tests.
 */

const USER = '3f1c9c5e-9a52-4a52-8f0a-2a3a6f0e1111';

describe('GET /api/v1/admin/slugs/availability', () => {
  it('answers a taken product address with the first free suggestion', async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'get',
      '/admin/slugs/availability?kind=product&slug=desk-lamp',
      'staff',
    );

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(slugAvailabilityResponseSchema.parse(response.body)).toEqual({
      available: false,
      reason: 'taken',
      suggestion: 'desk-lamp-2',
    });
  });

  it("counts the edited product's own address as free", async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'get',
      `/admin/slugs/availability?kind=product&slug=desk-lamp&excludeId=${setup.products.lamp.id}`,
      'staff',
    );

    expect(response.body).toEqual({ available: true, reason: null, suggestion: null });
  });

  it.each([
    [
      'category',
      'home-kitchen',
      { available: false, reason: 'taken', suggestion: 'home-kitchen-2' },
    ],
    ['category', 'garden', { available: true, reason: null, suggestion: null }],
    ['brand', 'shop', { available: false, reason: 'reserved', suggestion: 'shop-2' }],
    ['product', 'Desk%20Lamp', { available: false, reason: 'invalid', suggestion: null }],
    ['brand', 'a', { available: false, reason: 'invalid', suggestion: null }],
  ])('answers kind=%s slug=%s', async (kind, slug, expected) => {
    const setup = adminSetup();
    const response = await setup.call(
      'get',
      `/admin/slugs/availability?kind=${kind}&slug=${slug}`,
      'moderator',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expected);
  });

  it.each([
    ['an unknown kind', 'kind=page&slug=x', ['kind']],
    ['no slug', 'kind=product', ['slug']],
    ['an empty slug', 'kind=product&slug=', ['slug']],
    ['a slug over 200 characters', `kind=product&slug=${'a'.repeat(201)}`, ['slug']],
    ['an excludeId that is not a uuid', 'kind=product&slug=x&excludeId=me', ['excludeId']],
  ])('rejects %s before the database', async (_label, query, paths) => {
    const setup = adminSetup();
    const response = await setup.call('get', `/admin/slugs/availability?${query}`, 'staff');

    expect(response.status).toBe(400);
    const error = errorOf(response.body);
    expect(error.code).toBe('validation_failed');
    const issues = (error.details as { issues: { path: string }[] }).issues;
    expect(issues.map((issue) => issue.path)).toEqual(paths);
    expect(setup.admin.calls).toEqual([]);
  });

  it('answers a refusal from the database (NZ412) with 400', async () => {
    const setup = adminSetup();
    setup.admin.nextFailure = { code: 'NZ412' };
    const response = await setup.call(
      'get',
      '/admin/slugs/availability?kind=product&slug=desk-lamp',
      'staff',
    );

    expect(response.status).toBe(400);
  });
});

describe('slug availability in the catalog stores', () => {
  const answer = { available: false, reason: 'taken', suggestion: 'desk-lamp-2' };

  it('calls the function over the pool as the caller', async () => {
    const statements: { sql: string; values: unknown[] }[] = [];
    const client = {
      query: (sql: string, values: unknown[] = []) => {
        statements.push({ sql, values });
        return Promise.resolve({
          rows: sql.includes('admin_slug_availability') ? [{ answer }] : [],
        });
      },
      release: () => undefined,
    } as unknown as PoolClient;
    const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;

    const result = await createPostgresAdminCatalogStore(pool).slugAvailability('token', USER, {
      kind: 'brand',
      slug: 'north-star',
    });

    expect(result).toEqual(answer);
    expect(statements.find((entry) => entry.sql.includes('admin_slug_availability'))).toEqual({
      sql: 'select public.admin_slug_availability($1, $2, $3::uuid) as answer',
      values: ['brand', 'north-star', null],
    });
  });

  function supabase(data: unknown) {
    const calls: { name: string; args: unknown }[] = [];
    const clients = {
      asUser: () => ({
        rpc: (name: string, args: unknown) => {
          calls.push({ name, args });
          return Promise.resolve({ data, error: null });
        },
      }),
    } as unknown as SupabaseClients;
    return { store: createSupabaseAdminCatalogStore(clients), calls };
  }

  it('calls the rpc with the excluded id', async () => {
    const { store, calls } = supabase(answer);
    const excludeId = '0d000000-0000-4000-8000-000000000001';

    await expect(
      store.slugAvailability('token', USER, { kind: 'product', slug: 'desk-lamp', excludeId }),
    ).resolves.toEqual(answer);
    expect(calls).toEqual([
      {
        name: 'admin_slug_availability',
        args: { p_kind: 'product', p_slug: 'desk-lamp', p_exclude_id: excludeId },
      },
    ]);
  });

  it('refuses a contradictory answer (available with a reason)', async () => {
    const { store } = supabase({ available: true, reason: 'taken', suggestion: null });

    await expect(
      store.slugAvailability('token', USER, { kind: 'product', slug: 'desk-lamp' }),
    ).rejects.toBeInstanceOf(StoreUnavailableError);
  });
});
