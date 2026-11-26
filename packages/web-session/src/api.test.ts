import { TRUSTED_CLIENT_IP_HEADER, TRUSTED_CLIENT_SECRET_HEADER } from '@nilzora/contracts';
import { describe, expect, it, vi } from 'vitest';
import { apiClientFor } from './api';
import { TEST_API_CLIENT_SECRET, meResponse } from './testing/fixtures';

const BROWSER_HEADERS = {
  authorization: 'Bearer token-chosen-by-the-browser',
  cookie: 'nzs_at=cookie-access-token; nzs_rt=cookie-refresh-token',
  'x-forwarded-for': '198.51.100.7, 203.0.113.9',
  [TRUSTED_CLIENT_SECRET_HEADER]: 'secret-chosen-by-the-browser',
  [TRUSTED_CLIENT_IP_HEADER]: '9.9.9.9',
  'user-agent': 'Browser/1.0',
  origin: 'http://localhost:3000',
};

function config(apiClientSecret: string | undefined, trustProxyHops = 0) {
  return { apiUrl: 'http://api.nilzora.test', apiClientSecret, trustProxyHops };
}

function recordingFetch() {
  return vi.fn<typeof fetch>().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(meResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

function sentHeaders(fetchMock: ReturnType<typeof recordingFetch>, call = 0): Headers {
  return new Headers(fetchMock.mock.calls[call]?.[1]?.headers);
}

describe('apiClientFor', () => {
  it('sends the client secret and the browser address when both are known', async () => {
    const fetchMock = recordingFetch();
    const api = apiClientFor(
      config(TEST_API_CLIENT_SECRET),
      new Headers(BROWSER_HEADERS),
      fetchMock,
    );

    await api.getMe('access-token-from-cookie');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://api.nilzora.test/api/v1/me');
    const headers = sentHeaders(fetchMock);
    expect(headers.get(TRUSTED_CLIENT_SECRET_HEADER)).toBe(TEST_API_CLIENT_SECRET);
    expect(headers.get(TRUSTED_CLIENT_IP_HEADER)).toBe('203.0.113.9');
    expect(headers.get('authorization')).toBe('Bearer access-token-from-cookie');
  });

  it('uses the trusted proxy hop count to pick the address', async () => {
    const fetchMock = recordingFetch();
    const api = apiClientFor(
      config(TEST_API_CLIENT_SECRET, 2),
      new Headers(BROWSER_HEADERS),
      fetchMock,
    );

    await api.getMe('token');

    expect(sentHeaders(fetchMock).get(TRUSTED_CLIENT_IP_HEADER)).toBe('198.51.100.7');
  });

  it('sends neither header without a configured secret', async () => {
    const fetchMock = recordingFetch();
    const api = apiClientFor(config(undefined), new Headers(BROWSER_HEADERS), fetchMock);

    await api.getMe('token');

    const headers = sentHeaders(fetchMock);
    expect(headers.has(TRUSTED_CLIENT_SECRET_HEADER)).toBe(false);
    expect(headers.has(TRUSTED_CLIENT_IP_HEADER)).toBe(false);
  });

  it.each([
    ['missing', {}],
    ['invalid', { 'x-forwarded-for': 'unknown' }],
  ])('sends neither header when the browser address is %s', async (_, incoming) => {
    const fetchMock = recordingFetch();
    const api = apiClientFor(config(TEST_API_CLIENT_SECRET), new Headers(incoming), fetchMock);

    await api.getMe('token');

    const headers = sentHeaders(fetchMock);
    expect(headers.has(TRUSTED_CLIENT_SECRET_HEADER)).toBe(false);
    expect(headers.has(TRUSTED_CLIENT_IP_HEADER)).toBe(false);
  });

  it.each([TEST_API_CLIENT_SECRET, undefined])(
    'never forwards browser headers (secret configured: %s)',
    async (secret) => {
      const fetchMock = recordingFetch();
      const api = apiClientFor(config(secret), new Headers(BROWSER_HEADERS), fetchMock);

      await api.getMe('token-passed-to-the-method');
      await api.register({ email: 'new@example.com', password: 'Secret123' }).catch(() => {
        // The recording fetch answers with a profile, which register rejects; only the
        // outgoing request matters here.
      });

      for (const call of [0, 1]) {
        const headers = sentHeaders(fetchMock, call);
        expect(headers.has('cookie')).toBe(false);
        expect(headers.has('x-forwarded-for')).toBe(false);
        expect(headers.has('user-agent')).toBe(false);
        expect(headers.has('origin')).toBe(false);
        expect(headers.get(TRUSTED_CLIENT_SECRET_HEADER)).not.toBe('secret-chosen-by-the-browser');
        expect(headers.get(TRUSTED_CLIENT_IP_HEADER)).not.toBe('9.9.9.9');
      }
      expect(sentHeaders(fetchMock, 0).get('authorization')).toBe(
        'Bearer token-passed-to-the-method',
      );
      // A call without a token carries no Authorization header at all.
      expect(sentHeaders(fetchMock, 1).has('authorization')).toBe(false);
    },
  );
});
