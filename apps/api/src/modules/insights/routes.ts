import {
  customerInsightListResponseSchema,
  customerInsightQuerySchema,
  type CustomerInsightListResponse,
} from '@nilzora/contracts';
import { Router } from 'express';
import { currentIdentity, requirePermission } from '../../middleware/authorize';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { requestInput, validate } from '../../middleware/validate';
import { noStore, sendCommerceFailure } from '../commerce/http';
import { pageInfo, pageOf } from '../admin/shared';
import type { InsightStore } from './store';

const listSchemas = { query: customerInsightQuerySchema };

export interface InsightRouteDependencies extends AuthDependencies {
  insights: InsightStore;
}

/**
 * The customer directory with real spending: what each account has paid, minus what was
 * refunded, and the segments that follow from it. Admin only — a customer never sees their
 * own segment, and no demographic attribute is collected to produce one.
 */
export function insightRoutes(deps: InsightRouteDependencies): Router {
  const { insights } = deps;
  const requireUser = authenticate(deps);
  const canRead = requirePermission('customers.read');
  const router = Router();

  router.get(
    '/admin/insights/customers',
    noStore,
    requireUser,
    canRead,
    validate(listSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof listSchemas>(res);
      try {
        const { customers, total } = await insights.customers(
          identity.accessToken,
          identity.userId,
          query,
          pageOf(query),
        );
        const response: CustomerInsightListResponse = customerInsightListResponseSchema.parse({
          customers,
          ...pageInfo(query, total),
        });
        res.json(response);
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  return router;
}
