import type { RequestHandler } from 'express';
import type { TwoFactorState } from '../auth/two-factor';
import { sendError } from '../http/send-error';
import { AuthGatewayError, type AuthGateway } from '../modules/auth/gateway';
import { AccountStoreUnavailableError, type AccountStore } from '../modules/users/accounts';

export interface AuthDependencies {
  gateway: AuthGateway;
  accounts: AccountStore;
  /**
   * First-party sessions (opaque tokens). When present, a token that resolves here is
   * accepted before Supabase Auth is consulted; anything else falls back to the
   * gateway, so both providers work during the migration.
   */
  sessions?: SessionResolver | undefined;
  /** The database is reached directly, so RLS-scoped reads no longer need the token. */
  direct?: boolean | undefined;
  /**
   * Two-factor enforcement for the roles that require it (super_admin). Present only when
   * TWO_FACTOR_ENCRYPTION_KEY is configured (always in production: the API refuses to start
   * without it). When present, such an account's session is refused everywhere until it has
   * passed 2FA, except the few routes that opt in with `allowPendingTwoFactor`.
   */
  twoFactor?: TwoFactorGate | undefined;
  /** The route serves a session that has not passed 2FA yet (the 2FA routes, /me, sign-out). */
  allowPendingTwoFactor?: boolean | undefined;
}

/** Roles whose sessions must pass 2FA; mirrors private.two_factor_required in the database. */
export const TWO_FACTOR_ROLES: ReadonlySet<string> = new Set(['super_admin']);

export interface TwoFactorGate {
  state(userId: string, sessionId: string): Promise<TwoFactorState>;
}

export interface TwoFactorSummary {
  required: boolean;
  enrolled: boolean;
  verified: boolean;
}

/**
 * Whether this account's session must still pass 2FA. A session that cannot pass it at all (a
 * Supabase JWT, which has no first-party session to mark) counts as not verified. A failure to
 * read the state propagates (the caller answers 503): it never counts as verified.
 */
export async function twoFactorVerdict(
  gate: TwoFactorGate | undefined,
  userId: string,
  role: string,
  sessionId: string | null,
): Promise<TwoFactorSummary | undefined> {
  if (!gate || !TWO_FACTOR_ROLES.has(role)) return undefined;
  if (!sessionId) return { required: true, enrolled: false, verified: false };
  const state = await gate.state(userId, sessionId);
  if (!state.required) return undefined;
  return { required: true, enrolled: state.enrolled, verified: state.verified };
}

export interface SessionResolver {
  resolve(
    token: string,
  ): Promise<{ userId: string; sessionId: string; email?: string | null } | null>;
}

/** RFC 6750 bearer credentials; anything else is treated as no credentials. */
const BEARER = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/i;
const MAX_AUTHORIZATION_LENGTH = 8192;

export function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined || header.length > MAX_AUTHORIZATION_LENGTH) return undefined;
  return BEARER.exec(header)?.[1];
}

export function isServiceUnavailable(error: unknown): boolean {
  return (
    error instanceof AccountStoreUnavailableError ||
    (error instanceof AuthGatewayError && error.failure === 'unavailable')
  );
}

/**
 * Establishes who is calling, failing closed at every step:
 *   1. a well-formed bearer token must be present                 → else 401
 *   2. a first-party session must resolve, or Supabase must accept
 *      the token (valid, unexpired, session still active)         → else 401
 *   3. the account must have a role and profile in the database   → else 403
 *   4. the account must be active                                 → else 403
 * The role and the effective permissions (role defaults plus per-account grants and
 * denials) come from the database on every request, read as the user (my_access),
 * never from token claims, user metadata or anything in the request. A permission
 * change or suspension therefore applies to the account's very next request.
 */
/**
 * Establishes who is calling when credentials are present, and lets a request without
 * them continue anonymously. An invalid or suspended account is still refused, so a stale
 * token can never silently downgrade a customer to guest content (or the reverse).
 *
 * Used only by reads that answer differently to a guest and to a customer, such as the
 * public onboarding campaign. Everything that requires an account keeps using
 * `authenticate`, which fails closed.
 */
export function optionalAuthenticate(deps: AuthDependencies): RequestHandler {
  const required = authenticate(deps);
  return (req, res, next) => {
    if (bearerToken(req.get('Authorization')) === undefined) {
      next();
      return;
    }
    void required(req, res, next);
  };
}

export function authenticate({
  gateway,
  accounts,
  sessions,
  twoFactor,
  allowPendingTwoFactor = false,
}: AuthDependencies): RequestHandler {
  return async (req, res, next) => {
    const token = bearerToken(req.get('Authorization'));
    if (!token) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      sendError(res, 401, 'unauthenticated', 'Sign in to continue');
      return;
    }

    try {
      // A first-party session wins; otherwise the Supabase gateway is still consulted.
      const session = sessions ? await sessions.resolve(token) : null;
      let userId: string;
      let email: string | null = null;
      let sessionId: string | null = null;

      if (session) {
        userId = session.userId;
        email = session.email ?? null;
        sessionId = session.sessionId;
      } else {
        const user = await gateway.verifyAccessToken(token);
        if (!user) {
          res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
          sendError(res, 401, 'unauthenticated', 'Your session is invalid or has expired');
          return;
        }
        userId = user.id;
        email = user.email;
      }

      const access = await accounts.loadAccess(token, userId);
      if (!access) {
        sendError(res, 403, 'account_unavailable', 'This account cannot be used right now');
        return;
      }
      if (access.status !== 'active') {
        sendError(res, 403, 'account_suspended', 'This account is suspended');
        return;
      }

      let twoFactorSummary: TwoFactorSummary | undefined;
      try {
        twoFactorSummary = await twoFactorVerdict(twoFactor, userId, access.role, sessionId);
      } catch {
        // Fail closed: an unreadable 2FA state never lets a privileged session through.
        sendError(res, 503, 'auth_unavailable', 'Sign-in is temporarily unavailable. Try again.');
        return;
      }
      if (twoFactorSummary && !twoFactorSummary.verified && !allowPendingTwoFactor) {
        sendError(
          res,
          403,
          'two_factor_required',
          twoFactorSummary.enrolled
            ? 'Enter the code from your authenticator app to continue.'
            : 'Set up two-factor authentication to continue.',
          { enrolled: twoFactorSummary.enrolled },
        );
        return;
      }

      res.locals.identity = {
        userId,
        email,
        role: access.role,
        permissions: access.permissions,
        accessToken: token,
        sessionId,
        ...(twoFactorSummary ? { twoFactor: twoFactorSummary } : {}),
      };
      next();
    } catch (error) {
      if (!isServiceUnavailable(error)) throw error;
      sendError(res, 503, 'auth_unavailable', 'Sign-in is temporarily unavailable. Try again.');
    }
  };
}
