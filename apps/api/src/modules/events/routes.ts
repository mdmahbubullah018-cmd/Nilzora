import { domainEventsQuerySchema, type DomainEventListResponse } from '@nilzora/contracts';
import { Router } from 'express';
import { sendError } from '../../http/send-error';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { currentIdentity, requirePermission } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { noStore } from '../commerce/http';
import type { DomainEventStore } from './store';
import type { DomainEventWorker } from './worker';

/*
 * Missed-event recovery and outbox monitoring.
 *
 *   GET /me/events?after=<seq>&limit=<n>   the caller's events after a cursor (their own, plus
 *                                          those addressed to a permission they hold)
 *   GET /me/events/cursor                  the newest seq, where a fresh client starts listening
 *   GET /admin/events/stats                outbox health (settings.manage)
 *
 * The socket is only a fast path: after a reconnect a client calls /me/events with the last seq
 * it processed, so nothing that happened while it was offline is missed.
 */
export function domainEventRoutes(
  deps: AuthDependencies & { events: DomainEventStore; worker?: DomainEventWorker | undefined },
): Router {
  const router = Router();
  const requireUser = authenticate(deps);

  router.get(
    '/me/events',
    noStore,
    requireUser,
    validate({ query: domainEventsQuerySchema }),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<{ query: typeof domainEventsQuerySchema }>(res);
      try {
        const events = await deps.events.forUser(identity.userId, query.after, query.limit);
        const body: DomainEventListResponse = {
          events,
          cursor: events.at(-1)?.seq ?? query.after,
          hasMore: events.length === query.limit,
        };
        res.json(body);
      } catch {
        sendError(
          res,
          503,
          'service_unavailable',
          'Updates are unavailable right now. Try again shortly.',
        );
      }
    },
  );

  router.get('/me/events/cursor', noStore, requireUser, async (_req, res) => {
    const identity = currentIdentity(res);
    try {
      res.json({ cursor: await deps.events.cursor(identity.userId) });
    } catch {
      sendError(
        res,
        503,
        'service_unavailable',
        'Updates are unavailable right now. Try again shortly.',
      );
    }
  });

  router.get(
    '/admin/events/stats',
    noStore,
    requireUser,
    requirePermission('settings.manage'),
    async (_req, res) => {
      try {
        res.json(await deps.events.stats());
      } catch {
        sendError(res, 503, 'service_unavailable', 'Outbox statistics are unavailable right now.');
      }
    },
  );

  return router;
}
