import type { RequestHandler } from 'express';
import helmet from 'helmet';

/**
 * Helmet with its defaults unchanged: a strict Content-Security-Policy (the API
 * serves JSON, never HTML or scripts), HSTS, nosniff, frame denial, no referrer
 * and cross-origin isolation headers. Browser access for the web apps is granted
 * by the CORS middleware, not by relaxing any of these.
 */
export function securityHeaders(): RequestHandler {
  return helmet();
}
