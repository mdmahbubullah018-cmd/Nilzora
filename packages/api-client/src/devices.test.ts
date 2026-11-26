import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './client';

const TOKEN = 'fcm:APA91bHexample-token_value.with~allowed+chars/and=padding';
const ACCESS = 'access-token-1';
const DEVICE = 'de000000-0000-4000-8000-000000000001';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(response: Response) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  const client = createApiClient({ baseUrl: 'http://localhost:4000', fetch: fetchMock });
  const sent = () => {
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    return {
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : init?.body,
    };
  };
  return { client, sent };
}

describe('registerDevice', () => {
  it('posts the token, platform and version with the bearer token, and returns only the id', async () => {
    const { client, sent } = setup(jsonResponse({ device: { id: DEVICE } }));

    await expect(
      client.registerDevice(ACCESS, { token: TOKEN, platform: 'android', appVersion: '1.0.0' }),
    ).resolves.toStrictEqual({ device: { id: DEVICE } });
    const request = sent();
    expect(request).toMatchObject({
      url: 'http://localhost:4000/api/v1/me/devices',
      method: 'POST',
      body: { token: TOKEN, platform: 'android', appVersion: '1.0.0' },
    });
    expect(request.headers.get('Authorization')).toBe(`Bearer ${ACCESS}`);
    expect(request.headers.get('Content-Type')).toBe('application/json');
  });

  it('refuses an answer outside the contract', async () => {
    const { client } = setup(jsonResponse({ device: { id: 'not-a-uuid' } }));

    await expect(
      client.registerDevice(ACCESS, { token: TOKEN, platform: 'android' }),
    ).rejects.toMatchObject({ name: 'ApiError', code: 'invalid_response' });
  });

  it.each([
    [401, 'unauthenticated'],
    [403, 'account_suspended'],
    [400, 'validation_failed'],
  ])('raises the API error for %i', async (status, code) => {
    const { client } = setup(
      jsonResponse({ error: { code, message: 'Refused', requestId: 'req-12345678' } }, status),
    );

    const failure = await client
      .registerDevice(ACCESS, { token: TOKEN, platform: 'android' })
      .catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status, code, requestId: 'req-12345678' });
  });
});

describe('unregisterDevice', () => {
  it('posts the token to the removal route and resolves on 204', async () => {
    const { client, sent } = setup(new Response(null, { status: 204 }));

    await expect(client.unregisterDevice(ACCESS, { token: TOKEN })).resolves.toBeUndefined();
    const request = sent();
    expect(request).toMatchObject({
      url: 'http://localhost:4000/api/v1/me/devices/remove',
      method: 'POST',
      body: { token: TOKEN },
    });
    expect(request.headers.get('Authorization')).toBe(`Bearer ${ACCESS}`);
  });

  it('raises the API error when signed out, and refuses a body where none was expected', async () => {
    const signedOut = setup(
      jsonResponse({ error: { code: 'unauthenticated', message: 'Sign in' } }, 401),
    );
    const unexpected = setup(jsonResponse({ removed: true }));

    await expect(signedOut.client.unregisterDevice(ACCESS, { token: TOKEN })).rejects.toMatchObject(
      {
        status: 401,
        code: 'unauthenticated',
      },
    );
    await expect(
      unexpected.client.unregisterDevice(ACCESS, { token: TOKEN }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
