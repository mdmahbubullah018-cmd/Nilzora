import {
  adminCampaignListResponseSchema,
  adminCampaignResponseSchema,
  campaignConflictListResponseSchema,
  campaignHistoryResponseSchema,
  campaignPreviewResponseSchema,
  categoryCampaignListResponseSchema,
  type AdminCampaign,
  type AdminCampaignDetail,
  type AdminCampaignListQuery,
  type CampaignConflict,
  type CampaignHistoryEntry,
  type CampaignPreviewRequest,
  type CampaignPreviewResponse,
  type CampaignSaveRequest,
  type CampaignStatus,
  type CategoryCampaign,
  type MediaPicture,
} from '@nilzora/contracts';
import type { Pool } from 'pg';
import { withUser } from '../../db/user-context';
import type { SupabaseClients } from '../../supabase/clients';
import { functionCallSql, pgFailure } from '../db-rpc';
import { conform, isoTimestamps } from '../commerce/errors';
import { variantKeys } from '../media/images';
import { AdminRefusalError, toAdminStoreError } from './errors';
import { sqlNull, type Page } from './shared';

/**
 * Discount campaigns as the admin manages them, and the live campaigns the storefront
 * shows. Every admin call runs as the signed-in account and the database function checks
 * the caller's permission again, so a missing API check could not read or change a
 * campaign. Reads are never cached: a campaign's state depends on the clock.
 */
export interface AdminDiscountStore {
  list(
    accessToken: string,
    userId: string,
    filters: Pick<AdminCampaignListQuery, 'q' | 'state' | 'scope'>,
    page: Page,
  ): Promise<{ campaigns: AdminCampaign[]; total: number }>;
  get(accessToken: string, userId: string, campaignId: string): Promise<AdminCampaignDetail | null>;
  /** Creates (campaignId null) or updates a campaign; returns the saved campaign. */
  save(
    accessToken: string,
    userId: string,
    campaignId: string | null,
    input: CampaignSaveRequest,
  ): Promise<AdminCampaignDetail>;
  setStatus(
    accessToken: string,
    userId: string,
    campaignId: string,
    status: CampaignStatus,
    expectedVersion: number | null,
  ): Promise<AdminCampaignDetail>;
  duplicate(accessToken: string, userId: string, campaignId: string): Promise<AdminCampaignDetail>;
  /** What a configuration that is not saved yet would do, priced by the real engine. */
  preview(
    accessToken: string,
    userId: string,
    input: CampaignPreviewRequest,
  ): Promise<CampaignPreviewResponse>;
  products(
    accessToken: string,
    userId: string,
    campaignId: string,
    page: Page,
  ): Promise<CampaignPreviewResponse>;
  conflicts(accessToken: string, userId: string, campaignId: string): Promise<CampaignConflict[]>;
  history(
    accessToken: string,
    userId: string,
    campaignId: string,
    page: { page: number; pageSize: number },
  ): Promise<{ entries: CampaignHistoryEntry[]; total: number }>;
  /** The live campaigns reaching the given categories (all of them when null). */
  categoryCampaigns(
    accessToken: string,
    userId: string,
    categoryIds: readonly string[] | null,
  ): Promise<CategoryCampaign[]>;
}

function listArgs(
  filters: Pick<AdminCampaignListQuery, 'q' | 'state' | 'scope'>,
  { limit, offset }: Page,
) {
  return {
    p_search: sqlNull(filters.q === undefined || filters.q === '' ? null : filters.q),
    p_state: filters.state ?? 'all',
    p_scope: filters.scope ?? 'all',
    p_page: Math.floor(offset / limit) + 1,
    p_page_size: limit,
  };
}

function saveArgs(campaignId: string | null, input: CampaignSaveRequest) {
  return {
    p_campaign_id: sqlNull(campaignId),
    p_name: input.name,
    p_customer_title: input.customerTitle,
    p_scope: input.scope,
    p_discount_kind: input.discountKind,
    p_discount_value: input.discountValue,
    p_max_discount_minor: sqlNull(input.maxDiscountMinor ?? null),
    p_starts_at: sqlNull(input.startsAt ?? null),
    p_ends_at: sqlNull(input.endsAt ?? null),
    p_priority: input.priority ?? 0,
    p_is_visible: input.isVisible ?? true,
    p_banner_image_key: sqlNull(input.bannerImageKey ?? null),
    p_coupon_policy: input.couponPolicy ?? 'stackable',
    p_category_ids: [...(input.categoryIds ?? [])],
    p_brand_ids: [...(input.brandIds ?? [])],
    p_product_ids: [...(input.productIds ?? [])],
    p_internal_notes: sqlNull(input.internalNotes ?? null),
    p_expected_version: sqlNull(input.expectedVersion ?? null),
  };
}

function previewArgs(input: CampaignPreviewRequest) {
  return {
    p_scope: input.scope,
    p_discount_kind: input.discountKind,
    p_discount_value: input.discountValue,
    p_max_discount_minor: sqlNull(input.maxDiscountMinor ?? null),
    p_priority: input.priority ?? 0,
    p_category_ids: [...(input.categoryIds ?? [])],
    p_brand_ids: [...(input.brandIds ?? [])],
    p_product_ids: [...(input.productIds ?? [])],
    p_page: input.page ?? 1,
    p_page_size: input.pageSize ?? 25,
  };
}

/** Declared argument types per function, read once from the catalogue. */
const ARGUMENT_TYPES = new Map<string, Map<string, string>>();

/**
 * PostgreSQL cannot always resolve untyped parameters in a named-notation call, so each
 * argument is cast to the type the function itself declares (never to anything a request chose).
 */
async function argumentTypes(
  client: { query: <R>(sql: string, values?: unknown[]) => Promise<{ rows: R[] }> },
  name: string,
): Promise<Map<string, string>> {
  const known = ARGUMENT_TYPES.get(name);
  if (known) return known;
  const result = await client.query<{ arg: string; type: string }>(
    `select a.arg, format_type(a.type, null) as type
       from pg_catalog.pg_proc p
       cross join lateral unnest(p.proargnames, p.proargtypes::oid[]) as a (arg, type)
      where p.proname = $1 and p.pronamespace = 'public'::regnamespace`,
    [name],
  );
  const types = new Map(result.rows.map((row) => [row.arg, row.type]));
  ARGUMENT_TYPES.set(name, types);
  return types;
}

/** Calls one campaign function as the caller; a refusal arrives as an AdminRefusalError. */
type CampaignCall = (
  accessToken: string,
  userId: string,
) => (name: string, args: Record<string, unknown>) => Promise<unknown>;

/** Over Supabase, as the caller's JWT (Supabase Auth sessions). */
export function createSupabaseAdminDiscountStore(
  clients: SupabaseClients,
  options: { mediaBaseUrl?: string | undefined } = {},
): AdminDiscountStore {
  return createAdminDiscountStore(
    (accessToken) => async (name, args) => {
      const call = clients.asUser(accessToken).rpc.bind(clients.asUser(accessToken)) as unknown as (
        fn: string,
        params: Record<string, unknown>,
      ) => Promise<{
        data: unknown;
        error: { code: string; message: string; details: string | null } | null;
      }>;
      const { data, error } = await call(name, args);
      if (error) throw toAdminStoreError(error, name);
      return data;
    },
    options,
  );
}

/**
 * Over the direct database connection, inside a transaction that carries the verified
 * caller's identity, so the same functions check the same permissions. Needed for
 * first-party sessions, whose tokens Supabase cannot read.
 */
export function createPostgresAdminDiscountStore(
  pool: Pool,
  options: { mediaBaseUrl?: string | undefined } = {},
): AdminDiscountStore {
  return createAdminDiscountStore(
    (_accessToken, userId) => async (name, args) => {
      try {
        return await withUser(pool, userId, async (client) => {
          // Nulls are passed (typed, below) exactly as Supabase passes them: several campaign
          // functions take required arguments whose value may be null.
          const entries = Object.entries(args).filter(([, value]) => value !== undefined);
          // Arrays go to uuid[] parameters as PostgreSQL arrays; other objects are JSON.
          const parameters = entries.map(([, value]) =>
            value !== null && typeof value === 'object' && !Array.isArray(value)
              ? JSON.stringify(value)
              : value,
          );
          const types = await argumentTypes(client, name);
          const named = entries
            .map(([key], index) => {
              const type = types.get(key);
              return `${key} => $${String(index + 1)}${type ? `::${type}` : ''}`;
            })
            .join(', ');
          const result = await client.query<{ value: unknown }>(
            await functionCallSql(client, name, named),
            parameters,
          );
          return result.rows[0]?.value ?? null;
        });
      } catch (error) {
        if (error instanceof AdminRefusalError) throw error;
        throw toAdminStoreError(pgFailure(error), name);
      }
    },
    options,
  );
}

function createAdminDiscountStore(
  call: CampaignCall,
  { mediaBaseUrl }: { mediaBaseUrl?: string | undefined } = {},
): AdminDiscountStore {
  /** Runs one function and answers `{ data, error }` like Supabase; only "not found" is an answer, every other refusal throws. */
  function asUser(accessToken: string, userId = '') {
    return {
      rpc: async (name: string, args: Record<string, unknown>) => {
        try {
          return { data: isoTimestamps(await call(accessToken, userId)(name, args)), error: null };
        } catch (error) {
          if (error instanceof AdminRefusalError && error.refusal === 'campaign_not_found') {
            return { data: null, error: { code: 'NZ490' } };
          }
          throw error;
        }
      },
    };
  }

  /** A campaign function answers the campaign itself; the response contract wraps it. */
  function campaignOf(data: unknown, operation: string): AdminCampaignDetail {
    const campaign = conform(adminCampaignResponseSchema, { campaign: data }, operation).campaign;
    return { ...campaign, banner: bannerOf(campaign.bannerImageKey) };
  }

  /**
   * The write functions answer the campaign row without its targets (categories, brands,
   * products); the detail is read back as the same caller once the write committed.
   */
  async function fullCampaign(
    accessToken: string,
    userId: string,
    written: unknown,
    operation: string,
  ): Promise<AdminCampaignDetail> {
    const record = written as { categories?: unknown; id?: unknown } | null;
    if (record && Array.isArray(record.categories)) return campaignOf(written, operation);
    const id = typeof record?.id === 'string' ? record.id : null;
    if (id === null) return campaignOf(written, operation);
    const { data } = await asUser(accessToken, userId).rpc('admin_get_campaign', {
      p_campaign_id: id,
    });
    return campaignOf(data, 'admin_get_campaign');
  }

  /** The banner's two public variant URLs from the stored key; the key itself is not new. */
  function bannerOf(imageKey: string | null): MediaPicture | null {
    if (imageKey === null || imageKey === '' || mediaBaseUrl === undefined) return null;
    const [full, thumb] = variantKeys(imageKey);
    return { url: `${mediaBaseUrl}/${full}`, thumbUrl: `${mediaBaseUrl}/${thumb}` };
  }

  return {
    async list(accessToken, userId, filters, page) {
      const { data } = await asUser(accessToken, userId).rpc(
        'admin_list_campaigns',
        listArgs(filters, page),
      );
      const parsed = conform(adminCampaignListResponseSchema, data, 'admin_list_campaigns');
      return {
        campaigns: parsed.campaigns.map((campaign) => ({
          ...campaign,
          banner: bannerOf(campaign.bannerImageKey),
        })),
        total: parsed.total,
      };
    },

    async get(accessToken, userId, campaignId) {
      const { data, error } = await asUser(accessToken, userId).rpc('admin_get_campaign', {
        p_campaign_id: campaignId,
      });
      if (error) return null;
      return campaignOf(data, 'admin_get_campaign');
    },

    async save(accessToken, userId, campaignId, input) {
      const { data } = await asUser(accessToken, userId).rpc(
        'admin_save_campaign',
        saveArgs(campaignId, input),
      );
      return fullCampaign(accessToken, userId, data, 'admin_save_campaign');
    },

    async setStatus(accessToken, userId, campaignId, status, expectedVersion) {
      const { data } = await asUser(accessToken, userId).rpc('admin_set_campaign_status', {
        p_campaign_id: campaignId,
        p_status: status,
        p_expected_version: sqlNull(expectedVersion),
      });
      return fullCampaign(accessToken, userId, data, 'admin_set_campaign_status');
    },

    async duplicate(accessToken, userId, campaignId) {
      const { data } = await asUser(accessToken, userId).rpc('admin_duplicate_campaign', {
        p_campaign_id: campaignId,
      });
      return fullCampaign(accessToken, userId, data, 'admin_duplicate_campaign');
    },

    async preview(accessToken, userId, input) {
      const { data } = await asUser(accessToken, userId).rpc(
        'admin_preview_campaign',
        previewArgs(input),
      );
      return conform(campaignPreviewResponseSchema, data, 'admin_preview_campaign');
    },

    async products(accessToken, userId, campaignId, page) {
      const { data } = await asUser(accessToken, userId).rpc('admin_campaign_products', {
        p_campaign_id: campaignId,
        p_page: Math.floor(page.offset / page.limit) + 1,
        p_page_size: page.limit,
      });
      return conform(campaignPreviewResponseSchema, data, 'admin_campaign_products');
    },

    async conflicts(accessToken, userId, campaignId) {
      const { data } = await asUser(accessToken, userId).rpc('admin_campaign_conflicts', {
        p_campaign_id: campaignId,
      });
      return conform(
        campaignConflictListResponseSchema,
        { conflicts: data },
        'admin_campaign_conflicts',
      ).conflicts;
    },

    async history(accessToken, userId, campaignId, page) {
      const { data } = await asUser(accessToken, userId).rpc('admin_campaign_history', {
        p_campaign_id: campaignId,
        p_limit: page.pageSize,
        p_offset: (page.page - 1) * page.pageSize,
      });
      return conform(campaignHistoryResponseSchema, data, 'admin_campaign_history');
    },
    async categoryCampaigns(accessToken, userId, categoryIds) {
      const { data } = await asUser(accessToken, userId).rpc('admin_category_campaigns', {
        p_category_ids: sqlNull(categoryIds === null ? null : [...categoryIds]),
      });
      const rows = (data ?? []) as Record<string, unknown>[];
      return conform(
        categoryCampaignListResponseSchema,
        {
          campaigns: rows.map((row) => ({
            categoryId: row.category_id,
            campaignId: row.campaign_id,
            customerTitle: row.customer_title,
            scope: row.scope,
            discountKind: row.discount_kind,
            discountValue: Number(row.discount_value),
            startsAt: row.starts_at,
            endsAt: row.ends_at,
            status: row.status,
            productCount: Number(row.product_count),
          })),
        },
        'admin_category_campaigns',
      ).campaigns;
    },
  };
}
