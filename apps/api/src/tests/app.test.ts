import { apiErrorBodySchema, healthResponseSchema } from '@nilzora/contracts';
import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { captureLogs, testApp } from './helpers';

describe('GET /api/v1/health', () => {
  it('reports liveness using the shared contract', async () => {
    const response = await request(testApp()).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(healthResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('names the database target so a wrong stack is visible', async () => {
    const response = await request(
      testApp({ env: { DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' } }),
    ).get('/api/v1/health');

    expect(healthResponseSchema.parse(response.body).database).toStrictEqual({
      target: 'local',
      connection: 'local',
      projectRef: null,
    });
  });

  it('leaks no host, credential or key', async () => {
    const response = await request(
      testApp({ env: { DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' } }),
    ).get('/api/v1/health');
    const body = JSON.stringify(response.body);

    for (const forbidden of [
      '127.0.0.1',
      'localhost',
      'supabase.co',
      'postgresql://',
      'postgres@',
      'test-secret-key-not-real',
      'test-publishable-key-not-real',
      'password',
      'sslmode',
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });
});

describe('unknown routes', () => {
  it('return the standard 404 error envelope', async () => {
    const response = await request(testApp()).get('/api/v1/does-not-exist');

    expect(response.status).toBe(404);
    expect(apiErrorBodySchema.parse(response.body).error).toMatchObject({
      code: 'not_found',
      message: 'Route not found',
    });
  });
});

describe('error handling', () => {
  const failing = Router()
    .get('/sync-failure', () => {
      throw new Error('database password=hunter2 at 10.0.0.5');
    })
    .get('/async-failure', async () => {
      await Promise.resolve();
      throw new Error('upstream token=abc123 rejected');
    })
    .get('/client-failure', () => {
      throw Object.assign(new Error('bad'), { status: 400 });
    })
    .get('/items/:id', (_req, res) => {
      res.sendStatus(204);
    });

  it.each(['/api/v1/sync-failure', '/api/v1/async-failure'])(
    'hides internal details of unexpected errors from %s',
    async (path) => {
      const logs = captureLogs('error');
      const response = await request(testApp({ logger: logs.logger, modules: [failing] })).get(
        path,
      );

      expect(response.status).toBe(500);
      expect(response.body).toStrictEqual({
        error: {
          code: 'internal_error',
          message: 'Something went wrong',
          requestId: response.headers['x-request-id'],
        },
      });
      expect(response.text).not.toMatch(/hunter2|abc123|password|token|at \w/);
      // The full error is still available server-side for investigation.
      expect(logs.raw()).toContain('Unhandled API error');
    },
  );

  it('maps client errors raised by Express to a 4xx response', async () => {
    const response = await request(testApp({ modules: [failing] })).get('/api/v1/client-failure');

    expect(response.status).toBe(400);
    expect(apiErrorBodySchema.parse(response.body).error.code).toBe('bad_request');
  });

  it('rejects malformed URL encoding without a server error', async () => {
    const response = await request(testApp({ modules: [failing] })).get('/api/v1/items/%E0%A4%A');

    expect(response.status).toBe(400);
    expect(apiErrorBodySchema.parse(response.body).error.code).toBe('bad_request');
  });
});
