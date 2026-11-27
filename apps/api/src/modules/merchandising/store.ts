import {
  adminBannerSchema,
  adminBrandSchema,
  bannerSchema,
  brandSchema,
  productSummarySchema,
  type AdminBanner,
  type AdminBrand,
  type Banner,
  type BannerInput,
  type BannerPlacement,
  type Brand,
  type BrandInput,
  type MediaPicture,
  type ProductSummary,
} from '@nilzora/contracts';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import { disabledCatalogCache, type CatalogCache } from '../../cache';
import { BANNER_CACHE_KEYS } from '../../cache/catalog-cache';
import { withAnon, withUser } from '../../db/user-context';
import { pgFailure } from '../db-rpc';
import type { SupabaseClients } from '../../supabase/clients';
import { toAdminStoreError } from '../admin/errors';
import { sqlNull } from '../admin/shared';
import { stockView } from '../catalog/store';
import { colorView, postgresProductColors, supabaseProductColors } from '../catalog/colors';
import { conform, StoreUnavailableError, toStoreError } from '../commerce/errors';
import { IMAGE_COLUMNS, toProductImage, variantKeys, type ImageRow } from '../media/images';

export type BrandSort = 'featured' | 'newest' | 'price_asc' | 'price_desc';

/**
 * Brands and banners. Public reads use the publishable key, so Row Level Security
 * decides what is visible (active brands, banners on show). Admin reads and every
 * change run as the signed-in caller; the database functions check permissions,
 * enforce the rules and write the audit log.
 */
export interface MerchandisingStore {
  listBrands(): Promise<Brand[]>;
  /** The active brand at `slug`, or the slug it moved to, or neither. */
  lookupBrand(slug: string): Promise<{ brand: Brand | null; redirectTo: string | null }>;
  brandProducts(
    slug: string,
    sort: BrandSort,
    limit: number,
    offset: number,
  ): Promise<{ items: ProductSummary[]; total: number }>;
  listBanners(placement: BannerPlacement, categorySlug?: string): Promise<Banner[]>;

  adminListBrands(accessToken: string, userId: string): Promise<AdminBrand[]>;
  adminGetBrand(accessToken: string, userId: string, brandId: string): Promise<AdminBrand | null>;
  saveBrand(
    accessToken: string,
    userId: string,
    brandId: string | null,
    input: BrandInput,
  ): Promise<string>;
  /** Returns the replaced logo's base key, for deleting its files after commit. */
  setBrandLogo(
    accessToken: string,
    userId: string,
    brandId: string,
    logoKey: string | null,
  ): Promise<string | null>;
  /** Returns the replaced banner's base key, for deleting its files after commit. */
  setBrandBanner(
    accessToken: string,
    userId: string,
    brandId: string,
    bannerKey: string | null,
  ): Promise<string | null>;
  /**
   * Deletes a brand no product belongs to (refused with in_use otherwise). Answers the
   * pictures it owned — its logo's and its banner's base keys — so their files can be
   * deleted once the delete has committed. Both keys are read before the delete, because
   * the row is gone afterwards; a picture set in the moment between the two is left in
   * storage rather than deleted by mistake.
   */
  deleteBrand(
    accessToken: string,
    userId: string,
    brandId: string,
  ): Promise<{ logoKey: string | null; bannerKey: string | null }>;
  setProductBrand(
    accessToken: string,
    userId: string,
    productId: string,
    brandId: string | null,
  ): Promise<void>;
  /** The product's brand id (null for none), or undefined when the caller cannot see it. */
  productBrand(
    accessToken: string,
    userId: string,
    productId: string,
  ): Promise<string | null | undefined>;

  adminListBanners(accessToken: string, userId: string): Promise<AdminBanner[]>;
  adminGetBanner(
    accessToken: string,
    userId: string,
    bannerId: string,
  ): Promise<AdminBanner | null>;
  saveBanner(
    accessToken: string,
    userId: string,
    bannerId: string | null,
    input: BannerInput,
  ): Promise<string>;
  setBannerImage(
    accessToken: string,
    userId: string,
    bannerId: string,
    imageKey: string | null,
  ): Promise<string | null>;
  /** Sets or clears the small-screen image; returns the replaced key, for deleting its files. */
  setBannerMobileImage(
    accessToken: string,
    userId: string,
    bannerId: string,
    imageKey: string | null,
  ): Promise<string | null>;
  /** Returns every image key the deleted banner held, for deleting its files after commit. */
  deleteBanner(accessToken: string, userId: string, bannerId: string): Promise<string[]>;
  /** Orders the banners of one placement (and category): each exactly once, first shown first. */
  reorderBanners(
    accessToken: string,
    userId: string,
    placement: BannerPlacement,
    categoryId: string | null,
    ids: readonly string[],
  ): Promise<void>;
}

const BRAND_COLUMNS = 'id, slug, name, description, logo_key, banner_key, is_active, product_count';
/** The same columns for a database that has not run the brand-banner migration yet. */
const BRAND_COLUMNS_PLAIN = 'id, slug, name, description, logo_key, is_active, product_count';
const BANNER_COLUMNS =
  'id, placement, category_id, title, subtitle, cta_label, cta_href, image_key, mobile_image_key, image_alt, sort_order, is_active, starts_at, ends_at, category:categories(slug)';

interface BrandRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logo_key: string | null;
  banner_key: string | null;
  is_active: boolean;
  product_count: number | null;
}

interface BannerRow {
  id: string;
  placement: BannerPlacement;
  category_id: string | null;
  title: string;
  subtitle: string | null;
  cta_label: string | null;
  cta_href: string | null;
  image_key: string | null;
  /** Absent in rows read before the column existed. */
  mobile_image_key?: string | null;
  /** The picture's description for screen readers (20261204300000). */
  image_alt?: string | null;
  sort_order: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  category: { slug: string } | null;
}

/**
 * A stored picture, or null. A row read without its key column (a database that has not run
 * a migration yet) has no value at all, which means the same as null here: no picture.
 */
function picture(key: string | null | undefined, base: string | undefined): MediaPicture | null {
  if (key === null || key === undefined || base === undefined) return null;
  const [full, thumb] = variantKeys(key);
  return { url: `${base}/${full}`, thumbUrl: `${base}/${thumb}` };
}

function iso(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

/** The same rows read over SQL: brands carry their count, banners carry the category slug. */
const BRAND_SQL = `select b.id, b.slug, b.name, b.description, b.logo_key, b.banner_key, b.is_active,
    public.product_count(b)::int as product_count
  from public.brands b`;

/** The same rows for a database that has not run the brand-banner migration yet. */
const BRAND_SQL_PLAIN = `select b.id, b.slug, b.name, b.description, b.logo_key, null::text as banner_key,
    b.is_active, public.product_count(b)::int as product_count
  from public.brands b`;

const BANNER_SQL = `select b.id, b.placement, b.category_id, b.title, b.subtitle, b.cta_label,
    b.cta_href, b.image_key, b.mobile_image_key, b.image_alt, b.sort_order, b.is_active, b.starts_at, b.ends_at,
    jsonb_build_object('slug', c.slug) as category
  from public.banners b
  left join public.categories c on c.id = b.category_id`;

/** One row of `catalog_brand_products`: a product of a brand, with the page's total. */
interface BrandProductRow {
  id: string;
  slug: string;
  sku: string;
  name: string;
  summary: string | null;
  price_minor: string | number;
  compare_at_price_minor: string | number | null;
  stock_quantity: number;
  max_order_quantity: number;
  is_featured: boolean;
  published_at: string | null;
  category_slug: string;
  category_name: string;
  total_count: string | number;
}

const brandOf = (row: BrandRow, mediaBaseUrl: string | undefined): Brand => ({
  slug: row.slug,
  name: row.name,
  description: row.description,
  logo: picture(row.logo_key, mediaBaseUrl),
  banner: picture(row.banner_key, mediaBaseUrl),
  productCount: row.product_count ?? 0,
});

const adminBrandOf = (row: BrandRow, mediaBaseUrl: string | undefined): AdminBrand => ({
  ...brandOf(row, mediaBaseUrl),
  id: row.id,
  isActive: row.is_active,
});

const bannerOf = (row: BannerRow, mediaBaseUrl: string | undefined): Banner => ({
  id: row.id,
  placement: row.placement,
  title: row.title,
  imageAlt: row.image_alt ?? null,
  subtitle: row.subtitle,
  ctaLabel: row.cta_label,
  ctaHref: row.cta_href,
  image: picture(row.image_key, mediaBaseUrl),
  categorySlug: row.category?.slug ?? null,
  // Only banners that have a small-screen image carry the field, so older readers see no change.
  ...(row.mobile_image_key ? { mobileImage: picture(row.mobile_image_key, mediaBaseUrl) } : {}),
});

const adminBannerOf = (row: BannerRow, mediaBaseUrl: string | undefined): AdminBanner => ({
  ...bannerOf(row, mediaBaseUrl),
  categoryId: row.category_id,
  sortOrder: row.sort_order,
  isActive: row.is_active,
  startsAt: iso(row.starts_at),
  endsAt: iso(row.ends_at),
});

export function createSupabaseMerchandisingStore(
  clients: SupabaseClients,
  {
    mediaBaseUrl,
    cache = disabledCatalogCache(),
  }: { mediaBaseUrl?: string | undefined; cache?: CatalogCache | undefined } = {},
): MerchandisingStore {
  const toBrand = (row: BrandRow): Brand => brandOf(row, mediaBaseUrl);
  const toAdminBrand = (row: BrandRow): AdminBrand => adminBrandOf(row, mediaBaseUrl);
  const toBanner = (row: BannerRow): Banner => bannerOf(row, mediaBaseUrl);
  const toAdminBanner = (row: BannerRow): AdminBanner => adminBannerOf(row, mediaBaseUrl);

  /*
   * A database that has not run the brand-banner migration yet has no `brands.banner_key`, so
   * every brand read would fail without this. The first read asks once and the answer decides
   * the columns: brands then arrive without a banner. A "no such column" answer is re-checked
   * after a minute, so a process that started before the migration begins reading banners as
   * soon as the migration is applied rather than only after a restart.
   */
  const BRAND_SCHEMA_RECHECK_MS = 60_000;
  let brandColumns: { columns: string; checkedAt: number } | null = null;
  let brandProbe: Promise<string> | null = null;
  const brandSelect = (): Promise<string> => {
    const known = brandColumns;
    if (
      known !== null &&
      (known.columns === BRAND_COLUMNS || Date.now() - known.checkedAt < BRAND_SCHEMA_RECHECK_MS)
    ) {
      return Promise.resolve(known.columns);
    }
    brandProbe ??= Promise.resolve(clients.public().from('brands').select('banner_key').limit(1))
      .then(
        ({ error }) => (error === null ? BRAND_COLUMNS : BRAND_COLUMNS_PLAIN),
        () => BRAND_COLUMNS_PLAIN,
      )
      .then((columns) => {
        brandColumns = { columns, checkedAt: Date.now() };
        brandProbe = null;
        return columns;
      });
    return brandProbe;
  };

  async function primaryImages(productIds: readonly string[]) {
    const images = new Map<string, ReturnType<typeof toProductImage>>();
    if (mediaBaseUrl === undefined || productIds.length === 0) return images;
    const { data, error } = await clients
      .public()
      .from('product_images')
      .select(`product_id, ${IMAGE_COLUMNS}`)
      .in('product_id', [...productIds])
      .eq('position', 0);
    if (error) throw toStoreError(error, 'product_images');
    for (const row of data as unknown as (ImageRow & { product_id: string })[]) {
      images.set(row.product_id, toProductImage(row, mediaBaseUrl));
    }
    return images;
  }

  async function rpcId(name: string, call: PromiseLike<{ data: unknown; error: unknown }>) {
    const { data, error } = await call;
    if (error) throw toAdminStoreError(error as Parameters<typeof toAdminStoreError>[0], name);
    return data;
  }

  return {
    async listBrands() {
      return cache.read(
        'nilzora:v1:catalog:brands',
        (value) => {
          const parsed = z.array(brandSchema).safeParse(value);
          return parsed.success ? parsed.data : null;
        },
        async () => {
          const { data, error } = await clients
            .public()
            .from('brands')
            .select(await brandSelect())
            .eq('is_active', true)
            .order('name');
          if (error) throw toStoreError(error, 'brands');
          return conform(
            z.array(brandSchema),
            (data as unknown as BrandRow[]).map(toBrand),
            'brands',
          );
        },
      );
    },

    async lookupBrand(slug) {
      const { data, error } = await clients
        .public()
        .from('brands')
        .select(await brandSelect())
        .eq('slug', slug)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw toStoreError(error, 'brands');
      if (data) {
        return {
          brand: conform(brandSchema, toBrand(data as unknown as BrandRow), 'brands'),
          redirectTo: null,
        };
      }
      const { data: moved, error: movedError } = await clients
        .public()
        .from('brand_slug_redirects')
        .select('brand_id')
        .eq('old_slug', slug)
        .maybeSingle();
      if (movedError) throw toStoreError(movedError, 'brand_slug_redirects');
      if (!moved) return { brand: null, redirectTo: null };
      const { data: target, error: targetError } = await clients
        .public()
        .from('brands')
        .select('slug')
        .eq('id', moved.brand_id)
        .eq('is_active', true)
        .maybeSingle();
      if (targetError) throw toStoreError(targetError, 'brands');
      return { brand: null, redirectTo: target?.slug ?? null };
    },

    async brandProducts(slug, sort, limit, offset) {
      const call = (pageLimit: number, pageOffset: number) =>
        clients.public().rpc('catalog_brand_products', {
          p_brand_slug: slug,
          p_sort: sort,
          p_limit: pageLimit,
          p_offset: pageOffset,
        });
      const { data, error } = await call(limit, offset);
      if (error) throw toStoreError(error, 'catalog_brand_products');
      let total = data[0]?.total_count ?? 0;
      if (data.length === 0 && offset > 0) {
        const { data: first, error: firstError } = await call(1, 0);
        if (firstError) throw toStoreError(firstError, 'catalog_brand_products');
        total = first[0]?.total_count ?? 0;
      }
      const primary = await primaryImages(data.map((row) => row.id));
      const colors = await supabaseProductColors(
        clients,
        data.map((row) => row.id),
      );
      const items = data.map((row) => ({
        id: row.id,
        slug: row.slug,
        sku: row.sku,
        name: row.name,
        summary: row.summary ?? null,
        priceMinor: row.price_minor,
        compareAtPriceMinor: row.compare_at_price_minor ?? null,
        ...stockView(row),
        isFeatured: row.is_featured,
        category: { slug: row.category_slug, name: row.category_name },
        image: primary.get(row.id) ?? null,
        ...colorView(colors, row.id),
      }));
      return {
        items: conform(z.array(productSummarySchema), items, 'catalog_brand_products'),
        total,
      };
    },

    async listBanners(placement, categorySlug) {
      const load = async (): Promise<Banner[]> => {
        let query = clients
          .public()
          .from('banners')
          .select(BANNER_COLUMNS)
          .eq('placement', placement)
          .order('sort_order')
          .order('created_at', { ascending: false })
          .limit(placement === 'home_hero' ? 5 : 6);
        if (placement === 'category') {
          if (categorySlug === undefined) return [];
          const { data: category, error } = await clients
            .public()
            .from('categories')
            .select('id')
            .eq('slug', categorySlug)
            .maybeSingle();
          if (error) throw toStoreError(error, 'categories');
          if (!category) return [];
          query = query.eq('category_id', category.id);
        }
        const { data, error } = await query;
        if (error) throw toStoreError(error, 'banners');
        return conform(
          z.array(bannerSchema),
          (data as unknown as BannerRow[]).map(toBanner),
          'banners',
        );
      };

      // Only the two page-wide placements are cached: they have a fixed key and are read on
      // every homepage render. A category placement is per-slug (an unbounded key space) and
      // cheap, so it always asks the database.
      const key = BANNER_CACHE_KEYS[placement];
      if (key === undefined) return load();
      return cache.read(
        key,
        (value) => {
          const parsed = z.array(bannerSchema).safeParse(value);
          return parsed.success ? parsed.data : null;
        },
        load,
      );
    },

    async adminListBrands(accessToken, _userId) {
      const { data, error } = await clients
        .asUser(accessToken)
        .from('brands')
        .select(await brandSelect())
        .order('name');
      if (error) throw toAdminStoreError(error, 'brands');
      return conform(
        z.array(adminBrandSchema),
        (data as unknown as BrandRow[]).map(toAdminBrand),
        'brands',
      );
    },

    async adminGetBrand(accessToken, _userId, brandId) {
      const { data, error } = await clients
        .asUser(accessToken)
        .from('brands')
        .select(await brandSelect())
        .eq('id', brandId)
        .maybeSingle();
      if (error) throw toAdminStoreError(error, 'brands');
      return data
        ? conform(adminBrandSchema, toAdminBrand(data as unknown as BrandRow), 'brands')
        : null;
    },

    async saveBrand(accessToken, _userId, brandId, input) {
      const id = await rpcId(
        'admin_save_brand',
        clients.asUser(accessToken).rpc('admin_save_brand', {
          p_brand_id: sqlNull(brandId),
          p_slug: input.slug,
          p_name: input.name,
          p_description: sqlNull(input.description),
          p_is_active: input.isActive,
        }),
      );
      // The committed change is what matters: the cache must not outlive it.
      await cache.invalidate();
      return conform(z.uuid(), id, 'admin_save_brand');
    },

    async setBrandLogo(accessToken, _userId, brandId, logoKey) {
      const old = await rpcId(
        'admin_set_brand_logo',
        clients.asUser(accessToken).rpc('admin_set_brand_logo', {
          p_brand_id: sqlNull(brandId),
          p_logo_key: sqlNull(logoKey),
        }),
      );
      await cache.invalidate();
      return conform(z.string().nullable(), old ?? null, 'admin_set_brand_logo');
    },

    async setBrandBanner(accessToken, _userId, brandId, bannerKey) {
      const old = await rpcId(
        'admin_set_brand_banner',
        clients.asUser(accessToken).rpc('admin_set_brand_banner', {
          p_brand_id: sqlNull(brandId),
          p_banner_key: sqlNull(bannerKey),
        }),
      );
      await cache.invalidate();
      return conform(z.string().nullable(), old ?? null, 'admin_set_brand_banner');
    },

    async deleteBrand(accessToken, _userId, brandId) {
      // Read first: after the delete the row (and its banner key) is gone.
      const before = await clients
        .asUser(accessToken)
        .from('brands')
        .select(await brandSelect())
        .eq('id', brandId)
        .maybeSingle();
      const key = await rpcId(
        'admin_delete_brand',
        clients.asUser(accessToken).rpc('admin_delete_brand', { p_brand_id: brandId }),
      );
      await cache.invalidate();
      const bannerKey = (before.data as unknown as BrandRow | null)?.banner_key ?? null;
      return {
        logoKey: conform(z.string().nullable(), key ?? null, 'admin_delete_brand'),
        bannerKey: conform(z.string().nullable(), bannerKey, 'brands'),
      };
    },

    async setProductBrand(accessToken, _userId, productId, brandId) {
      await rpcId(
        'admin_set_product_brand',
        clients.asUser(accessToken).rpc('admin_set_product_brand', {
          p_product_id: productId,
          p_brand_id: sqlNull(brandId),
        }),
      );
    },

    async productBrand(accessToken, _userId, productId) {
      const { data, error } = await clients
        .asUser(accessToken)
        .from('products')
        .select('brand_id')
        .eq('id', productId)
        .maybeSingle();
      if (error) throw toAdminStoreError(error, 'products');
      return data ? data.brand_id : undefined;
    },

    async adminListBanners(accessToken, _userId) {
      const { data, error } = await clients
        .asUser(accessToken)
        .from('banners')
        .select(BANNER_COLUMNS)
        .order('placement')
        .order('sort_order');
      if (error) throw toAdminStoreError(error, 'banners');
      return conform(
        z.array(adminBannerSchema),
        (data as unknown as BannerRow[]).map(toAdminBanner),
        'banners',
      );
    },

    async adminGetBanner(accessToken, _userId, bannerId) {
      const { data, error } = await clients
        .asUser(accessToken)
        .from('banners')
        .select(BANNER_COLUMNS)
        .eq('id', bannerId)
        .maybeSingle();
      if (error) throw toAdminStoreError(error, 'banners');
      return data ? conform(adminBannerSchema, toAdminBanner(data), 'banners') : null;
    },

    async saveBanner(accessToken, _userId, bannerId, input) {
      const id = await rpcId(
        'admin_save_banner',
        clients.asUser(accessToken).rpc('admin_save_banner', {
          p_banner_id: sqlNull(bannerId),
          p_placement: input.placement,
          p_category_id: sqlNull(input.categoryId),
          p_title: input.title,
          p_subtitle: sqlNull(input.subtitle),
          p_cta_label: sqlNull(input.ctaLabel),
          p_cta_href: sqlNull(input.ctaHref),
          p_sort_order: input.sortOrder,
          p_is_active: input.isActive,
          p_starts_at: sqlNull(input.startsAt),
          p_ends_at: sqlNull(input.endsAt),
          p_image_alt: sqlNull(input.imageAlt),
        }),
      );
      await cache.invalidate();
      return conform(z.uuid(), id, 'admin_save_banner');
    },

    async setBannerImage(accessToken, _userId, bannerId, imageKey) {
      const old = await rpcId(
        'admin_set_banner_image',
        clients.asUser(accessToken).rpc('admin_set_banner_image', {
          p_banner_id: sqlNull(bannerId),
          p_image_key: sqlNull(imageKey),
        }),
      );
      await cache.invalidate();
      return conform(z.string().nullable(), old ?? null, 'admin_set_banner_image');
    },

    async setBannerMobileImage(accessToken, _userId, bannerId, imageKey) {
      const old = await rpcId(
        'admin_set_banner_mobile_image',
        clients.asUser(accessToken).rpc('admin_set_banner_mobile_image', {
          p_banner_id: sqlNull(bannerId),
          p_image_key: sqlNull(imageKey),
        }),
      );
      await cache.invalidate();
      return conform(z.string().nullable(), old ?? null, 'admin_set_banner_mobile_image');
    },

    async deleteBanner(accessToken, _userId, bannerId) {
      const keys = await rpcId(
        'admin_delete_banner_files',
        clients.asUser(accessToken).rpc('admin_delete_banner_files', { p_banner_id: bannerId }),
      );
      await cache.invalidate();
      return conform(z.array(z.string()), keys, 'admin_delete_banner_files');
    },

    async reorderBanners(accessToken, _userId, placement, categoryId, ids) {
      await rpcId(
        'admin_reorder_banners',
        clients.asUser(accessToken).rpc('admin_reorder_banners', {
          p_placement: placement,
          p_category_id: sqlNull(categoryId),
          p_ids: [...ids],
        }),
      );
      await cache.invalidate();
    },
  };
}

/*
 * The direct-PostgreSQL twin. Every module has one: the API can run against Supabase (one
 * request per call, as the caller's JWT) or against the database itself, where a call runs
 * inside a transaction carrying the caller's identity (see db/user-context). The reads below
 * are the same rows, in SQL, because a table read has no RPC equivalent; every change still
 * goes through the permission-checking database functions, never through SQL here.
 */
export function createPostgresMerchandisingStore(
  pool: Pool,
  {
    mediaBaseUrl,
    cache = disabledCatalogCache(),
  }: { mediaBaseUrl?: string | undefined; cache?: CatalogCache | undefined } = {},
): MerchandisingStore {
  const asUser = <T>(userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> =>
    withUser(pool, userId, fn);

  /*
   * A database that has not run the brand-banner migration yet has no `brands.banner_key`, so
   * one probe decides the brand query: brands then arrive without a banner (the column reads
   * as null). A "no such column" answer is re-checked after a minute, so a long-running API
   * starts returning banners as soon as the migration is applied.
   */
  const BRAND_SCHEMA_RECHECK_MS = 60_000;
  let brandQuery: { sql: string; checkedAt: number } | null = null;
  let brandProbe: Promise<string> | null = null;
  const brandSelect = (): Promise<string> => {
    const known = brandQuery;
    if (
      known !== null &&
      (known.sql === BRAND_SQL || Date.now() - known.checkedAt < BRAND_SCHEMA_RECHECK_MS)
    ) {
      return Promise.resolve(known.sql);
    }
    brandProbe ??= withAnon(pool, (client) =>
      client
        .query<{ present: boolean }>(
          `select exists (
             select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'brands' and column_name = 'banner_key'
           ) as present`,
        )
        .then((result) => (result.rows[0]?.present === true ? BRAND_SQL : BRAND_SQL_PLAIN)),
    )
      .catch(() => BRAND_SQL_PLAIN)
      .then((sql) => {
        brandQuery = { sql, checkedAt: Date.now() };
        brandProbe = null;
        return sql;
      });
    return brandProbe;
  };

  /**
   * Runs one database function as the caller and returns its single value. The arguments
   * are positional and typed, so a nullable one is still passed: these functions take no
   * defaults, and "null" here means "none", not "leave it out".
   */
  async function callFunction<T>(
    userId: string,
    sql: string,
    values: readonly unknown[],
    operation: string,
  ): Promise<T> {
    try {
      return await asUser(userId, async (client) => {
        const result = await client.query<{ value: T }>(`${sql} as value`, [...values]);
        const row = result.rows[0];
        if (row === undefined) throw new StoreUnavailableError(`${operation} answered with no row`);
        return row.value;
      });
    } catch (error) {
      if (error instanceof StoreUnavailableError) throw error;
      throw toAdminStoreError(pgFailure(error), operation);
    }
  }

  /** Reads a page of products of one brand as a visitor; the function enforces the paging rules. */
  async function brandProductPage(slug: string, sort: BrandSort, limit: number, offset: number) {
    const page = (pageLimit: number, pageOffset: number) =>
      withAnon(pool, (client) =>
        client
          .query<BrandProductRow>(
            `select * from public.catalog_brand_products(
               p_brand_slug => $1, p_sort => $2, p_limit => $3, p_offset => $4)`,
            [slug, sort, pageLimit, pageOffset],
          )
          .then((result) => result.rows),
      );
    const rows = await page(limit, offset);
    // A page past the end still needs the total for the pager.
    const total =
      rows[0]?.total_count ??
      (rows.length === 0 && offset > 0 ? (await page(1, 0))[0]?.total_count : 0);
    return { rows, total: Number(total ?? 0) };
  }

  return {
    async listBrands() {
      return cache.read(
        'nilzora:v1:catalog:brands',
        (value) => {
          const parsed = z.array(brandSchema).safeParse(value);
          return parsed.success ? parsed.data : null;
        },
        async () => {
          const sql = await brandSelect();
          const rows = await withAnon(pool, (client) =>
            client
              .query<BrandRow>(`${sql} where b.is_active order by b.name`)
              .then((result) => result.rows),
          );
          return conform(
            z.array(brandSchema),
            rows.map((row) => brandOf(row, mediaBaseUrl)),
            'brands',
          );
        },
      );
    },

    async lookupBrand(slug) {
      const sql = await brandSelect();
      const found = await withAnon(pool, async (client) => {
        const brand = await client.query<BrandRow>(`${sql} where b.slug = $1 and b.is_active`, [
          slug,
        ]);
        if (brand.rows[0] !== undefined) return { row: brand.rows[0], redirectTo: null };
        const moved = await client.query<{ brand_id: string }>(
          'select brand_id from public.brand_slug_redirects where old_slug = $1',
          [slug],
        );
        const target = moved.rows[0];
        if (target === undefined) return { row: undefined, redirectTo: null };
        const next = await client.query<{ slug: string }>(
          'select slug from public.brands where id = $1 and is_active',
          [target.brand_id],
        );
        return { row: undefined, redirectTo: next.rows[0]?.slug ?? null };
      });
      if (found.row === undefined) return { brand: null, redirectTo: found.redirectTo };
      return {
        brand: conform(brandSchema, brandOf(found.row, mediaBaseUrl), 'brands'),
        redirectTo: null,
      };
    },

    async brandProducts(slug, sort, limit, offset) {
      const { rows, total } = await brandProductPage(slug, sort, limit, offset);
      const ids = rows.map((row) => row.id);
      const primary = new Map<string, ReturnType<typeof toProductImage>>();
      if (mediaBaseUrl !== undefined && ids.length > 0) {
        const images = await withAnon(pool, (client) =>
          client
            .query<ImageRow & { product_id: string }>(
              `select product_id, ${IMAGE_COLUMNS} from public.product_images
                where product_id = any($1::uuid[]) and position = 0`,
              [ids],
            )
            .then((result) => result.rows),
        );
        for (const row of images) primary.set(row.product_id, toProductImage(row, mediaBaseUrl));
      }
      const colors = await withAnon(pool, (client) => postgresProductColors(client, ids));
      const items = rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        sku: row.sku,
        name: row.name,
        summary: row.summary ?? null,
        priceMinor: Number(row.price_minor),
        compareAtPriceMinor:
          row.compare_at_price_minor === null ? null : Number(row.compare_at_price_minor),
        ...stockView(row),
        isFeatured: row.is_featured,
        category: { slug: row.category_slug, name: row.category_name },
        image: primary.get(row.id) ?? null,
        ...colorView(colors, row.id),
      }));
      return {
        items: conform(z.array(productSummarySchema), items, 'catalog_brand_products'),
        total,
      };
    },

    async listBanners(placement, categorySlug) {
      const load = async (): Promise<Banner[]> => {
        const rows = await withAnon(pool, async (client) => {
          const parameters: unknown[] = [placement];
          let filter = '';
          if (placement === 'category') {
            if (categorySlug === undefined) return [];
            const category = await client.query<{ id: string }>(
              'select id from public.categories where slug = $1',
              [categorySlug],
            );
            const id = category.rows[0]?.id;
            if (id === undefined) return [];
            parameters.push(id);
            filter = ` and b.category_id = $2`;
          }
          const result = await client.query<BannerRow>(
            `${BANNER_SQL} where b.placement = $1${filter}
              order by b.sort_order, b.created_at desc limit ${placement === 'home_hero' ? 5 : 6}`,
            parameters,
          );
          return result.rows;
        });
        return conform(
          z.array(bannerSchema),
          rows.map((row) => bannerOf(row, mediaBaseUrl)),
          'banners',
        );
      };

      const key = BANNER_CACHE_KEYS[placement];
      if (key === undefined) return load();
      return cache.read(
        key,
        (value) => {
          const parsed = z.array(bannerSchema).safeParse(value);
          return parsed.success ? parsed.data : null;
        },
        load,
      );
    },

    async adminListBrands(_accessToken, userId) {
      const sql = await brandSelect();
      const rows = await asUser(userId, (client) =>
        client.query<BrandRow>(`${sql} order by b.name`).then((result) => result.rows),
      );
      return conform(
        z.array(adminBrandSchema),
        rows.map((row) => adminBrandOf(row, mediaBaseUrl)),
        'brands',
      );
    },

    async adminGetBrand(_accessToken, userId, brandId) {
      const sql = await brandSelect();
      const rows = await asUser(userId, (client) =>
        client.query<BrandRow>(`${sql} where b.id = $1`, [brandId]).then((result) => result.rows),
      );
      const row = rows[0];
      return row === undefined
        ? null
        : conform(adminBrandSchema, adminBrandOf(row, mediaBaseUrl), 'brands');
    },

    async saveBrand(_accessToken, userId, brandId, input) {
      const id = await callFunction<string | null>(
        userId,
        'select public.admin_save_brand($1::uuid, $2, $3, $4, $5)',
        [brandId, input.slug, input.name, input.description ?? null, input.isActive],
        'admin_save_brand',
      );
      await cache.invalidate();
      return conform(z.uuid(), id, 'admin_save_brand');
    },

    async setBrandLogo(_accessToken, userId, brandId, logoKey) {
      const old = await callFunction<string | null>(
        userId,
        'select public.admin_set_brand_logo($1::uuid, $2)',
        [brandId, logoKey],
        'admin_set_brand_logo',
      );
      await cache.invalidate();
      return conform(z.string().nullable(), old ?? null, 'admin_set_brand_logo');
    },

    async setBrandBanner(_accessToken, userId, brandId, bannerKey) {
      const old = await callFunction<string | null>(
        userId,
        'select public.admin_set_brand_banner($1::uuid, $2)',
        [brandId, bannerKey],
        'admin_set_brand_banner',
      );
      await cache.invalidate();
      return conform(z.string().nullable(), old ?? null, 'admin_set_brand_banner');
    },

    async deleteBrand(_accessToken, userId, brandId) {
      // Read first: the delete removes the row, and with it the banner key.
      const sql = await brandSelect();
      const before = await asUser(userId, (client) =>
        client
          .query<BrandRow>(`${sql} where b.id = $1`, [brandId])
          .then((result) => result.rows[0]),
      );
      const key = await callFunction<string | null>(
        userId,
        'select public.admin_delete_brand($1::uuid)',
        [brandId],
        'admin_delete_brand',
      );
      await cache.invalidate();
      return {
        logoKey: conform(z.string().nullable(), key ?? null, 'admin_delete_brand'),
        bannerKey: conform(z.string().nullable(), before?.banner_key ?? null, 'brands'),
      };
    },

    async setProductBrand(_accessToken, userId, productId, brandId) {
      await callFunction<null>(
        userId,
        'select public.admin_set_product_brand($1::uuid, $2::uuid)',
        [productId, brandId],
        'admin_set_product_brand',
      );
    },

    async productBrand(_accessToken, userId, productId) {
      const rows = await asUser(userId, (client) =>
        client
          .query<{ brand_id: string | null }>(
            'select brand_id from public.products where id = $1',
            [productId],
          )
          .then((result) => result.rows),
      );
      return rows[0] === undefined ? undefined : rows[0].brand_id;
    },

    async adminListBanners(_accessToken, userId) {
      const rows = await asUser(userId, (client) =>
        client
          .query<BannerRow>(`${BANNER_SQL} order by b.placement, b.sort_order`)
          .then((result) => result.rows),
      );
      return conform(
        z.array(adminBannerSchema),
        rows.map((row) => adminBannerOf(row, mediaBaseUrl)),
        'banners',
      );
    },

    async adminGetBanner(_accessToken, userId, bannerId) {
      const rows = await asUser(userId, (client) =>
        client
          .query<BannerRow>(`${BANNER_SQL} where b.id = $1`, [bannerId])
          .then((result) => result.rows),
      );
      const row = rows[0];
      return row === undefined
        ? null
        : conform(adminBannerSchema, adminBannerOf(row, mediaBaseUrl), 'banners');
    },

    async saveBanner(_accessToken, userId, bannerId, input) {
      const id = await callFunction<string | null>(
        userId,
        'select public.admin_save_banner($1::uuid, $2::public.banner_placement, $3::uuid, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12)',
        [
          bannerId,
          input.placement,
          input.categoryId,
          input.title,
          input.subtitle,
          input.ctaLabel,
          input.ctaHref,
          input.sortOrder,
          input.isActive,
          input.startsAt,
          input.endsAt,
          input.imageAlt,
        ],
        'admin_save_banner',
      );
      await cache.invalidate();
      return conform(z.uuid(), id, 'admin_save_banner');
    },

    async setBannerImage(_accessToken, userId, bannerId, imageKey) {
      const old = await callFunction<string | null>(
        userId,
        'select public.admin_set_banner_image($1::uuid, $2)',
        [bannerId, imageKey],
        'admin_set_banner_image',
      );
      await cache.invalidate();
      return conform(z.string().nullable(), old ?? null, 'admin_set_banner_image');
    },

    async setBannerMobileImage(_accessToken, userId, bannerId, imageKey) {
      const old = await callFunction<string | null>(
        userId,
        'select public.admin_set_banner_mobile_image($1::uuid, $2)',
        [bannerId, imageKey],
        'admin_set_banner_mobile_image',
      );
      await cache.invalidate();
      return conform(z.string().nullable(), old ?? null, 'admin_set_banner_mobile_image');
    },

    async deleteBanner(_accessToken, userId, bannerId) {
      const keys = await callFunction<string[]>(
        userId,
        'select public.admin_delete_banner_files($1::uuid)',
        [bannerId],
        'admin_delete_banner_files',
      );
      await cache.invalidate();
      return conform(z.array(z.string()), keys, 'admin_delete_banner_files');
    },

    async reorderBanners(_accessToken, userId, placement, categoryId, ids) {
      await callFunction<unknown>(
        userId,
        'select public.admin_reorder_banners($1::public.banner_placement, $2::uuid, $3::uuid[])',
        [placement, categoryId, [...ids]],
        'admin_reorder_banners',
      );
      await cache.invalidate();
    },
  };
}
