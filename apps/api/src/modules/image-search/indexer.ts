import type { Logger } from 'pino';
import {
  imageContentHash,
  ImageEmbeddingError,
  vectorLiteral,
  type ImageEmbeddingProvider,
} from './embedding/provider';
import { inspectStoredImage, type ImageRejection } from './image-input';
import type { ImageSourceReader } from './image-source';
import type { ClaimedImage, ImageSearchStore } from './store';

/*
 * The background indexer
 * ----------------------
 * Product pictures are embedded here, never inside a product request: a save stays fast and a
 * slow model never fails a catalogue edit. The queue is the `image_search_images` table
 * itself, so an interrupted process loses nothing — a row is only ever in one of pending,
 * processing, indexed, failed or excluded, and a batch that dies mid-flight is returned to
 * pending by `image_search_recover_stale`.
 *
 * Two rules make the pipeline trustworthy:
 *   - the same picture is embedded once (the content hash is the cache key), and
 *   - a picture that cannot be embedded for a reason about the picture (too small, a
 *     placeholder, not decodable) is *excluded* with a reason, not retried forever as a
 *     failed job. Only transient failures (a network error, a 5xx, a timeout, a missing
 *     object that may reappear) are retried, with backoff, up to three attempts.
 */

export interface IndexerTickResult {
  claimed: number;
  indexed: number;
  failed: number;
  excluded: number;
  cached: number;
}

export interface ImageSearchIndexerOptions {
  store: ImageSearchStore;
  provider: ImageEmbeddingProvider;
  reader: ImageSourceReader;
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
  batchSize?: number;
  intervalMs?: number;
}

export interface ImageSearchIndexer {
  /** One batch; the worker calls it on a timer, tests call it directly. */
  tick(): Promise<IndexerTickResult>;
  start(): void;
  stop(): void;
  /** Runs a batch as soon as possible (after an admin starts a job). */
  kick(): void;
  /** Loads the model and recovers interrupted rows; safe to call twice. */
  prepare(): Promise<void>;
}

export function createImageSearchIndexer(options: ImageSearchIndexerOptions): ImageSearchIndexer {
  const { store, provider, reader, logger } = options;
  const batchSize = options.batchSize ?? 4;
  const intervalMs = options.intervalMs ?? 3_000;

  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let prepared: Promise<void> | null = null;
  let kicked = false;

  async function prepare(): Promise<void> {
    prepared ??= (async () => {
      const recovered = await store.recoverStale(600).catch(() => 0);
      if (recovered > 0)
        logger.info({ recovered }, 'image search: returned interrupted pictures to the queue');
      try {
        await provider.warmUp?.();
      } catch (error) {
        // The model is downloaded on first use; a slow or offline start must not stop the
        // worker from running, because the retry inside each embed is the real recovery.
        logger.warn(
          { err: { name: error instanceof Error ? error.name : 'UnknownError' } },
          'image search: the embedding model is not warm yet',
        );
      }
    })();
    return prepared;
  }

  async function processOne(
    image: ClaimedImage,
  ): Promise<'indexed' | 'failed' | 'excluded' | 'cached'> {
    const bytes =
      image.kind === 'variant'
        ? await reader.readVariantUrl(image.sourceKey)
        : await reader.readStoredImage(image.sourceKey);

    if (bytes === null) {
      // A variant picture on somebody else's host is a policy refusal, not a retry.
      if (image.kind === 'variant' && !reader.isOwnMediaUrl(image.sourceKey)) {
        await store.recordExclusion(image.id, 'host_not_allowed');
        return 'excluded';
      }
      await store.recordFailure(image.id, 'image_unavailable');
      return 'failed';
    }

    const verdict = await inspectStoredImage(bytes);
    if (!verdict.eligible) {
      await store.recordExclusion(image.id, verdict.reason);
      return 'excluded';
    }

    const contentHash = verdict.contentHash || imageContentHash(bytes);
    let vector = await store.cachedVector(contentHash, provider.model);
    if (vector !== null) {
      await store.recordIndexed({
        id: image.id,
        contentHash,
        model: provider.model,
        dimensions: provider.dimensions,
        vector: vectorLiteral(vector),
        width: verdict.width,
        height: verdict.height,
      });
      return 'cached';
    }

    try {
      vector = await provider.embed(bytes);
    } catch (error) {
      const retryable = error instanceof ImageEmbeddingError ? error.retryable : true;
      await store.recordFailure(
        image.id,
        retryable ? 'embedding_failed' : 'embedding_rejected',
        retryable,
      );
      return 'failed';
    }

    await store.recordIndexed({
      id: image.id,
      contentHash,
      model: provider.model,
      dimensions: provider.dimensions,
      vector: vectorLiteral(vector),
      width: verdict.width,
      height: verdict.height,
    });
    return 'indexed';
  }

  async function tick(): Promise<IndexerTickResult> {
    const result: IndexerTickResult = { claimed: 0, indexed: 0, failed: 0, excluded: 0, cached: 0 };
    await prepare();
    const jobId = (await store.takeJob()) ?? (await store.activeJob());
    const images = await store.claim(batchSize, jobId);
    result.claimed = images.length;
    for (const image of images) {
      try {
        const outcome = await processOne(image);
        if (outcome === 'indexed') result.indexed += 1;
        else if (outcome === 'cached') result.cached += 1;
        else if (outcome === 'excluded') result.excluded += 1;
        else result.failed += 1;
      } catch (error) {
        // A database failure while recording the outcome: put the picture back rather than
        // leave it in "processing" until the stale sweep finds it.
        await store.recordFailure(image.id, 'index_failed').catch(() => undefined);
        result.failed += 1;
        logger.warn(
          { err: { name: error instanceof Error ? error.name : 'UnknownError' } },
          'image search: a picture could not be indexed',
        );
      }
    }
    if (jobId !== null) await store.syncJob(jobId).catch(() => undefined);
    return result;
  }

  function schedule(delay: number): void {
    timer = setTimeout(() => {
      timer = null;
      void (async () => {
        if (!running) {
          running = true;
          try {
            await tick();
          } catch (error) {
            logger.warn(
              { err: { name: error instanceof Error ? error.name : 'UnknownError' } },
              'image search: a worker tick failed',
            );
          } finally {
            running = false;
          }
        }
        if (kicked) {
          kicked = false;
          schedule(0);
          return;
        }
        schedule(intervalMs);
      })();
    }, delay);
    // A pending embedding must not keep the process alive on its own.
    timer.unref?.();
  }

  return {
    tick,
    prepare,

    start() {
      if (timer !== null) return;
      logger.info({ intervalMs, batchSize }, 'image search indexer started');
      schedule(0);
    },

    stop() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      kicked = false;
    },

    kick() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      kicked = true;
      schedule(0);
    },
  };
}

/** The exclusion reasons the indexer can record, for the admin screen's wording. */
export const IMAGE_EXCLUSION_REASONS: readonly (
  ImageRejection | 'unknown_dimensions' | 'host_not_allowed'
)[] = [
  'too_small',
  'too_large',
  'unsupported_format',
  'corrupt',
  'placeholder',
  'empty',
  'unknown_dimensions',
  'host_not_allowed',
];
