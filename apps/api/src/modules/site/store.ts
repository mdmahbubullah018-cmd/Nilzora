import {
  homepageSectionSchema,
  navigationSchema,
  publicSitePageSchema,
  publicStoreProfileSchema,
  seoMetadataSchema,
  seoOverviewRowSchema,
  sitemapEntrySchema,
  type HomepageSection,
  type Navigation,
  type PublicSitePage,
  type PublicStoreProfile,
  type SaveSeoRequest,
  type SaveStoreProfileRequest,
  type SeoKind,
  type SeoMetadata,
  type SeoOverviewQuery,
  type SeoOverviewRow,
  type SitemapEntry,
  type SitePageSlug,
} from '@nilzora/contracts';
import { functionCallSql } from '../db-rpc';
import type { Pool } from 'pg';
import { z } from 'zod';
import { withUser } from '../../db/user-context';
import type { SupabaseClients } from '../../supabase/clients';
import { toAdminStoreError } from '../admin/errors';
import {
  StoreUnavailableError,
  isoTimestamp,
  toStoreError,
  type DatabaseFailure,
} from '../commerce/errors';
import { publicMediaUrl } from '../media/public-url';

/*
 * SEO and the store profile
 * -------------------------
 * Both are read by the public site and written by staff. The public reads are granted to
 * anon in the database and answer only for content a visitor may see, so this module never
 * decides visibility itself; the writes run as the caller, and the database checks the
 * permission again.
 */

/** Set-returning functions need a different Postgres call shape; Supabase answers an array either way. */
type Rpc = <T>(name: string, args: Record<string, unknown>, rows?: boolean) => Promise<T>;

type RpcCall = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: DatabaseFailure | null }>;

export interface SiteStore {
  publicProfile(): Promise<PublicStoreProfile>;
  /** A published static page, or null (unwritten, unpublished or unknown). */
  publicPage(slug: SitePageSlug): Promise<PublicSitePage | null>;
  /** The active navigation links and the published pages. */
  publicNavigation(): Promise<Navigation>;
  /** The enabled homepage sections in order; empty when none are set up. */
  publicHomepage(): Promise<HomepageSection[]>;
  publicSeo(kind: SeoKind, slug: string): Promise<SeoMetadata | null>;
  sitemap(): Promise<SitemapEntry[]>;
  overview(accessToken: string, userId: string, query: SeoOverviewQuery): Promise<SeoOverviewRow[]>;
  saveProductSeo(
    accessToken: string,
    userId: string,
    productId: string,
    input: SaveSeoRequest,
  ): Promise<void>;
  saveCategorySeo(
    accessToken: string,
    userId: string,
    categoryId: string,
    input: SaveSeoRequest,
  ): Promise<void>;
  adminProfile(accessToken: string, userId: string): Promise<PublicStoreProfile>;
  saveProfile(
    accessToken: string,
    userId: string,
    input: SaveStoreProfileRequest,
  ): Promise<PublicStoreProfile>;
}

interface OverviewRow {
  kind: string;
  id: string;
  slug: string;
  name: string;
  is_public: boolean;
  seo_title: string | null;
  seo_description: string | null;
  og_title: string | null;
  og_description: string | null;
  og_image_key: string | null;
  canonical_path: string | null;
  no_index: boolean;
  missing_title: boolean;
  missing_description: boolean;
  updated_at: string | Date;
}

interface SitemapRow {
  kind: string;
  slug: string;
  last_modified: string | Date;
}

const idSchema = z.uuid();

/** Options both adapters take: the public media address, so a stored key becomes a URL. */
export interface SiteStoreOptions {
  /**
   * The bucket's public base (config.media.publicBaseUrl). Absent when media is not
   * configured, in which case every resolved URL is null and nothing is guessed.
   */
  mediaBaseUrl?: string | undefined;
}

/**
 * One profile as a reader receives it: the stored logo and share-image keys turned into public
 * URLs by the only process that knows the media address. The keys themselves stay in the
 * payload — the Admin form edits them — but a reader never has to build a URL from them.
 */
export function presentProfile(
  profile: PublicStoreProfile,
  mediaBaseUrl: string | undefined,
): PublicStoreProfile {
  return {
    ...profile,
    logoUrl: publicMediaUrl(profile.logoKey, mediaBaseUrl, 'thumb'),
    ogImageUrl: publicMediaUrl(profile.ogImageKey, mediaBaseUrl),
  };
}

/** One page's metadata as a reader receives it, with its share image resolved. */
export function presentSeo(seo: SeoMetadata, mediaBaseUrl: string | undefined): SeoMetadata {
  return { ...seo, ogImageUrl: publicMediaUrl(seo.ogImageKey, mediaBaseUrl) };
}

function toIso(value: string | Date): string {
  return isoTimestamp(value);
}

/**
 * A `jsonb` document from the database, with its `updatedAt` in the `Z` form the contracts
 * require. Inside `jsonb` PostgreSQL writes a timestamp as `…+00:00`, which is valid ISO but
 * not the shape `z.iso.datetime()` accepts, so it is normalised here rather than in SQL.
 */
function withIsoTimestamp(value: unknown): unknown {
  const row = (value ?? {}) as Record<string, unknown>;
  return { ...row, updatedAt: isoTimestamp(row.updatedAt as string | Date) };
}

/** The save arguments, in the order both save functions declare them. */
function seoArgs(input: SaveSeoRequest) {
  return {
    p_seo_title: input.seoTitle,
    p_seo_description: input.seoDescription,
    p_og_title: input.ogTitle,
    p_og_description: input.ogDescription,
    p_og_image_key: input.ogImageKey,
    p_canonical_path: input.canonicalPath,
    p_no_index: input.noIndex,
  };
}

function siteStoreOver(
  rpcFor: (accessToken: string | null, userId: string | null) => Rpc,
  mediaBaseUrl: string | undefined,
): SiteStore {
  /** Every read of the profile goes through here, so the logo URL is resolved once per path. */
  const toProfile = (data: unknown): PublicStoreProfile =>
    presentProfile(publicStoreProfileSchema.parse(withIsoTimestamp(data)), mediaBaseUrl);

  return {
    async publicProfile() {
      const data = await rpcFor(null, null)<unknown>('public_store_profile', {});
      if (data === null || data === undefined) {
        throw new StoreUnavailableError('public_store_profile answered with no row');
      }
      return toProfile(data);
    },

    async publicPage(slug) {
      const data = await rpcFor(null, null)<unknown>('public_site_page', { p_slug: slug });
      return data === null || data === undefined
        ? null
        : publicSitePageSchema.parse(withIsoTimestamp(data));
    },

    async publicNavigation() {
      const data = await rpcFor(null, null)<unknown>('public_navigation', {});
      return navigationSchema.parse(data);
    },

    async publicHomepage() {
      const data = await rpcFor(null, null)<{ sections?: unknown } | null>('public_homepage', {});
      return z.array(homepageSectionSchema).parse(data?.sections ?? []);
    },

    async publicSeo(kind, slug) {
      const name = kind === 'product' ? 'public_product_seo' : 'public_category_seo';
      const data = await rpcFor(null, null)<unknown>(name, { p_slug: slug });
      return data === null || data === undefined
        ? null
        : presentSeo(seoMetadataSchema.parse(withIsoTimestamp(data)), mediaBaseUrl);
    },

    async sitemap() {
      const rows = await rpcFor(null, null)<SitemapRow[]>('public_sitemap_entries', {}, true);
      return (rows ?? []).map((row) =>
        sitemapEntrySchema.parse({
          kind: row.kind,
          slug: row.slug,
          lastModified: toIso(row.last_modified),
        }),
      );
    },

    async overview(accessToken, userId, query) {
      const rows = await rpcFor(accessToken, userId)<OverviewRow[]>(
        'admin_seo_overview',
        { p_query: query.q === '' ? null : query.q },
        true,
      );
      return (rows ?? []).map((row) =>
        seoOverviewRowSchema.parse({
          kind: row.kind,
          id: row.id,
          slug: row.slug,
          name: row.name,
          isPublic: row.is_public,
          seoTitle: row.seo_title,
          seoDescription: row.seo_description,
          ogTitle: row.og_title,
          ogDescription: row.og_description,
          ogImageKey: row.og_image_key,
          canonicalPath: row.canonical_path,
          noIndex: row.no_index,
          missingTitle: row.missing_title,
          missingDescription: row.missing_description,
          updatedAt: toIso(row.updated_at),
        }),
      );
    },

    async saveProductSeo(accessToken, userId, productId, input) {
      await rpcFor(accessToken, userId)('admin_save_product_seo', {
        p_product_id: idSchema.parse(productId),
        ...seoArgs(input),
      });
    },

    async saveCategorySeo(accessToken, userId, categoryId, input) {
      await rpcFor(accessToken, userId)('admin_save_category_seo', {
        p_category_id: idSchema.parse(categoryId),
        ...seoArgs(input),
      });
    },

    async adminProfile(accessToken, userId) {
      const data = await rpcFor(accessToken, userId)<unknown>('admin_store_profile', {});
      if (data === null || data === undefined) {
        throw new StoreUnavailableError('admin_store_profile answered with no row');
      }
      return toProfile(data);
    },

    async saveProfile(accessToken, userId, input) {
      // A key present sets (or, as null, clears) the field; one left out keeps what is saved.
      const extras: Record<string, string | null> = {};
      if (input.whatsappNumber !== undefined) extras.whatsappNumber = input.whatsappNumber;
      if (input.playStoreUrl !== undefined) extras.playStoreUrl = input.playStoreUrl;
      if (input.appStoreUrl !== undefined) extras.appStoreUrl = input.appStoreUrl;
      if (input.socialTiktok !== undefined) extras.socialTiktok = input.socialTiktok;
      if (input.socialX !== undefined) extras.socialX = input.socialX;
      await rpcFor(accessToken, userId)('admin_save_store_profile', {
        p_display_name: input.displayName,
        p_extras: extras,
        p_tagline: input.tagline,
        p_description: input.description,
        p_logo_key: input.logoKey,
        p_contact_email: input.contactEmail,
        p_contact_phone: input.contactPhone,
        p_address_line: input.addressLine,
        p_address_area: input.addressArea,
        p_address_district: input.addressDistrict,
        p_business_hours: input.businessHours,
        p_support_email: input.supportEmail,
        p_support_phone: input.supportPhone,
        p_social_facebook: input.socialFacebook,
        p_social_instagram: input.socialInstagram,
        p_social_youtube: input.socialYoutube,
        p_default_seo_title: input.defaultSeoTitle,
        p_default_seo_description: input.defaultSeoDescription,
        p_og_image_key: input.ogImageKey,
      });
      // Read it back, so the page shows what the database actually holds.
      const data = await rpcFor(accessToken, userId)<unknown>('admin_store_profile', {});
      if (data === null || data === undefined) {
        throw new StoreUnavailableError('admin_store_profile answered with no row');
      }
      return toProfile(data);
    },
  };
}

export function createSupabaseSiteStore(
  clients: SupabaseClients,
  options: SiteStoreOptions = {},
): SiteStore {
  return siteStoreOver((accessToken) => {
    const client = clients.asUser(accessToken ?? '');
    const call = client.rpc.bind(client) as unknown as RpcCall;
    return async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      const { data, error } = await call(name, args);
      if (error) throw toAdminStoreError(error, name);
      return data as T;
    };
  }, options.mediaBaseUrl);
}

export function createPostgresSiteStore(pool: Pool, options: SiteStoreOptions = {}): SiteStore {
  return siteStoreOver((_accessToken, userId) => {
    return async <T>(name: string, args: Record<string, unknown>, rows = false): Promise<T> => {
      try {
        return await withUser(
          pool,
          userId ?? '00000000-0000-0000-0000-000000000000',
          async (client) => {
            const entries = Object.entries(args).filter(
              ([, argument]) => argument !== null && argument !== undefined,
            );
            const parameters = entries.map(([, argument]) =>
              typeof argument === 'object' ? JSON.stringify(argument) : argument,
            );
            const named = entries.map(([key], index) => `${key} => $${index + 1}`).join(', ');
            const sql = rows
              ? `select * from public.${name}(${named})`
              : await functionCallSql(client, name, named);
            const result = await client.query(sql, parameters);
            if (rows) return result.rows as T;
            const row = result.rows[0] as { value: T } | undefined;
            if (row === undefined) throw new StoreUnavailableError(`${name} answered with no row`);
            return row.value;
          },
        );
      } catch (error) {
        if (error instanceof StoreUnavailableError) throw error;
        throw toStoreError(pgFailure(error), name);
      }
    };
  }, options.mediaBaseUrl);
}

function pgFailure(error: unknown): DatabaseFailure {
  const fields = error as { code?: unknown; message?: unknown; detail?: unknown } | null;
  return {
    code: typeof fields?.code === 'string' ? fields.code : '',
    message: typeof fields?.message === 'string' ? fields.message : 'database error',
    details: typeof fields?.detail === 'string' ? fields.detail : null,
  };
}
