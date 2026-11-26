import { ApiError } from '@nilzora/api-client';
import type { AuthSession } from '@nilzora/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  accessTokenExpiry,
  accessTokenNeedsRefresh,
  REFRESH_MARGIN_SECONDS,
  refreshSessionOnce,
  resetRefreshFlights,
} from './refresh';
import { authSession, deferred, fakeAccessToken, stubApi } from './testing/fixtures';

beforeEach(() => {
  resetRefreshFlights();
});

describe('refreshSessionOnce', () => {
  it('shares one API call between concurrent requests with the same token', async () => {
    const api = stubApi();
    const pending = deferred<AuthSession>();
    api.refresh.mockReturnValue(pending.promise);

    const first = refreshSessionOnce(api, 'refresh-1');
    const second = refreshSessionOnce(api, 'refresh-1');
    const session = authSession({ refreshToken: 'refresh-2' });
    pending.resolve(session);

    const outcomes = await Promise.all([first, second]);
    expect(api.refresh).toHaveBeenCalledExactlyOnceWith('refresh-1');
    expect(outcomes).toStrictEqual([
      { kind: 'refreshed', session },
      { kind: 'refreshed', session },
    ]);
  });

  it('refreshes different tokens separately', async () => {
    const api = stubApi();
    api.refresh.mockImplementation((token) =>
      Promise.resolve(authSession({ refreshToken: `${token}-next` })),
    );

    const [a, b] = await Promise.all([
      refreshSessionOnce(api, 'refresh-a'),
      refreshSessionOnce(api, 'refresh-b'),
    ]);

    expect(api.refresh).toHaveBeenCalledTimes(2);
    expect(a).toMatchObject({ kind: 'refreshed', session: { refreshToken: 'refresh-a-next' } });
    expect(b).toMatchObject({ kind: 'refreshed', session: { refreshToken: 'refresh-b-next' } });
  });

  it.each([
    ['refreshed', () => Promise.resolve(authSession())],
    ['rejected', () => Promise.reject(new ApiError(401, 'invalid_refresh_token', 'Spent'))],
  ] as const)(
    'reuses a %s outcome within the reuse window, then forgets it',
    async (kind, answer) => {
      const api = stubApi();
      api.refresh.mockImplementation(answer);
      let clock = 1_000_000;
      const now = () => clock;

      const first = await refreshSessionOnce(api, 'refresh-1', now);
      expect(first.kind).toBe(kind);

      clock += 5_000;
      await expect(refreshSessionOnce(api, 'refresh-1', now)).resolves.toBe(first);
      expect(api.refresh).toHaveBeenCalledTimes(1);

      clock += 1;
      const later = await refreshSessionOnce(api, 'refresh-1', now);
      expect(later).not.toBe(first);
      expect(later.kind).toBe(kind);
      expect(api.refresh).toHaveBeenCalledTimes(2);
    },
  );

  it('does not remember an unavailable outcome, so the next request retries', async () => {
    const api = stubApi();
    api.refresh
      .mockRejectedValueOnce(new ApiError(503, 'auth_unavailable', 'Down'))
      .mockResolvedValueOnce(authSession());

    await expect(refreshSessionOnce(api, 'refresh-1')).resolves.toStrictEqual({
      kind: 'unavailable',
    });
    await expect(refreshSessionOnce(api, 'refresh-1')).resolves.toMatchObject({
      kind: 'refreshed',
    });
    expect(api.refresh).toHaveBeenCalledTimes(2);
  });

  it('shares an unavailable outcome between requests that were already waiting', async () => {
    const api = stubApi();
    const pending = deferred<AuthSession>();
    api.refresh.mockReturnValue(pending.promise);

    const both = Promise.all([refreshSessionOnce(api, 'r'), refreshSessionOnce(api, 'r')]);
    pending.reject(new ApiError(0, 'network_error', 'Offline'));

    await expect(both).resolves.toStrictEqual([{ kind: 'unavailable' }, { kind: 'unavailable' }]);
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, 'validation_failed'],
    [401, 'invalid_refresh_token'],
    [403, 'account_suspended'],
    [403, 'account_unavailable'],
  ])('treats %i %s as the end of the session', async (status, code) => {
    const api = stubApi();
    api.refresh.mockRejectedValue(new ApiError(status, code, 'Refused'));

    await expect(refreshSessionOnce(api, 'refresh-1')).resolves.toStrictEqual({
      kind: 'rejected',
    });
  });

  it.each([
    ['rate limiting', new ApiError(429, 'rate_limited', 'Slow down')],
    ['a server error', new ApiError(500, 'internal_error', 'Boom')],
    ['a bad gateway', new ApiError(502, 'http_error', 'Bad gateway')],
    ['an outage', new ApiError(503, 'auth_unavailable', 'Down')],
    ['a network failure', new ApiError(0, 'network_error', 'Offline')],
    ['a timeout', new ApiError(0, 'timeout', 'Timed out')],
    ['a broken contract', new ApiError(200, 'invalid_response', 'Unexpected')],
    ['a non-API error', new TypeError('fetch failed')],
  ])('treats %s as undecided', async (_, error) => {
    const api = stubApi();
    api.refresh.mockRejectedValue(error);

    await expect(refreshSessionOnce(api, 'refresh-1')).resolves.toStrictEqual({
      kind: 'unavailable',
    });
  });

  it('forgets everything on resetRefreshFlights', async () => {
    const api = stubApi();
    api.refresh.mockImplementation(() => Promise.resolve(authSession()));

    await refreshSessionOnce(api, 'refresh-1');
    resetRefreshFlights();
    await refreshSessionOnce(api, 'refresh-1');

    expect(api.refresh).toHaveBeenCalledTimes(2);
  });
});

describe('accessTokenExpiry', () => {
  it('reads the exp claim without verifying the signature', () => {
    expect(accessTokenExpiry(fakeAccessToken({ sub: 'u', exp: 1_900_000_000 }))).toBe(
      1_900_000_000,
    );
  });

  it.each([
    ['an empty string', ''],
    ['a single segment', 'not-a-jwt'],
    ['an empty payload', 'header..signature'],
    ['a payload that is not JSON', 'header.%%%garbage%%%.signature'],
    ['a payload without exp', fakeAccessToken({ sub: 'u' })],
    ['a string exp', fakeAccessToken({ exp: '1900000000' })],
    ['a null exp', fakeAccessToken({ exp: null })],
    ['a JSON null payload', `h.${Buffer.from('null').toString('base64url')}.s`],
    ['a JSON array payload', `h.${Buffer.from('[1900000000]').toString('base64url')}.s`],
  ])('returns undefined for %s', (_, token) => {
    expect(accessTokenExpiry(token)).toBeUndefined();
  });
});

describe('accessTokenNeedsRefresh', () => {
  const nowSeconds = 1_800_000_000;
  const nowMs = nowSeconds * 1000;

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['garbage', 'garbage'],
    ['without exp', fakeAccessToken({ sub: 'u' })],
    ['expired', fakeAccessToken({ exp: nowSeconds - 10 })],
    ['expiring now', fakeAccessToken({ exp: nowSeconds })],
    ['expiring within the margin', fakeAccessToken({ exp: nowSeconds + 30 })],
    [
      'expiring exactly at the margin',
      fakeAccessToken({ exp: nowSeconds + REFRESH_MARGIN_SECONDS }),
    ],
  ])('is true for a token that is %s', (_, token) => {
    expect(accessTokenNeedsRefresh(token, nowMs)).toBe(true);
  });

  it.each([
    ['just outside the margin', nowSeconds + REFRESH_MARGIN_SECONDS + 1],
    ['fresh', nowSeconds + 3600],
  ])('is false for a token that is %s', (_, exp) => {
    expect(accessTokenNeedsRefresh(fakeAccessToken({ exp }), nowMs)).toBe(false);
  });

  it('refreshes 60 seconds ahead of expiry', () => {
    expect(REFRESH_MARGIN_SECONDS).toBe(60);
  });
});
