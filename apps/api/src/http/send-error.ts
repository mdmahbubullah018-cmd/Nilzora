import type { ApiErrorBody, ApiErrorCode } from '@nilzora/contracts';
import type { Response } from 'express';

/** Sends the standard error envelope, tagged with the request's correlation id. */
export function sendError(
  res: Response,
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): void {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      ...(res.locals.requestId === undefined ? {} : { requestId: res.locals.requestId }),
      ...(details === undefined ? {} : { details }),
    },
  };
  res.status(status).json(body);
}
