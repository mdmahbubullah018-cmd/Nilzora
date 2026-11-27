import { z } from 'zod';
import { productSummarySchema } from './catalog';

/*
 * Visual search contract
 * ----------------------
 * A shopper sends a picture; the API answers the same product cards an ordinary listing
 * returns, plus the similarity of each result and one identifier for the search itself so a
 * later tap can be recorded against it. Two things are deliberately absent from every shape
 * here: the uploaded photograph (never stored, never returned) and any embedding vector (it
 * never leaves the server).
 */

/** How the results of an image search are ordered. */
export const IMAGE_SEARCH_SORTS = ['best_match', 'price_asc', 'price_desc'] as const;
export type ImageSearchSort = (typeof IMAGE_SEARCH_SORTS)[number];
export const imageSearchSortSchema = z.enum(IMAGE_SEARCH_SORTS);

/** Which client sent the search. Recorded for tuning only, never linked to an account. */
export const IMAGE_SEARCH_CLIENTS = ['web', 'android', 'api'] as const;
export type ImageSearchClient = (typeof IMAGE_SEARCH_CLIENTS)[number];
export const imageSearchClientSchema = z.enum(IMAGE_SEARCH_CLIENTS);

/** The outcome recorded for a search. */
export const IMAGE_SEARCH_OUTCOMES = ['results', 'no_results', 'barcode', 'disabled'] as const;
export type ImageSearchOutcome = (typeof IMAGE_SEARCH_OUTCOMES)[number];
export const imageSearchOutcomeSchema = z.enum(IMAGE_SEARCH_OUTCOMES);

/** An upload may be up to 6 MB; the client compresses well below that before sending. */
export const IMAGE_SEARCH_MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
/** Smaller than this cannot be decoded into anything worth embedding. */
export const IMAGE_SEARCH_MIN_UPLOAD_BYTES = 1024;
/** The rate limit the API applies to image searches, per address per minute. */
export const IMAGE_SEARCH_RATE_LIMIT = { windowMs: 60_000, limit: 20 } as const;
/** The server never stores a preview of the query; the client keeps its own. */
export const IMAGE_SEARCH_PAGE_MAX = 48;

/** What one result's similarity means: cosine similarity to the query image, 0 to 1. */
export const imageSearchMatchSchema = z.object({
  product: productSummarySchema,
  /** Cosine similarity of the best matching picture of this product, rounded to 4 places. */
  similarity: z.number().min(-1).max(1),
  /** The image of this product that matched best, so the card can show the real match. */
  imageId: z.string().uuid().nullable(),
});
export type ImageSearchMatch = z.infer<typeof imageSearchMatchSchema>;

/** POST /search/image (multipart/form-data or a raw image body). */
export const imageSearchQuerySchema = z.object({
  sort: imageSearchSortSchema.default('best_match'),
  page: z.coerce.number().int().min(1).max(200).default(1),
  pageSize: z.coerce.number().int().min(1).max(IMAGE_SEARCH_PAGE_MAX).default(24),
  client: imageSearchClientSchema.default('api'),
});
export type ImageSearchQuery = z.infer<typeof imageSearchQuerySchema>;

export const imageSearchResponseSchema = z.object({
  /** Identifies this search in the activity log; null when logging was unavailable. */
  searchId: z.string().uuid().nullable(),
  query: z.object({
    /** SHA-256 of the prepared image, so the same picture is recognisable without keeping it. */
    imageHash: z.string().length(64),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  items: z.array(imageSearchMatchSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(0),
  sort: imageSearchSortSchema,
  /** The threshold actually applied, so a client can explain a thin result set. */
  threshold: z.number().min(-1).max(1),
  model: z.string(),
  tookMs: z.number().int().min(0),
  outcome: imageSearchOutcomeSchema,
});
export type ImageSearchResponse = z.infer<typeof imageSearchResponseSchema>;

/** POST /search/image/similar — reuse an indexed product picture instead of an upload. */
export const imageSearchSimilarRequestSchema = z.strictObject({
  productId: z.string().uuid(),
  /** A picture of that product; the primary one when omitted. */
  imageId: z.string().uuid().nullable().optional(),
});
export type ImageSearchSimilarRequest = z.infer<typeof imageSearchSimilarRequestSchema>;

/** POST /search/image/click — which result the shopper opened. */
export const imageSearchClickRequestSchema = z.strictObject({
  searchId: z.string().uuid(),
  productId: z.string().uuid(),
});
export type ImageSearchClickRequest = z.infer<typeof imageSearchClickRequestSchema>;

/** POST /scan/resolve — the shared barcode and QR resolution used by both scan surfaces. */
export const scanResolveRequestSchema = z.strictObject({
  /** The decoded QR or barcode text, never a raw image. */
  value: z.string().trim().min(1).max(512),
});
export type ScanResolveRequest = z.infer<typeof scanResolveRequestSchema>;

export const SCAN_RESOLVE_KINDS = ['product', 'search', 'unsupported'] as const;
export type ScanResolveKind = (typeof SCAN_RESOLVE_KINDS)[number];

export const scanResolveResponseSchema = z.object({
  kind: z.enum(SCAN_RESOLVE_KINDS),
  /** Present for `product`: the card the client opens. */
  product: productSummarySchema.nullable().default(null),
  /** Present for `search`: the text a normal product search should run. */
  query: z.string().nullable().default(null),
  /** What the client scanned, echoed for its own message. */
  value: z.string(),
});
export type ScanResolveResponse = z.infer<typeof scanResolveResponseSchema>;

// ------------------------------------------------------------------------- admin settings

export const imageSearchSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Cosine similarity a product needs before it is shown at all. */
  similarityThreshold: z.number().min(0).max(1),
  maxResults: z.number().int().min(1).max(120),
  model: z.string(),
  modelVersion: z.string(),
  dimensions: z.number().int().positive(),
  lastIndexedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type ImageSearchSettings = z.infer<typeof imageSearchSettingsSchema>;

export const saveImageSearchSettingsRequestSchema = z.strictObject({
  enabled: z.boolean(),
  similarityThreshold: z.number().min(0.3).max(0.99),
  maxResults: z.number().int().min(1).max(120),
});
export type SaveImageSearchSettingsRequest = z.infer<typeof saveImageSearchSettingsRequestSchema>;

export const IMAGE_SEARCH_JOB_KINDS = ['backfill', 'reindex_all', 'retry_failed'] as const;
export type ImageSearchJobKind = (typeof IMAGE_SEARCH_JOB_KINDS)[number];

export const imageSearchJobSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(IMAGE_SEARCH_JOB_KINDS),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  total: z.number().int().min(0),
  indexed: z.number().int().min(0),
  failed: z.number().int().min(0),
  excluded: z.number().int().min(0),
  createdAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  /** Absent from the row shape the API returns as JSON arrays of jobs. */
  error: z.string().nullable().optional(),
});
export type ImageSearchJob = z.infer<typeof imageSearchJobSchema>;

export const startImageSearchJobRequestSchema = z.strictObject({
  kind: z.enum(IMAGE_SEARCH_JOB_KINDS),
});
export type StartImageSearchJobRequest = z.infer<typeof startImageSearchJobRequestSchema>;

export const imageSearchStatsSchema = z.object({
  indexed: z.number().int().min(0),
  pending: z.number().int().min(0),
  processing: z.number().int().min(0),
  failed: z.number().int().min(0),
  excluded: z.number().int().min(0),
  /** Indexed + pending + processing + failed: pictures the policy allows. */
  eligible: z.number().int().min(0),
  candidates: z.number().int().min(0),
  uniqueVectors: z.number().int().min(0),
  lastIndexedAt: z.string().nullable(),
  products: z.number().int().min(0),
  activeProducts: z.number().int().min(0),
  vectorsByModel: z.record(z.string(), z.number().int().min(0)),
  settings: imageSearchSettingsSchema.pick({
    enabled: true,
    similarityThreshold: true,
    maxResults: true,
    model: true,
    modelVersion: true,
    dimensions: true,
  }),
  /** What this API process is configured to produce, so a mismatch is visible. */
  provider: z.object({
    id: z.string(),
    model: z.string(),
    modelVersion: z.string(),
    dimensions: z.number().int().positive(),
    /** Always the configured provider's model; a stored model that differs needs a reindex. */
    matchesStoredModel: z.boolean(),
  }),
  jobs: z.array(imageSearchJobSchema),
});
export type ImageSearchStats = z.infer<typeof imageSearchStatsSchema>;

export const imageSearchMissingImagesQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ImageSearchMissingImagesQuery = z.infer<typeof imageSearchMissingImagesQuerySchema>;

export const IMAGE_SEARCH_MISSING_REASONS = [
  'no_images',
  'unknown_dimensions',
  'too_small',
  'undecodable',
  'placeholder',
  'unsupported_format',
  'too_large',
  'host_not_allowed',
  'variant_unavailable',
  'ineligible',
] as const;
export type ImageSearchMissingReason = (typeof IMAGE_SEARCH_MISSING_REASONS)[number];

export const imageSearchMissingImageSchema = z.object({
  productId: z.string().uuid(),
  name: z.string(),
  sku: z.string(),
  productStatus: z.string(),
  images: z.number().int().min(0),
  indexed: z.number().int().min(0),
  excluded: z.number().int().min(0),
  reason: z.string(),
});
export type ImageSearchMissingImage = z.infer<typeof imageSearchMissingImageSchema>;

export const imageSearchMissingImagesResponseSchema = z.object({
  items: z.array(imageSearchMissingImageSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
});
export type ImageSearchMissingImagesResponse = z.infer<
  typeof imageSearchMissingImagesResponseSchema
>;

export const imageSearchActivityQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ImageSearchActivityQuery = z.infer<typeof imageSearchActivityQuerySchema>;

export const imageSearchActivitySchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  imageHash: z.string().nullable(),
  model: z.string().nullable(),
  threshold: z.number().nullable(),
  resultCount: z.number().int().min(0),
  topProductIds: z.array(z.string().uuid()),
  clickedProductId: z.string().uuid().nullable(),
  clickedProductName: z.string().nullable(),
  outcome: imageSearchOutcomeSchema,
  client: z.string().nullable(),
  durationMs: z.number().int().nullable(),
});
export type ImageSearchActivity = z.infer<typeof imageSearchActivitySchema>;

export const imageSearchActivityResponseSchema = z.object({
  items: z.array(imageSearchActivitySchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
});
export type ImageSearchActivityResponse = z.infer<typeof imageSearchActivityResponseSchema>;
