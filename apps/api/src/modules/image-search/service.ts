import type {
  ImageSearchMatch,
  ImageSearchResponse,
  ImageSearchSort,
  ProductSummary,
} from '@nilzora/contracts';
import type { Logger } from 'pino';
import type { CatalogStore } from '../catalog/store';
import { imageContentHash, vectorLiteral, type ImageEmbeddingProvider } from './embedding/provider';
import { prepareQueryImage } from './image-input';
import type { ImageSearchStore, NearestMatch } from './store';

/*
 * The image search itself
 * -----------------------
 * The steps, in order, because the order is the design:
 *
 *  1. Prepare the picture (decode, orientation, 1024 px, JPEG, no metadata) and hash it.
 *  2. Reuse a vector that is already stored for those exact bytes, if there is one.
 *  3. Otherwise ask the model. It is the only expensive step.
 *  4. Ask PostgreSQL for the nearest indexed pictures (cosine, HNSW), of products on sale.
 *  5. Group by product, keeping the best picture of each — that is the product's score.
 *  6. Drop anything below the configured threshold, then order.
 *  7. Fetch the cards of the page from the ordinary catalog path, so an image result is the
 *     same card shape as a search result, with its price, badges, variants and availability.
 *  8. Log the search anonymously (hash, model, top ids, outcome) and return.
 *
 * Similarity is cosine similarity in [-1, 1], where 1 is identical and ~0.7-0.9 is "the same
 * kind of object" for CLIP ViT-B/32. The threshold is a setting, and the evaluation script in
 * scripts/evaluate-image-search.ts measures it against real catalogue images.
 */

/** More pictures than products: several pictures of one product collapse into one result. */
const NEAREST_LIMIT = 150;

export class ImageSearchDisabledError extends Error {
  override readonly name = 'ImageSearchDisabledError';
  constructor() {
    super('Image search is switched off');
  }
}

export class ImageSearchNoIndexError extends Error {
  override readonly name = 'ImageSearchNoIndexError';
  constructor() {
    super('No indexed product pictures are available yet');
  }
}

export class ImageSearchUnavailableError extends Error {
  override readonly name = 'ImageSearchUnavailableError';
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ImageSearchUnavailableError';
  }
}

export interface ImageSearchServiceDeps {
  store: ImageSearchStore;
  catalog: CatalogStore;
  provider: ImageEmbeddingProvider;
  logger: Pick<Logger, 'warn' | 'info' | 'error'>;
  /** The deployment switch (IMAGE_SEARCH_ENABLED); the admin switch is in the database. */
  enabled: boolean;
}

export interface ImageSearchRequest {
  image: Buffer;
  sort: ImageSearchSort;
  page: number;
  pageSize: number;
  client: 'web' | 'android' | 'api';
}

export interface SimilarSearchRequest {
  productId: string;
  imageId: string | null;
  sort: ImageSearchSort;
  page: number;
  pageSize: number;
  client: 'web' | 'android' | 'api';
}

interface GroupedProduct {
  productId: string;
  similarity: number;
  imageId: string;
  primary: boolean;
  inStock: boolean;
}

export interface ImageSearchService {
  search(request: ImageSearchRequest): Promise<ImageSearchResponse>;
  searchSimilar(request: SimilarSearchRequest): Promise<ImageSearchResponse>;
  recordClick(searchId: string, productId: string): Promise<boolean>;
}

export function createImageSearchService(deps: ImageSearchServiceDeps): ImageSearchService {
  const { store, catalog, provider, logger } = deps;

  /** Groups the nearest pictures into products, best picture first. */
  function group(matches: readonly NearestMatch[]): Map<string, GroupedProduct> {
    const products = new Map<string, GroupedProduct>();
    for (const match of matches) {
      const existing = products.get(match.productId);
      const better =
        existing === undefined ||
        match.similarity > existing.similarity ||
        // A tie goes to the primary picture, which is the one the card shows.
        (match.similarity === existing.similarity && match.isPrimary && !existing.primary);
      if (better) {
        products.set(match.productId, {
          productId: match.productId,
          similarity: match.similarity,
          imageId: match.imageId,
          primary: match.isPrimary,
          // Filled in below from the card, which is the only place stock is authoritative.
          inStock: true,
        });
      }
    }
    return products;
  }

  async function answer(input: {
    vector: Float32Array;
    imageHash: string;
    width: number;
    height: number;
    sort: ImageSearchSort;
    page: number;
    pageSize: number;
    client: 'web' | 'android' | 'api';
    startedAt: number;
    /** "Find similar" leaves out the product whose picture seeded the search. */
    excludeProductId?: string | undefined;
  }): Promise<ImageSearchResponse> {
    const settings = await store.settings();
    if (!deps.enabled || !settings.enabled) throw new ImageSearchDisabledError();
    if (settings.dimensions !== provider.dimensions) {
      // The stored vectors were produced by a model of another width: comparing them would be
      // meaningless, and the admin screen flags the same mismatch.
      throw new ImageSearchNoIndexError();
    }

    const matches = await store.nearest(
      vectorLiteral(input.vector),
      settings.model,
      settings.dimensions,
      NEAREST_LIMIT,
    );
    const grouped = [...group(matches).values()].filter(
      (entry) =>
        entry.similarity >= settings.similarityThreshold &&
        entry.productId !== input.excludeProductId,
    );

    let items: ImageSearchMatch[] = [];
    let total = 0;

    if (grouped.length > 0) {
      // One card query for the whole candidate set: stock and price live on the card, and a
      // product that has just been unpublished simply has no card.
      const cards = await catalog.listProductsByIds(grouped.map((entry) => entry.productId));
      const bySlug = new Map(cards.map((card) => [card.id, card]));
      const known = grouped
        .map((entry) => ({ entry, card: bySlug.get(entry.productId) }))
        .filter((row): row is { entry: GroupedProduct; card: ProductSummary } => row.card !== undefined)
        .map(({ entry, card }) => ({
          ...entry,
          inStock: card.availability !== 'out_of_stock',
        }));

      const sorted = known.sort((a, b) => {
        if (input.sort === 'price_asc' || input.sort === 'price_desc') {
          const difference = (bySlug.get(a.productId)?.priceMinor ?? 0) - (bySlug.get(b.productId)?.priceMinor ?? 0);
          if (difference !== 0) return input.sort === 'price_asc' ? difference : -difference;
          return b.similarity - a.similarity;
        }
        // Best match: what a shopper can actually buy first, then the closest picture. The
        // brief asks for both, and this is the order that keeps them from fighting.
        if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
        return b.similarity - a.similarity;
      });

      total = Math.min(sorted.length, settings.maxResults);
      const offset = (input.page - 1) * input.pageSize;
      const page = sorted.slice(offset, offset + input.pageSize);
      items = page.map((entry) => ({
        product: bySlug.get(entry.productId) as ProductSummary,
        similarity: Math.round(entry.similarity * 10_000) / 10_000,
        imageId: entry.imageId,
      }));
    }

    const tookMs = Date.now() - input.startedAt;
    const outcome = total === 0 ? 'no_results' : 'results';
    let searchId: string | null = null;
    try {
      searchId = await store.logSearch({
        imageHash: input.imageHash,
        model: settings.model,
        threshold: settings.similarityThreshold,
        resultCount: total,
        topProductIds: items.slice(0, 10).map((item) => item.product.id),
        outcome,
        client: input.client,
        durationMs: tookMs,
      });
    } catch (error) {
      // A search must not fail because its log line could not be written.
      logger.warn({ err: { name: error instanceof Error ? error.name : 'UnknownError' } }, 'image search log failed');
    }

    return {
      searchId,
      query: { imageHash: input.imageHash, width: input.width, height: input.height },
      items,
      total,
      page: input.page,
      pageSize: input.pageSize,
      totalPages: Math.ceil(total / input.pageSize),
      sort: input.sort,
      threshold: settings.similarityThreshold,
      model: settings.model,
      tookMs,
      outcome,
    };
  }

  return {
    async search(request) {
      const startedAt = Date.now();
      if (!(await store.available())) {
        throw new ImageSearchUnavailableError('Image search is not set up in this database');
      }
      const prepared = await prepareQueryImage(request.image);
      let vector = await store.cachedVector(prepared.contentHash, provider.model);
      if (vector === null) {
        vector = await provider.embed(prepared.jpeg);
      }
      return answer({
        vector,
        imageHash: prepared.contentHash,
        width: prepared.width,
        height: prepared.height,
        sort: request.sort,
        page: request.page,
        pageSize: request.pageSize,
        client: request.client,
        startedAt,
      });
    },

    async searchSimilar(request) {
      const startedAt = Date.now();
      if (!(await store.available())) {
        throw new ImageSearchUnavailableError('Image search is not set up in this database');
      }
      const stored = await store.vectorForProductImage(request.productId, request.imageId);
      if (stored === null) {
        throw new ImageSearchNoIndexError();
      }
      return answer({
        vector: stored.vector,
        imageHash: stored.contentHash,
        width: stored.width ?? 0,
        height: stored.height ?? 0,
        sort: request.sort,
        page: request.page,
        pageSize: request.pageSize,
        client: request.client,
        startedAt,
        excludeProductId: request.productId,
      });
    },

    recordClick(searchId, productId) {
      return store.recordClick(searchId, productId);
    },
  };
}

/** Re-exported so the route can hash a raw body without duplicating the helper. */
export { imageContentHash };
