import {
  imageSearchActivityQuerySchema,
  imageSearchActivityResponseSchema,
  imageSearchMissingImagesQuerySchema,
  imageSearchMissingImagesResponseSchema,
  imageSearchSettingsSchema,
  imageSearchStatsSchema,
  saveImageSearchSettingsRequestSchema,
  startImageSearchJobRequestSchema,
} from '@nilzora/contracts';
import { Router, type RequestHandler } from 'express';
import type { Logger } from 'pino';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { currentIdentity, requirePermission } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { sendError } from '../../http/send-error';
import { noStore } from '../commerce/http';
import type { ImageEmbeddingConfig } from './embedding';
import { ImageSearchRefusedError, type ImageSearchStore } from './store';
import type { ImageSearchIndexer } from './indexer';

/*
 * Settings -> Image Search (image_search.manage)
 * ----------------------------------------------
 * Every route here is behind the permission, twice: the API refuses an account that does
 * not hold it, and each database function checks the same thing again, so a caller that
 * reached a function without the middleware still cannot read the index or start a job.
 *
 *   GET    /admin/image-search                 settings + live statistics + recent jobs
 *   PATCH  /admin/image-search/settings        enable, threshold and result cap
 *   POST   /admin/image-search/jobs            backfill | reindex_all | retry_failed
 *   GET    /admin/image-search/jobs            the last ten runs
 *   GET    /admin/image-search/missing-images  products with no usable picture
 *   GET    /admin/image-search/activity        the anonymised search log
 *
 * Nothing here blocks while indexing runs: a job is a row the worker drains, and the screen
 * polls these same reads to show progress.
 */

export interface ImageSearchAdminDependencies extends AuthDependencies {
  store: ImageSearchStore;
  provider: ImageEmbeddingConfig;
  /** The worker, so a started job is picked up at once instead of on the next tick. */
  indexer: ImageSearchIndexer | null;
  limiter: RequestHandler;
  logger: Pick<Logger, 'warn' | 'error'>;
}

/** A jsonb field as text, whatever the database sent. */
function cell(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function answerRefusal(res: Parameters<typeof sendError>[0], error: unknown): boolean {
  if (!(error instanceof ImageSearchRefusedError)) return false;
  if (error.refusal === 'missing_permission') {
    sendError(res, 403, 'forbidden', 'You do not have permission to manage image search');
  } else if (error.refusal === 'invalid_input') {
    sendError(res, 400, 'bad_request', 'The request was refused as invalid');
  } else if (error.refusal === 'not_found') {
    sendError(res, 404, 'not_found', 'Not found');
  } else {
    sendError(res, 409, 'bad_request', 'An indexing job is already running');
  }
  return true;
}

export function imageSearchAdminRoutes(deps: ImageSearchAdminDependencies): Router {
  const { store, provider, indexer, logger } = deps;
  const router = Router();
  const requireUser = authenticate(deps);

  /** Every route shares the same gate: a signed-in account holding the permission. */
  const guard = [requireUser, requirePermission('image_search.manage')];

  function providerInfo(storedModel: string) {
    return {
      id: provider.id,
      model: provider.model,
      modelVersion: provider.modelVersion,
      dimensions: provider.dimensions,
      matchesStoredModel: storedModel === provider.model,
    };
  }

  router.get('/admin/image-search', noStore, ...guard, async (_req, res) => {
    const identity = currentIdentity(res);
    try {
      const stats = (await store.adminStats(identity.userId));
      const jobs = await store.adminJobs(identity.userId);
      const settings = (typeof stats.settings === 'object' && stats.settings !== null ? stats.settings : {}) as Record<string, unknown>;
      res.json(
        imageSearchStatsSchema.parse({
          indexed: Number(stats.indexed ?? 0),
          pending: Number(stats.pending ?? 0),
          processing: Number(stats.processing ?? 0),
          failed: Number(stats.failed ?? 0),
          excluded: Number(stats.excluded ?? 0),
          eligible: Number(stats.eligible ?? 0),
          candidates: Number(stats.candidates ?? 0),
          uniqueVectors: Number(stats.uniqueVectors ?? 0),
          lastIndexedAt: stats.lastIndexedAt ?? null,
          products: Number(stats.products ?? 0),
          activeProducts: Number(stats.activeProducts ?? 0),
          vectorsByModel: (stats.vectorsByModel as Record<string, number>) ?? {},
          settings: imageSearchSettingsSchema.pick({
            enabled: true,
            similarityThreshold: true,
            maxResults: true,
            model: true,
            modelVersion: true,
            dimensions: true,
          }).parse({
            enabled: settings.enabled === true,
            similarityThreshold: Number(settings.similarityThreshold),
            maxResults: Number(settings.maxResults),
            model: String(settings.model),
            modelVersion: String(settings.modelVersion),
            dimensions: Number(settings.dimensions),
          }),
          provider: providerInfo(String(settings.model)),
          jobs: jobs.map((job) => ({
            id: String(job.id),
            kind: String(job.kind),
            status: String(job.status),
            total: Number(job.total ?? 0),
            indexed: Number(job.indexed ?? 0),
            failed: Number(job.failed ?? 0),
            excluded: Number(job.excluded ?? 0),
            createdAt: job.created_at ?? job.createdAt ?? null,
            startedAt: job.started_at ?? job.startedAt ?? null,
            finishedAt: job.finished_at ?? job.finishedAt ?? null,
            error: (job.error as string | null) ?? null,
          })),
        }),
      );
    } catch (error) {
      if (answerRefusal(res, error)) return;
      logger.error(
        { err: { name: error instanceof Error ? error.name : 'UnknownError' } },
        'image search statistics failed',
      );
      sendError(res, 503, 'service_unavailable', 'Image search settings could not be read');
    }
  });

  const settingsSchemas = { body: saveImageSearchSettingsRequestSchema };
  router.patch('/admin/image-search/settings', noStore, ...guard, validate(settingsSchemas), async (_req, res) => {
    const identity = currentIdentity(res);
    const { body } = requestInput<typeof settingsSchemas>(res);
    try {
      const settings = await store.adminSaveSettings(identity.userId, {
        enabled: body.enabled,
        similarityThreshold: body.similarityThreshold,
        maxResults: body.maxResults,
        // The model is the running provider's, not a client's opinion: storing anything else
        // would label vectors with a model that did not produce them.
        model: provider.model,
        modelVersion: provider.modelVersion,
        dimensions: provider.dimensions,
      });
      res.json(imageSearchSettingsSchema.parse(settings));
    } catch (error) {
      if (answerRefusal(res, error)) return;
      logger.error(
        { err: { name: error instanceof Error ? error.name : 'UnknownError' } },
        'image search settings could not be saved',
      );
      sendError(res, 503, 'service_unavailable', 'Image search settings could not be saved');
    }
  });

  const jobSchemas = { body: startImageSearchJobRequestSchema };
  router.post('/admin/image-search/jobs', noStore, deps.limiter, ...guard, validate(jobSchemas), async (_req, res) => {
    const identity = currentIdentity(res);
    const { body } = requestInput<typeof jobSchemas>(res);
    try {
      const job = await store.adminStartJob(identity.userId, body.kind);
      // The queue now holds work; ask the worker for it now rather than on the next tick.
      indexer?.kick();
      res.status(202).json({
        id: String(job.id),
        kind: String(job.kind),
        status: String(job.status),
        total: Number(job.total ?? 0),
        indexed: Number(job.indexed ?? 0),
        failed: Number(job.failed ?? 0),
        excluded: Number(job.excluded ?? 0),
        createdAt: job.createdAt ?? job.created_at ?? null,
        startedAt: job.startedAt ?? job.started_at ?? null,
        finishedAt: job.finishedAt ?? job.finished_at ?? null,
      });
    } catch (error) {
      if (answerRefusal(res, error)) return;
      logger.error(
        { err: { name: error instanceof Error ? error.name : 'UnknownError' } },
        'image search job could not be started',
      );
      sendError(res, 503, 'service_unavailable', 'The indexing job could not be started');
    }
  });

  router.get('/admin/image-search/jobs', noStore, ...guard, async (_req, res) => {
    const identity = currentIdentity(res);
    try {
      const jobs = (await store.adminJobs(identity.userId));
      res.json({ items: jobs });
    } catch (error) {
      if (answerRefusal(res, error)) return;
      sendError(res, 503, 'service_unavailable', 'Indexing jobs could not be read');
    }
  });

  const listSchemas = { query: imageSearchMissingImagesQuerySchema };
  router.get('/admin/image-search/missing-images', noStore, ...guard, validate(listSchemas), async (_req, res) => {
    const identity = currentIdentity(res);
    const { query } = requestInput<typeof listSchemas>(res);
    try {
      const page = await store.adminMissingImages(identity.userId, query);
      res.json(
        imageSearchMissingImagesResponseSchema.parse({
          items: page.items.map((row) => ({
            productId: String(row.product_id),
            name: String(row.name),
            sku: String(row.sku),
            productStatus: String(row.product_status),
            images: Number(row.images ?? 0),
            indexed: Number(row.indexed ?? 0),
            excluded: Number(row.excluded ?? 0),
            reason: cell(row.reason) || 'ineligible',
          })),
          total: page.total,
          limit: page.limit,
          offset: page.offset,
        }),
      );
    } catch (error) {
      if (answerRefusal(res, error)) return;
      sendError(res, 503, 'service_unavailable', 'Missing images could not be read');
    }
  });

  const activitySchemas = { query: imageSearchActivityQuerySchema };
  router.get('/admin/image-search/activity', noStore, ...guard, validate(activitySchemas), async (_req, res) => {
    const identity = currentIdentity(res);
    const { query } = requestInput<typeof activitySchemas>(res);
    try {
      const page = await store.adminActivity(identity.userId, query);
      res.json(imageSearchActivityResponseSchema.parse(page));
    } catch (error) {
      if (answerRefusal(res, error)) return;
      sendError(res, 503, 'service_unavailable', 'Search activity could not be read');
    }
  });

  return router;
}
