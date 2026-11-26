import {
  adminCategoryZonesSchema,
  adminProductZonesSchema,
  adminShoppingZoneListResponseSchema,
  shoppingZoneSchema,
  shoppingZonesResponseSchema,
  type AdminCategoryZones,
  type AdminProductZones,
  type AdminSaveShoppingZoneRequest,
  type AdminShoppingZoneListQuery,
  type AdminShoppingZoneListResponse,
  type AdminShoppingZoneDetail,
  type ShoppingZone,
  type ShoppingZonesResponse,
} from '@nilzora/contracts';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { withAnon, withUser } from '../../db/user-context';
import type { SupabaseClients } from '../../supabase/clients';
import { conform, StoreUnavailableError } from '../commerce/errors';
import { toAdminStoreError } from '../admin/errors';
import { sqlNull } from '../admin/shared';
import { pictureFromKey } from '../media/images';

/*
 * Shopping zones
 * --------------
 * A merchandising layer beside the categories. Public reads return active zones only — the
 * database filters, not this module — and every admin write runs as the signed-in account
 * inside a function that checks `zones.manage` itself.
 *
 * Zone banners are stored keys, like every other picture: only the API knows the media host,
 * so a key becomes public URLs here and never reaches a client.
 */

export interface ZoneStoreOptions {
  /** Public address of the media bucket (undefined when media is not configured). */
  mediaBaseUrl?: string | undefined;
}

/** A zone row as the database builds it, with the pictures still keys. */
const dbZoneSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  audience: z.string().nullable(),
  bannerKey: z.string().nullable(),
  bannerAlt: z.string().nullable(),
  /**
   * The app's own artwork. Optional while the zone-mobile-artwork migration may not have run
   * yet: an older database simply answers without the field, and the app keeps using the
   * website's picture instead of the whole collection list failing to parse.
   */
  mobileBannerKey: z.string().nullable().default(null),
  productCount: z.number().int().min(0),
});

const dbZoneListSchema = z.array(dbZoneSchema);

const dbAdminZoneSchema = dbZoneSchema.extend({
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  displayOrder: z.number().int().min(0),
  isActive: z.boolean(),
  explicitProductCount: z.number().int().min(0),
  categoryCount: z.number().int().min(0),
  updatedAt: z.string(),
});

const dbAdminZoneDetailSchema = dbAdminZoneSchema.extend({
  productIds: z.array(z.uuid()).default([]),
  categoryIds: z.array(z.uuid()).default([]),
});

const dbAdminZoneListSchema = z.object({
  zones: z.array(dbAdminZoneSchema),
  noteCounts: z.object({
    active: z.number().int().min(0),
    inactive: z.number().int().min(0),
  }),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});

function bannerOf(key: string | null, mediaBaseUrl: string | undefined) {
  return pictureFromKey(key, mediaBaseUrl);
}

function toZone(row: z.infer<typeof dbZoneSchema>, mediaBaseUrl: string | undefined): ShoppingZone {
  return shoppingZoneSchema.parse({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    audience: row.audience,
    banner: bannerOf(row.bannerKey, mediaBaseUrl),
    bannerAlt: row.bannerAlt,
    mobileBanner: bannerOf(row.mobileBannerKey, mediaBaseUrl),
    productCount: row.productCount,
  });
}

function publicZones(payload: unknown, mediaBaseUrl: string | undefined): ShoppingZonesResponse {
  const rows = conform(dbZoneListSchema, payload, 'catalog_shopping_zones');
  return shoppingZonesResponseSchema.parse({
    zones: rows.map((row) => toZone(row, mediaBaseUrl)),
  });
}

function adminZoneOf(
  row: z.infer<typeof dbAdminZoneDetailSchema>,
  mediaBaseUrl: string | undefined,
): AdminShoppingZoneDetail {
  return {
    ...toZone(row, mediaBaseUrl),
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    displayOrder: row.displayOrder,
    isActive: row.isActive,
    explicitProductCount: row.explicitProductCount,
    categoryCount: row.categoryCount,
    updatedAt: row.updatedAt,
    productIds: row.productIds,
    categoryIds: row.categoryIds,
  };
}

/** Refusals the zone functions raise, as the workspace should read them. */
export type ZoneRefusal = 'zone_slug_taken' | 'zone_in_use';

export class ZoneRefusalError extends Error {
  override readonly name: string = 'ZoneRefusalError';
  readonly refusal: ZoneRefusal;

  constructor(refusal: ZoneRefusal) {
    super(`Refused by the database: ${refusal}`);
    this.refusal = refusal;
  }
}

/**
 * The database raises NZ409 for two different situations. The message tells them apart, so
 * the workspace can say "that address is taken" or "this zone still holds products".
 */
function zoneRefusalOf(code: string, message: string): ZoneRefusal | undefined {
  if (code !== 'NZ409') return undefined;
  return message.includes('still holds') ? 'zone_in_use' : 'zone_slug_taken';
}

function zoneFailure(code: string, message: string, operation: string): Error {
  const refusal = zoneRefusalOf(code, message);
  if (refusal !== undefined) return new ZoneRefusalError(refusal);
  return toAdminStoreError({ code, message }, operation);
}

/** Both pictures a zone had, as the delete function hands them back. */
const zoneKeysSchema = z.object({
  bannerKey: z.string().nullable(),
  mobileBannerKey: z.string().nullable(),
});

function zoneKeysOf(payload: unknown): ZonePictureKeys {
  const parsed = zoneKeysSchema.safeParse(payload);
  // An answer this API cannot read must never look like "the zone had no pictures": that would
  // quietly leave both files behind. An empty list of keys is the honest fallback, and the
  // caller's reference check keeps every object that a row still points at.
  if (!parsed.success) return { bannerKey: null, mobileBannerKey: null };
  return parsed.data;
}

/** The keys a deleted zone used, so the API can clean up after the commit. */
export interface ZonePictureKeys {
  bannerKey: string | null;
  mobileBannerKey: string | null;
}

/** Zones: the public read, the workspace's, and the admin writes. */
export interface ZoneStore {
  /** Every active zone, in display order (anyone). */
  list(): Promise<ShoppingZonesResponse>;
  /** One active zone, or null when it does not exist or is not public. */
  zone(slug: string): Promise<ShoppingZone | null>;
  adminList(
    accessToken: string,
    userId: string,
    query: AdminShoppingZoneListQuery,
  ): Promise<AdminShoppingZoneListResponse>;
  adminZone(accessToken: string, userId: string, zoneId: string): Promise<AdminShoppingZoneDetail>;
  /** Creates (null id) or updates a zone; answers its id. */
  save(
    accessToken: string,
    userId: string,
    zoneId: string | null,
    input: AdminSaveShoppingZoneRequest,
  ): Promise<string>;
  setActive(accessToken: string, userId: string, zoneId: string, isActive: boolean): Promise<void>;
  /** Deletes a zone that holds nothing; answers the picture keys it had. */
  delete(accessToken: string, userId: string, zoneId: string): Promise<ZonePictureKeys>;
  setProducts(
    accessToken: string,
    userId: string,
    zoneId: string,
    productIds: readonly string[],
  ): Promise<number>;
  setCategories(
    accessToken: string,
    userId: string,
    zoneId: string,
    categoryIds: readonly string[],
  ): Promise<number>;
  /** Sets or clears the banner; answers the key it replaced. */
  setBanner(
    accessToken: string,
    userId: string,
    zoneId: string,
    key: string | null,
    alt: string | null,
  ): Promise<string | null>;
  /** Sets or clears the app's own artwork; answers the key it replaced. */
  setMobileBanner(
    accessToken: string,
    userId: string,
    zoneId: string,
    key: string | null,
  ): Promise<string | null>;
  /** A product's own zones, its category's zones, and what it resolves to. */
  productZones(accessToken: string, userId: string, productId: string): Promise<AdminProductZones>;
  /** Replaces a product's pinned zones; an empty list hands it back to its category. */
  setProductZones(
    accessToken: string,
    userId: string,
    productId: string,
    zoneIds: readonly string[],
  ): Promise<number>;
  /** The zones a category feeds to the products that follow it. */
  categoryZones(
    accessToken: string,
    userId: string,
    categoryId: string,
  ): Promise<AdminCategoryZones>;
  setCategoryZones(
    accessToken: string,
    userId: string,
    categoryId: string,
    zoneIds: readonly string[],
  ): Promise<number>;
}

/** The same functions, reached through the data API. */
export function createSupabaseZoneStore(
  clients: SupabaseClients,
  options: ZoneStoreOptions = {},
): ZoneStore {
  return {
    async list() {
      const { data, error } = await clients.public().rpc('catalog_shopping_zones');
      if (error) throw new StoreUnavailableError('catalog_shopping_zones failed');
      return publicZones(data, options.mediaBaseUrl);
    },

    async zone(slug) {
      const { data, error } = await clients.public().rpc('catalog_shopping_zone', {
        p_slug: slug,
      });
      if (error) throw new StoreUnavailableError('catalog_shopping_zone failed');
      if (data === null || data === undefined) return null;
      return toZone(conform(dbZoneSchema, data, 'catalog_shopping_zone'), options.mediaBaseUrl);
    },

    async adminList(accessToken, _userId, query) {
      const { data, error } = await clients.asUser(accessToken).rpc('admin_list_shopping_zones', {
        p_query: sqlNull(query.q ?? null),
        p_status: query.status,
        p_sort: query.sort,
        p_page: query.page,
        p_page_size: query.pageSize,
      });
      if (error) throw toAdminStoreError(error, 'admin_list_shopping_zones');
      const parsed = conform(dbAdminZoneListSchema, data, 'admin_list_shopping_zones');
      return adminListOf(parsed, options.mediaBaseUrl);
    },

    async adminZone(accessToken, _userId, zoneId) {
      const { data, error } = await clients.asUser(accessToken).rpc('admin_shopping_zone', {
        p_zone_id: zoneId,
      });
      if (error) throw toAdminStoreError(error, 'admin_shopping_zone');
      return adminZoneOf(
        conform(dbAdminZoneDetailSchema, data, 'admin_shopping_zone'),
        options.mediaBaseUrl,
      );
    },

    async save(accessToken, _userId, zoneId, input) {
      const { data, error } = await clients.asUser(accessToken).rpc('admin_save_shopping_zone', {
        p_zone_id: sqlNull(zoneId),
        p_name: input.name,
        p_slug: input.slug ?? '',
        p_description: sqlNull(input.description ?? null),
        p_audience: sqlNull(input.audience ?? null),
        p_display_order: input.displayOrder,
        p_is_active: input.isActive,
        p_seo_title: sqlNull(input.seoTitle ?? null),
        p_seo_description: sqlNull(input.seoDescription ?? null),
        p_banner_alt: sqlNull(input.bannerAlt ?? null),
      });
      if (error) throw zoneFailure(error.code, error.message, 'admin_save_shopping_zone');
      if (typeof data !== 'string') {
        throw new StoreUnavailableError('admin_save_shopping_zone returned no id');
      }
      return data;
    },

    async setActive(accessToken, _userId, zoneId, isActive) {
      const { error } = await clients.asUser(accessToken).rpc('admin_set_shopping_zone_active', {
        p_zone_id: zoneId,
        p_is_active: isActive,
      });
      if (error) throw toAdminStoreError(error, 'admin_set_shopping_zone_active');
    },

    async delete(accessToken, _userId, zoneId) {
      const { data, error } = await clients.asUser(accessToken).rpc('admin_delete_shopping_zone', {
        p_zone_id: zoneId,
      });
      if (error) throw zoneFailure(error.code, error.message, 'admin_delete_shopping_zone');
      return zoneKeysOf(data);
    },

    async setProducts(accessToken, _userId, zoneId, productIds) {
      const { data, error } = await clients
        .asUser(accessToken)
        .rpc('admin_set_shopping_zone_products', {
          p_zone_id: zoneId,
          p_product_ids: [...productIds],
        });
      if (error) throw toAdminStoreError(error, 'admin_set_shopping_zone_products');
      return typeof data === 'number' ? data : 0;
    },

    async setCategories(accessToken, _userId, zoneId, categoryIds) {
      const { data, error } = await clients
        .asUser(accessToken)
        .rpc('admin_set_shopping_zone_categories', {
          p_zone_id: zoneId,
          p_category_ids: [...categoryIds],
        });
      if (error) throw toAdminStoreError(error, 'admin_set_shopping_zone_categories');
      return typeof data === 'number' ? data : 0;
    },

    async setBanner(accessToken, _userId, zoneId, key, alt) {
      const { data, error } = await clients
        .asUser(accessToken)
        .rpc('admin_set_shopping_zone_banner', {
          p_zone_id: zoneId,
          p_banner_key: sqlNull(key),
          p_banner_alt: sqlNull(alt),
        });
      if (error) throw toAdminStoreError(error, 'admin_set_shopping_zone_banner');
      return typeof data === 'string' ? data : null;
    },

    async setMobileBanner(accessToken, _userId, zoneId, key) {
      const { data, error } = await clients
        .asUser(accessToken)
        .rpc('admin_set_shopping_zone_mobile_banner', {
          p_zone_id: zoneId,
          p_banner_key: sqlNull(key),
        });
      if (error) throw toAdminStoreError(error, 'admin_set_shopping_zone_mobile_banner');
      return typeof data === 'string' ? data : null;
    },

    async productZones(accessToken, _userId, productId) {
      const { data, error } = await clients.asUser(accessToken).rpc('admin_product_zones', {
        p_product_id: productId,
      });
      if (error) throw toAdminStoreError(error, 'admin_product_zones');
      return adminProductZonesSchema.parse(data);
    },

    async setProductZones(accessToken, _userId, productId, zoneIds) {
      const { data, error } = await clients.asUser(accessToken).rpc('admin_set_product_zones', {
        p_product_id: productId,
        p_zone_ids: [...zoneIds],
      });
      if (error) throw toAdminStoreError(error, 'admin_set_product_zones');
      return typeof data === 'number' ? data : 0;
    },

    async categoryZones(accessToken, _userId, categoryId) {
      const { data, error } = await clients.asUser(accessToken).rpc('admin_category_zones', {
        p_category_id: categoryId,
      });
      if (error) throw toAdminStoreError(error, 'admin_category_zones');
      return adminCategoryZonesSchema.parse(data);
    },

    async setCategoryZones(accessToken, _userId, categoryId, zoneIds) {
      const { data, error } = await clients.asUser(accessToken).rpc('admin_set_category_zones', {
        p_category_id: categoryId,
        p_zone_ids: [...zoneIds],
      });
      if (error) throw toAdminStoreError(error, 'admin_set_category_zones');
      return typeof data === 'number' ? data : 0;
    },
  };
}

function adminListOf(
  parsed: z.infer<typeof dbAdminZoneListSchema>,
  mediaBaseUrl: string | undefined,
): AdminShoppingZoneListResponse {
  return adminShoppingZoneListResponseSchema.parse({
    zones: parsed.zones.map((row) => ({
      ...toZone(row, mediaBaseUrl),
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      displayOrder: row.displayOrder,
      isActive: row.isActive,
      explicitProductCount: row.explicitProductCount,
      categoryCount: row.categoryCount,
      updatedAt: row.updatedAt,
    })),
    counts: parsed.noteCounts,
    page: parsed.page,
    pageSize: parsed.pageSize,
    total: parsed.total,
    totalPages: parsed.totalPages,
  });
}

/** The same functions over a direct connection, always as the caller. */
export function createPostgresZoneStore(pool: Pool, options: ZoneStoreOptions = {}): ZoneStore {
  function failure(error: unknown, operation: string): Error {
    if (error instanceof StoreUnavailableError || error instanceof ZoneRefusalError) return error;
    const fields = error as { code?: unknown; message?: unknown } | null;
    return zoneFailure(
      typeof fields?.code === 'string' ? fields.code : '',
      typeof fields?.message === 'string' ? fields.message : 'database request failed',
      operation,
    );
  }

  function asUser<T>(
    userId: string,
    run: (client: PoolClient) => Promise<T>,
    operation: string,
  ): Promise<T> {
    return withUser(pool, userId, run).catch((error: unknown) => {
      throw failure(error, operation);
    });
  }

  const publicCall = async (sql: string, params: unknown[]) => {
    try {
      return await withAnon(pool, async (client) => {
        const result = await client.query<{ payload: unknown }>(sql, params);
        return result.rows[0]?.payload ?? null;
      });
    } catch (error) {
      throw failure(error, 'catalog_shopping_zones');
    }
  };

  return {
    async list() {
      return publicZones(
        await publicCall('select public.catalog_shopping_zones() as payload', []),
        options.mediaBaseUrl,
      );
    },

    async zone(slug) {
      const payload = await publicCall('select public.catalog_shopping_zone($1::text) as payload', [
        slug,
      ]);
      return payload === null
        ? null
        : toZone(conform(dbZoneSchema, payload, 'catalog_shopping_zone'), options.mediaBaseUrl);
    },

    adminList: (_accessToken, userId, query) =>
      asUser(
        userId,
        async (client) => {
          const result = await client.query<{ payload: unknown }>(
            'select public.admin_list_shopping_zones($1::text, $2::text, $3::text, $4::int, $5::int) as payload',
            [query.q ?? null, query.status, query.sort, query.page, query.pageSize],
          );
          const parsed = conform(
            dbAdminZoneListSchema,
            result.rows[0]?.payload,
            'admin_list_shopping_zones',
          );
          return adminListOf(parsed, options.mediaBaseUrl);
        },
        'admin_list_shopping_zones',
      ),

    adminZone: (_accessToken, userId, zoneId) =>
      asUser(
        userId,
        async (client) => {
          const result = await client.query<{ payload: unknown }>(
            'select public.admin_shopping_zone($1::uuid) as payload',
            [zoneId],
          );
          return adminZoneOf(
            conform(dbAdminZoneDetailSchema, result.rows[0]?.payload, 'admin_shopping_zone'),
            options.mediaBaseUrl,
          );
        },
        'admin_shopping_zone',
      ),

    save: (_accessToken, userId, zoneId, input) =>
      asUser(
        userId,
        async (client) => {
          const result = await client.query<{ id: string }>(
            'select public.admin_save_shopping_zone($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::int, $7::boolean, $8::text, $9::text, $10::text) as id',
            [
              zoneId,
              input.name,
              input.slug ?? '',
              input.description ?? null,
              input.audience ?? null,
              input.displayOrder,
              input.isActive,
              input.seoTitle ?? null,
              input.seoDescription ?? null,
              input.bannerAlt ?? null,
            ],
          );
          const id = result.rows[0]?.id;
          if (typeof id !== 'string') {
            throw new StoreUnavailableError('admin_save_shopping_zone returned no id');
          }
          return id;
        },
        'admin_save_shopping_zone',
      ),

    setActive: (_accessToken, userId, zoneId, isActive) =>
      asUser(
        userId,
        async (client) => {
          await client.query(
            'select public.admin_set_shopping_zone_active($1::uuid, $2::boolean)',
            [zoneId, isActive],
          );
        },
        'admin_set_shopping_zone_active',
      ),

    delete: (_accessToken, userId, zoneId) =>
      asUser(
        userId,
        async (client) => {
          const result = await client.query<{ keys: unknown }>(
            'select public.admin_delete_shopping_zone($1::uuid) as keys',
            [zoneId],
          );
          return zoneKeysOf(result.rows[0]?.keys);
        },
        'admin_delete_shopping_zone',
      ),

    setProducts: (_accessToken, userId, zoneId, productIds) =>
      asUser(
        userId,
        async (client) => {
          const result = await client.query<{ kept: number }>(
            'select public.admin_set_shopping_zone_products($1::uuid, $2::uuid[]) as kept',
            [zoneId, [...productIds]],
          );
          return Number(result.rows[0]?.kept ?? 0);
        },
        'admin_set_shopping_zone_products',
      ),

    setCategories: (_accessToken, userId, zoneId, categoryIds) =>
      asUser(
        userId,
        async (client) => {
          const result = await client.query<{ kept: number }>(
            'select public.admin_set_shopping_zone_categories($1::uuid, $2::uuid[]) as kept',
            [zoneId, [...categoryIds]],
          );
          return Number(result.rows[0]?.kept ?? 0);
        },
        'admin_set_shopping_zone_categories',
      ),

    setBanner: (_accessToken, userId, zoneId, key, alt) =>
      asUser(
        userId,
        async (client) => {
          const result = await client.query<{ old: string | null }>(
            'select public.admin_set_shopping_zone_banner($1::uuid, $2::text, $3::text) as old',
            [zoneId, key, alt],
          );
          return result.rows[0]?.old ?? null;
        },
        'admin_set_shopping_zone_banner',
      ),

    setMobileBanner: (_accessToken, userId, zoneId, key) =>
      asUser(
        userId,
        async (client) => {
          const result = await client.query<{ old: string | null }>(
            'select public.admin_set_shopping_zone_mobile_banner($1::uuid, $2::text) as old',
            [zoneId, key],
          );
          return result.rows[0]?.old ?? null;
        },
        'admin_set_shopping_zone_mobile_banner',
      ),

    productZones: (_accessToken, userId, productId) =>
      asUser(
        userId,
        async (client) => {
          const result = await client.query<{ zones: unknown }>(
            'select public.admin_product_zones($1::uuid) as zones',
            [productId],
          );
          return adminProductZonesSchema.parse(result.rows[0]?.zones);
        },
        'admin_product_zones',
      ),

    setProductZones: (_accessToken, userId, productId, zoneIds) =>
      asUser(
        userId,
        async (client) => {
          const result = await client.query<{ kept: number }>(
            'select public.admin_set_product_zones($1::uuid, $2::uuid[]) as kept',
            [productId, [...zoneIds]],
          );
          return Number(result.rows[0]?.kept ?? 0);
        },
        'admin_set_product_zones',
      ),

    categoryZones: (_accessToken, userId, categoryId) =>
      asUser(
        userId,
        async (client) => {
          const result = await client.query<{ zones: unknown }>(
            'select public.admin_category_zones($1::uuid) as zones',
            [categoryId],
          );
          return adminCategoryZonesSchema.parse(result.rows[0]?.zones);
        },
        'admin_category_zones',
      ),

    setCategoryZones: (_accessToken, userId, categoryId, zoneIds) =>
      asUser(
        userId,
        async (client) => {
          const result = await client.query<{ kept: number }>(
            'select public.admin_set_category_zones($1::uuid, $2::uuid[]) as kept',
            [categoryId, [...zoneIds]],
          );
          return Number(result.rows[0]?.kept ?? 0);
        },
        'admin_set_category_zones',
      ),
  };
}
