import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { CatalogCache } from '../cache';
import { AdminRefusalError } from '../modules/admin/errors';
import { variantKeys } from '../modules/media/images';
import { merchandisingRouter } from '../modules/merchandising/routes';
import {
  createSupabaseMerchandisingStore,
  type MerchandisingStore,
} from '../modules/merchandising/store';
import type { SupabaseClients } from '../supabase/clients';
import { errorOf } from './commerce-helpers';
import { FakeIdentity } from './fakes';
import { captureLogs, testApp } from './helpers';
import { failingObjectStore } from './media-fakes';

/*
 * DELETE /admin/brands/:brandId: products.read + products.publish, refused while products
 * belong to the brand, and the logo objects removed only once the delete has succeeded.
 * The database function (admin_delete_brand) is covered by catalog_admin.test.sql.
 */

const noLimit: RequestHandler = (_req, _res, next) => next();
const BASE_URL = 'https://media.example.com';

function setup() {
  const identity = new FakeIdentity();
  const users = {
    owner: identity.addUser({ email: 'owner@example.com', role: 'super_admin' }),
    admin: identity.addUser({ email: 'admin@example.com', role: 'admin' }),
    staff: identity.addUser({ email: 'staff@example.com', role: 'staff' }),
    customer: identity.addUser({ email: 'customer@example.com', role: 'customer' }),
  };
  type Who = keyof typeof users;
  const tokens = Object.fromEntries(
    Object.entries(users).map(([who, user]) => [who, identity.tokenFor(user)]),
  ) as Record<Who, string>;

  const brands = {
    withLogo: randomUUID(),
    withLogoAndBanner: randomUUID(),
    withoutLogo: randomUUID(),
    withProducts: randomUUID(),
  };
  const logoKey = `brands/${brands.withLogo}/${randomUUID()}`;
  const bannerKey = `brands/${brands.withLogoAndBanner}/${randomUUID()}`;
  const bannerLogoKey = `brands/${brands.withLogoAndBanner}/${randomUUID()}`;
  /** What happened, in order: store calls and bucket deletes. */
  const events: string[] = [];
  const store = {
    deleteBrand: (_accessToken: string, _userId: string, brandId: string) => {
      events.push(`deleteBrand:${brandId}`);
      if (brandId === brands.withProducts) return Promise.reject(new AdminRefusalError('in_use'));
      if (brandId === brands.withLogo) return Promise.resolve({ logoKey, bannerKey: null });
      if (brandId === brands.withLogoAndBanner) {
        return Promise.resolve({ logoKey: bannerLogoKey, bannerKey });
      }
      if (brandId === brands.withoutLogo)
        return Promise.resolve({ logoKey: null, bannerKey: null });
      return Promise.reject(new AdminRefusalError('not_found'));
    },
  } as unknown as MerchandisingStore;

  /** Keys a record still uses; every other picture is free to delete. */
  const stillUsed = new Set<string>();
  const checked: string[] = [];
  const references = {
    inUse: (key: string) => {
      checked.push(key);
      if (failChecks) return Promise.resolve(null);
      return Promise.resolve(stillUsed.has(key));
    },
  };
  let failChecks = false;

  const objects = failingObjectStore();
  const logs = captureLogs('info');
  const storage = {
    objects: {
      put: objects.store.put,
      deleteMany: (keys: readonly string[]) => {
        events.push(`deleteObjects:${keys.join(',')}`);
        return objects.store.deleteMany(keys);
      },
    },
    publicBaseUrl: BASE_URL,
  };
  const app = testApp({
    auth: identity.deps,
    logger: logs.logger,
    modules: [
      merchandisingRouter({
        ...identity.deps,
        store,
        storage,
        references,
        limiter: noLimit,
        logger: logs.logger,
      }),
    ],
  });

  const remove = (brandId: string, who?: Who) => {
    const pending = request(app).delete(`/api/v1/admin/brands/${brandId}`);
    return who ? pending.set('Authorization', `Bearer ${tokens[who]}`) : pending;
  };
  return {
    users,
    brands,
    logoKey,
    bannerKey,
    bannerLogoKey,
    events,
    objects,
    logs,
    remove,
    stillUsed,
    checked,
    fail: () => {
      failChecks = true;
    },
  };
}

const CALLER = '00000000-0000-4000-8000-0000000000aa';

describe('DELETE /api/v1/admin/brands/:brandId', () => {
  it('deletes a brand, then removes its logo objects', async () => {
    const s = setup();
    const response = await s.remove(s.brands.withLogo, 'admin');

    expect(response.status).toBe(204);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(s.events).toEqual([
      `deleteBrand:${s.brands.withLogo}`,
      `deleteObjects:${variantKeys(s.logoKey).join(',')}`,
    ]);
    expect(s.checked).toEqual([s.logoKey]);
  });

  it('removes the banner objects too, after the delete, when the brand had a banner', async () => {
    const s = setup();
    const response = await s.remove(s.brands.withLogoAndBanner, 'admin');

    expect(response.status).toBe(204);
    expect(s.events).toEqual([
      `deleteBrand:${s.brands.withLogoAndBanner}`,
      `deleteObjects:${variantKeys(s.bannerLogoKey).join(',')}`,
      `deleteObjects:${variantKeys(s.bannerKey).join(',')}`,
    ]);
    // Both pictures are checked before anything is deleted.
    expect(s.checked).toEqual([s.bannerLogoKey, s.bannerKey]);
  });

  it('keeps a picture another record still uses', async () => {
    const s = setup();
    s.stillUsed.add(s.bannerKey);
    const response = await s.remove(s.brands.withLogoAndBanner, 'admin');

    expect(response.status).toBe(204);
    expect(s.events).toEqual([
      `deleteBrand:${s.brands.withLogoAndBanner}`,
      `deleteObjects:${variantKeys(s.bannerLogoKey).join(',')}`,
    ]);
    expect(s.logs.raw()).toContain('Picture kept: a record still uses it');
  });

  it('keeps the pictures when their references cannot be checked, and says so', async () => {
    const s = setup();
    s.fail();
    const response = await s.remove(s.brands.withLogo, 'admin');

    expect(response.status).toBe(204);
    // Nothing was deleted: an unused file is cheaper than a broken image.
    expect(s.events).toEqual([`deleteBrand:${s.brands.withLogo}`]);
    expect(s.logs.raw()).toContain('its references could not be checked');
  });

  it('touches no objects for a brand without a logo or banner', async () => {
    const s = setup();
    const response = await s.remove(s.brands.withoutLogo, 'owner');

    expect(response.status).toBe(204);
    expect(s.events).toEqual([`deleteBrand:${s.brands.withoutLogo}`]);
    expect(s.checked).toEqual([]);
  });

  it('refuses a brand that products still belong to with 409 brand_in_use, keeping its logo', async () => {
    const s = setup();
    const response = await s.remove(s.brands.withProducts, 'admin');

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('brand_in_use');
    expect(s.events).toEqual([`deleteBrand:${s.brands.withProducts}`]);
  });

  it('answers 404 for an unknown brand', async () => {
    const s = setup();
    const response = await s.remove(randomUUID(), 'admin');

    expect(response.status).toBe(404);
    expect(s.objects.state.deletes).toEqual([]);
  });

  it('answers 204 even when the logo objects cannot be deleted (orphans are logged)', async () => {
    const s = setup();
    s.objects.state.failDelete = true;
    const response = await s.remove(s.brands.withLogo, 'admin');

    expect(response.status).toBe(204);
    expect(s.logs.raw()).toContain('Picture objects not deleted');
  });

  it.each([
    ['anonymous callers', undefined, 401],
    ['customers', 'customer' as const, 403],
    ['staff, who cannot publish', 'staff' as const, 403],
  ])('refuses %s before the database', async (_label, who, status) => {
    const s = setup();
    const response = await s.remove(s.brands.withLogo, who);

    expect(response.status).toBe(status);
    expect(s.events).toEqual([]);
  });

  it('refuses an admin whose products.publish is denied, before the database', async () => {
    const s = setup();
    s.users.admin.overrides.set('products.publish', 'deny');
    const response = await s.remove(s.brands.withLogo, 'admin');

    expect(response.status).toBe(403);
    expect(errorOf(response.body).code).toBe('forbidden');
    expect(s.events).toEqual([]);
  });

  it('rejects an id that is not a uuid', async () => {
    const s = setup();
    const response = await s.remove('north-star', 'admin');

    expect(response.status).toBe(400);
    expect(s.events).toEqual([]);
  });
});

describe('deleteBrand through Supabase', () => {
  function clients(result: { data: unknown; error: unknown }, brandRow: unknown = null) {
    const calls: { name: string; args: unknown; token: string }[] = [];
    // The banner key is read before the delete; `brandSelect()` asks once for the column.
    const builder = () => ({
      from: () => ({
        select: () => ({
          limit: () => Promise.resolve({ data: brandRow === null ? [] : [brandRow], error: null }),
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: brandRow, error: null }),
          }),
        }),
      }),
    });
    const supabase = {
      public: builder,
      asUser: (token: string) => ({
        ...builder(),
        rpc: (name: string, args: unknown) => {
          calls.push({ name, args, token });
          return Promise.resolve(result);
        },
      }),
    } as unknown as SupabaseClients;
    let invalidated = 0;
    const cache = {
      enabled: true,
      read: <T>(_key: unknown, _parse: unknown, load: () => Promise<T>) => load(),
      invalidate: () => {
        invalidated += 1;
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
    } as unknown as CatalogCache;
    const store = createSupabaseMerchandisingStore(supabase, { cache });
    return { store, calls, invalidated: () => invalidated };
  }

  it('calls admin_delete_brand as the caller, answers both pictures and clears the cache', async () => {
    const brandId = randomUUID();
    const key = `brands/${brandId}/${randomUUID()}`;
    const banner = `brands/${brandId}/${randomUUID()}`;
    const { store, calls, invalidated } = clients(
      { data: key, error: null },
      { banner_key: banner },
    );

    await expect(store.deleteBrand('caller-token', CALLER, brandId)).resolves.toEqual({
      logoKey: key,
      bannerKey: banner,
    });
    expect(calls).toEqual([
      { name: 'admin_delete_brand', args: { p_brand_id: brandId }, token: 'caller-token' },
    ]);
    expect(invalidated()).toBe(1);
  });

  it('answers a null banner for a brand that had none, and for a database without the column', async () => {
    const brandId = randomUUID();
    const key = `brands/${brandId}/${randomUUID()}`;
    const { store } = clients({ data: key, error: null });

    await expect(store.deleteBrand('caller-token', CALLER, brandId)).resolves.toEqual({
      logoKey: key,
      bannerKey: null,
    });
  });

  it('maps products still belonging to the brand (NZ442) to the in_use refusal', async () => {
    const { store, invalidated } = clients({
      data: null,
      error: { code: 'NZ442', message: 'products still belong to the brand' },
    });

    await expect(store.deleteBrand('caller-token', CALLER, randomUUID())).rejects.toMatchObject({
      refusal: 'in_use',
    });
    expect(invalidated()).toBe(0);
  });
});
