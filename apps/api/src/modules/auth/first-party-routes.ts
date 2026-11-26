import {
  loginRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
  type ApiErrorCode,
  type AuthSession,
  type RegisterResponse,
} from '@nilzora/contracts';
import { Router, type Response } from 'express';
import { z } from 'zod';
import {
  AuthError,
  type AuthFailure,
  type AuthService,
  type SessionTokens,
} from '../../auth/first-party';
import { safeReturnTo, type GoogleIdentitySignIn, type GoogleOAuth } from '../../auth/oauth';
import { sendError } from '../../http/send-error';
import { bearerToken, isServiceUnavailable } from '../../middleware/authenticate';
import { createRateLimiter, type RateLimitOptions } from '../../middleware/rate-limit';
import { requestInput, validate } from '../../middleware/validate';
import { noStore } from '../commerce/http';

const sixDigitCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the six-digit code from your email');

/** POST /auth/verify-otp and /auth/resend-otp — the account-claim and verification code. */
export const verifyOtpRequestSchema = z.strictObject({
  email: z.string().trim().toLowerCase().min(3).max(254),
  code: sixDigitCodeSchema,
});

export const resendOtpRequestSchema = z.strictObject({
  email: z.string().trim().toLowerCase().min(3).max(254),
});

/** POST /auth/forgot-password — always answers 202 so it cannot enumerate accounts. */
export const forgotPasswordRequestSchema = z.strictObject({
  email: z.string().trim().toLowerCase().min(3).max(254),
});

export const resetPasswordRequestSchema = z.strictObject({
  email: z.string().trim().toLowerCase().min(3).max(254),
  code: sixDigitCodeSchema,
  password: z.string().min(1).max(1024),
});

/** POST /auth/google/callback — the code and state Google returned, validated server-side. */
export const googleCallbackSchema = z.strictObject({
  code: z.string().min(1).max(4096),
  state: z.string().min(1).max(4096),
  /** RFC 9207 issuer of the authorization response; Google sends it and the client checks it. */
  iss: z.string().max(2048).optional(),
});

/** POST /auth/google/id-token — an ID token a native app obtained from Google Identity Services. */
export const googleIdTokenSchema = z.strictObject({
  idToken: z.string().min(20).max(8192),
});

const FAILURES: Record<AuthFailure, [number, ApiErrorCode, string]> = {
  invalid_credentials: [401, 'invalid_credentials', 'Email or password is incorrect'],
  account_suspended: [403, 'account_suspended', 'This account is suspended'],
  email_not_confirmed: [
    403,
    'email_not_confirmed',
    'Enter the six-digit code we emailed you before signing in',
  ],
  invalid_refresh_token: [401, 'invalid_refresh_token', 'Your session has expired. Sign in again.'],
  weak_password: [400, 'weak_password', 'Choose a stronger password'],
  account_exists: [
    409,
    'account_exists',
    'An account already uses this email address. Change its role instead.',
  ],
  invalid_code: [400, 'invalid_code', 'That code is invalid or has expired'],
  rate_limited: [429, 'rate_limited', 'Too many attempts. Please wait and try again.'],
  unavailable: [503, 'auth_unavailable', 'Sign-in is temporarily unavailable. Try again.'],
  email_unavailable: [
    503,
    'email_unavailable',
    // Used when no mail server is configured and when it refuses the message: either way
    // nothing was stored, and the visitor can simply try again later.
    'We could not send the email right now. Nothing was created; please try again in a few minutes.',
  ],
  oauth_unavailable: [503, 'oauth_unavailable', 'Google sign-in is not configured'],
  invitation_invalid: [400, 'invitation_invalid', 'This invitation link is invalid or has expired'],
};

const REGISTERED: RegisterResponse = {
  status: 'accepted',
  message:
    'If this email address can be used, we have sent a six-digit code. Enter it to finish creating your account.',
};

const RESET_SENT = {
  status: 'accepted',
  message: 'If this email address belongs to an account, we have sent a six-digit reset code.',
} as const;

/** Answers a first-party auth refusal or outage with its stable code; anything else is rethrown. */
export function sendFirstPartyFailure(res: Response, error: unknown): void {
  if (error instanceof AuthError) {
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
    tokenType: tokens.tokenType,
    expiresIn: tokens.expiresIn,
    expiresAt: tokens.expiresAt,
  };
}

/**
 * First-party authentication routes.
 *
 * Mounted ahead of the Supabase Auth router, which keeps serving the paths this
 * router does not implement (`/auth/confirm-email`, `/auth/accept-invite`), so both
 * providers work while the migration is in progress. Tokens are opaque random
 * strings: the API owns the session, and no client can read claims out of them.
 */
export function firstPartyAuthRouter({
  auth,
  rateLimit,
  google,
  googleIdToken,
}: {
  auth: AuthService;
  rateLimit: RateLimitOptions;
  /** Present only when Google credentials are configured; otherwise the routes answer 503. */
  google?: GoogleOAuth | undefined;
  /** Present with Google configured: verifies native ID tokens and links them the same way. */
  googleIdToken?: GoogleIdentitySignIn | undefined;
}): Router {
  const router = Router();
  const authLimiter = createRateLimiter(rateLimit);

  router.post(
    '/auth/register',
    noStore,
    authLimiter,
    validate({ body: registerRequestSchema }),
    async (_req, res) => {
      const { body } = requestInput<{ body: typeof registerRequestSchema }>(res);
      try {
        // The database assigns the customer role; the request cannot ask for another.
        await auth.register(body);
        res.status(202).json(REGISTERED);
      } catch (error) {
        // An address that already has an account is indistinguishable from a new one:
        // same 202, no mail. Owners recover access through resend-otp / forgot-password.
        if (error instanceof AuthError && error.failure === 'account_exists') {
          res.status(202).json(REGISTERED);
          return;
        }
        sendFirstPartyFailure(res, error);
      }
    },
  );

  router.post(
    '/auth/verify-otp',
    noStore,
    authLimiter,
    validate({ body: verifyOtpRequestSchema }),
    async (_req, res) => {
      const { body } = requestInput<{ body: typeof verifyOtpRequestSchema }>(res);
      try {
        const session = await auth.verifyEmail(body.email, body.code);
        res.set('Cache-Control', 'no-store').json(sessionBody(session.tokens));
      } catch (error) {
        sendFirstPartyFailure(res, error);
      }
    },
  );

  router.post(
    '/auth/resend-otp',
    noStore,
    authLimiter,
    validate({ body: resendOtpRequestSchema }),
    async (_req, res) => {
      const { body } = requestInput<{ body: typeof resendOtpRequestSchema }>(res);
      try {
        await auth.resendEmailCode(body.email);
        res.status(202).json(REGISTERED);
      } catch (error) {
        sendFirstPartyFailure(res, error);
      }
    },
  );

  router.post(
    '/auth/login',
    noStore,
    authLimiter,
    validate({ body: loginRequestSchema }),
    async (req, res) => {
      const { body } = requestInput<{ body: typeof loginRequestSchema }>(res);
      try {
        const session = await auth.login(body.email, body.password, req.get('User-Agent'), req.ip);
        res.set('Cache-Control', 'no-store').json(sessionBody(session.tokens));
      } catch (error) {
        sendFirstPartyFailure(res, error);
      }
    },
  );

  router.post(
    '/auth/refresh',
    noStore,
    authLimiter,
    validate({ body: refreshRequestSchema }),
    async (req, res) => {
      const { body } = requestInput<{ body: typeof refreshRequestSchema }>(res);
      try {
        const session = await auth.refresh(body.refreshToken, req.get('User-Agent'), req.ip);
        res.set('Cache-Control', 'no-store').json(sessionBody(session.tokens));
      } catch (error) {
        sendFirstPartyFailure(res, error);
      }
    },
  );

  router.post('/auth/logout', noStore, async (req, res) => {
    const token = bearerToken(req.get('Authorization'));
    if (!token) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      sendError(res, 401, 'unauthenticated', 'Sign in to continue');
      return;
    }
    try {
      // Only the holder of a live token can end the session it belongs to; an unknown
      // or already revoked token is still a successful sign-out for the caller.
      await auth.logout(token);
      res.status(204).end();
    } catch (error) {
      sendFirstPartyFailure(res, error);
    }
  });

  router.post(
    '/auth/forgot-password',
    noStore,
    authLimiter,
    validate({ body: forgotPasswordRequestSchema }),
    async (_req, res) => {
      const { body } = requestInput<{ body: typeof forgotPasswordRequestSchema }>(res);
      try {
        await auth.requestPasswordReset(body.email);
        res.status(202).json(RESET_SENT);
      } catch (error) {
        sendFirstPartyFailure(res, error);
      }
    },
  );

  router.post(
    '/auth/reset-password',
    noStore,
    authLimiter,
    validate({ body: resetPasswordRequestSchema }),
    async (_req, res) => {
      const { body } = requestInput<{ body: typeof resetPasswordRequestSchema }>(res);
      try {
        await auth.resetPassword(body.email, body.code, body.password);
        res.status(204).end();
      } catch (error) {
        sendFirstPartyFailure(res, error);
      }
    },
  );

  /** Which social providers this deployment can actually offer, so the UI can hide the rest. */
  router.get('/auth/providers', noStore, (_req, res) => {
    res.json({ google: google !== undefined });
  });

  if (google) {
    // The browser is sent to Google with a signed state; the callback returns a session
    // in the same shape as password sign-in, so clients handle both identically.
    const oauth = google;

    /**
     * Redeems an authorization code. The same work serves the browser (Google redirects
     * here) and a server-side relay (a web app posts the code and state it received), so
     * the tokens can be turned into session cookies by the app that owns them.
     */
    async function completeGoogle(input: Record<string, unknown>, res: Response): Promise<void> {
      const { userId, returnTo } = await oauth.finish(input);
      const session = await auth.createSession(userId);
      res.set('Cache-Control', 'no-store').json({ ...sessionBody(session.tokens), returnTo });
    }

    router.get('/auth/google/start', noStore, authLimiter, async (req, res) => {
      try {
        const { url } = await oauth.start(safeReturnTo(req.query.returnTo));
        // The URL contains the state and PKCE challenge but no token: safe to hand back.
        res.json({ url });
      } catch (error) {
        sendFirstPartyFailure(res, error);
      }
    });

    router.get('/auth/google/callback', noStore, authLimiter, async (req, res) => {
      // A browser reaching this endpoint means no web app owns the callback: returning the
      // session as JSON would put tokens on screen. It only answers non-browser clients.
      if ((req.get('Accept') ?? '').includes('text/html')) {
        sendError(
          res,
          400,
          'oauth_unavailable',
          'Google sign-in must finish in the web app that stores the session',
        );
        return;
      }
      try {
        await completeGoogle(req.query, res);
      } catch (error) {
        sendFirstPartyFailure(res, error);
      }
    });

    // Server-to-server form used by a web app whose own callback route is the redirect
    // target: the code and state stay on the server, and the app turns the session into
    // its own HttpOnly cookies. Every check is identical to the browser path.
    router.post(
      '/auth/google/callback',
      noStore,
      authLimiter,
      validate({ body: googleCallbackSchema }),
      async (_req, res) => {
        const { body } = requestInput<{ body: typeof googleCallbackSchema }>(res);
        try {
          await completeGoogle(body, res);
        } catch (error) {
          sendFirstPartyFailure(res, error);
        }
      },
    );
  } else {
    // Fails closed with a stable code instead of redirecting somewhere half-configured.
    for (const path of ['/auth/google/start', '/auth/google/callback']) {
      router.all(path, noStore, (_req, res) => {
        const [status, code, message] = FAILURES.oauth_unavailable;
        sendError(res, status, code, message);
      });
    }
  }

  if (googleIdToken) {
    // Native apps: Google Identity Services hands the app an ID token, the API verifies it
    // (signature, issuer, audience, expiry, verified email) and answers a Nilzora session.
    const signIn = googleIdToken;
    router.post(
      '/auth/google/id-token',
      noStore,
      authLimiter,
      validate({ body: googleIdTokenSchema }),
      async (_req, res) => {
        const { body } = requestInput<{ body: typeof googleIdTokenSchema }>(res);
        try {
          const { userId } = await signIn.signIn(body.idToken);
          const session = await auth.createSession(userId);
          res.set('Cache-Control', 'no-store').json(sessionBody(session.tokens));
        } catch (error) {
          sendFirstPartyFailure(res, error);
        }
      },
    );
  } else {
    router.all('/auth/google/id-token', noStore, (_req, res) => {
      const [status, code, message] = FAILURES.oauth_unavailable;
      sendError(res, status, code, message);
    });
  }

  return router;
}
