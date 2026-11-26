import express, { Router, type RequestHandler } from 'express';
import type { Logger } from 'pino';
import { sendError } from '../../http/send-error';
import { noStore } from '../commerce/http';
import type { CourierProcessor } from './processor';

/*
 * POST /webhooks/couriers/:provider — courier status callbacks.
 *
 * Mounted BEFORE the global JSON body parser: the signature covers the exact bytes the
 * courier sent, so the body is read raw (at most WEBHOOK_BODY_LIMIT) and parsed only after
 * it has been verified. A courier that has no verified webhook in the current mode (and
 * any unknown courier id) answers 404, revealing nothing about what exists.
 */

export const WEBHOOK_BODY_LIMIT = '64kb';

export interface CourierWebhookDependencies {
  processor: CourierProcessor;
  /** Per-IP limit for webhook calls. */
  limiter: RequestHandler;
  logger: Pick<Logger, 'warn'>;
}

const PROVIDER_ID = /^[a-z][a-z0-9_]{1,30}$/;

export function courierWebhookRouter(deps: CourierWebhookDependencies): Router {
  const router = Router();
  const raw = express.raw({ type: () => true, limit: WEBHOOK_BODY_LIMIT });

  // Unknown couriers are refused before the body is even read.
  const knownCourier: RequestHandler = async (req, res, next) => {
    const provider = String(req.params.provider);
    let known = false;
    try {
      known =
        PROVIDER_ID.test(provider) &&
        (await deps.processor.webhookProvider(provider)) !== undefined;
    } catch {
      // The settings could not be read: ask the courier to send it again.
      sendError(res, 503, 'service_unavailable', 'Try again later');
      return;
    }
    if (!known) {
      sendError(res, 404, 'not_found', 'Route not found');
      return;
    }
    next();
  };

  router.post(
    '/webhooks/couriers/:provider',
    noStore,
    deps.limiter,
    knownCourier,
    raw,
    async (req, res) => {
      const provider = String(req.params.provider);
      const body: unknown = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        sendError(res, 400, 'bad_request', 'The webhook body is empty');
        return;
      }
      try {
        const answer = await deps.processor.handleWebhook(provider, (name) => req.get(name), body);
        if (answer.status === 404) sendError(res, 404, 'not_found', 'Route not found');
        else if (answer.status === 401) {
          sendError(res, 401, 'unauthenticated', 'Invalid webhook signature');
        } else res.status(answer.status).json(answer.body);
      } catch (failure) {
        // Not stored: the courier should send it again.
        deps.logger.warn(
          { provider, errorName: failure instanceof Error ? failure.name : 'UnknownError' },
          'Courier webhook could not be stored',
        );
        sendError(res, 503, 'service_unavailable', 'Try again later');
      }
    },
  );

  return router;
}
