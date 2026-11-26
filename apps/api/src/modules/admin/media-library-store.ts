import { accountRefSchema, mediaLibraryKeySchema } from '@nilzora/contracts';
import type { Pool } from 'pg';
import { z } from 'zod';
import { withUser } from '../../db/user-context';
import type { SupabaseClients } from '../../supabase/clients';
import { conform, isoTimestamp, StoreUnavailableError } from '../commerce/errors';
import { toAdminStoreError } from './errors';
import { sqlNull } from './shared';

/**
 * One library picture as the database describes it (private.media_asset_json): the base
 * key other image fields store, the two object keys, and its labels. Public URLs are added
 * by the route, from the configured media address.
 */
export const storedMediaAssetSchema = z.object({
  id: z.uuid(),
  key: mediaLibraryKeySchema,
  fullKey: z.string(),
  thumbKey: z.string(),
  contentType: z.string(),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  bytes: z.number().int().min(1),
  alt: z.string().nullable(),
  originalName: z.string().nullable(),
  uploadedBy: accountRefSchema.nullable(),
  createdAt: z.string().transform((value) => isoTimestamp(value)),
});

export type StoredMediaAsset = z.output<typeof storedMediaAssetSchema>;

/** An upload whose objects are already stored under `library/<id>`. */
export interface MediaRecordInput {
  id: string;
  contentType: string;
  width: number;
  height: number;
  bytes: number;
  alt: string | null;
  originalName: string | null;
}

/**
 * The media library, always as the signed-in caller: every call is a database function
 * that checks the caller's permission (reads: settings.manage or products.update; changes:
 * settings.manage) and writes the audit log.
 */
export interface MediaLibraryStore {
  /** Newest first; `search` matches the description or the file name. */
  list(
    accessToken: string,
    userId: string,
    search: string | undefined,
    page: { page: number; pageSize: number },
  ): Promise<{ assets: StoredMediaAsset[]; total: number }>;
  record(accessToken: string, userId: string, input: MediaRecordInput): Promise<StoredMediaAsset>;
  updateAlt(
    accessToken: string,
    userId: string,
    id: string,
    alt: string | null,
  ): Promise<StoredMediaAsset>;
  /** Deletes the row (refused while the picture is in use) and answers its object keys. */
  remove(accessToken: string, userId: string, id: string): Promise<string[]>;
}

const objectKeysSchema = z.array(z.string().regex(/^library\/[0-9a-f-]{36}\/(full|thumb)\.webp$/));

function toAssets(
  rows: readonly { asset: unknown; total_count: number | string }[],
  operation: string,
): { assets: StoredMediaAsset[]; total: number } {
  return {
    assets: conform(
      z.array(storedMediaAssetSchema),
      rows.map((row) => row.asset),
      operation,
    ),
    total: Number(rows[0]?.total_count ?? 0),
  };
}

export function createSupabaseMediaLibraryStore(clients: SupabaseClients): MediaLibraryStore {
  async function call<T>(
    operation: string,
    request: PromiseLike<{
      data: T | null;
      error: { code: string; message: string; details?: string | null } | null;
    }>,
  ): Promise<T | null> {
    const { data, error } = await request;
    if (error) throw toAdminStoreError(error, operation);
    return data;
  }

  return {
    async list(accessToken, _userId, search, { page, pageSize }) {
      const rows = await call(
        'admin_list_media',
        clients.asUser(accessToken).rpc('admin_list_media', {
          p_q: sqlNull(search),
          p_page: page,
          p_page_size: pageSize,
        }),
      );
      return toAssets(rows ?? [], 'admin_list_media');
    },

    async record(accessToken, _userId, input) {
      const data = await call(
        'admin_record_media',
        clients.asUser(accessToken).rpc('admin_record_media', {
          p_id: input.id,
          p_content_type: input.contentType,
          p_width: input.width,
          p_height: input.height,
          p_bytes: input.bytes,
          p_alt: sqlNull(input.alt),
          p_original_name: sqlNull(input.originalName),
        }),
      );
      return conform(storedMediaAssetSchema, data, 'admin_record_media');
    },

    async updateAlt(accessToken, _userId, id, alt) {
      const data = await call(
        'admin_update_media_alt',
        clients.asUser(accessToken).rpc('admin_update_media_alt', { p_id: id, p_alt: sqlNull(alt) }),
      );
      return conform(storedMediaAssetSchema, data, 'admin_update_media_alt');
    },

    async remove(accessToken, _userId, id) {
      const data = await call(
        'admin_delete_media',
        clients.asUser(accessToken).rpc('admin_delete_media', { p_id: id }),
      );
      return conform(objectKeysSchema, data, 'admin_delete_media');
    },
  };
}

/** PostgreSQL exposes custom SQLSTATEs (`NZ4xx`, `23514`) as a string `code`. */
function pgFailure(error: unknown): { code: string; message: string; details: string | null } {
  const fields = error as { code?: unknown; message?: unknown; detail?: unknown } | null;
  return {
    code: typeof fields?.code === 'string' ? fields.code : '',
    message: typeof fields?.message === 'string' ? fields.message : 'database request failed',
    details: typeof fields?.detail === 'string' ? fields.detail : null,
  };
}

/** The media library over a direct PostgreSQL connection, always as the signed-in caller. */
export function createPostgresMediaLibraryStore(pool: Pool): MediaLibraryStore {
  function failure(error: unknown, operation: string): Error {
    if (error instanceof StoreUnavailableError) return error;
    return toAdminStoreError(pgFailure(error), operation);
  }

  async function one(userId: string, operation: string, sql: string, values: unknown[]) {
    try {
      return await withUser(pool, userId, async (client) => {
        const result = await client.query<{ value: unknown }>(sql, values);
        return result.rows[0]?.value;
      });
    } catch (error) {
      throw failure(error, operation);
    }
  }

  return {
    async list(_accessToken, userId, search, { page, pageSize }) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{ asset: unknown; total_count: string }>(
            'select asset, total_count from public.admin_list_media($1, $2, $3)',
            [search ?? null, page, pageSize],
          );
          return toAssets(result.rows, 'admin_list_media');
        });
      } catch (error) {
        throw failure(error, 'admin_list_media');
      }
    },

    async record(_accessToken, userId, input) {
      const value = await one(
        userId,
        'admin_record_media',
        `select public.admin_record_media($1::uuid, $2, $3::integer, $4::integer, $5::integer,
           $6, $7) as value`,
        [
          input.id,
          input.contentType,
          input.width,
          input.height,
          input.bytes,
          input.alt,
          input.originalName,
        ],
      );
      return conform(storedMediaAssetSchema, value, 'admin_record_media');
    },

    async updateAlt(_accessToken, userId, id, alt) {
      const value = await one(
        userId,
        'admin_update_media_alt',
        'select public.admin_update_media_alt($1::uuid, $2) as value',
        [id, alt],
      );
      return conform(storedMediaAssetSchema, value, 'admin_update_media_alt');
    },

    async remove(_accessToken, userId, id) {
      const value = await one(
        userId,
        'admin_delete_media',
        'select public.admin_delete_media($1::uuid) as value',
        [id],
      );
      return conform(objectKeysSchema, value, 'admin_delete_media');
    },
  };
}
