import {
  adminPopupSchema,
  adminPopupSummarySchema,
  popupDelaySchema,
  popupDisplayModeSchema,
  popupAudienceSchema,
  popupFrequencySchema,
  popupPlatformSchema,
  popupMediaKindSchema,
  popupAnimatedKeySchema,
  popupStillKeySchema,
  publicPopupSchema,
  type AdminPopup,
  type AdminPopupSummary,
  type PublicPopup,
} from '@nilzora/contracts';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { withServiceRole, withUser } from '../../db/user-context';
import { functionCallSql } from '../db-rpc';
import { toAdminStoreError } from '../admin/errors';
import { StoreUnavailableError, isoTimestamp, type DatabaseFailure } from '../commerce/errors';
import { publicMediaUrl, singleObjectUrl } from '../media/public-url';

/*
 * Promotional popups
 * ------------------
 * The database decides what a customer may see — switched on, inside its window — and returns
 * presentation fields only. This module adds the one thing SQL cannot know: the public address
 * of the media bucket, because only the API is configured with it.
 *
 * Two kinds of stored artwork, and therefore two ways to build its address:
 *
 *   still     the picture pipeline wrote `<key>/full.webp` and `<key>/thumb.webp` beside the
 *             base key, so the address is built from the key's two variants;
 *   animated  an animated GIF was kept byte for byte under one key, so the address is that
 *             exact object.
 *
 * Both key shapes are matched against their own strict pattern before any URL is built, so a
 * stored value can never point a customer's browser somewhere else, and a popup whose artwork
 * cannot be resolved is treated as nothing to show rather than a broken frame.
 */

/** Every field the database hands back, as it arrives: camelCase from jsonb, unvalidated. */
const popupPayloadSchema = z.object({
  id: z.uuid(),
  internalName: z.string(),
  displayMode: z.string(),
  imageKey: z.string().nullable().default(null),
  imageKind: z.string().nullable().default(null),
  imageWidth: z.number().int().nullable().default(null),
  imageHeight: z.number().int().nullable().default(null),
  imageBytes: z.number().int().nullable().default(null),
  imageFormat: z.string().nullable().default(null),
  imageAlt: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  subtitle: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  buttonLabel: z.string().nullable().default(null),
  buttonHref: z.string().nullable().default(null),
  delaySeconds: z.number().int(),
  frequency: z.string(),
  // Absent from a database that has not run the targeting migration: the old behaviour.
  platform: z.string().default('both'),
  audience: z.string().default('all'),
  priority: z.number().int().default(0),
  isActive: z.boolean(),
  startsAt: z.string().nullable().default(null),
  endsAt: z.string().nullable().default(null),
  updatedAt: z.string(),
});

type PopupRow = z.infer<typeof popupPayloadSchema>;

/** The public payload the database sends: the same shape, minus every management field. */
const publicPayloadSchema = z.object({
  id: z.uuid(),
  displayMode: z.string(),
  imageKey: z.string(),
  imageKind: z.string(),
  imageWidth: z.number().int(),
  imageHeight: z.number().int(),
  imageFormat: z.string().nullable().default(null),
  imageAlt: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  subtitle: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  buttonLabel: z.string().nullable().default(null),
  buttonHref: z.string().nullable().default(null),
  delaySeconds: z.number().int(),
  frequency: z.string(),
  audience: z.string().default('all'),
  priority: z.number().int().default(0),
  endsAt: z.string().nullable().default(null),
});

function toIsoOrNull(value: string | null): string | null {
  return value === null ? null : isoTimestamp(value);
}

/** The stored file's format, for the facts shown beside a preview. */
function formatOf(mediaKind: 'still' | 'animated', stored: string | null): string {
  // A still was re-encoded as WebP by the pipeline, so that is what an admin is served.
  if (mediaKind === 'still') return 'webp';
  return stored ?? 'gif';
}

/**
 * The public URL of one popup's artwork, or null when there is nothing safe to link to.
 * A still resolves to the full-size variant; an animated file resolves to itself.
 */
export function popupArtworkUrl(
  key: string,
  mediaKind: 'still' | 'animated',
  mediaBaseUrl: string | undefined,
): string | null {
  if (mediaKind === 'still') return publicMediaUrl(key, mediaBaseUrl, 'full', popupStillKeySchema);
  return singleObjectUrl(key, mediaBaseUrl, popupAnimatedKeySchema);
}

/** The thumbnail of a still (for the Admin list); an animated file has only itself. */
export function popupThumbUrl(
  key: string,
  mediaKind: 'still' | 'animated',
  mediaBaseUrl: string | undefined,
): string | null {
  if (mediaKind === 'still') return publicMediaUrl(key, mediaBaseUrl, 'thumb', popupStillKeySchema);
  return singleObjectUrl(key, mediaBaseUrl, popupAnimatedKeySchema);
}

/**
 * The customer-facing popup, or null when there is nothing worth showing: no row, a row whose
 * shape cannot be read, or artwork whose address cannot be resolved (media not configured, or a
 * key that does not match).
 *
 * One unreadable popup must never take the whole endpoint down: the storefront and the app both
 * treat a failed read as "no popup", so a throw here would silently hide every other eligible
 * popup as well.
 */
export function toPublicPopup(data: unknown, mediaBaseUrl: string | undefined): PublicPopup | null {
  if (data === null || data === undefined) return null;
  const parsed = publicPayloadSchema.safeParse(data);
  if (!parsed.success) return null;
  const row = parsed.data;
  const mediaKind = popupMediaKindSchema.safeParse(row.imageKind);
  if (!mediaKind.success) return null;
  const imageUrl = popupArtworkUrl(row.imageKey, mediaKind.data, mediaBaseUrl);
  if (imageUrl === null) return null;
  const candidate = publicPopupSchema.safeParse({
    id: row.id,
    displayMode: popupDisplayModeSchema.parse(row.displayMode),
    imageUrl,
    imageWidth: row.imageWidth,
    imageHeight: row.imageHeight,
    isAnimated: mediaKind.data === 'animated',
    imageAlt: row.imageAlt,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    buttonLabel: row.buttonLabel,
    buttonHref: row.buttonHref,
    delaySeconds: popupDelaySchema.parse(row.delaySeconds),
    frequency: popupFrequencySchema.parse(row.frequency),
    audience: popupAudienceSchema.parse(row.audience),
    priority: row.priority,
    // Postgres sends a timestamptz as "…+00:00"; the contract carries an ISO instant.
    endsAt: toIsoOrNull(row.endsAt),
  });
  return candidate.success ? candidate.data : null;
}

/** One stored popup as the editor sees it: every field, plus the artwork's own facts. */
export function toAdminPopup(row: PopupRow, mediaBaseUrl: string | undefined): AdminPopup {
  const mediaKind = row.imageKind === null ? null : popupMediaKindSchema.parse(row.imageKind);
  const key = row.imageKey;
  return adminPopupSchema.parse({
    id: row.id,
    internalName: row.internalName,
    displayMode: popupDisplayModeSchema.parse(row.displayMode),
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    buttonLabel: row.buttonLabel,
    buttonHref: row.buttonHref,
    imageAlt: row.imageAlt,
    imageUrl:
      key === null || mediaKind === null ? null : popupArtworkUrl(key, mediaKind, mediaBaseUrl),
    thumbUrl:
      key === null || mediaKind === null ? null : popupThumbUrl(key, mediaKind, mediaBaseUrl),
    imageWidth: row.imageWidth,
    imageHeight: row.imageHeight,
    imageBytes: row.imageBytes,
    imageKind: mediaKind,
    imageFormat: mediaKind === null ? null : formatOf(mediaKind, row.imageFormat),
    isActive: row.isActive,
    delaySeconds: popupDelaySchema.parse(row.delaySeconds),
    frequency: popupFrequencySchema.parse(row.frequency),
    platform: popupPlatformSchema.parse(row.platform),
    audience: popupAudienceSchema.parse(row.audience),
    priority: row.priority,
    startsAt: toIsoOrNull(row.startsAt),
    endsAt: toIsoOrNull(row.endsAt),
    updatedAt: isoTimestamp(row.updatedAt),
  });
}

/** The facts the API validated from the uploaded bytes, recorded with the artwork. */
export interface PopupArtworkRecord {
  key: string;
  kind: 'still' | 'animated';
  width: number;
  height: number;
  bytes: number;
  format: 'jpeg' | 'png' | 'webp' | 'gif';
}

/**
 * What the routes need from persistence. Declared as properties holding functions rather than
 * as methods, so a port may be passed around (and mocked) without losing its receiver.
 */
export interface PopupStore {
  /** The popups a customer may see right now on one platform, best first. */
  publicPopups: (platform: 'website' | 'app') => Promise<PublicPopup[]>;
  list: (accessToken: string, userId: string) => Promise<AdminPopupSummary[]>;
  get: (accessToken: string, userId: string, popupId: string) => Promise<AdminPopup | null>;
  /** Creates (id null) or updates one popup, and returns its id. */
  save: (
    accessToken: string,
    userId: string,
    popupId: string | null,
    input: Record<string, unknown>,
  ) => Promise<string>;
  setActive: (
    accessToken: string,
    userId: string,
    popupId: string,
    active: boolean,
  ) => Promise<void>;
  /**
   * Records the artwork — or clears it when given null — and returns the key it replaced, so
   * the caller can delete those objects afterwards.
   */
  setArtwork: (
    accessToken: string,
    userId: string,
    popupId: string,
    artwork: PopupArtworkRecord | null,
  ) => Promise<string | null>;
  /** Removes the popup and returns its artwork key, for deleting the objects afterwards. */
  remove: (accessToken: string, userId: string, popupId: string) => Promise<string | null>;
}

function pgFailure(error: unknown): DatabaseFailure {
  const fields = error as { code?: unknown; message?: unknown; detail?: unknown } | null;
  return {
    code: typeof fields?.code === 'string' ? fields.code : '',
    message: typeof fields?.message === 'string' ? fields.message : 'database error',
    details: typeof fields?.detail === 'string' ? fields.detail : null,
  };
}

export interface PopupStoreOptions {
  /** The bucket's public base (config.media.publicBaseUrl); absent when media is unset. */
  mediaBaseUrl?: string | undefined;
}

/** One summary row: the list fields only, so the list never carries unused columns. */
function toSummary(row: PopupRow, mediaBaseUrl: string | undefined): AdminPopupSummary {
  // A draft has no artwork yet: no kind, no address.
  const mediaKind = row.imageKind === null ? null : popupMediaKindSchema.parse(row.imageKind);
  const key = row.imageKey;
  return adminPopupSummarySchema.parse({
    id: row.id,
    internalName: row.internalName,
    displayMode: popupDisplayModeSchema.parse(row.displayMode),
    title: row.title,
    imageUrl:
      key === null || mediaKind === null ? null : popupArtworkUrl(key, mediaKind, mediaBaseUrl),
    thumbUrl:
      key === null || mediaKind === null ? null : popupThumbUrl(key, mediaKind, mediaBaseUrl),
    isActive: row.isActive,
    delaySeconds: popupDelaySchema.parse(row.delaySeconds),
    frequency: popupFrequencySchema.parse(row.frequency),
    startsAt: toIsoOrNull(row.startsAt),
    endsAt: toIsoOrNull(row.endsAt),
    updatedAt: isoTimestamp(row.updatedAt),
  });
}

/**
 * Popups over the direct PostgreSQL connection.
 *
 * The public read runs as the service role because the table has no end-user policy at all: the
 * only thing a customer's client is ever told comes out of `public_popup()`, which decides
 * eligibility itself. Every management call runs as the signed-in admin, so `settings.manage` is
 * checked by the database on every write, exactly as for banners and the onboarding campaigns.
 *
 * Popups therefore need DATABASE_URL, like first-party authentication: they are only reachable
 * through service-role functions, and the Supabase fallback has no equivalent to call.
 */
export function createPostgresPopupStore(pool: Pool, options: PopupStoreOptions = {}): PopupStore {
  async function call(
    client: PoolClient,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    // A null is an argument like any other (a new popup has no id yet, a cleared picture has no
    // key): dropping it would name a function that does not exist. Only a missing one is left out.
    const entries = Object.entries(args).filter(([, argument]) => argument !== undefined);
    const parameters = entries.map(([, argument]) =>
      argument !== null && typeof argument === 'object' ? JSON.stringify(argument) : argument,
    );
    const named = entries.map(([key], index) => `${key} => $${index + 1}`).join(', ');
    const result = await client.query(await functionCallSql(client, name, named), parameters);
    const row = result.rows[0] as { value: unknown } | undefined;
    if (row === undefined) throw new StoreUnavailableError(`${name} answered no row`);
    return row.value;
  }

  /** Runs one management call as the signed-in admin, turning a refusal into a store error. */
  async function asAdmin<T>(
    userId: string,
    name: string,
    run: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await withUser(pool, userId, run);
    } catch (error) {
      if (error instanceof StoreUnavailableError) throw error;
      throw toAdminStoreError(pgFailure(error), name);
    }
  }

  return {
    async publicPopups(platform) {
      try {
        const data = await withServiceRole(pool, async (client) => {
          try {
            return await call(client, 'public_popups', { p_platform: platform });
          } catch (error) {
            // A database that has not run the targeting migration has only the single-popup read:
            // answer with that one popup, exactly as before.
            if ((error as { code?: string }).code !== '42883') throw error;
            const single = await call(client, 'public_popup', {});
            return single === null || single === undefined ? [] : [single];
          }
        });
        const rows = Array.isArray(data) ? (data as unknown[]) : [];
        return rows
          .map((row) => toPublicPopup(row, options.mediaBaseUrl))
          .filter((popup): popup is PublicPopup => popup !== null);
      } catch (error) {
        if (error instanceof StoreUnavailableError) throw error;
        // The public read is never refused by design: any failure is the store being unable
        // to answer, which the client treats as "no popup" rather than an error to show.
        throw new StoreUnavailableError('public_popup failed', { cause: error });
      }
    },

    async list(_accessToken, userId) {
      return asAdmin(userId, 'admin_list_popups', async (client) => {
        const data = await call(client, 'admin_list_popups', {});
        const rows = z.array(popupPayloadSchema).parse(data ?? []);
        return rows.map((row) => toSummary(row, options.mediaBaseUrl));
      });
    },

    async get(_accessToken, userId, popupId) {
      return asAdmin(userId, 'admin_get_popup', async (client) => {
        const data = await call(client, 'admin_get_popup', {
          p_popup_id: z.uuid().parse(popupId),
        });
        if (data === null || data === undefined) return null;
        return toAdminPopup(popupPayloadSchema.parse(data), options.mediaBaseUrl);
      });
    },

    async save(_accessToken, userId, popupId, input) {
      return asAdmin(userId, 'admin_save_popup', async (client) => {
        const data = await call(client, 'admin_save_popup', {
          p_popup_id: popupId === null ? null : z.uuid().parse(popupId),
          p_payload: input,
        });
        return z.uuid().parse(data);
      });
    },

    async setActive(_accessToken, userId, popupId, active) {
      await asAdmin(userId, 'admin_set_popup_active', async (client) => {
        await call(client, 'admin_set_popup_active', {
          p_popup_id: z.uuid().parse(popupId),
          p_active: active,
        });
      });
    },

    async setArtwork(_accessToken, userId, popupId, artwork) {
      return asAdmin(userId, 'admin_set_popup_image', async (client) => {
        // Clearing sends every column as SQL NULL, so this call keeps its nulls: the shared
        // helper drops them by default to let a function's own defaults apply.
        const args: [string, unknown][] = [
          ['p_popup_id', z.uuid().parse(popupId)],
          ['p_image_key', artwork === null ? null : artwork.key],
          ['p_image_kind', artwork === null ? null : artwork.kind],
          ['p_image_width', artwork === null ? null : artwork.width],
          ['p_image_height', artwork === null ? null : artwork.height],
          ['p_image_bytes', artwork === null ? null : artwork.bytes],
          ['p_image_format', artwork === null ? null : artwork.format],
        ];
        const parameters = args.map(([, argument]) => argument);
        const named = args.map(([key], index) => `${key} => $${String(index + 1)}`).join(', ');
        const result = await client.query<{ value: unknown }>(
          await functionCallSql(client, 'admin_set_popup_image', named),
          parameters,
        );
        const data = result.rows[0]?.value;
        return data === null || data === undefined ? null : z.string().parse(data);
      });
    },

    async remove(_accessToken, userId, popupId) {
      return asAdmin(userId, 'admin_delete_popup', async (client) => {
        const data = await call(client, 'admin_delete_popup', {
          p_popup_id: z.uuid().parse(popupId),
        });
        return data === null || data === undefined ? null : z.string().parse(data);
      });
    },
  };
}
