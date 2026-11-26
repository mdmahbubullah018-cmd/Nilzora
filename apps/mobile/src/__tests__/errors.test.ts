import { ApiError } from '@nilzora/api-client';
import { SessionEndedError } from '../auth/session-manager';
import {
  ApiNotConfiguredError,
  describeApiError,
  isSessionEnded,
  isTransientError,
} from '../lib/errors';

const api = (status: number, code: string) =>
  new ApiError(status, code, 'raw API text: stack at x');

describe('describeApiError', () => {
  it.each([
    ['network_error', 0],
    ['timeout', 0],
    ['rate_limited', 429],
    ['service_unavailable', 503],
    ['auth_unavailable', 503],
    ['internal_error', 500],
  ])('says %s can be retried', (code, status) => {
    expect(describeApiError(api(status, code)).retryable).toBe(true);
  });

  it('explains a lost connection and a timeout in different words', () => {
    expect(describeApiError(api(0, 'network_error'))).toMatchObject({
      title: 'Nilzora could not be reached',
    });
    expect(describeApiError(api(0, 'timeout'))).toMatchObject({
      title: 'This is taking too long',
    });
  });

  it.each([
    ['unauthenticated', 401],
    ['invalid_refresh_token', 401],
  ])('treats %s as an ended session', (code, status) => {
    expect(describeApiError(api(status, code))).toEqual({
      title: 'Your session has ended',
      message: 'Please sign in again to continue.',
      retryable: false,
    });
  });

  it('treats a session-ended error from the session manager the same way', () => {
    expect(describeApiError(new SessionEndedError())).toMatchObject({
      title: 'Your session has ended',
      retryable: false,
    });
  });

  it.each([
    ['validation_failed', 400],
    ['bad_request', 400],
    ['not_found', 404],
    ['forbidden', 403],
    ['account_suspended', 403],
    ['account_unavailable', 403],
    ['cart_invalid', 400],
    ['product_unavailable', 409],
    ['insufficient_stock', 409],
    ['quantity_limit_exceeded', 409],
    ['delivery_unavailable', 409],
    ['price_changed', 409],
    ['idempotency_conflict', 409],
    ['too_many_pending_orders', 409],
    ['order_not_cancellable', 409],
    ['address_not_found', 400],
    ['address_limit_reached', 409],
  ])('does not offer a retry for %s', (code, status) => {
    expect(describeApiError(api(status, code)).retryable).toBe(false);
  });

  it('describes not found and validation failures', () => {
    expect(describeApiError(api(404, 'not_found')).title).toBe('Not found');
    expect(describeApiError(api(400, 'validation_failed')).title).toBe('Check your details');
  });

  it('falls back on the HTTP status for codes it does not know', () => {
    expect(describeApiError(api(404, 'something_new'))).toMatchObject({
      title: 'Not found',
      retryable: false,
    });
    expect(describeApiError(api(429, 'something_new')).retryable).toBe(true);
    expect(describeApiError(api(502, 'http_error'))).toMatchObject({
      title: 'Something went wrong on our side',
      retryable: true,
    });
    expect(describeApiError(api(409, 'something_new')).retryable).toBe(false);
    expect(describeApiError(api(401, 'something_new')).title).toBe('Your session has ended');
  });

  it('never repeats the API text or internals', () => {
    for (const status of [0, 400, 401, 403, 404, 409, 429, 500, 503]) {
      const { title, message } = describeApiError(api(status, 'whatever_code'));
      expect(`${title} ${message}`).not.toMatch(/raw API text|stack/);
    }
  });

  it('describes a build without an API address and unexpected errors', () => {
    expect(describeApiError(new ApiNotConfiguredError())).toMatchObject({
      title: 'Nilzora is not set up',
      retryable: false,
    });
    expect(describeApiError(new TypeError('x is undefined'))).toMatchObject({
      title: 'Something went wrong',
      retryable: true,
    });
    expect(describeApiError('boom')).toMatchObject({ title: 'Something went wrong' });
    expect(describeApiError(api(200, 'invalid_response')).title).toBe('Something went wrong');
  });
});

describe('isSessionEnded', () => {
  it('is true for the session manager error and any 401', () => {
    expect(isSessionEnded(new SessionEndedError())).toBe(true);
    expect(isSessionEnded(api(401, 'unauthenticated'))).toBe(true);
  });

  it('is false for everything else', () => {
    expect(isSessionEnded(api(403, 'forbidden'))).toBe(false);
    expect(isSessionEnded(api(0, 'network_error'))).toBe(false);
    expect(isSessionEnded(new Error('x'))).toBe(false);
    expect(isSessionEnded(undefined)).toBe(false);
  });
});

describe('isTransientError', () => {
  it('is true for connection failures and server errors only', () => {
    expect(isTransientError(api(0, 'network_error'))).toBe(true);
    expect(isTransientError(api(0, 'timeout'))).toBe(true);
    expect(isTransientError(api(500, 'internal_error'))).toBe(true);
    expect(isTransientError(api(503, 'service_unavailable'))).toBe(true);
  });

  it('is false for client errors, local refusals and anything unexpected', () => {
    expect(isTransientError(api(0, 'invalid_request'))).toBe(false);
    expect(isTransientError(api(400, 'validation_failed'))).toBe(false);
    expect(isTransientError(api(404, 'not_found'))).toBe(false);
    expect(isTransientError(api(429, 'rate_limited'))).toBe(false);
    expect(isTransientError(api(200, 'invalid_response'))).toBe(false);
    expect(isTransientError(new SessionEndedError())).toBe(false);
    expect(isTransientError(new Error('x'))).toBe(false);
  });
});
