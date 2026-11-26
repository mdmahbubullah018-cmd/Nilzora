import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { sendError } from '../http/send-error';
import { AdminRefusalError, sendAdminFailure } from '../modules/admin/errors';
import { OrderReadBackError, StoreUnavailableError } from '../modules/commerce/errors';
import { isServiceUnavailable } from './authenticate';

interface HttpError {
  status: number;
  type?: unknown;
}

/** Errors raised by Express and its body parser carry a 4xx `status` (and a `type`). */
function asClientError(error: unknown): HttpError | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined;
  const { status } = error;
  if (typeof status !== 'number' || status < 400 || status >= 500) return undefined;
  return { status, type: 'type' in error ? error.type : undefined };
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  sendError(res, 404, 'not_found', 'Route not found');
};

/**
 * Final error handler. Responses carry a stable code, a generic message and the
 * request id, never stack traces or internal messages. Unexpected errors are
 * logged server-side with the request id for correlation.
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const clientError = asClientError(error);
    if (clientError?.status === 400 && clientError.type === 'entity.parse.failed') {
      sendError(res, 400, 'invalid_json', 'The request body is not valid JSON');
    } else if (clientError?.status === 413) {
      sendError(res, 413, 'payload_too_large', 'The request body is too large');
    } else if (clientError?.status === 415) {
      sendError(res, 415, 'unsupported_media_type', 'The request content type is not supported');
    } else if (clientError) {
      sendError(res, clientError.status, 'bad_request', 'The request could not be processed');
    } else if (error instanceof AdminRefusalError) {
      // A refusal a route did not word itself (for example a permission withdrawn
      // between the API's check and the database's): its standard answer.
      sendAdminFailure(res, error);
    } else if (error instanceof StoreUnavailableError) {
      // The store's database could not be reached or answered unexpectedly: retryable.
      if (error instanceof OrderReadBackError) {
        /*
         * The write committed and only its read-back failed. Saying "unavailable" alone
         * would leave the customer wondering whether the order exists, so an order that was
         * just placed is named in the answer: the caller owns it, and a client can open its
         * receipt instead of placing the order again. A retry with the same idempotency key
         * would also replay it, but naming it is faster and cannot be misread as a failure.
         *
         * A cancellation keeps the plain "unavailable" answer: the order is already on the
         * customer's screen, so a refresh is all that is needed.
         */
        (req.log ?? logger).warn(
          { err: error, operation: error.operation, orderNumber: error.orderNumber },
          'Order change committed but could not be read back',
        );
        if (error.operation === 'place_cod_order') {
          sendError(
            res,
            503,
            'order_confirmation_pending',
            'Your order was placed, but it could not be loaded just now.',
            { orderNumber: error.orderNumber },
          );
          return;
        }
      } else {
        (req.log ?? logger).warn({ err: error }, 'Store database unavailable');
      }
      sendError(
        res,
        503,
        'service_unavailable',
        'The store is temporarily unavailable. Try again.',
      );
    } else if (isServiceUnavailable(error)) {
      // Supabase Auth or the database could not be reached: retryable, and nothing was granted.
      (req.log ?? logger).warn({ err: error }, 'Identity service unavailable');
      sendError(
        res,
        503,
        'auth_unavailable',
        'This service is temporarily unavailable. Try again.',
      );
    } else {
      // pino-http attaches a request-scoped logger; fall back if it is not mounted.
      (req.log ?? logger).error({ err: error }, 'Unhandled API error');
      sendError(res, 500, 'internal_error', 'Something went wrong');
    }
  };
}
