import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { REDACTED } from '../logging/logger';
import { captureLogs, testApp } from './helpers';

describe('logger redaction', () => {
  it('redacts secret-bearing fields at several depths', () => {
    const logs = captureLogs();
    logs.logger.info(
      {
        password: 'pw-top-level',
        token: 'tok-top-level',
        user: { email: 'visible@example.com', accessToken: 'tok-nested', apiKey: 'key-nested' },
        integration: { credentials: { clientSecret: 'secret-deep', privateKey: 'pk-deep' } },
        headers: { authorization: 'Bearer header-token', cookie: 'sid=cookie-value' },
        req: { headers: { authorization: 'Bearer req-token', 'x-api-key': 'x-api-key-value' } },
        res: { headers: { 'set-cookie': 'session=set-cookie-value' } },
        note: 'safe to log',
      },
      'redaction check',
    );

    const raw = logs.raw();
    for (const secret of [
      'pw-top-level',
      'tok-top-level',
      'tok-nested',
      'key-nested',
      'secret-deep',
      'pk-deep',
      'header-token',
      'cookie-value',
      'req-token',
      'x-api-key-value',
      'set-cookie-value',
    ]) {
      expect(raw).not.toContain(secret);
    }
    expect(raw).toContain(REDACTED);
    expect(raw).toContain('safe to log');
    expect(raw).toContain('visible@example.com');
  });
});

describe('request logging', () => {
  it('records method, path, status and timing but no headers, cookies, query or body', async () => {
    const logs = captureLogs();
    const echo = Router().post('/echo', (_req, res) => {
      res.status(204).end();
    });

    await request(testApp({ logger: logs.logger, modules: [echo] }))
      .post('/api/v1/echo?token=query-secret&email=someone@example.com')
      .set('Authorization', 'Bearer header-secret')
      .set('Cookie', 'sb-session=cookie-secret')
      .send({ password: 'body-secret', phone: '01712345678' });

    const raw = logs.raw();
    for (const value of [
      'query-secret',
      'someone@example.com',
      'header-secret',
      'cookie-secret',
      'body-secret',
      '01712345678',
      '127.0.0.1',
    ]) {
      expect(raw).not.toContain(value);
    }

    const completed = logs.entries().find((entry) => entry.msg === 'request completed');
    expect(completed).toMatchObject({
      level: 30,
      service: 'nilzora-api',
      req: { method: 'POST', path: '/api/v1/echo' },
      res: { statusCode: 204 },
    });
    expect(typeof completed?.responseTime).toBe('number');
  });

  it('logs client errors as warnings and server errors as errors', async () => {
    const logs = captureLogs();
    const failing = Router().get('/explode', () => {
      throw new Error('boom');
    });
    const app = testApp({ logger: logs.logger, modules: [failing] });

    await request(app).get('/api/v1/missing');
    await request(app).get('/api/v1/explode');

    // pino-http logs finished requests as "request completed", and 5xx ones as "request errored".
    const levels = logs
      .entries()
      .filter((entry) => entry.msg === 'request completed' || entry.msg === 'request errored')
      .map((entry) => [entry.msg, (entry.res as { statusCode: number }).statusCode, entry.level]);
    expect(levels).toEqual([
      ['request completed', 404, 40],
      ['request errored', 500, 50],
    ]);
  });
});
