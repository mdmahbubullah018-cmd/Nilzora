import type { Permission } from '@nilzora/contracts';
import type { RequestHandler, Response } from 'express';
import type { RequestIdentity } from '../auth/identity';
import { sendError } from '../http/send-error';

/** Mounts after authenticate(); without an identity the request is refused (fail closed). */
function guard(allows: (identity: RequestIdentity) => boolean): RequestHandler {
  return (_req, res, next) => {
    const identity = res.locals.identity;
    if (!identity) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      sendError(res, 401, 'unauthenticated', 'Sign in to continue');
      return;
    }
    if (!allows(identity)) {
      sendError(res, 403, 'forbidden', 'You do not have permission to do this');
      return;
    }
    next();
  };
}

/**
 * Allows the request only if the authenticated caller holds every one of
 * `permissions` (their effective permissions, read from the database by
 * authenticate()). The database functions behind the route check them again.
 */
export function requirePermission(
  permission: Permission,
  ...more: readonly Permission[]
): RequestHandler {
  const required = [permission, ...more];
  return guard((identity) => required.every((name) => identity.permissions.has(name)));
}

/** Allows the request if the authenticated caller holds at least one of `permissions`. */
export function requireAnyPermission(permissions: readonly Permission[]): RequestHandler {
  return guard((identity) => permissions.some((name) => identity.permissions.has(name)));
}

/** The verified caller. Throws (a 500) if a route forgot to mount authenticate(). */
export function currentIdentity(res: Response): RequestIdentity {
  const identity = res.locals.identity;
  if (!identity) throw new Error('Route reached without an authenticated identity');
  return identity;
}
