import { REQUEST_ID_HEADER } from '@nilzora/contracts';
import type { RequestHandler } from 'express';
import { sendError } from '../http/send-error';

const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE';
const ALLOWED_HEADERS = `Authorization, Content-Type, Idempotency-Key, ${REQUEST_ID_HEADER}`;
const EXPOSED_HEADERS = `${REQUEST_ID_HEADER}, RateLimit, RateLimit-Policy, Retry-After`;
const PREFLIGHT_MAX_AGE_SECONDS = '600';

/**
 * CORS with an exact origin allowlist from validated configuration. Credentials
 * are not enabled because the web apps authenticate with an Authorization header,
 * not cookies; a wildcard origin is never sent.
 *
 * CORS only decides which browser origins may read responses. It is not
 * authentication: protected routes still verify the caller on every request.
 */
export function cors(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);

  return (req, res, next) => {
    res.vary('Origin');
    const origin = req.get('Origin');
    const isAllowed = origin !== undefined && allowed.has(origin);

    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);
    }

    const isPreflight =
      req.method === 'OPTIONS' &&
      origin !== undefined &&
      req.get('Access-Control-Request-Method') !== undefined;
    if (!isPreflight) {
      next();
      return;
    }

    res.vary('Access-Control-Request-Method');
    res.vary('Access-Control-Request-Headers');
    if (!isAllowed) {
      sendError(res, 403, 'origin_not_allowed', 'This origin is not allowed to call the API');
      return;
    }
    res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
    res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    res.setHeader('Access-Control-Max-Age', PREFLIGHT_MAX_AGE_SECONDS);
    res.status(204).end();
  };
}
