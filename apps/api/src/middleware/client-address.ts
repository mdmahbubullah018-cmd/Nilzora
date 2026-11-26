import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { TRUSTED_CLIENT_IP_HEADER, TRUSTED_CLIENT_SECRET_HEADER } from '@nilzora/contracts';
import type { RequestHandler } from 'express';
import type { Logger } from 'pino';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Chooses the address used for per-client rate limits (`res.locals.clientIp`).
 *
 * The Nilzora web servers call the API for many browsers from one address. When a
 * request presents the shared secret, the browser address it names is used instead.
 * Anything else (no secret configured, a missing or wrong secret, or an invalid
 * address) falls back to `req.ip`. The secret header is removed once checked so
 * nothing later in the pipeline can log or forward it.
 *
 * The secret is the API's API_CLIENT_SECRET (the canonical name), which the web servers
 * send as their API_CLIENT_SECRET. A secret presented but not verified usually means the
 * two differ, which quietly puts every browser behind one rate limit. That is logged once
 * per process, without the value.
 */
export function clientAddress(
  trustedSecret: string | undefined,
  logger?: Pick<Logger, 'warn'>,
): RequestHandler {
  const expected = trustedSecret === undefined ? undefined : digest(trustedSecret);
  let warned = false;

  return (req, res, next) => {
    const presented = req.get(TRUSTED_CLIENT_SECRET_HEADER);
    const named = req.get(TRUSTED_CLIENT_IP_HEADER)?.trim();
    delete req.headers[TRUSTED_CLIENT_SECRET_HEADER.toLowerCase()];
    delete req.headers[TRUSTED_CLIENT_IP_HEADER.toLowerCase()];

    // Comparing fixed-length digests keeps the check constant-time for any input length.
    const trusted =
      expected !== undefined &&
      presented !== undefined &&
      timingSafeEqual(digest(presented), expected);

    if (presented !== undefined && !trusted && !warned) {
      warned = true;
      logger?.warn(
        "A request presented the trusted client secret header, but it did not match TRUSTED_CLIENT_SECRET (unset, or different from the web servers' TRUSTED_CLIENT_SECRET). Rate limits use the connection address. Logged once.",
      );
    }
    res.locals.clientIp = trusted && named !== undefined && isIP(named) !== 0 ? named : req.ip;
    next();
  };
}
