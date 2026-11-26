import {
  acceptInvitationRequestSchema,
  confirmEmailRequestSchema,
  loginRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
  type ApiErrorCode,
  type AuthSession,
  type RegisterResponse,
} from '@nilzora/contracts';
import { Router, type Response } from 'express';
import { sendError } from '../../http/send-error';
import {
  bearerToken,
  isServiceUnavailable,
  type AuthDependencies,
} from '../../middleware/authenticate';
import { createRateLimiter, type RateLimitOptions } from '../../middleware/rate-limit';
import { requestInput, validate } from '../../middleware/validate';
import { noStore } from '../commerce/http';
import {
  AuthGatewayError,
  type AuthFailure,
  type SessionTokens,
  type VerifiedUser,
} from './gateway';

const FAILURES: Record<AuthFailure, [number, ApiErrorCode, string]> = {
  invalid_credentials: [401, 'invalid_credentials', 'Email or password is incorrect'],
  email_not_confirmed: [403, 'email_not_confirmed', 'Confirm your email address before signing in'],
  invalid_refresh_token: [401, 'invalid_refresh_token', 'Your session has expired. Sign in again.'],
  weak_password: [400, 'weak_password', 'Choose a stronger password'],
  invalid_confirmation_link: [
    400,
    'invalid_confirmation_link',
    'This confirmation link is invalid or has expired',
  ],
  account_exists: [
    409,
    'account_exists',
    'An account already uses this email address. Change its role instead.',
  ],
  invitation_invalid: [400, 'invitation_invalid', 'This invitation link is invalid or has expired'],
  rejected: [400, 'bad_request', 'This request could not be completed'],
  rate_limited: [429, 'rate_limited', 'Too many attempts. Please wait and try again.'],
  unavailable: [503, 'auth_unavailable', 'Sign-in is temporarily unavailable. Try again.'],
};

const REGISTERED: RegisterResponse = {
  status: 'accepted',
  message:
    'If this email address can be used, we have sent a confirmation link. Confirm it, then sign in.',
};

/** Answers a Supabase Auth refusal or outage with its stable code; anything else is rethrown. */
export function sendAuthFailure(res: Response, error: unknown): void {
  if (error instanceof AuthGatewayError) {
    const [status, code, message] = FAILURES[error.failure];
    sendError(res, status, code, message);
    return;
  }
  if (isServiceUnavailable(error)) {
    sendError(res, 503, 'auth_unavailable', FAILURES.unavailable[2]);
    return;
  }
  throw error;
}

function sessionBody(tokens: SessionTokens): AuthSession {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenType: 'bearer',
    expiresIn: tokens.expiresIn,
    expiresAt: tokens.expiresAt,
  };
}

/**
 * POST /auth/register, /auth/confirm-email, /auth/accept-invite, /auth/login,
 * /auth/refresh and /auth/logout.
 *
 * Bearer-token flow: Supabase Auth issues the tokens and the API hands them to
 * the client; no cookies are set. Sign-in attempts share a stricter per-IP limit.
 */
export function authRouter({
  gateway,
  accounts,
  rateLimit,
}: AuthDependencies & { rateLimit: RateLimitOptions }): Router {
  const router = Router();
  const authLimiter = createRateLimiter(rateLimit);

  /** Issues tokens only to active, fully provisioned accounts; otherwise revokes them. */
  async function issueSession(
    res: Response,
    session: SessionTokens & { user: VerifiedUser },
  ): Promise<void> {
    const access = await accounts.loadAccess(session.accessToken, session.user.id);
    if (!access || access.status !== 'active') {
      await gateway.signOut(session.accessToken);
      if (access) sendError(res, 403, 'account_suspended', 'This account is suspended');
      else sendError(res, 403, 'account_unavailable', 'This account cannot be used right now');
      return;
    }
    res.set('Cache-Control', 'no-store').json(sessionBody(session));
  }

  router.post(
    '/auth/register',
    authLimiter,
    validate({ body: registerRequestSchema }),
    async (_req, res) => {
      const { body } = requestInput<{ body: typeof registerRequestSchema }>(res);
      try {
        // Customer accounts only: the database assigns the role, never the request.
        await gateway.signUp(body);
        res.status(202).json(REGISTERED);
      } catch (error) {
        sendAuthFailure(res, error);
      }
    },
  );

  router.post(
    '/auth/confirm-email',
    authLimiter,
    validate({ body: confirmEmailRequestSchema }),
    async (_req, res) => {
      const { body } = requestInput<{ body: typeof confirmEmailRequestSchema }>(res);
      try {
        // Confirms the address only: the visitor then signs in with their password, so
        // a link sent to someone else can never sign them in to the sender's account.
        await gateway.confirmEmail(body.tokenHash);
        res.status(204).end();
      } catch (error) {
        sendAuthFailure(res, error);
      }
    },
  );

  router.post(
    '/auth/accept-invite',
    noStore,
    authLimiter,
    validate({ body: acceptInvitationRequestSchema }),
    async (_req, res) => {
      const { body } = requestInput<{ body: typeof acceptInvitationRequestSchema }>(res);
      let session: (SessionTokens & { user: VerifiedUser }) | undefined;
      try {
        session = await gateway.verifyInvitation(body.tokenHash);
        // Only an invitation that still carries a staff role sets a password here. A
        // customer's sign-up link redeemed on this route only confirms the address.
        const access = await accounts.loadAccess(session.accessToken, session.user.id);
        if (!access || access.status !== 'active' || access.role === 'customer') {
          const [status, code, message] = FAILURES.invitation_invalid;
          sendError(res, status, code, message);
          return;
        }
        await gateway.setPassword(session.user.id, body.password);
        res.status(204).end();
      } catch (error) {
        sendAuthFailure(res, error);
      } finally {
        // The session from the link never leaves the API: the invitee signs in with the
        // new password. Revocation is best effort, as for email confirmation.
        if (session) await gateway.signOut(session.accessToken).catch(() => undefined);
      }
    },
  );

  router.post(
    '/auth/login',
    authLimiter,
    validate({ body: loginRequestSchema }),
    async (_req, res) => {
      const { body } = requestInput<{ body: typeof loginRequestSchema }>(res);
      try {
        await issueSession(res, await gateway.signIn(body.email, body.password));
      } catch (error) {
        sendAuthFailure(res, error);
      }
    },
  );

  router.post(
    '/auth/refresh',
    authLimiter,
    validate({ body: refreshRequestSchema }),
    async (_req, res) => {
      const { body } = requestInput<{ body: typeof refreshRequestSchema }>(res);
      try {
        await issueSession(res, await gateway.refresh(body.refreshToken));
      } catch (error) {
        sendAuthFailure(res, error);
      }
    },
  );

  router.post('/auth/logout', async (req, res) => {
    const token = bearerToken(req.get('Authorization'));
    if (!token) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      sendError(res, 401, 'unauthenticated', 'Sign in to continue');
      return;
    }
    try {
      // Only the holder of a currently valid token can end its session.
      if (!(await gateway.verifyAccessToken(token))) {
        res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
        sendError(res, 401, 'unauthenticated', 'Your session is invalid or has expired');
        return;
      }
      await gateway.signOut(token);
      res.status(204).end();
    } catch (error) {
      sendAuthFailure(res, error);
    }
  });

  return router;
}
