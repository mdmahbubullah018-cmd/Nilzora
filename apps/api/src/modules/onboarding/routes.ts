import {
  onboardingCampaignListResponseSchema,
  onboardingCampaignResponseSchema,
  onboardingPreviewResponseSchema,
  onboardingResponseSchema,
  onboardingSlideResponseSchema,
  reorderOnboardingSlidesSchema,
  saveOnboardingCampaignSchema,
  saveOnboardingSlideSchema,
  setOnboardingActiveSchema,
  type OnboardingCampaignListResponse,
  type OnboardingCampaignResponse,
  type OnboardingPreviewResponse,
  type OnboardingResponse,
  type OnboardingSlideResponse,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router } from 'express';
import { z } from 'zod';
import { currentIdentity, requirePermission } from '../../middleware/authorize';
import {
  authenticate,
  optionalAuthenticate,
  type AuthDependencies,
} from '../../middleware/authenticate';
import { requestInput, validate } from '../../middleware/validate';
import { sendAdminFailure } from '../admin/errors';
import { noStore } from '../commerce/http';
import type { OnboardingStore } from './store';

const campaignParams = z.object({ campaignId: uuidSchema });
const slideParams = z.object({ campaignId: uuidSchema, slideId: uuidSchema });

const campaignSchemas = { body: saveOnboardingCampaignSchema };
const campaignEditSchemas = { params: campaignParams, body: saveOnboardingCampaignSchema };
const campaignReadSchemas = { params: campaignParams };
const activeSchemas = { params: campaignParams, body: setOnboardingActiveSchema };
const slideCreateSchemas = { params: campaignParams, body: saveOnboardingSlideSchema };
const slideEditSchemas = { params: slideParams, body: saveOnboardingSlideSchema };
const slideReadSchemas = { params: slideParams };
const reorderSchemas = { params: campaignParams, body: reorderOnboardingSlidesSchema };
const completeSchemas = { params: campaignParams };

export interface OnboardingRouteDependencies extends AuthDependencies {
  onboarding: OnboardingStore;
}

/**
 * The customer-facing read.
 *
 * It answers differently to a guest and to a signed-in customer (a campaign's audience is
 * `guest`, `authenticated` or `all`, and a finished sequence is not sent again), so the
 * route establishes an identity when credentials are present and continues anonymously
 * when they are not. A bad or suspended token is still refused: a stale session must never
 * quietly turn a customer into a guest.
 *
 * Nothing here is cached: the answer depends on the caller and on the current time.
 */
export function onboardingRoutes(deps: OnboardingRouteDependencies): Router {
  const { onboarding } = deps;
  const requireUser = authenticate(deps);
  const identify = optionalAuthenticate(deps);
  const router = Router();

  router.get('/onboarding', noStore, identify, async (_req, res) => {
    // Set only when a valid token came with the request (optionalAuthenticate); never a value
    // the client names. The account id goes along with the token so the database sees the
    // customer, not an anonymous visitor.
    const identity = res.locals.identity as { accessToken: string; userId: string } | undefined;
    try {
      const campaign = await onboarding.publicCampaign(
        identity?.accessToken ?? null,
        identity?.userId ?? null,
      );
      const response: OnboardingResponse = onboardingResponseSchema.parse({ campaign });
      res.json(response);
    } catch (error) {
      sendAdminFailure(res, error);
    }
  });

  router.post(
    '/onboarding/:campaignId/complete',
    noStore,
    requireUser,
    validate(completeSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof completeSchemas>(res);
      try {
        // Always the verified caller's own account: nothing in the URL or body can name another.
        await onboarding.complete(identity.accessToken, identity.userId, params.campaignId);
        res.status(204).end();
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  return router;
}

/**
 * Management. Every route requires the same permission the Settings screens do, and the
 * database checks it again inside each function, so a gap here still could not act beyond
 * the account.
 */
export function adminOnboardingRoutes(deps: OnboardingRouteDependencies): Router {
  const { onboarding } = deps;
  const requireUser = authenticate(deps);
  const canManage = requirePermission('settings.manage');
  const guard = [noStore, requireUser, canManage] as const;
  const router = Router();

  router.get('/admin/onboarding', ...guard, async (_req, res) => {
    const identity = currentIdentity(res);
    try {
      const campaigns = await onboarding.list(identity.accessToken, identity.userId);
      const response: OnboardingCampaignListResponse = onboardingCampaignListResponseSchema.parse({
        campaigns,
      });
      res.json(response);
    } catch (error) {
      sendAdminFailure(res, error);
    }
  });

  router.post('/admin/onboarding', ...guard, validate(campaignSchemas), async (_req, res) => {
    const identity = currentIdentity(res);
    const { body } = requestInput<typeof campaignSchemas>(res);
    try {
      const campaignId = await onboarding.saveCampaign(
        identity.accessToken,
        identity.userId,
        null,
        body,
      );
      const campaign = await onboarding.get(identity.accessToken, identity.userId, campaignId);
      const response: OnboardingCampaignResponse = onboardingCampaignResponseSchema.parse({
        campaign,
      });
      res.status(201).json(response);
    } catch (error) {
      sendAdminFailure(res, error);
    }
  });

  router.get(
    '/admin/onboarding/:campaignId',
    ...guard,
    validate(campaignReadSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof campaignReadSchemas>(res);
      try {
        const campaign = await onboarding.get(
          identity.accessToken,
          identity.userId,
          params.campaignId,
        );
        const response: OnboardingCampaignResponse = onboardingCampaignResponseSchema.parse({
          campaign,
        });
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.put(
    '/admin/onboarding/:campaignId',
    ...guard,
    validate(campaignEditSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof campaignEditSchemas>(res);
      try {
        await onboarding.saveCampaign(
          identity.accessToken,
          identity.userId,
          params.campaignId,
          body,
        );
        const campaign = await onboarding.get(
          identity.accessToken,
          identity.userId,
          params.campaignId,
        );
        const response: OnboardingCampaignResponse = onboardingCampaignResponseSchema.parse({
          campaign,
        });
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.delete(
    '/admin/onboarding/:campaignId',
    ...guard,
    validate(campaignReadSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof campaignReadSchemas>(res);
      try {
        await onboarding.remove(identity.accessToken, identity.userId, params.campaignId);
        res.status(204).end();
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.post(
    '/admin/onboarding/:campaignId/active',
    ...guard,
    validate(activeSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof activeSchemas>(res);
      try {
        await onboarding.setActive(
          identity.accessToken,
          identity.userId,
          params.campaignId,
          body.active,
        );
        res.status(204).end();
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.get(
    '/admin/onboarding/:campaignId/preview',
    ...guard,
    validate(campaignReadSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof campaignReadSchemas>(res);
      try {
        const campaign = await onboarding.preview(
          identity.accessToken,
          identity.userId,
          params.campaignId,
        );
        const response: OnboardingPreviewResponse = onboardingPreviewResponseSchema.parse({
          campaign,
        });
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.post(
    '/admin/onboarding/:campaignId/slides',
    ...guard,
    validate(slideCreateSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof slideCreateSchemas>(res);
      try {
        const slide = await onboarding.saveSlide(
          identity.accessToken,
          identity.userId,
          null,
          params.campaignId,
          body,
        );
        const response: OnboardingSlideResponse = onboardingSlideResponseSchema.parse({ slide });
        res.status(201).json(response);
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.put(
    '/admin/onboarding/:campaignId/slides/:slideId',
    ...guard,
    validate(slideEditSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof slideEditSchemas>(res);
      try {
        const slide = await onboarding.saveSlide(
          identity.accessToken,
          identity.userId,
          params.slideId,
          params.campaignId,
          body,
        );
        const response: OnboardingSlideResponse = onboardingSlideResponseSchema.parse({ slide });
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.delete(
    '/admin/onboarding/:campaignId/slides/:slideId',
    ...guard,
    validate(slideReadSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof slideReadSchemas>(res);
      try {
        await onboarding.deleteSlide(identity.accessToken, identity.userId, params.slideId);
        res.status(204).end();
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.post(
    '/admin/onboarding/:campaignId/slides/reorder',
    ...guard,
    validate(reorderSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof reorderSchemas>(res);
      try {
        await onboarding.reorder(
          identity.accessToken,
          identity.userId,
          params.campaignId,
          body.slideIds,
        );
        res.status(204).end();
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  return router;
}
