import type { Pool } from 'pg';
import { z } from 'zod';
import { withUser } from '../../db/user-context';
import type { SupabaseClients } from '../../supabase/clients';
import { StoreUnavailableError } from '../commerce/errors';

/*
 * Avatars and review photos: the database side
 * --------------------------------------------
 * Every write goes through a security-definer function that works on the caller's own account
 * or review (see 20261108090000_avatars_and_review_images.sql), so ownership is decided by the
 * database from the caller's identity, never from anything the client sent. This module only
 * calls them and turns their refusals into a small, fixed vocabulary.
 *
 * Until that migration is applied the functions do not exist. That is reported as
 * AttachmentsUnavailableError (a 503), never as a success and never as another user's data.
 */

export type AttachmentRefusal =
  'not_found' | 'account_blocked' | 'review_locked' | 'review_image_limit' | 'invalid_key';

export class AttachmentRefusalError extends Error {
  override readonly name = 'AttachmentRefusalError';
  readonly refusal: AttachmentRefusal;

  constructor(refusal: AttachmentRefusal) {
    super(`Refused by the database: ${refusal}`);
    this.refusal = refusal;
  }
}

/** The feature's database objects are missing, or the database could not be reached. */
export class AttachmentsUnavailableError extends StoreUnavailableError {
  override readonly name = 'AttachmentsUnavailableError';
}

const REFUSALS: Readonly<Record<string, AttachmentRefusal>> = {
  NZ404: 'not_found',
  NZ464: 'account_blocked',
  NZ466: 'review_locked',
  NZ467: 'review_image_limit',
  NZ468: 'invalid_key',
  NZ469: 'invalid_key',
};

/** PostgreSQL "undefined function" and PostgREST "function not found in the schema cache". */
const MISSING_FUNCTION = new Set(['42883', 'PGRST202']);

/** A photo as the database stores it: an id and the base key; the API makes the URLs. */
export const storedImageSchema = z.object({ id: z.uuid(), key: z.string() });
export type StoredImage = z.infer<typeof storedImageSchema>;

const addResultSchema = z.object({ id: z.uuid(), images: z.array(storedImageSchema) });
const removeResultSchema = z.object({ key: z.string(), images: z.array(storedImageSchema) });
const adminImagesSchema = z.array(z.object({ reviewId: z.uuid(), id: z.uuid(), key: z.string() }));

export interface Caller {
  accessToken: string;
  userId: string;
}

export interface AttachmentStore {
  /** The caller's own picture key, or null. */
  avatarKey(caller: Caller): Promise<string | null>;
  /** Points the caller's profile at `key`; returns the previous key (for cleanup) or null. */
  setAvatar(caller: Caller, key: string): Promise<string | null>;
  /** Clears the caller's picture; returns the key it had or null. */
  clearAvatar(caller: Caller): Promise<string | null>;
  addReviewImage(
    caller: Caller,
    reviewId: string,
    image: { key: string; width: number; height: number },
  ): Promise<{ id: string; images: StoredImage[] }>;
  removeReviewImage(
    caller: Caller,
    imageId: string,
  ): Promise<{ key: string; images: StoredImage[] }>;
  /** Moderators: the photos of the given reviews (needs reviews.moderate). */
  adminReviewImages(
    caller: Caller,
    reviewIds: readonly string[],
  ): Promise<{ reviewId: string; id: string; key: string }[]>;
}

/** One database function call, described once and run over either connection. */
interface Call {
  fn: string;
  /** [parameter name, value, SQL type] in order. */
  params: readonly (readonly [name: string, value: unknown, type: string])[];
}

interface Failure extends Error {
  code?: unknown;
}

function translate(error: unknown, operation: string): Error {
  if (error instanceof AttachmentRefusalError || error instanceof StoreUnavailableError) {
    return error;
  }
  const code =
    typeof (error as Failure | null)?.code === 'string' ? (error as { code: string }).code : '';
  const refusal = REFUSALS[code];
  if (refusal) return new AttachmentRefusalError(refusal);
  if (MISSING_FUNCTION.has(code)) {
    return new AttachmentsUnavailableError(
      `${operation}: the avatar and photo functions are not installed`,
      {
        cause: error,
      },
    );
  }
  return new AttachmentsUnavailableError(`${operation} failed (${code || 'network'})`, {
    cause: error,
  });
}

function build(run: (caller: Caller, call: Call) => Promise<unknown>): AttachmentStore {
  async function execute(caller: Caller, call: Call, operation: string): Promise<unknown> {
    try {
      return await run(caller, call);
    } catch (error) {
      throw translate(error, operation);
    }
  }

  function parse<T>(schema: z.ZodType<T>, value: unknown, operation: string): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new AttachmentsUnavailableError(`${operation} returned an unexpected shape`);
    }
    return parsed.data;
  }

  const textOrNull = (value: unknown, operation: string): string | null =>
    parse(z.string().nullable(), value ?? null, operation);

  return {
    async avatarKey(caller) {
      const value = await execute(caller, { fn: 'my_avatar_key', params: [] }, 'my_avatar_key');
      return textOrNull(value, 'my_avatar_key');
    },
    async setAvatar(caller, key) {
      const value = await execute(
        caller,
        { fn: 'set_my_avatar', params: [['p_key', key, 'text']] },
        'set_my_avatar',
      );
      return textOrNull(value, 'set_my_avatar');
    },
    async clearAvatar(caller) {
      const value = await execute(caller, { fn: 'clear_my_avatar', params: [] }, 'clear_my_avatar');
      return textOrNull(value, 'clear_my_avatar');
    },
    async addReviewImage(caller, reviewId, image) {
      const value = await execute(
        caller,
        {
          fn: 'add_review_image',
          params: [
            ['p_review_id', reviewId, 'uuid'],
            ['p_key', image.key, 'text'],
            ['p_width', image.width, 'integer'],
            ['p_height', image.height, 'integer'],
          ],
        },
        'add_review_image',
      );
      return parse(addResultSchema, value, 'add_review_image');
    },
    async removeReviewImage(caller, imageId) {
      const value = await execute(
        caller,
        { fn: 'remove_review_image', params: [['p_image_id', imageId, 'uuid']] },
        'remove_review_image',
      );
      return parse(removeResultSchema, value, 'remove_review_image');
    },
    async adminReviewImages(caller, reviewIds) {
      const value = await execute(
        caller,
        { fn: 'admin_review_images', params: [['p_review_ids', [...reviewIds], 'uuid[]']] },
        'admin_review_images',
      );
      return parse(adminImagesSchema, value, 'admin_review_images');
    },
  };
}

/** Over Supabase: the call runs as the caller's own JWT. */
export function createSupabaseAttachmentStore(clients: SupabaseClients): AttachmentStore {
  return build(async (caller, call) => {
    const client = clients.asUser(caller.accessToken);
    const rpc = client.rpc.bind(client) as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: Failure | null }>;
    const { data, error } = await rpc(
      call.fn,
      Object.fromEntries(call.params.map(([name, value]) => [name, value])),
    );
    if (error) throw error;
    return data;
  });
}

/** Over a direct connection: inside a transaction that carries the caller's identity. */
export function createPostgresAttachmentStore(pool: Pool): AttachmentStore {
  return build((caller, call) =>
    withUser(pool, caller.userId, async (client) => {
      const args = call.params.map(([, , type], index) => `$${index + 1}::${type}`).join(', ');
      const result = await client.query<{ value: unknown }>(
        `select public.${call.fn}(${args}) as value`,
        call.params.map(([, value]) => value),
      );
      return result.rows[0]?.value ?? null;
    }),
  );
}
