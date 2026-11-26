import { randomUUID } from 'node:crypto';
import { REQUEST_ID_HEADER } from '@nilzora/contracts';
import type { RequestHandler } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';

/**
 * One structured line per request, tagged with the correlation id. Only the
 * method, path (without the query string), status and timing are recorded: no
 * headers, cookies, bodies or client IP addresses.
 */
export function httpLogger(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    // Reuse the id chosen by the requestId middleware.
    genReqId: (_req, res) => {
      const id = res.getHeader(REQUEST_ID_HEADER);
      return typeof id === 'string' ? id : randomUUID();
    },
    customLogLevel: (_req, res, error) => {
      if (error !== undefined || res.statusCode >= 500) return 'error';
      return res.statusCode >= 400 ? 'warn' : 'info';
    },
    serializers: {
      req: (req: { id: unknown; method: string; url: string }) => ({
        id: req.id,
        method: req.method,
        path: req.url.split('?')[0],
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
  });
}
