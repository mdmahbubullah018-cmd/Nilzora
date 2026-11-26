import { readinessResponseSchema } from '@nilzora/contracts';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from '../cache';
import { createRateLimiter } from '../middleware/rate-limit';
import { healthRouter, type ReadinessProbes } from '../modules/health/routes';

/*
 * GET /health/ready decides whether an instance receives traffic, and the shared rate-limit
 * store is what lets several instances enforce one limit. Both must fail in the safe direction:
 * readiness reports a dead database as not ready (and never leaks why), and a Redis outage
 * neither stops the API nor switches rate limiting off.
 */

const TARGET = { mode: 'local', connection: 'local', projectRef: null } as const;

function readinessApp(probes: ReadinessProbes, timeoutMs = 50) {
  const app = express();
  app.use(healthRouter(TARGET, probes, timeoutMs));
  return app;
}

describe('GET /health/ready', () => {
  it('is ready when the database answers, and says Redis is skipped when it is not configured', async () => {
    const response = await request(readinessApp({ database: () => Promise.resolve(true) })).get(
      '/health/ready',
    );
    expect(response.status).toBe(200);
    const body = readinessResponseSchema.parse(response.body);
    expect(body.status).toBe('ready');
    expect(body.checks.database.status).toBe('ok');
    expect(body.checks.redis).toEqual({ status: 'skipped', latencyMs: null });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('answers 503 when the database fails, without the error text', async () => {
    const response = await request(
      readinessApp({
        database: () => Promise.reject(new Error('connect ECONNREFUSED db.internal.example:5432')),
      }),
    ).get('/health/ready');
    expect(response.status).toBe(503);
    expect(readinessResponseSchema.parse(response.body).status).toBe('not_ready');
    expect(JSON.stringify(response.body)).not.toContain('db.internal');
    expect(JSON.stringify(response.body)).not.toContain('ECONNREFUSED');
  });

  it('counts a database that never answers as failed instead of hanging', async () => {
    const response = await request(
      readinessApp({ database: () => new Promise<boolean>(() => undefined) }, 30),
    ).get('/health/ready');
    expect(response.status).toBe(503);
    expect(readinessResponseSchema.parse(response.body).checks.database.status).toBe('failed');
  });

  it('stays in service, degraded, when only Redis is down', async () => {
    const response = await request(
      readinessApp({ database: () => Promise.resolve(true), redis: () => Promise.resolve(false) }),
    ).get('/health/ready');
    expect(response.status).toBe(200);
    expect(readinessResponseSchema.parse(response.body).status).toBe('degraded');
  });
});

/** A Redis-shaped counter: INCR per key, and an outage switch. */
function counters() {
  const counts = new Map<string, number>();
  const state = { down: false };
  const store: KeyValueStore = {
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(),
    del: (keys) => {
      for (const key of keys) counts.delete(key);
      return Promise.resolve(keys.length);
    },
    increment: (key) => {
      if (state.down) return Promise.reject(new Error('redis down'));
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return Promise.resolve(next);
    },
    ping: () => Promise.resolve(!state.down),
    close: () => Promise.resolve(),
  };
  return { store, counts, state };
}

/** One "API instance": its own Express app and its own limiter, sharing only the store. */
function instance(store: KeyValueStore, name = 'auth', limit = 2) {
  const app = express();
  app.use(createRateLimiter({ windowMs: 60_000, limit, store, name }));
  app.get('/ping', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('shared rate-limit counters', () => {
  it('enforce one limit across two API instances', async () => {
    const { store } = counters();
    const first = instance(store);
    const second = instance(store);

    expect((await request(first).get('/ping')).status).toBe(200);
    expect((await request(second).get('/ping')).status).toBe(200);
    // The third request in the window is refused, whichever instance it reaches.
    const refused = await request(first).get('/ping');
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ error: { code: 'rate_limited' } });
  });

  it('keep each limiter in its own namespace', async () => {
    const { store, counts } = counters();
    await request(instance(store, 'auth')).get('/ping');
    await request(instance(store, 'orders')).get('/ping');
    const keys = [...counts.keys()];
    expect(keys.some((key) => key.startsWith('nilzora:v1:ratelimit:auth:'))).toBe(true);
    expect(keys.some((key) => key.startsWith('nilzora:v1:ratelimit:orders:'))).toBe(true);
  });

  it('fall back to this process during a Redis outage: still serving, still limiting', async () => {
    const { store, state } = counters();
    state.down = true;
    const app = instance(store);
    expect((await request(app).get('/ping')).status).toBe(200);
    expect((await request(app).get('/ping')).status).toBe(200);
    expect((await request(app).get('/ping')).status).toBe(429);
  });
});
