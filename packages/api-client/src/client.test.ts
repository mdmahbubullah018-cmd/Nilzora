import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './client';

const health = {
  status: 'ok',
  service: 'nilzora-api',
  uptimeSeconds: 12,
  timestamp: '2026-10-22T10:00:00.000Z',
  database: { target: 'local', connection: 'local', projectRef: null },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A fetch that never settles until its signal aborts. */
function hangingFetch(): typeof fetch {
  return (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    });
}

describe('createApiClient', () => {
  it('calls the versioned health endpoint and validates the response', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(health));
    const client = createApiClient({ baseUrl: 'http://localhost:4000/', fetch: fetchMock });

    await expect(client.getHealth()).resolves.toStrictEqual(health);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:4000/api/v1/health');
    expect(new Headers(init?.headers).get('Accept')).toBe('application/json');
  });

  it('turns the API error envelope into an ApiError', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: 'service_unavailable', message: 'Down', requestId: 'req-1' } },
          503,
        ),
      );
    const client = createApiClient({ baseUrl: 'http://localhost:4000', fetch: fetchMock });

    const error = await client.getHealth().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503, code: 'service_unavailable', requestId: 'req-1' });
  });

  it('reports non-JSON failures with a generic http_error', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }));
    const client = createApiClient({ baseUrl: 'http://localhost:4000', fetch: fetchMock });

    await expect(client.getHealth()).rejects.toMatchObject({ status: 502, code: 'http_error' });
  });

  it('rejects responses that break the contract', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: 'ok' }));
    const client = createApiClient({ baseUrl: 'http://localhost:4000', fetch: fetchMock });

    await expect(client.getHealth()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('times out slow requests', async () => {
    const client = createApiClient({
      baseUrl: 'http://localhost:4000',
      fetch: hangingFetch(),
      timeoutMs: 20,
    });

    await expect(client.getHealth()).rejects.toMatchObject({ code: 'timeout' });
  });

  it('passes caller cancellation through unchanged', async () => {
    const client = createApiClient({ baseUrl: 'http://localhost:4000', fetch: hangingFetch() });
    const controller = new AbortController();

    const pending = client.getHealth({ signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reports network failures', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    const client = createApiClient({ baseUrl: 'http://localhost:4000', fetch: fetchMock });

    await expect(client.getHealth()).rejects.toMatchObject({ code: 'network_error' });
  });
});
