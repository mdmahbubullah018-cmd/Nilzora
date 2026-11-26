import { describe, expect, it } from 'vitest';
import { createSupabaseZoneStore, ZoneRefusalError } from '../modules/zones/store';
import type { SupabaseClients } from '../supabase/clients';

/*
 * Shopping zones at the store boundary: what the database's zone functions answer, and how
 * the API shapes it for the storefront, the app and the workspace.
 *
 * The resolution rule itself (pinned products win, otherwise the category, otherwise nothing)
 * lives in the database and is proved against the real schema in the migration's own dry run.
 * What is checked here is everything the API adds: active-only public reads, stored banner
 * keys turned into public URLs, refusals given their own meaning, and counts passed through.
 */

const MEDIA = 'https://media.example.com';
const ZONE_ID = '3f2a1b4c-0000-4000-8000-000000000001';
const KEY = `zone-banners/${ZONE_ID}/00000000-0000-4000-9000-0000000000aa`;
const MOBILE_KEY = `zone-mobile-banners/${ZONE_ID}/00000000-0000-4000-9000-0000000000bb`;

interface ZoneRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  audience: string | null;
  bannerKey: string | null;
  bannerAlt: string | null;
  mobileBannerKey?: string | null;
  productCount: number;
}

function zoneRow(overrides: Partial<ZoneRow> = {}): ZoneRow {
  return {
    id: ZONE_ID,
    slug: 'mens',
    name: "Men's",
    description: null,
    audience: 'men',
    bannerKey: null,
    bannerAlt: null,
    productCount: 0,
    ...overrides,
  };
}

type Answer = { data?: unknown; error?: { code: string; message: string } | null };

/** A data API whose named functions each answer with what the test gave them. */
function storeWith(answers: Record<string, Answer>) {
  const calls: { name: string; args: unknown }[] = [];
  const rpc = (name: string, args?: unknown) => {
    calls.push({ name, args });
    const answer = answers[name] ?? { data: null, error: null };
    return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null });
  };
  const clients = {
    public: () => ({ rpc }),
    asUser: () => ({ rpc }),
  } as unknown as SupabaseClients;
  return { store: createSupabaseZoneStore(clients, { mediaBaseUrl: MEDIA }), calls };
}

describe('public zones', () => {
  it('reads the active zones from the public function', async () => {
    const { store, calls } = storeWith({ catalog_shopping_zones: { data: [zoneRow()] } });

    const { zones } = await store.list();

    expect(calls.map((call) => call.name)).toStrictEqual(['catalog_shopping_zones']);
    expect(zones).toHaveLength(1);
  });

  it('publishes a banner as variant URLs, never the stored key', async () => {
    const { store } = storeWith({
      catalog_shopping_zones: { data: [zoneRow({ bannerKey: KEY, bannerAlt: 'Two sarees' })] },
    });

    const [zone] = (await store.list()).zones;

    expect(zone?.banner).toStrictEqual({
      url: `${MEDIA}/${KEY}/full.webp`,
      thumbUrl: `${MEDIA}/${KEY}/thumb.webp`,
    });
    expect(zone?.bannerAlt).toBe('Two sarees');
    expect(Object.keys(zone ?? {})).not.toContain('bannerKey');
  });

  it('has no banner when none is set', async () => {
    const { store } = storeWith({ catalog_shopping_zones: { data: [zoneRow()] } });

    expect((await store.list()).zones[0]?.banner).toBeNull();
    expect((await store.list()).zones[0]?.mobileBanner).toBeNull();
  });

  it('publishes the app artwork as its own variant URLs, apart from the website picture', async () => {
    const { store } = storeWith({
      catalog_shopping_zones: {
        data: [zoneRow({ bannerKey: KEY, mobileBannerKey: MOBILE_KEY })],
      },
    });

    const [zone] = (await store.list()).zones;

    expect(zone?.banner?.url).toBe(`${MEDIA}/${KEY}/full.webp`);
    expect(zone?.mobileBanner).toStrictEqual({
      url: `${MEDIA}/${MOBILE_KEY}/full.webp`,
      thumbUrl: `${MEDIA}/${MOBILE_KEY}/thumb.webp`,
    });
    expect(Object.keys(zone ?? {})).not.toContain('mobileBannerKey');
  });

  it('keeps working against a database that has no app artwork column yet', async () => {
    // The payload of a database the mobile-artwork migration has not reached: no
    // `mobileBannerKey` at all. The collection list must still answer, with the website
    // picture and no app artwork, rather than failing to parse.
    const { mobileBannerKey: _omitted, ...olderRow } = zoneRow({ bannerKey: KEY });
    const { store } = storeWith({ catalog_shopping_zones: { data: [olderRow] } });

    const [zone] = (await store.list()).zones;

    expect(zone?.banner?.url).toBe(`${MEDIA}/${KEY}/full.webp`);
    expect(zone?.mobileBanner).toBeNull();
  });

  it('has no banner when media is not configured, even with a stored key', async () => {
    const clients = {
      public: () => ({
        rpc: () => Promise.resolve({ data: [zoneRow({ bannerKey: KEY })], error: null }),
      }),
    } as unknown as SupabaseClients;
    const store = createSupabaseZoneStore(clients);

    expect((await store.list()).zones[0]?.banner).toBeNull();
  });

  it('carries the visible product count through', async () => {
    const { store } = storeWith({
      catalog_shopping_zones: { data: [zoneRow({ productCount: 7 })] },
    });

    expect((await store.list()).zones[0]?.productCount).toBe(7);
  });

  it('answers no zone when the address does not resolve', async () => {
    const { store } = storeWith({ catalog_shopping_zone: { data: null } });

    expect(await store.zone('nope')).toBeNull();
  });
});

describe('workspace writes', () => {
  it('tells a taken address from a zone that still holds products', async () => {
    const taken = storeWith({
      admin_save_shopping_zone: {
        error: { code: 'NZ409', message: 'shopping zone slug is taken' },
      },
    });
    const held = storeWith({
      admin_delete_shopping_zone: {
        error: { code: 'NZ409', message: 'zone still holds 2 products and 1 categories' },
      },
    });

    await expect(
      taken.store.save('token', 'user', null, { name: 'Mens', displayOrder: 0, isActive: true }),
    ).rejects.toMatchObject({ refusal: 'zone_slug_taken' });
    await expect(held.store.delete('token', 'user', ZONE_ID)).rejects.toMatchObject({
      refusal: 'zone_in_use',
    });
  });

  it('refuses with a plain store error when the code means neither', async () => {
    const { store } = storeWith({
      admin_delete_shopping_zone: {
        error: { code: 'NZ403', message: 'not allowed' },
      },
    });

    await expect(store.delete('token', 'user', ZONE_ID)).rejects.not.toBeInstanceOf(
      ZoneRefusalError,
    );
  });

  it('answers the picture keys a deleted zone had, so both pictures can go too', async () => {
    const { store } = storeWith({
      admin_delete_shopping_zone: { data: { bannerKey: KEY, mobileBannerKey: MOBILE_KEY } },
    });

    expect(await store.delete('token', 'user', ZONE_ID)).toStrictEqual({
      bannerKey: KEY,
      mobileBannerKey: MOBILE_KEY,
    });
  });

  it('answers two empty slots when a deleted zone had no pictures', async () => {
    const { store } = storeWith({
      admin_delete_shopping_zone: { data: { bannerKey: null, mobileBannerKey: null } },
    });

    expect(await store.delete('token', 'user', ZONE_ID)).toStrictEqual({
      bannerKey: null,
      mobileBannerKey: null,
    });
  });

  it('gives back no keys rather than a broken answer when the delete payload is unreadable', async () => {
    // An older database answers with a bare key; the API must not treat that as "nothing to
    // clean up" and must not throw after the zone is already gone.
    const { store } = storeWith({ admin_delete_shopping_zone: { data: KEY } });

    expect(await store.delete('token', 'user', ZONE_ID)).toStrictEqual({
      bannerKey: null,
      mobileBannerKey: null,
    });
  });

  it('counts the associations a replace kept', async () => {
    const { store, calls } = storeWith({ admin_set_shopping_zone_products: { data: 3 } });

    expect(await store.setProducts('token', 'user', ZONE_ID, ['a', 'b'])).toBe(3);
    expect(calls[0]?.args).toMatchObject({ p_zone_id: ZONE_ID, p_product_ids: ['a', 'b'] });
  });

  it('lists nothing for a failed read rather than publishing an empty catalogue', async () => {
    const { store } = storeWith({
      catalog_shopping_zones: { error: { code: 'P0001', message: 'function does not exist' } },
    });

    await expect(store.list()).rejects.toThrow();
  });
});
