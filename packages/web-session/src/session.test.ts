import { ApiError, type ApiClient } from '@nilzora/api-client';
import { describe, expect, it, vi } from 'vitest';
import { readSession, readWithAccessToken } from './session';
import { meResponse, stubApi } from './testing/fixtures';

describe('readSession', () => {
  it.each([undefined, ''])(
    'is signed out without calling the API when the token is %j',
    async (token) => {
      const api = stubApi();

      await expect(readSession(api, token)).resolves.toStrictEqual({ status: 'signed_out' });
      await expect(readSession(api, token, '')).resolves.toStrictEqual({ status: 'signed_out' });
      expect(api.getMe).not.toHaveBeenCalled();
    },
  );

  it('is unavailable, not signed out, when only a refresh token remains', async () => {
    // The proxy kept it because the API could not decide the refresh.
    const api = stubApi();

    await expect(readSession(api, undefined, 'refresh-token')).resolves.toStrictEqual({
      status: 'unavailable',
    });
    expect(api.getMe).not.toHaveBeenCalled();
  });

  it('is signed in with the API-verified user', async () => {
    const api = stubApi();
    const me = meResponse('staff', ['admin_workspace.access', 'orders.read']);
    api.getMe.mockResolvedValue(me);

    await expect(readSession(api, 'access-token')).resolves.toStrictEqual({
      status: 'signed_in',
      user: me.user,
    });
    expect(api.getMe).toHaveBeenCalledExactlyOnceWith('access-token');
  });

  it.each([
    ['an expired or revoked token', new ApiError(401, 'invalid_token', 'Invalid token')],
    ['an unknown 401 code', new ApiError(401, 'unauthorized', 'Unauthorized')],
    ['a deleted account', new ApiError(403, 'account_unavailable', 'Unavailable')],
  ])('is signed out for %s', async (_, error) => {
    const api = stubApi();
    api.getMe.mockRejectedValue(error);

    await expect(readSession(api, 'access-token')).resolves.toStrictEqual({
      status: 'signed_out',
    });
  });

  it('is suspended for a suspended account', async () => {
    const api = stubApi();
    api.getMe.mockRejectedValue(new ApiError(403, 'account_suspended', 'Suspended'));

    await expect(readSession(api, 'access-token')).resolves.toStrictEqual({
      status: 'suspended',
    });
  });

  it.each([
    ['a network failure', new ApiError(0, 'network_error', 'Could not reach the API')],
    ['a timeout', new ApiError(0, 'timeout', 'Timed out')],
    ['a server error', new ApiError(500, 'internal_error', 'Boom')],
    ['an outage', new ApiError(503, 'auth_unavailable', 'Down')],
    ['rate limiting', new ApiError(429, 'rate_limited', 'Slow down')],
    ['a broken contract', new ApiError(200, 'invalid_response', 'Unexpected')],
    ['an unexpected error', new Error('boom')],
  ])('is unavailable after %s', async (_, error) => {
    const api = stubApi();
    api.getMe.mockRejectedValue(error);

    await expect(readSession(api, 'access-token')).resolves.toStrictEqual({
      status: 'unavailable',
    });
  });
});

describe('readWithAccessToken', () => {
  const tokens = { accessToken: 'access-token', refreshToken: 'refresh-token' };

  it('passes the client and the access token to the call', async () => {
    const api = stubApi();
    const me = meResponse();
    api.getMe.mockResolvedValue(me);
    const call = vi.fn((client: ApiClient, token: string) => client.getMe(token));

    await expect(readWithAccessToken(api, tokens, call)).resolves.toStrictEqual({
      kind: 'ok',
      value: me,
    });
    expect(call).toHaveBeenCalledExactlyOnceWith(api, 'access-token');
    expect(api.getMe).toHaveBeenCalledExactlyOnceWith('access-token');
  });

  it.each([
    ['there are no session cookies', {}],
    ['the proxy cleared the session cookies (empty values)', { accessToken: '', refreshToken: '' }],
  ])('is signed out without calling the API when %s', async (_, cookieTokens) => {
    const api = stubApi();
    const call = vi.fn(() => Promise.resolve('never'));

    await expect(readWithAccessToken(api, cookieTokens, call)).resolves.toStrictEqual({
      kind: 'signed_out',
    });
    expect(call).not.toHaveBeenCalled();
  });

  it.each([undefined, ''])(
    'is unavailable, not signed out, when only a refresh token remains (access token %j)',
    async (accessToken) => {
      // The proxy kept it because the API could not decide the refresh. Pages never refresh.
      const api = stubApi();
      const call = vi.fn(() => Promise.resolve('never'));

      await expect(
        readWithAccessToken(api, { accessToken, refreshToken: 'refresh-token' }, call),
      ).resolves.toStrictEqual({ kind: 'unavailable' });
      expect(call).not.toHaveBeenCalled();
      expect(api.refresh).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['an expired or revoked token', new ApiError(401, 'invalid_token', 'Invalid token')],
    ['an unknown 401 code', new ApiError(401, 'unauthorized', 'Unauthorized')],
  ])('is signed out after %s, without refreshing', async (_, error) => {
    const api = stubApi();
    const call = vi.fn(() => Promise.reject(error));

    await expect(readWithAccessToken(api, tokens, call)).resolves.toStrictEqual({
      kind: 'signed_out',
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it.each([
    ['a network failure', new ApiError(0, 'network_error', 'Could not reach the API')],
    ['a timeout', new ApiError(0, 'timeout', 'Timed out')],
    ['a server error', new ApiError(500, 'internal_error', 'Boom')],
    ['a gateway error', new ApiError(502, 'http_error', 'Bad gateway')],
    ['an outage', new ApiError(503, 'service_unavailable', 'Down')],
  ])('is unavailable after %s', async (_, error) => {
    const api = stubApi();

    await expect(
      readWithAccessToken(api, tokens, () => Promise.reject(error)),
    ).resolves.toStrictEqual({ kind: 'unavailable' });
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing resource', new ApiError(404, 'not_found', 'Not found')],
    ['a validation failure', new ApiError(400, 'validation_failed', 'Invalid')],
    ['a suspended account', new ApiError(403, 'account_suspended', 'Suspended')],
    ['a business rule', new ApiError(409, 'order_not_cancellable', 'Not cancellable')],
    ['rate limiting', new ApiError(429, 'rate_limited', 'Slow down')],
    ['a broken contract', new ApiError(200, 'invalid_response', 'Unexpected')],
    ['an unexpected error', new Error('boom')],
    ['a request the client refused to send', new ApiError(0, 'invalid_request', 'Bad path')],
  ])('rethrows %s for the page to map', async (_, error) => {
    const api = stubApi();

    await expect(readWithAccessToken(api, tokens, () => Promise.reject(error))).rejects.toBe(error);
    expect(api.refresh).not.toHaveBeenCalled();
  });
});
