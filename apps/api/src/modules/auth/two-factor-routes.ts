import {
  twoFactorCodeRequestSchema,
  twoFactorEnrollRequestSchema,
  twoFactorRecoveryRequestSchema,
  twoFactorResetRequestSchema,
  type TwoFactorStatusResponse,
} from '@nilzora/contracts';
import { Router, type Response } from 'express';
import type { RequestIdentity } from '../../auth/identity';
import { TwoFactorError, type TwoFactorCaller, type TwoFactorService } from '../../auth/two-factor';
import { sendError } from '../../http/send-error';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { currentIdentity } from '../../middleware/authorize';
import { createRateLimiter, type RateLimitOptions } from '../../middleware/rate-limit';
import { requestInput, validate } from '../../middleware/validate';
import { noStore } from '../commerce/http';

/*
 * Two-factor authentication routes, for the signed-in account only (the id always comes from the
 * verified session; no route accepts another account's id). They serve a session that has not
 * passed 2FA yet — that is their purpose — and nothing else does: every other route refuses such
 * a session for a super_admin (see authenticate()).
 *
 *   GET  /auth/two-factor                   the caller's state
 *   POST /auth/two-factor/enroll            password -> QR secret (shown once)
 *   POST /auth/two-factor/activate          first code -> 2FA on, recovery codes (shown once)
 *   POST /auth/two-factor/verify            code -> this session passes 2FA
 *   POST /auth/two-factor/recovery          one recovery code -> this session passes 2FA
 *   POST /auth/two-factor/recovery-codes    code -> ten new recovery codes (old ones revoked)
 *   POST /auth/two-factor/reset             password + code -> 2FA removed (must enroll again)
 *
 * Every attempt is behind the auth rate limiter, and the database locks verification after five
 * wrong codes in a row; every outcome is audited there.
 */

function caller(res: Response, identity: RequestIdentity): TwoFactorCaller | null {
  if (!identity.sessionId) {
    sendError(
      res,
      409,
      'two_factor_unavailable',
      'Sign in with your Nilzora email and password to use two-factor authentication.',
    );
    return null;
  }
  return { userId: identity.userId, sessionId: identity.sessionId, email: identity.email };
}

function sendTwoFactorFailure(res: Response, error: unknown): void {
  if (!(error instanceof TwoFactorError)) throw error;
  switch (error.failure) {
    case 'invalid_code':
      sendError(
        res,
        400,
        'invalid_two_factor_code',
        'That code is not valid. Check it and try again.',
      );
      return;
    case 'locked':
      sendError(
        res,
        429,
        'two_factor_locked',
        'Too many wrong codes. Try again in a few minutes.',
        {
          lockedUntil: error.lockedUntil?.toISOString() ?? null,
        },
      );
      return;
    // Never 401: a client reads 401 as "session expired" and would refresh and retry, which
    // would count the wrong password twice and sign the person out.
    case 'invalid_password':
      sendError(res, 400, 'reauthentication_failed', 'That password is not correct.');
      return;
    case 'reauthentication_required':
      sendError(res, 403, 'reauthentication_failed', 'Sign in again, then try once more.');
      return;
    case 'already_active':
      sendError(res, 409, 'two_factor_already_active', 'Two-factor authentication is already on.');
      return;
    case 'not_enrolled':
      sendError(res, 409, 'two_factor_not_enrolled', 'Set up two-factor authentication first.');
      return;
    case 'not_required':
      sendError(
        res,
        403,
        'forbidden',
        'Two-factor authentication is not available for this account.',
      );
      return;
    case 'unavailable':
      sendError(
        res,
        503,
        'two_factor_unavailable',
        'Two-factor authentication is unavailable. Try again.',
      );
      return;
  }
}

export function twoFactorRouter({
  auth,
  service,
  rateLimit,
}: {
  auth: AuthDependencies;
  service: TwoFactorService;
  rateLimit: RateLimitOptions;
}): Router {
  const router = Router();
  const limiter = createRateLimiter(rateLimit);
  const signedIn = authenticate({ ...auth, allowPendingTwoFactor: true });

  router.get('/auth/two-factor', noStore, signedIn, async (_req, res) => {
    const identity = currentIdentity(res);
    const who = caller(res, identity);
    if (!who) return;
    try {
      const state = await service.state(who.userId, who.sessionId);
      const body: TwoFactorStatusResponse = {
        required: state.required,
        enrolled: state.enrolled,
        pending: state.pending,
        verified: state.verified,
        lockedUntil: state.lockedUntil?.toISOString() ?? null,
        recoveryCodesLeft: state.recoveryCodesLeft,
      };
      res.json(body);
    } catch (error) {
      sendTwoFactorFailure(res, error);
    }
  });

  router.post(
    '/auth/two-factor/enroll',
    noStore,
    limiter,
    signedIn,
    validate({ body: twoFactorEnrollRequestSchema }),
    async (_req, res) => {
      const who = caller(res, currentIdentity(res));
      if (!who) return;
      const { body } = requestInput<{ body: typeof twoFactorEnrollRequestSchema }>(res);
      try {
        res.json(await service.enroll(who, body.password));
      } catch (error) {
        sendTwoFactorFailure(res, error);
      }
    },
  );

  const withCode = (
    path: string,
    run: (who: TwoFactorCaller, code: string) => Promise<unknown>,
    success: (res: Response, value: unknown) => void,
  ) => {
    router.post(
      path,
      noStore,
      limiter,
      signedIn,
      validate({ body: twoFactorCodeRequestSchema }),
      async (_req, res) => {
        const who = caller(res, currentIdentity(res));
        if (!who) return;
        const { body } = requestInput<{ body: typeof twoFactorCodeRequestSchema }>(res);
        try {
          success(res, await run(who, body.code));
        } catch (error) {
          sendTwoFactorFailure(res, error);
        }
      },
    );
  };

  withCode(
    '/auth/two-factor/activate',
    (who, code) => service.activate(who, code),
    (res, value) => {
      res.json(value);
    },
  );
  withCode(
    '/auth/two-factor/verify',
    (who, code) => service.verify(who, code),
    (res) => {
      res.status(204).end();
    },
  );
  withCode(
    '/auth/two-factor/recovery-codes',
    (who, code) => service.replaceRecoveryCodes(who, code),
    (res, value) => {
      res.json(value);
    },
  );

  router.post(
    '/auth/two-factor/recovery',
    noStore,
    limiter,
    signedIn,
    validate({ body: twoFactorRecoveryRequestSchema }),
    async (_req, res) => {
      const who = caller(res, currentIdentity(res));
      if (!who) return;
      const { body } = requestInput<{ body: typeof twoFactorRecoveryRequestSchema }>(res);
      try {
        res.json(await service.useRecoveryCode(who, body.recoveryCode));
      } catch (error) {
        sendTwoFactorFailure(res, error);
      }
    },
  );

  router.post(
    '/auth/two-factor/reset',
    noStore,
    limiter,
    signedIn,
    validate({ body: twoFactorResetRequestSchema }),
    async (_req, res) => {
      const who = caller(res, currentIdentity(res));
      if (!who) return;
      const { body } = requestInput<{ body: typeof twoFactorResetRequestSchema }>(res);
      try {
        await service.reset(who, body.password, body.code);
        res.status(204).end();
      } catch (error) {
        sendTwoFactorFailure(res, error);
      }
    },
  );

  return router;
}
