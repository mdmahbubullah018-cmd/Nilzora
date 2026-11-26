import type { MeResponse } from '@nilzora/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './client';

const session = {
  accessToken: 'access-token-1',
  refreshToken: 'refresh-token-1',
  tokenType: 'bearer',
  expiresIn: 3600,
  expiresAt: 1_792_000_000,
};

const me: MeResponse = {
  user: {
    id: '0f6b8f8e-6a43-4f5e-9d7e-2b1f3c4d5e6f',
    email: 'rahima@example.com',
    role: 'customer',
    permissions: [],
    profile: {
      fullName: 'Rahima Khatun',
      avatar: null,
      googleAvatar: null,
      phone: '+8801712345678',
      status: 'active',
      createdAt: '2026-10-23T10:00:00.000Z',
      updatedAt: '2026-10-23T10:00:00.000Z',
    },
  },
};

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

describe('auth calls', () => {
  it('registers with a JSON body and no credentials', async () => {
    const accepted = { status: 'accepted', message: 'Check your inbox.' };
    const { client, sent } = setup(jsonResponse(accepted, 202));

    await expect(
      client.register({ email: 'rahima@example.com', password: 'shopping2026' }),
    ).resolves.toStrictEqual(accepted);
    expect(sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/auth/register',
      method: 'POST',
      body: { email: 'rahima@example.com', password: 'shopping2026' },
    });
    expect(sent().headers.get('Content-Type')).toBe('application/json');
    expect(sent().headers.has('Authorization')).toBe(false);
  });

  it('logs in and returns the validated session', async () => {
    const { client, sent } = setup(jsonResponse(session));

    await expect(
      client.login({ email: 'rahima@example.com', password: 'shopping2026' }),
    ).resolves.toStrictEqual(session);
    expect(sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/auth/login',
      method: 'POST',
    });
  });

  it('refreshes with the refresh token in the body, never in the URL', async () => {
    const { client, sent } = setup(jsonResponse({ ...session, refreshToken: 'refresh-token-2' }));

    const rotated = await client.refresh('refresh-token-1');
    expect(rotated.refreshToken).toBe('refresh-token-2');
    expect(sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/auth/refresh',
      method: 'POST',
      body: { refreshToken: 'refresh-token-1' },
    });
  });

  it('confirms an email with the token hash in the body and an empty 204 response', async () => {
    const { client, sent } = setup(new Response(null, { status: 204 }));

    await expect(client.confirmEmail('confirmation-hash-0001')).resolves.toBeUndefined();
    expect(sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/auth/confirm-email',
      method: 'POST',
      body: { tokenHash: 'confirmation-hash-0001' },
    });
  });

  it('sends the access token as a bearer header for account calls', async () => {
    const { client, sent } = setup(jsonResponse(me));

    await expect(client.getMe('access-token-1')).resolves.toStrictEqual(me);
    expect(sent()).toMatchObject({ url: 'http://localhost:4000/api/v1/me', method: 'GET' });
    expect(sent().headers.get('Authorization')).toBe('Bearer access-token-1');
  });

  it('updates the profile with PATCH, a bearer header and a JSON body', async () => {
    const { client, sent } = setup(jsonResponse(me));

    await client.updateMe('access-token-1', { fullName: 'Rahima Khatun' });
    expect(sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/me',
      method: 'PATCH',
      body: { fullName: 'Rahima Khatun' },
    });
    expect(sent().headers.get('Authorization')).toBe('Bearer access-token-1');
    expect(sent().headers.get('Content-Type')).toBe('application/json');
  });

  it('logs out with an empty 204 response', async () => {
    const { client, sent } = setup(new Response(null, { status: 204 }));

    await expect(client.logout('access-token-1')).resolves.toBeUndefined();
    expect(sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/auth/logout',
      method: 'POST',
    });
    expect(sent().headers.get('Authorization')).toBe('Bearer access-token-1');
  });

  it('surfaces auth failures as ApiError with the API code', async () => {
    const { client } = setup(
      jsonResponse(
        { error: { code: 'unauthenticated', message: 'Sign in again.', requestId: 'req-7' } },
        401,
      ),
    );

    const error = await client.getMe('expired').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'unauthenticated', requestId: 'req-7' });
  });

  it('rejects a session response that breaks the contract', async () => {
    const { client } = setup(jsonResponse({ accessToken: 'only-half' }));

    await expect(client.refresh('refresh-token-1')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('passes caller cancellation to auth calls', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(session));
    const client = createApiClient({ baseUrl: 'http://localhost:4000', fetch: fetchMock });
    const controller = new AbortController();
    controller.abort();

    await client.login({ email: 'a@example.com', password: 'x' }, { signal: controller.signal });
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});

describe('google sign-in calls', () => {
  it('asks for the authorization URL with the return path in the query', async () => {
    const { client, sent } = setup(
      jsonResponse({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=s' }),
    );

    const result = await client.googleStart('/account');

    expect(result.url).toContain('accounts.google.com');
    expect(sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/auth/google/start?returnTo=%2Faccount',
      method: 'GET',
    });
    expect(sent().headers.has('Authorization')).toBe(false);
  });

  it('omits the return path when there is none', async () => {
    const { client, sent } = setup(jsonResponse({ url: 'https://accounts.google.com/x' }));

    await client.googleStart('');

    expect(sent().url).toBe('http://localhost:4000/api/v1/auth/google/start');
  });

  it('relays the code and state in a POST body and returns the session', async () => {
    const { client, sent } = setup(jsonResponse({ ...session, returnTo: '/checkout' }));

    const result = await client.completeGoogle({ code: 'auth-code', state: 'signed.state' });

    expect(result.accessToken).toBe(session.accessToken);
    expect(result.returnTo).toBe('/checkout');
    expect(sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/auth/google/callback',
      method: 'POST',
      body: { code: 'auth-code', state: 'signed.state' },
    });
    expect(sent().headers.has('Authorization')).toBe(false);
  });

  it('surfaces a refused callback as an ApiError with its stable code', async () => {
    const { client } = setup(
      jsonResponse({ error: { code: 'invalid_credentials', message: 'nope' } }, 401),
    );

    await expect(
      client.completeGoogle({ code: 'used-code', state: 'signed.state' }),
    ).rejects.toMatchObject({ code: 'invalid_credentials', status: 401 });
  });
});

describe('native Google sign-in', () => {
  it('posts the ID token and returns the first-party session', async () => {
    const { client, sent } = setup(jsonResponse(session));

    const result = await client.completeGoogleIdToken({ idToken: 'header.claims.signature' });

    expect(result.accessToken).toBe(session.accessToken);
    expect(sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/auth/google/id-token',
      method: 'POST',
      body: { idToken: 'header.claims.signature' },
    });
    expect(sent().headers.has('Authorization')).toBe(false);
  });

  it('surfaces a refused token with its stable code', async () => {
    const { client } = setup(
      jsonResponse({ error: { code: 'invalid_credentials', message: 'nope' } }, 401),
    );

    await expect(client.completeGoogleIdToken({ idToken: 'forged' })).rejects.toMatchObject({
      code: 'invalid_credentials',
      status: 401,
    });
  });
});
