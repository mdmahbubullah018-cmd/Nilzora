import { randomUUID } from 'node:crypto';
import { REQUEST_ID_HEADER } from '@nilzora/contracts';
import type { RequestHandler } from 'express';

/**
 * Incoming ids are reused only if they are 8–128 characters of letters, digits,
 * `.`, `_`, `:` or `-`. Anything else (spaces, newlines, control characters,
 * multiple values) is replaced, so client input cannot forge or break log lines.
 */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get(REQUEST_ID_HEADER);
  const id = incoming !== undefined && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
};
