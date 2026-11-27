import type {
  ImageSearchActivity as ImageSearchActivityRow,
  ImageSearchMissingImagesQuery,
} from '@nilzora/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { withUser } from '../../db/user-context';

/*
 * The visual-search data layer
 * ----------------------------
 * Two doors, deliberately:
 *
 *  - The worker and the public search route run with the service role (`pool.query`). They
 *    touch rows no ordinary account may read: the embedding cache, the index state and the
 *    anonymised search log. The functions they call are the only writers.
 *  - The admin routes run as the caller (`withUser`), so `private.require_permission` inside
 *    each SQL function decides. A missing permission raises NZ403 and is answered 403, not
 *    "the query returned nothing".
 */

/** A refusal raised by the image-search SQL functions, mapped to a status by the routes. */
export type ImageSearchRefusal = 'missing_permission' | 'invalid_input' | 'not_found' | 'busy';

export class ImageSearchRefusedError extends Error {
  override readonly name = 'ImageSearchRefusedError';
  readonly refusal: ImageSearchRefusal;

  constructor(refusal: ImageSearchRefusal) {
    super(`Refused by the database: ${refusal}`);
    this.refusal = refusal;
  }
}

const SQLSTATES: Readonly<Record<string, ImageSearchRefusal>> = {
  NZ403: 'missing_permission',
  NZ404: 'not_found',
  NZ412: 'invalid_input',
  NZ409: 'busy',
  '23514': 'invalid_input',
};

function toRefusal(error: unknown): never {
  const code = (error as { code?: string }).code;
  if (typeof code === 'string' && Object.hasOwn(SQLSTATES, code)) {
    throw new ImageSearchRefusedError(SQLSTATES[code] as ImageSearchRefusal);
  }
  throw error;
}

/** The settings row, as both the search route and the admin screen read it. */
export interface ImageSearchSettingsRow {
  enabled: boolean;
  similarityThreshold: number;
  maxResults: number;
  model: string;
  modelVersion: string;
  dimensions: number;
  lastIndexedAt: string | null;
  updatedAt: string;
}

export interface ClaimedImage {
  id: string;
  productId: string;
  productImageId: string | null;
  kind: 'primary' | 'gallery' | 'variant';
  sourceKey: string;
  isPrimary: boolean;
  attempts: number;
}

export interface NearestMatch {
  imageId: string;
  productId: string;
  kind: 'primary' | 'gallery' | 'variant';
  isPrimary: boolean;
  similarity: number;
}

export interface StoredProductVector {
  vector: Float32Array;
  contentHash: string;
  model: string;
  width: number | null;
  height: number | null;
}

export interface ImageSearchStore {
  /** False when the migration has not reached this database: the feature stays off. */
  available(): Promise<boolean>;
  /** How many pictures the index has ever considered; 0 means a fresh install. */
  countCandidates(): Promise<number>;
  settings(): Promise<ImageSearchSettingsRow>;
  /**
   * The vector already stored for exactly these bytes, if the same picture was embedded
   * before. This is the cache that stops a shared or unchanged photo being re-embedded.
   */
  cachedVector(contentHash: string, model: string): Promise<Float32Array | null>;
  claim(limit: number, jobId: string | null): Promise<ClaimedImage[]>;
  recordIndexed(input: {
    id: string;
    contentHash: string;
    model: string;
    dimensions: number;
    vector: string;
    width: number | null;
    height: number | null;
  }): Promise<void>;
  recordFailure(id: string, error: string, retryable?: boolean): Promise<void>;
  recordExclusion(id: string, reason: string): Promise<void>;
  recoverStale(seconds: number): Promise<number>;
  syncJob(jobId: string): Promise<void>;
  takeJob(): Promise<string | null>;
  activeJob(): Promise<string | null>;
  queueAll(): Promise<number>;
  nearest(
    vector: string,
    model: string,
    dimensions: number,
    limit: number,
  ): Promise<NearestMatch[]>;
  /**
   * The vector already stored for one of a product's pictures: what "Find similar" searches
   * with, so an image the store already holds is never downloaded and embedded again.
   */
  vectorForProductImage(
    productId: string,
    imageId: string | null,
  ): Promise<StoredProductVector | null>;
  logSearch(input: {
    imageHash: string | null;
    model: string | null;
    threshold: number | null;
    resultCount: number;
    topProductIds: readonly string[];
    outcome: 'results' | 'no_results' | 'barcode' | 'disabled';
    client: string;
    durationMs: number;
  }): Promise<string | null>;
  recordClick(searchId: string, productId: string): Promise<boolean>;

  adminSettings(userId: string): Promise<ImageSearchSettingsRow>;
  adminSaveSettings(
    userId: string,
    input: {
      enabled: boolean;
      similarityThreshold: number;
      maxResults: number;
      model: string;
      modelVersion: string;
      dimensions: number;
    },
  ): Promise<ImageSearchSettingsRow>;
  adminStats(userId: string): Promise<Record<string, unknown>>;
  adminMissingImages(
    userId: string,
    query: ImageSearchMissingImagesQuery,
  ): Promise<{ items: Record<string, unknown>[]; total: number; limit: number; offset: number }>;
  adminActivity(
    userId: string,
    query: ImageSearchMissingImagesQuery,
  ): Promise<{ items: ImageSearchActivityRow[]; total: number; limit: number; offset: number }>;
  adminJobs(userId: string): Promise<Record<string, unknown>[]>;
  adminStartJob(userId: string, kind: string): Promise<Record<string, unknown>>;
}

/* ---------------------------------------------------------------- typed rows */

interface SettingsDbRow extends QueryResultRow {
  enabled: boolean;
  similarity_threshold: number;
  max_results: number;
  model: string;
  model_version: string;
  dimensions: number;
  last_indexed_at: Date | null;
  updated_at: Date;
}

interface ClaimDbRow extends QueryResultRow {
  id: string;
  product_id: string;
  product_image_id: string | null;
  kind: string;
  source_key: string;
  is_primary: boolean;
  attempts: number;
}

interface NearestDbRow extends QueryResultRow {
  image_id: string;
  product_id: string;
  kind: string;
  is_primary: boolean;
  similarity: number;
}

interface VectorDbRow extends QueryResultRow {
  embedding: string;
  content_hash: string;
  model: string;
  width: number | null;
  height: number | null;
}

interface ScalarDbRow extends QueryResultRow {
  value: unknown;
}

/* ---------------------------------------------------------------- readers */

const iso = (value: Date | string | null): string =>
  value instanceof Date ? value.toISOString() : String(value ?? '');

const isoOrNull = (value: Date | string | null): string | null =>
  value === null || value === undefined ? null : iso(value);

/** A string field out of a jsonb answer, without trusting its type. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function number(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function bool(value: unknown): boolean {
  return value === true;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function settingsFrom(value: unknown): ImageSearchSettingsRow {
  const row = record(value);
  return {
    enabled: bool(row.enabled),
    similarityThreshold: number(row.similarityThreshold),
    maxResults: number(row.maxResults),
    model: text(row.model),
    modelVersion: text(row.modelVersion),
    dimensions: number(row.dimensions),
    lastIndexedAt: textOrNull(row.lastIndexedAt),
    updatedAt: iso((row.updatedAt as Date | string | undefined) ?? null),
  };
}

export function createPostgresImageSearchStore(pool: Pool): ImageSearchStore {
  return {
    async available() {
      const result = await pool.query<{ ready: boolean } & QueryResultRow>(
        `select to_regprocedure('public.image_search_nearest(extensions.vector, text, integer, integer)') is not null as ready`,
      );
      return result.rows[0]?.ready === true;
    },

    async countCandidates() {
      const result = await pool.query<{ count: string } & QueryResultRow>(
        `select count(*)::text as count from public.image_search_images`,
      );
      return Number(result.rows[0]?.count ?? 0);
    },

    async settings() {
      const result = await pool.query<SettingsDbRow>(
        `select enabled, similarity_threshold, max_results, model, model_version, dimensions,
                last_indexed_at, updated_at
         from public.image_search_settings where id`,
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error('image search settings row is missing');
      return {
        enabled: row.enabled === true,
        similarityThreshold: Number(row.similarity_threshold),
        maxResults: Number(row.max_results),
        model: row.model,
        modelVersion: row.model_version,
        dimensions: Number(row.dimensions),
        lastIndexedAt: isoOrNull(row.last_indexed_at),
        updatedAt: iso(row.updated_at),
      };
    },

    async cachedVector(contentHash, model) {
      const result = await pool.query<{ embedding: string } & QueryResultRow>(
        `select embedding::text as embedding
         from public.image_search_embeddings
         where content_hash = $1 and model = $2`,
        [contentHash, model],
      );
      const stored = result.rows[0]?.embedding;
      return stored === undefined ? null : parseVectorText(stored);
    },

    async claim(limit, jobId) {
      const result = await pool.query<ClaimDbRow>(
        `select id, product_id, product_image_id, kind::text as kind, source_key, is_primary, attempts
         from public.image_search_claim($1, $2)`,
        [limit, jobId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        productId: row.product_id,
        productImageId: row.product_image_id,
        kind: row.kind as ClaimedImage['kind'],
        sourceKey: row.source_key,
        isPrimary: row.is_primary === true,
        attempts: Number(row.attempts),
      }));
    },

    async recordIndexed(input) {
      await pool.query(
        `select public.image_search_record_indexed($1, $2, $3, $4, $5::extensions.vector, $6, $7)`,
        [
          input.id,
          input.contentHash,
          input.model,
          input.dimensions,
          input.vector,
          input.width,
          input.height,
        ],
      );
    },

    async recordFailure(id, error, retryable = true) {
      await pool.query(`select public.image_search_record_failure($1, $2, $3)`, [
        id,
        error,
        retryable,
      ]);
    },

    async recordExclusion(id, reason) {
      await pool.query(`select public.image_search_record_exclusion($1, $2)`, [id, reason]);
    },

    async recoverStale(seconds) {
      const result = await pool.query<{ count: number } & QueryResultRow>(
        `select public.image_search_recover_stale($1) as count`,
        [seconds],
      );
      return Number(result.rows[0]?.count ?? 0);
    },

    async syncJob(jobId) {
      await pool.query(`select public.image_search_sync_job($1)`, [jobId]);
    },

    async takeJob() {
      const result = await pool.query<{ id: string | null } & QueryResultRow>(
        `select public.image_search_take_job() as id`,
      );
      const id = result.rows[0]?.id;
      return id === null || id === undefined ? null : id;
    },

    async activeJob() {
      const result = await pool.query<{ id: string | null } & QueryResultRow>(
        `select public.image_search_active_job() as id`,
      );
      const id = result.rows[0]?.id;
      return id === null || id === undefined ? null : id;
    },

    async queueAll() {
      const result = await pool.query<{ pending: number } & QueryResultRow>(
        `select public.image_search_queue_all() as pending`,
      );
      return Number(result.rows[0]?.pending ?? 0);
    },

    async nearest(vector, model, dimensions, limit) {
      const result = await pool.query<NearestDbRow>(
        `select image_id, product_id, kind::text as kind, is_primary, similarity
         from public.image_search_nearest($1::extensions.vector, $2, $3, $4)`,
        [vector, model, dimensions, limit],
      );
      return result.rows.map((row) => ({
        imageId: row.image_id,
        productId: row.product_id,
        kind: row.kind as NearestMatch['kind'],
        isPrimary: row.is_primary === true,
        similarity: Number(row.similarity),
      }));
    },

    async vectorForProductImage(productId, imageId) {
      const result = await pool.query<VectorDbRow>(
        `select e.embedding::text as embedding, i.content_hash, i.model, i.width, i.height
         from public.image_search_images i
         join public.image_search_embeddings e
           on e.content_hash = i.content_hash and e.model = i.model
         where i.product_id = $1
           and i.status = 'indexed'
           and ($2::uuid is null or i.id = $2::uuid)
         order by i.is_primary desc, i.updated_at desc
         limit 1`,
        [productId, imageId],
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      return {
        vector: parseVectorText(row.embedding),
        contentHash: row.content_hash,
        model: row.model,
        width: row.width === null ? null : Number(row.width),
        height: row.height === null ? null : Number(row.height),
      };
    },

    async logSearch(input) {
      const result = await pool.query<{ id: string } & QueryResultRow>(
        `select public.image_search_log($1, $2, $3, $4, $5, $6, $7, $8) as id`,
        [
          input.imageHash,
          input.model,
          input.threshold,
          input.resultCount,
          input.topProductIds,
          input.outcome,
          input.client,
          input.durationMs,
        ],
      );
      return result.rows[0]?.id ?? null;
    },

    async recordClick(searchId, productId) {
      const result = await pool.query<{ recorded: boolean } & QueryResultRow>(
        `select public.image_search_record_click($1, $2) as recorded`,
        [searchId, productId],
      );
      return result.rows[0]?.recorded === true;
    },

    async adminSettings(userId) {
      return settingsFrom(await adminJson(pool, userId, 'image_search_settings', []));
    },

    async adminSaveSettings(userId, input) {
      return settingsFrom(
        await adminJson(pool, userId, 'admin_save_image_search_settings', [
          input.enabled,
          input.similarityThreshold,
          input.maxResults,
          input.model,
          input.modelVersion,
          input.dimensions,
        ]),
      );
    },

    async adminStats(userId) {
      return record(await adminJson(pool, userId, 'admin_image_search_stats', []));
    },

    async adminMissingImages(userId, query) {
      const answer = record(
        await adminJson(pool, userId, 'admin_image_search_missing_images', [
          query.q ?? null,
          query.pageSize,
          (query.page - 1) * query.pageSize,
        ]),
      );
      return {
        items: Array.isArray(answer.items) ? answer.items.map(record) : [],
        total: number(answer.total),
        limit: number(answer.limit),
        offset: number(answer.offset),
      };
    },

    async adminActivity(userId, query) {
      const answer = record(
        await adminJson(pool, userId, 'admin_image_search_activity', [
          query.q ?? null,
          query.pageSize,
          (query.page - 1) * query.pageSize,
        ]),
      );
      const items = Array.isArray(answer.items) ? answer.items.map(record) : [];
      return {
        total: number(answer.total),
        limit: number(answer.limit),
        offset: number(answer.offset),
        items: items.map((row) => ({
          id: text(row.id),
          createdAt: iso((row.created_at as Date | string | undefined) ?? null),
          imageHash: textOrNull(row.image_hash),
          model: textOrNull(row.model),
          threshold:
            row.threshold === null || row.threshold === undefined ? null : number(row.threshold),
          resultCount: number(row.result_count),
          topProductIds: Array.isArray(row.top_product_ids)
            ? (row.top_product_ids as string[])
            : [],
          clickedProductId: textOrNull(row.clicked_product_id),
          clickedProductName: textOrNull(row.clicked_product_name),
          outcome: text(row.outcome) as ImageSearchActivityRow['outcome'],
          client: textOrNull(row.client),
          durationMs:
            row.duration_ms === null || row.duration_ms === undefined
              ? null
              : number(row.duration_ms),
        })),
      };
    },

    async adminJobs(userId) {
      const answer = await adminJson(pool, userId, 'admin_image_search_jobs', []);
      return Array.isArray(answer) ? answer.map(record) : [];
    },

    async adminStartJob(userId, kind) {
      return record(await adminJson(pool, userId, 'admin_start_image_search_job', [kind]));
    },
  };
}

/** Calls a SECURITY DEFINER admin function as the caller and reads its jsonb answer. */
async function adminJson(
  pool: Pool,
  userId: string,
  fn: string,
  args: readonly unknown[],
): Promise<unknown> {
  try {
    return await withUser(pool, userId, async (client: PoolClient) => {
      const placeholders = args.map((_value, index) => `$${index + 1}`).join(', ');
      const result = await client.query<ScalarDbRow>(
        `select public.${fn}(${placeholders}) as value`,
        [...args],
      );
      return result.rows[0]?.value ?? null;
    });
  } catch (error) {
    toRefusal(error);
  }
}

/** Reads a pgvector text form ("[0.1,0.2]") into a typed array. */
function parseVectorText(value: string): Float32Array {
  const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (inner === '') return new Float32Array(0);
  return Float32Array.from(inner.split(',').map((entry) => Number(entry)));
}
