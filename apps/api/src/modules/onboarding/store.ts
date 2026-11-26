import {
  adminOnboardingSlideSchema,
  onboardingCampaignListResponseSchema,
  onboardingCampaignSchema,
  onboardingSlideSecondsSchema,
  publicOnboardingSchema,
  type AdminOnboardingSlide,
  type OnboardingCampaign,
  type OnboardingCampaignSummary,
  type PublicOnboarding,
} from '@nilzora/contracts';
import { bindArguments, functionCallSql } from '../db-rpc';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { withAnon, withUser } from '../../db/user-context';
import type { SupabaseClients } from '../../supabase/clients';
import { toAdminStoreError } from '../admin/errors';
import {
  StoreUnavailableError,
  isoTimestamp,
  isoTimestamps,
  toStoreError,
  type DatabaseFailure,
} from '../commerce/errors';
import { publicMediaUrl } from '../media/public-url';

/*
 * Onboarding campaigns
 * --------------------
 * The database decides eligibility — enabled, inside its window, matching the caller's
 * audience, and not already finished under the campaign's own frequency — and returns only
 * presentation fields. This module adds the one thing SQL cannot know here: the public
 * address of the media bucket, because only the API is configured with it.
 *
 * A campaign whose slides are all disabled has nothing to show, so it is treated as no
 * campaign at all rather than sending an empty carousel to a customer.
 */

/** Set-returning functions need a different Postgres call shape. */
type Rpc = <T>(name: string, args: Record<string, unknown>, rows?: boolean) => Promise<T>;

type RpcCall = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: DatabaseFailure | null }>;

export interface OnboardingStoreOptions {
  /** The bucket's public base (config.media.publicBaseUrl); absent when media is unset. */
  mediaBaseUrl?: string | undefined;
}

/**
 * What the routes need from persistence. Declared as properties holding functions rather
 * than as methods: a port may be passed around (and mocked) without losing its receiver.
 */
export interface OnboardingStore {
  /**
   * The one campaign this caller may see right now, or null. A guest passes `null, null`; a
   * signed-in customer passes their token and their verified account id, so the database
   * applies the audience and the account's own history (never the guest's view).
   */
  publicCampaign: (
    accessToken: string | null,
    userId: string | null,
  ) => Promise<PublicOnboarding | null>;
  /** Records that the signed-in caller finished (or skipped) a campaign they were shown. */
  complete: (accessToken: string, userId: string, campaignId: string) => Promise<void>;

  list: (accessToken: string, userId: string) => Promise<OnboardingCampaignSummary[]>;
  get: (accessToken: string, userId: string, campaignId: string) => Promise<OnboardingCampaign>;
  saveCampaign: (
    accessToken: string,
    userId: string,
    campaignId: string | null,
    input: Record<string, unknown>,
  ) => Promise<string>;
  setActive: (
    accessToken: string,
    userId: string,
    campaignId: string,
    active: boolean,
  ) => Promise<void>;
  remove: (accessToken: string, userId: string, campaignId: string) => Promise<void>;
  preview: (accessToken: string, userId: string, campaignId: string) => Promise<PublicOnboarding>;
  saveSlide: (
    accessToken: string,
    userId: string,
    slideId: string | null,
    campaignId: string,
    input: Record<string, unknown>,
  ) => Promise<AdminOnboardingSlide>;
  deleteSlide: (accessToken: string, userId: string, slideId: string) => Promise<void>;
  reorder: (
    accessToken: string,
    userId: string,
    campaignId: string,
    slideIds: readonly string[],
  ) => Promise<void>;
}

interface CampaignSummaryRow {
  id: string;
  internal_name: string;
  kind: string;
  audience: string;
  frequency: string;
  repeat_days: number | null;
  slide_seconds: number;
  starts_at: string | Date | null;
  ends_at: string | Date | null;
  is_active: boolean;
  slide_count: number;
  active_slide_count: number;
  updated_at: string | Date;
}

/** What the public function returns before the media address is attached. */
const publicPayloadSchema = z
  .object({
    id: z.uuid(),
    kind: z.string(),
    frequency: z.string(),
    repeatDays: z.number().int().nullable().default(null),
    slideSeconds: z.number().int(),
    endsAt: z.string().nullable().default(null),
    slides: z.array(
      z.object({
        id: z.uuid(),
        heading: z.string(),
        description: z.string(),
        imageKey: z.string().nullable().default(null),
        icon: z.string().nullable().default(null),
        ctaLabel: z.string().nullable().default(null),
        ctaPath: z.string().nullable().default(null),
        altText: z.string().nullable().default(null),
        position: z.number().int(),
      }),
    ),
  })
  .nullable();

function toIso(value: string | Date | null): string | null {
  if (value === null) return null;
  return isoTimestamp(value);
}

/**
 * The customer-facing campaign: one real media URL per slide, and null when there is
 * nothing worth showing (no payload, or every slide switched off).
 */
export function toPublicCampaign(
  data: unknown,
  mediaBaseUrl: string | undefined,
): PublicOnboarding | null {
  const parsed = publicPayloadSchema.parse(isoTimestamps(data));
  if (parsed === null || parsed.slides.length === 0) return null;

  return publicOnboardingSchema.parse({
    id: parsed.id,
    kind: parsed.kind,
    frequency: parsed.frequency,
    repeatDays: parsed.repeatDays,
    slideSeconds: onboardingSlideSecondsSchema.parse(parsed.slideSeconds),
    endsAt: parsed.endsAt,
    slides: parsed.slides.map((slide) => ({
      id: slide.id,
      heading: slide.heading,
      description: slide.description,
      imageUrl: publicMediaUrl(slide.imageKey, mediaBaseUrl),
      icon: slide.icon,
      ctaLabel: slide.ctaLabel,
      ctaPath: slide.ctaPath,
      altText: slide.altText,
      position: slide.position,
    })),
  });
}

function onboardingStoreOver(
  rpcFor: (accessToken: string | null, userId: string | null) => Rpc,
  mediaBaseUrl: string | undefined,
): OnboardingStore {
  return {
    async publicCampaign(accessToken, userId) {
      const data = await rpcFor(accessToken, userId)<unknown>('public_onboarding', {});
      return toPublicCampaign(data, mediaBaseUrl);
    },

    async complete(accessToken, userId, campaignId) {
      await rpcFor(accessToken, userId)('complete_onboarding', {
        p_campaign_id: z.uuid().parse(campaignId),
      });
    },

    async list(accessToken, userId) {
      const rows = await rpcFor(accessToken, userId)<CampaignSummaryRow[]>(
        'admin_list_onboarding',
        {},
        true,
      );
      const parsed = onboardingCampaignListResponseSchema.parse({
        campaigns: (rows ?? []).map((row) => ({
          id: row.id,
          internalName: row.internal_name,
          kind: row.kind,
          audience: row.audience,
          frequency: row.frequency,
          repeatDays: row.repeat_days,
          slideSeconds: row.slide_seconds,
          startsAt: toIso(row.starts_at),
          endsAt: toIso(row.ends_at),
          isActive: row.is_active,
          slideCount: row.slide_count,
          activeSlideCount: row.active_slide_count,
          updatedAt: toIso(row.updated_at),
        })),
      });
      return parsed.campaigns;
    },

    async get(accessToken, userId, campaignId) {
      const data = await rpcFor(accessToken, userId)<unknown>('admin_get_onboarding', {
        p_campaign_id: z.uuid().parse(campaignId),
      });
      // The database writes jsonb timestamps with an offset (+00:00); the contract wants Z.
      return onboardingCampaignSchema.parse(isoTimestamps(data));
    },

    async saveCampaign(accessToken, userId, campaignId, input) {
      const data = await rpcFor(accessToken, userId)<unknown>('admin_save_onboarding_campaign', {
        p_campaign_id: campaignId === null ? null : z.uuid().parse(campaignId),
        p_payload: input,
      });
      return z.uuid().parse(data);
    },

    async setActive(accessToken, userId, campaignId, active) {
      await rpcFor(accessToken, userId)('admin_set_onboarding_active', {
        p_campaign_id: z.uuid().parse(campaignId),
        p_active: active,
      });
    },

    async remove(accessToken, userId, campaignId) {
      await rpcFor(accessToken, userId)('admin_delete_onboarding_campaign', {
        p_campaign_id: z.uuid().parse(campaignId),
      });
    },

    async preview(accessToken, userId, campaignId) {
      const data = await rpcFor(accessToken, userId)<unknown>('admin_preview_onboarding', {
        p_campaign_id: z.uuid().parse(campaignId),
      });
      const campaign = toPublicCampaign(data, mediaBaseUrl);
      if (campaign === null) {
        throw new StoreUnavailableError('this campaign has no enabled slide to preview');
      }
      return campaign;
    },

    async saveSlide(accessToken, userId, slideId, campaignId, input) {
      const data = await rpcFor(accessToken, userId)<unknown>('admin_save_onboarding_slide', {
        p_slide_id: slideId === null ? null : z.uuid().parse(slideId),
        p_campaign_id: z.uuid().parse(campaignId),
        p_payload: input,
      });
      return adminOnboardingSlideSchema.parse(isoTimestamps(data));
    },

    async deleteSlide(accessToken, userId, slideId) {
      await rpcFor(accessToken, userId)('admin_delete_onboarding_slide', {
        p_slide_id: z.uuid().parse(slideId),
      });
    },

    async reorder(accessToken, userId, campaignId, slideIds) {
      await rpcFor(accessToken, userId)('admin_reorder_onboarding_slides', {
        p_campaign_id: z.uuid().parse(campaignId),
        p_slide_ids: slideIds.map((id) => z.uuid().parse(id)),
      });
    },
  };
}

export function createSupabaseOnboardingStore(
  clients: SupabaseClients,
  options: OnboardingStoreOptions = {},
): OnboardingStore {
  return onboardingStoreOver((accessToken) => {
    // No token means a genuine anonymous PostgREST request: auth.uid() is null, so the
    // database can tell a guest from a customer when it applies the audience rule.
    const client = accessToken === null ? clients.public() : clients.asUser(accessToken);
    const call = client.rpc.bind(client) as unknown as RpcCall;
    return async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      const { data, error } = await call(name, args);
      if (error) throw toAdminStoreError(error, name);
      return data as T;
    };
  }, options.mediaBaseUrl);
}

export function createPostgresOnboardingStore(
  pool: Pool,
  options: OnboardingStoreOptions = {},
): OnboardingStore {
  return onboardingStoreOver((accessToken, userId) => {
    return async <T>(name: string, args: Record<string, unknown>, rows = false): Promise<T> => {
      // A token without the account it was verified for is a caller's mistake, never a guest:
      // running it as `anon` would quietly show a customer the guest view (and refuse to
      // record what they finished), so it is refused before the database is touched.
      if (accessToken !== null && userId === null) {
        throw new TypeError(`${name}: a signed-in call needs the verified account id`);
      }
      const run = async (client: PoolClient): Promise<T> => {
        // A null is an argument like any other: a new campaign or slide has no id yet, and these
        // functions have no defaults, so leaving it out would name a function that does not exist.
        // bindArguments also sends a uuid[] (the slide order) as an array, not as JSON text.
        const entries = Object.entries(args).filter(([, argument]) => argument !== undefined);
        const parameters = await bindArguments(client, name, entries);
        const named = entries.map(([key], index) => `${key} => $${index + 1}`).join(', ');
        const sql = rows
          ? `select * from public.${name}(${named})`
          : await functionCallSql(client, name, named);
        const result = await client.query(sql, parameters);
        if (rows) return result.rows as T;
        const row = result.rows[0] as { value: T } | undefined;
        if (row === undefined) throw new StoreUnavailableError(`${name} answered no row`);
        return row.value;
      };

      try {
        return accessToken === null || userId === null
          ? await withAnon(pool, run)
          : await withUser(pool, userId, run);
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
