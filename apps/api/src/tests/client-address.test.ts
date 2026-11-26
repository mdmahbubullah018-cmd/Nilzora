import { TRUSTED_CLIENT_IP_HEADER, TRUSTED_CLIENT_SECRET_HEADER } from '@nilzora/contracts';
import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { captureLogs, testApp } from './helpers';

const SECRET = 'web-client-secret-for-tests-0000000000';

/** Test-only module: reports what later middleware can still see of the trusted headers. */
function echoModule(): Router {
  const router = Router();
  router.get('/probe/client', (req, res) => {
    res.json({
      clientIp: res.locals.clientIp,
      secretHeader: req.get(TRUSTED_CLIENT_SECRET_HEADER) ?? null,
      ipHeader: req.get(TRUSTED_CLIENT_IP_HEADER) ?? null,
    });
  });
  return router;
}

function setup(env: Record<string, string> = {}) {
  return testApp({ env: { RATE_LIMIT_MAX: '2', ...env }, modules: [echoModule()] });
}

const probe = (app: ReturnType<typeof setup>, headers: Record<string, string> = {}) =>
  request(app).get('/api/v1/probe/client').set(headers);

describe('trusted web client address', () => {
  it('uses the browser address named by a web server holding the secret', async () => {
    const app = setup({ TRUSTED_CLIENT_SECRET: SECRET });
    const response = await probe(app, {
      [TRUSTED_CLIENT_SECRET_HEADER]: SECRET,
      [TRUSTED_CLIENT_IP_HEADER]: '203.0.113.7',
    });

    expect(response.body).toStrictEqual({
      clientIp: '203.0.113.7',
      secretHeader: null,
      ipHeader: null,
    });
  });

  it('accepts the same secret under the canonical API_CLIENT_SECRET name', async () => {
    const app = setup({ API_CLIENT_SECRET: SECRET });
    const response = await probe(app, {
      [TRUSTED_CLIENT_SECRET_HEADER]: SECRET,
      [TRUSTED_CLIENT_IP_HEADER]: '203.0.113.9',
    });

    const body = response.body as { clientIp: string | undefined };
    expect(body.clientIp).toBe('203.0.113.9');
  });

  it('trusts only the canonical name when both names are set to different values', async () => {
    const app = setup({ API_CLIENT_SECRET: SECRET, TRUSTED_CLIENT_SECRET: `${SECRET}-older` });

    const canonical = await probe(app, {
      [TRUSTED_CLIENT_SECRET_HEADER]: SECRET,
      [TRUSTED_CLIENT_IP_HEADER]: '203.0.113.9',
    });
    const older = await probe(app, {
      [TRUSTED_CLIENT_SECRET_HEADER]: `${SECRET}-older`,
      [TRUSTED_CLIENT_IP_HEADER]: '203.0.113.10',
    });

    const canonicalBody = canonical.body as { clientIp: string | undefined };
    const olderBody = older.body as { clientIp: string | undefined };
    expect(canonicalBody.clientIp).toBe('203.0.113.9');
    // Not trusted: the connection address is used instead of the claimed one.
    expect(olderBody.clientIp).not.toBe('203.0.113.10');
  });

  it('limits each named browser separately', async () => {
    const app = setup({ TRUSTED_CLIENT_SECRET: SECRET });
    const as = (ip: string) =>
      probe(app, { [TRUSTED_CLIENT_SECRET_HEADER]: SECRET, [TRUSTED_CLIENT_IP_HEADER]: ip });

    expect((await as('203.0.113.7')).status).toBe(200);
    expect((await as('203.0.113.7')).status).toBe(200);
    expect((await as('203.0.113.7')).status).toBe(429);
    expect((await as('198.51.100.20')).status).toBe(200);
  });

  it.each<[string, Record<string, string>, Record<string, string>]>([
    ['no secret is configured', {}, { [TRUSTED_CLIENT_SECRET_HEADER]: SECRET }],
    [
      'the secret is wrong',
      { TRUSTED_CLIENT_SECRET: SECRET },
      { [TRUSTED_CLIENT_SECRET_HEADER]: `${SECRET}x` },
    ],
    ['the secret is missing', { TRUSTED_CLIENT_SECRET: SECRET }, {}],
  ])('ignores the named address when %s', async (_label, env, secretHeader) => {
    const app = setup(env);
    const spoof = (ip: string) => probe(app, { ...secretHeader, [TRUSTED_CLIENT_IP_HEADER]: ip });

    const first = await spoof('203.0.113.7');
    expect(first.body).toMatchObject({ secretHeader: null, ipHeader: null });
    expect(first.body).not.toMatchObject({ clientIp: '203.0.113.7' });
    // Rotating the claimed address does not escape the caller's own limit.
    expect((await spoof('203.0.113.8')).status).toBe(200);
    expect((await spoof('203.0.113.9')).status).toBe(429);
  });

  it('logs a secret that does not verify once, without its value', async () => {
    const logs = captureLogs('warn');
    const app = testApp({
      env: { TRUSTED_CLIENT_SECRET: SECRET },
      modules: [echoModule()],
      logger: logs.logger,
    });
    const wrong = `${SECRET}-mismatch`;

    await probe(app, { [TRUSTED_CLIENT_SECRET_HEADER]: wrong });
    await probe(app, { [TRUSTED_CLIENT_SECRET_HEADER]: wrong });

    const warnings = logs
      .entries()
      .filter((entry) => /TRUSTED_CLIENT_SECRET/.test(String(entry.msg)));
    expect(warnings).toHaveLength(1);
    expect(logs.raw()).not.toContain(wrong);
    expect(logs.raw()).not.toContain(SECRET);
  });

  it('logs nothing when the secret verifies or is not presented', async () => {
    const logs = captureLogs('warn');
    const app = testApp({
      env: { TRUSTED_CLIENT_SECRET: SECRET },
      modules: [echoModule()],
      logger: logs.logger,
    });

    await probe(app, { [TRUSTED_CLIENT_SECRET_HEADER]: SECRET });
    await probe(app);

    expect(logs.entries()).toStrictEqual([]);
  });

  it.each(['not-an-ip', '203.0.113.7, 10.0.0.1', ' '])(
    'falls back to the connection address for %j',
    async (value) => {
      const app = setup({ TRUSTED_CLIENT_SECRET: SECRET });
      const response = await probe(app, {
        [TRUSTED_CLIENT_SECRET_HEADER]: SECRET,
        [TRUSTED_CLIENT_IP_HEADER]: value,
      });

      expect(response.status).toBe(200);
      expect(response.body).not.toMatchObject({ clientIp: value });
      expect(response.body).not.toMatchObject({ clientIp: value.trim() });
    },
  );
});
