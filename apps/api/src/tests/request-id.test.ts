import { apiErrorBodySchema } from '@nilzora/contracts';
import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { captureLogs, testApp } from './helpers';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('request ids', () => {
  it('generates an id when the client sends none', async () => {
    const response = await request(testApp()).get('/api/v1/health');

    expect(response.headers['x-request-id']).toMatch(UUID);
  });

  it('gives every request its own id', async () => {
    const app = testApp();
    const first = await request(app).get('/api/v1/health');
    const second = await request(app).get('/api/v1/health');

    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });

  it('reuses a well-formed incoming id', async () => {
    const id = 'edge-7f3a.trace:01-abc_DEF';
    const response = await request(testApp()).get('/api/v1/health').set('X-Request-Id', id);

    expect(response.headers['x-request-id']).toBe(id);
  });

  it.each([
    ['too short', 'abc123'],
    ['too long', 'a'.repeat(129)],
    ['contains spaces', 'abc def ghi jkl'],
    ['contains markup', '<script>alert(1)</script>'],
    ['contains a log-forging quote', 'abcdefgh","level":60'],
  ])('replaces an id that is %s', async (_, id) => {
    const response = await request(testApp()).get('/api/v1/health').set('X-Request-Id', id);

    expect(response.headers['x-request-id']).toMatch(UUID);
  });

  it('replaces ids sent in more than one header (Node joins them with ", ")', async () => {
    const response = await request(testApp())
      .get('/api/v1/health')
      .set('X-Request-Id', 'aaaaaaaa-1, bbbbbbbb-2');

    expect(response.headers['x-request-id']).toMatch(UUID);
  });

  it('includes the id in error bodies', async () => {
    const response = await request(testApp())
      .get('/api/v1/does-not-exist')
      .set('X-Request-Id', 'client-req-0001');

    expect(response.status).toBe(404);
    expect(apiErrorBodySchema.parse(response.body).error.requestId).toBe('client-req-0001');
  });

  it('tags request logs and server-error logs with the same id', async () => {
    const logs = captureLogs();
    const failing = Router().get('/explode', () => {
      throw new Error('boom');
    });
    const response = await request(testApp({ logger: logs.logger, modules: [failing] }))
      .get('/api/v1/explode')
      .set('X-Request-Id', 'trace-err-0001');

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ error: { requestId: 'trace-err-0001' } });
    const tagged = logs
      .entries()
      .filter((entry) => (entry.req as { id?: string } | undefined)?.id === 'trace-err-0001');
    expect(tagged.map((entry) => entry.msg)).toEqual(
      expect.arrayContaining(['Unhandled API error', 'request errored']),
    );
  });
});
