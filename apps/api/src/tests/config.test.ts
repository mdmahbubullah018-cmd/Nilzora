import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../config/env';
import { TEST_SUPABASE_ENV } from './helpers';

function configError(env: Record<string, string>): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('Expected loadConfig to throw a ConfigError');
}

/** Valid settings for every required variable, so each test can break just one. */
const BASE = { ...TEST_SUPABASE_ENV };
const PRODUCTION = {
  ...BASE,
  NODE_ENV: 'production',
  SUPABASE_URL: 'https://project.supabase.example',
  CORS_ORIGINS: 'https://nilzora.example',
  TRUSTED_CLIENT_SECRET: 'production-web-client-secret-placeholder-00',
  ADMIN_APP_ORIGIN: 'https://admin.nilzora.example',
};

describe('loadConfig', () => {
  it('keeps the API running when REDIS_URL is not a Redis URL, and warns instead', () => {
    // An optional cache must never be able to stop the shop: the value is ignored.
    const config = loadConfig({
      ...BASE,
      NODE_ENV: 'development',
      REDIS_URL: 'http://localhost:6379',
    });

    expect(config.redisUrl).toBeUndefined();
    expect(config.incompleteIntegrations.some((entry) => entry.startsWith('Redis cache'))).toBe(
      true,
    );
  });

  it('keeps the API running when Redis credentials are in a query string', () => {
    const config = loadConfig({
      ...BASE,
      NODE_ENV: 'development',
      REDIS_URL: 'redis://host:6379/0?password=x',
    });

    expect(config.redisUrl).toBeUndefined();
    expect(
      config.incompleteIntegrations.some((entry) => entry.includes('credentials in query')),
    ).toBe(true);
  });

  it('accepts a valid Redis URL and passes it through untouched', () => {
    const config = loadConfig({
      ...BASE,
      NODE_ENV: 'development',
      REDIS_URL: 'redis://127.0.0.1:6379/0',
    });

    expect(config.redisUrl).toBe('redis://127.0.0.1:6379/0');
  });

  it('provides safe local defaults outside production', () => {
    expect(loadConfig({ ...BASE, NODE_ENV: 'development' })).toStrictEqual({
      nodeEnv: 'development',
      port: 4000,
      logLevel: 'debug',
      corsOrigins: ['http://localhost:3000', 'http://localhost:3001'],
      trustProxyHops: 0,
      rateLimit: { windowMs: 60_000, limit: 300 },
      authRateLimit: { windowMs: 900_000, limit: 20 },
      orderRateLimit: { windowMs: 600_000, limit: 30 },
      adminRateLimit: { windowMs: 60_000, limit: 120 },
      chatRateLimit: { windowMs: 60_000, limit: 60 },
      chatUploadRateLimit: {
        windowMs: 60_000,
        total: 12,
        image: 8,
        document: 6,
        audio: 6,
      },
      chatAutomationWorker: { enabled: false, intervalMs: 30_000, batchSize: 20 },
      orderEmailWorker: { enabled: false, intervalMs: 15_000 },
      imageSearch: {
        enabled: true,
        provider: {
          id: 'local',
          model: 'Xenova/clip-vit-base-patch32',
          modelVersion: '1',
          dimensions: 512,
          cacheDir: undefined,
          httpUrl: undefined,
          httpApiKey: undefined,
          timeoutMs: 30_000,
        },
        worker: { enabled: true, intervalMs: 3_000, batchSize: 4 },
        rateLimit: { windowMs: 60_000, limit: 20 },
      },
      realtime: undefined,
      adminAppOrigin: 'http://localhost:3001',
      supabase: {
        url: 'http://127.0.0.1:54321',
        publishableKey: TEST_SUPABASE_ENV.SUPABASE_PUBLISHABLE_KEY,
        secretKey: TEST_SUPABASE_ENV.SUPABASE_SECRET_KEY,
      },
      databaseUrl: undefined,
      redisUrl: undefined,
      databaseTarget: { mode: 'other', connection: 'other', projectRef: null },
      trustedClientSecret: undefined,
      media: undefined,
      push: undefined,
      incompleteIntegrations: [],
      // Courier operating switches live in the database; the environment keeps only the
      // database target (for the test-mode rule), secrets and fallbacks, none set here.
      couriers: {
        databaseTarget: 'local',
        mockAllowed: true,
        ignoredVariables: [],
        mockWebhookSecret: undefined,
        credentials: {
          steadfast: { api_key: undefined, secret_key: undefined, webhook_token: undefined },
          pathao: {
            client_id: undefined,
            client_secret: undefined,
            username: undefined,
            password: undefined,
            webhook_secret: undefined,
          },
        },
        baseUrls: { steadfast: undefined, pathao: undefined },
      },
    });
  });

  it('defaults to development and keeps tests quiet', () => {
    expect(loadConfig(BASE).nodeEnv).toBe('development');
    expect(loadConfig({ ...BASE, NODE_ENV: 'test' }).logLevel).toBe('silent');
  });

  it('treats empty values as unset', () => {
    const config = loadConfig({
      ...BASE,
      NODE_ENV: 'test',
      PORT: '',
      CORS_ORIGINS: '',
      LOG_LEVEL: '',
    });
    expect(config.port).toBe(4000);
    expect(config.corsOrigins).toEqual(['http://localhost:3000', 'http://localhost:3001']);
  });

  it('normalises and de-duplicates allowed origins', () => {
    const config = loadConfig({
      ...BASE,
      NODE_ENV: 'development',
      CORS_ORIGINS: ' https://shop.example.com ,https://SHOP.example.com, http://localhost:3000',
    });
    expect(config.corsOrigins).toEqual(['https://shop.example.com', 'http://localhost:3000']);
  });

  it('accepts an explicit https setup in production', () => {
    const config = loadConfig({
      ...PRODUCTION,
      CORS_ORIGINS: 'https://nilzora.example,https://admin.nilzora.example',
      TRUST_PROXY_HOPS: '1',
    });
    expect(config.corsOrigins).toEqual([
      'https://nilzora.example',
      'https://admin.nilzora.example',
    ]);
    expect(config.logLevel).toBe('info');
    expect(config.trustProxyHops).toBe(1);
  });

  it('requires CORS_ORIGINS in production instead of falling back to localhost', () => {
    const { CORS_ORIGINS: _unused, ...withoutOrigins } = PRODUCTION;
    expect(configError(withoutOrigins).problems).toEqual([
      'CORS_ORIGINS: required in production (comma-separated https origins)',
    ]);
  });

  it('requires the shared client secret in production, where the web servers send it', () => {
    const { TRUSTED_CLIENT_SECRET: _unused, ...withoutSecret } = PRODUCTION;
    expect(configError(withoutSecret).problems).toEqual([
      'API_CLIENT_SECRET: required in production (the same value in the web servers)',
    ]);
  });

  it('rejects a direct database URL that is not PostgreSQL', () => {
    const error = configError({ ...BASE, DATABASE_URL: 'mysql://user:pw@db:3306/app' });
    expect(error.problems).toEqual([
      'DATABASE_URL: must be a postgres:// or postgresql:// connection string',
    ]);
  });

  it('requires an encrypted direct database connection in production', () => {
    const error = configError({
      ...PRODUCTION,
      DATABASE_URL: 'postgresql://user:pw@db:5432/postgres',
    });
    expect(error.problems).toEqual([
      'DATABASE_URL: must enable TLS in production (sslmode=require or stricter)',
    ]);
  });

  it('accepts an encrypted direct database connection in production', () => {
    const databaseUrl = 'postgresql://user:pw@db:5432/postgres?sslmode=require';
    expect(loadConfig({ ...PRODUCTION, DATABASE_URL: databaseUrl }).databaseUrl).toBe(databaseUrl);
  });

  it('rejects plain http origins in production', () => {
    const error = configError({ ...PRODUCTION, CORS_ORIGINS: 'http://nilzora.example' });
    expect(error.problems).toEqual(['CORS_ORIGINS: entry 1 must use https in production']);
  });

  it.each([
    '*',
    'null',
    'https://shop.example.com/',
    'https://shop.example.com/path',
    'https://shop.example.com?x=1',
    'https://user:pass@shop.example.com',
    'ftp://shop.example.com',
    'not a url',
  ])('rejects the CORS origin %j', (origin) => {
    const error = configError({ ...BASE, NODE_ENV: 'development', CORS_ORIGINS: origin });
    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]).toMatch(/^CORS_ORIGINS: entry 1 /);
  });

  it('reports every invalid variable without echoing submitted values', () => {
    const secretLooking = 'fake-secret-value-7f3a9c';
    const error = configError({
      ...PRODUCTION,
      PORT: secretLooking,
      LOG_LEVEL: secretLooking,
      RATE_LIMIT_MAX: '0',
      TRUST_PROXY_HOPS: '-1',
      CORS_ORIGINS: `https://${secretLooking}.example/path`,
    });

    expect(error.problems.map((problem) => problem.split(':')[0]).sort()).toEqual([
      'CORS_ORIGINS',
      'LOG_LEVEL',
      'PORT',
      'RATE_LIMIT_MAX',
      'TRUST_PROXY_HOPS',
    ]);
    expect(error.message).not.toContain(secretLooking);
  });

  it('reads the order rate limit and validates it like the other limits', () => {
    const config = loadConfig({
      ...BASE,
      ORDER_RATE_LIMIT_WINDOW_MS: '120000',
      ORDER_RATE_LIMIT_MAX: '5',
    });
    expect(config.orderRateLimit).toStrictEqual({ windowMs: 120_000, limit: 5 });

    const error = configError({
      ...BASE,
      ORDER_RATE_LIMIT_WINDOW_MS: '999',
      ORDER_RATE_LIMIT_MAX: '0',
    });
    expect(error.problems.map((problem) => problem.split(':')[0]).sort()).toEqual([
      'ORDER_RATE_LIMIT_MAX',
      'ORDER_RATE_LIMIT_WINDOW_MS',
    ]);
  });

  it('reads the admin rate limit and validates it like the other limits', () => {
    const config = loadConfig({
      ...BASE,
      ADMIN_RATE_LIMIT_WINDOW_MS: '30000',
      ADMIN_RATE_LIMIT_MAX: '40',
    });
    expect(config.adminRateLimit).toStrictEqual({ windowMs: 30_000, limit: 40 });

    const error = configError({ ...BASE, ADMIN_RATE_LIMIT_MAX: '0' });
    expect(error.problems.map((problem) => problem.split(':')[0])).toEqual([
      'ADMIN_RATE_LIMIT_MAX',
    ]);
  });

  it('reads the admin workspace origin for invitation links', () => {
    expect(loadConfig(PRODUCTION).adminAppOrigin).toBe('https://admin.nilzora.example');
    expect(
      loadConfig({ ...BASE, ADMIN_APP_ORIGIN: ' https://ADMIN.example.com ' }).adminAppOrigin,
    ).toBe('https://admin.example.com');
  });

  it('requires an https ADMIN_APP_ORIGIN in production', () => {
    const { ADMIN_APP_ORIGIN: _unused, ...withoutAdmin } = PRODUCTION;
    expect(configError(withoutAdmin).problems).toEqual([
      'ADMIN_APP_ORIGIN: required in production (the https origin of the admin app)',
    ]);
    expect(
      configError({ ...PRODUCTION, ADMIN_APP_ORIGIN: 'http://admin.nilzora.example' }).problems,
    ).toEqual(['ADMIN_APP_ORIGIN: must use https in production']);
  });

  it.each(['https://admin.example.com/accept-invite', 'javascript:alert(1)', '*', 'not a url'])(
    'rejects the admin origin %j',
    (origin) => {
      const error = configError({ ...BASE, ADMIN_APP_ORIGIN: origin });
      expect(error.problems).toHaveLength(1);
      expect(error.problems[0]).toMatch(/^ADMIN_APP_ORIGIN: /);
    },
  );

  it('ignores unrelated variables, so other secrets never enter the config', () => {
    const config = loadConfig({ ...BASE, NODE_ENV: 'test', R2_SECRET_ACCESS_KEY: 'r2-not-used' });
    expect(JSON.stringify(config)).not.toContain('r2-not-used');
  });
});

describe('Supabase configuration', () => {
  it.each(['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY'] as const)(
    'requires %s in every environment',
    (key) => {
      const env: Record<string, string> = { ...BASE, NODE_ENV: 'test' };
      delete env[key];
      expect(configError(env).problems.map((problem) => problem.split(':')[0])).toEqual([key]);
    },
  );

  it('requires https for Supabase in production', () => {
    const error = configError({ ...PRODUCTION, SUPABASE_URL: 'http://project.supabase.example' });
    expect(error.problems).toEqual(['SUPABASE_URL: must use https in production']);
  });

  it('rejects keys pasted into the wrong variable without printing them', () => {
    const secret = 'sb_secret_EXAMPLEexampleEXAMPLE00';
    const publishable = 'sb_publishable_EXAMPLEexampleEXAMP';
    const swapped = configError({
      ...BASE,
      SUPABASE_PUBLISHABLE_KEY: secret,
      SUPABASE_SECRET_KEY: publishable,
    });

    expect(swapped.problems).toEqual([
      'SUPABASE_SECRET_KEY: contains a publishable key; use the secret key',
      'SUPABASE_PUBLISHABLE_KEY: contains a secret key, which must stay server-only',
    ]);
    expect(swapped.message).not.toContain(secret);
    expect(swapped.message).not.toContain(publishable);
  });

  it('rejects using one key for both roles', () => {
    const error = configError({ ...BASE, SUPABASE_SECRET_KEY: BASE.SUPABASE_PUBLISHABLE_KEY });
    expect(error.problems).toEqual([
      'SUPABASE_SECRET_KEY: must differ from SUPABASE_PUBLISHABLE_KEY',
    ]);
  });

  it('rejects a malformed URL and a too-short key without echoing them', () => {
    const error = configError({
      ...BASE,
      SUPABASE_URL: 'not-a-url-value',
      SUPABASE_SECRET_KEY: 'short-key',
    });
    expect(error.problems.map((problem) => problem.split(':')[0]).sort()).toEqual([
      'SUPABASE_SECRET_KEY',
      'SUPABASE_URL',
    ]);
    expect(error.message).not.toContain('not-a-url-value');
    expect(error.message).not.toContain('short-key');
  });
});

describe('trusted web client secret', () => {
  const secret = 'web-client-secret-for-tests-0000000000';
  const other = 'another-web-client-secret-tests-1111111111';

  it('is optional and passed through when set', () => {
    expect(loadConfig(BASE).trustedClientSecret).toBeUndefined();
    expect(loadConfig({ ...BASE, TRUSTED_CLIENT_SECRET: secret }).trustedClientSecret).toBe(secret);
  });

  it('reads the canonical API_CLIENT_SECRET the web servers use', () => {
    expect(loadConfig({ ...BASE, API_CLIENT_SECRET: secret }).trustedClientSecret).toBe(secret);
  });

  it('accepts the canonical name alone in production', () => {
    const { TRUSTED_CLIENT_SECRET: _older, ...production } = PRODUCTION;
    const config = loadConfig({ ...production, API_CLIENT_SECRET: secret });

    expect(config.trustedClientSecret).toBe(secret);
  });

  it('prefers API_CLIENT_SECRET over TRUSTED_CLIENT_SECRET when both are set', () => {
    const config = loadConfig({ ...BASE, API_CLIENT_SECRET: secret, TRUSTED_CLIENT_SECRET: other });

    expect(config.trustedClientSecret).toBe(secret);
  });

  it('rejects a short secret without echoing it', () => {
    const error = configError({ ...BASE, TRUSTED_CLIENT_SECRET: 'too-short-secret' });
    expect(error.problems.map((problem) => problem.split(':')[0])).toEqual([
      'TRUSTED_CLIENT_SECRET',
    ]);
    expect(error.message).not.toContain('too-short-secret');
  });

  it('rejects a short canonical secret, naming the variable the deployment set', () => {
    const error = configError({ ...BASE, API_CLIENT_SECRET: 'too-short-secret' });
    expect(error.problems.map((problem) => problem.split(':')[0])).toEqual(['API_CLIENT_SECRET']);
    expect(error.message).not.toContain('too-short-secret');
  });

  it('rejects reusing a Supabase key as the client secret', () => {
    const reused = BASE.SUPABASE_SECRET_KEY.padEnd(40, '0');
    const error = configError({
      ...BASE,
      SUPABASE_SECRET_KEY: reused,
      TRUSTED_CLIENT_SECRET: reused,
    });
    expect(error.problems).toEqual([
      'TRUSTED_CLIENT_SECRET: must be its own random value, not a Supabase key',
    ]);
  });

  it('rejects reusing a Supabase key as the canonical secret', () => {
    const reused = BASE.SUPABASE_SECRET_KEY.padEnd(40, '0');
    const error = configError({
      ...BASE,
      SUPABASE_SECRET_KEY: reused,
      API_CLIENT_SECRET: reused,
    });
    expect(error.problems).toEqual([
      'API_CLIENT_SECRET: must be its own random value, not a Supabase key',
    ]);
  });
});

const NEWLINE = String.fromCharCode(10);
/** A backslash followed by "n": how a private key looks when pasted from the service-account JSON. */
const BACKSLASH_N = String.fromCharCode(92) + 'n';

describe('optional integrations: R2 media and FCM push', () => {
  const pem = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey;
  const R2 = {
    R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    R2_ACCESS_KEY_ID: 'access-key-id',
    R2_SECRET_ACCESS_KEY: 'r2-secret-access-key-VALUE',
    R2_BUCKET: 'nilzora-media',
    R2_PUBLIC_BASE_URL: 'https://media.example.com/',
  };
  const FCM = {
    FCM_PROJECT_ID: 'nilzora-test',
    FCM_CLIENT_EMAIL: 'sender@nilzora-test.iam.gserviceaccount.com',
    FCM_PRIVATE_KEY: pem,
  };

  it('are off when none of their variables are set', () => {
    const config = loadConfig(PRODUCTION);
    expect(config.media).toBeUndefined();
    expect(config.push).toBeUndefined();
    expect(config.incompleteIntegrations).toEqual([]);
  });

  it('switch R2 media on when all five variables are set, normalising the public address', () => {
    expect(loadConfig({ ...BASE, ...R2 }).media).toEqual({
      accountId: '0123456789abcdef0123456789abcdef',
      accessKeyId: 'access-key-id',
      secretAccessKey: 'r2-secret-access-key-VALUE',
      bucket: 'nilzora-media',
      publicBaseUrl: 'https://media.example.com',
    });
    expect(
      loadConfig({ ...BASE, ...R2, R2_PUBLIC_BASE_URL: 'https://cdn.example.com/media//' }).media
        ?.publicBaseUrl,
    ).toBe('https://cdn.example.com/media');
  });

  it('switch FCM on, accepting a key pasted with literal backslash-n escapes', () => {
    const escaped = pem.trim().split(NEWLINE).join(BACKSLASH_N);
    expect(escaped).not.toContain(NEWLINE);
    const config = loadConfig({ ...BASE, ...FCM, FCM_PRIVATE_KEY: escaped });
    expect(config.push).toEqual({
      projectId: 'nilzora-test',
      clientEmail: FCM.FCM_CLIENT_EMAIL,
      privateKey: pem.trim(),
    });
    expect(loadConfig({ ...BASE, ...FCM }).push?.privateKey).toBe(pem.trim());
  });

  it('treat a partial set as off with a warning outside production, naming only variables', () => {
    const config = loadConfig({
      ...BASE,
      ...FCM,
      FCM_CLIENT_EMAIL: '',
      ...R2,
      R2_BUCKET: '',
      R2_PUBLIC_BASE_URL: '',
    });
    expect(config.push).toBeUndefined();
    expect(config.media).toBeUndefined();
    expect(config.incompleteIntegrations).toEqual([
      'R2 media storage (missing R2_BUCKET, R2_PUBLIC_BASE_URL)',
      'FCM push notifications (missing FCM_CLIENT_EMAIL)',
    ]);
    expect(JSON.stringify(config.incompleteIntegrations)).not.toContain(R2.R2_SECRET_ACCESS_KEY);
  });

  it('fail the start in production when only part of a set is present', () => {
    const error = configError({ ...PRODUCTION, ...R2, R2_BUCKET: '', ...FCM, FCM_PROJECT_ID: '' });
    const text = error.problems.join(' | ');
    expect(text).toContain('R2 media storage: set all of R2_ACCOUNT_ID');
    expect(text).toContain('missing R2_BUCKET');
    expect(text).toContain('FCM push notifications: set all of FCM_PROJECT_ID');
    expect(error.message).not.toContain(R2.R2_SECRET_ACCESS_KEY);
  });

  it('reject a bad bucket name, public address or private key without echoing secrets', () => {
    expect(configError({ ...BASE, ...R2, R2_BUCKET: 'Bad Bucket!' }).problems.join()).toContain(
      'R2_BUCKET',
    );
    expect(
      configError({ ...BASE, ...R2, R2_PUBLIC_BASE_URL: 'not a url' }).problems.join(),
    ).toContain('R2_PUBLIC_BASE_URL');
    expect(
      configError({
        ...BASE,
        ...R2,
        R2_PUBLIC_BASE_URL: 'ftp://media.example.com',
      }).problems.join(),
    ).toContain('must use https');
    expect(
      configError({
        ...BASE,
        ...R2,
        R2_PUBLIC_BASE_URL: 'https://user:pw@media.example.com',
      }).problems.join(),
    ).toContain('credentials');
    const badKey = configError({ ...BASE, ...FCM, FCM_PRIVATE_KEY: 'super-secret-not-a-pem' });
    expect(badKey.problems.join()).toContain('FCM_PRIVATE_KEY');
    expect(badKey.message).not.toContain('super-secret');
  });

  it('require an https public address in production, but allow local http outside it', () => {
    expect(
      configError({
        ...PRODUCTION,
        ...R2,
        R2_PUBLIC_BASE_URL: 'http://media.example.com',
      }).problems.join(),
    ).toContain('R2_PUBLIC_BASE_URL: must use https');
    expect(
      loadConfig({ ...BASE, ...R2, R2_PUBLIC_BASE_URL: 'http://localhost:8787' }).media
        ?.publicBaseUrl,
    ).toBe('http://localhost:8787');
  });
});

describe('the FCM service-account file', () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const directory = mkdtempSync(join(tmpdir(), 'nilzora-fcm-'));
  let counter = 0;

  /** Writes `contents` to its own file and returns the path. */
  function file(contents: string): string {
    counter += 1;
    const path = join(directory, `account-${String(counter)}.json`);
    writeFileSync(path, contents, 'utf8');
    return path;
  }

  function credential(overrides: Record<string, unknown> = {}): string {
    return file(
      JSON.stringify({
        type: 'service_account',
        project_id: 'nilzora-64ad5',
        private_key_id: 'key-id',
        private_key: privateKey,
        client_email: 'firebase-adminsdk-fbsvc@nilzora-64ad5.iam.gserviceaccount.com',
        client_id: '1234567890',
        token_uri: 'https://oauth2.googleapis.com/token',
        ...overrides,
      }),
    );
  }

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('switches push on from the Admin SDK JSON, and wins over the inline variables', () => {
    const config = loadConfig({
      ...BASE,
      FCM_SERVICE_ACCOUNT_FILE: credential(),
      // Deliberately different: the file is the credential that counts.
      FCM_PROJECT_ID: 'ignored-project',
      FCM_CLIENT_EMAIL: 'ignored@example.com',
      FCM_PRIVATE_KEY: privateKey,
    });
    expect(config.push).toEqual({
      projectId: 'nilzora-64ad5',
      clientEmail: 'firebase-adminsdk-fbsvc@nilzora-64ad5.iam.gserviceaccount.com',
      privateKey: privateKey.trim(),
    });
    expect(config.incompleteIntegrations).toEqual([]);
  });

  it('keeps push off, with a warning, when the file is unusable', () => {
    const cases: [string, string, string][] = [
      ['a missing file', join(directory, 'does-not-exist.json'), 'cannot be read'],
      ['a file that is not JSON', file('not json at all'), 'is not valid JSON'],
      ['a JSON array', file('[1, 2]'), 'must contain a JSON object'],
      ['another credential type', credential({ type: 'authorized_user' }), 'service_account'],
      ['no client email', credential({ client_email: '' }), 'is missing'],
      ['a key that is not PEM', credential({ private_key: 'super-secret-not-a-pem' }), 'PEM'],
    ];

    for (const [label, path, expected] of cases) {
      const config = loadConfig({ ...BASE, FCM_SERVICE_ACCOUNT_FILE: path });
      expect(config.push, label).toBeUndefined();
      const warning = config.incompleteIntegrations.join(' | ');
      expect(warning, label).toContain('FCM_SERVICE_ACCOUNT_FILE');
      expect(warning, label).toContain(expected);
      // The warning names the problem, never the key or the file's contents.
      expect(warning, label).not.toContain('super-secret');
      expect(warning, label).not.toContain('BEGIN PRIVATE KEY');
    }
  });

  it('fails the start in production when the file cannot be used', () => {
    const error = configError({
      ...PRODUCTION,
      FCM_SERVICE_ACCOUNT_FILE: join(directory, 'missing-in-production.json'),
    });
    expect(error.problems.join()).toContain('FCM_SERVICE_ACCOUNT_FILE');
    expect(error.message).not.toContain('BEGIN PRIVATE KEY');
  });
});

describe('server startup', () => {
  const apiRoot = fileURLToPath(new URL('../..', import.meta.url));
  const configKeys = [
    'NODE_ENV',
    'PORT',
    'LOG_LEVEL',
    'CORS_ORIGINS',
    'TRUST_PROXY_HOPS',
    'RATE_LIMIT_WINDOW_MS',
    'RATE_LIMIT_MAX',
    'AUTH_RATE_LIMIT_WINDOW_MS',
    'AUTH_RATE_LIMIT_MAX',
    'ORDER_RATE_LIMIT_WINDOW_MS',
    'ORDER_RATE_LIMIT_MAX',
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SECRET_KEY',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
    'R2_PUBLIC_BASE_URL',
    'FCM_PROJECT_ID',
    'FCM_CLIENT_EMAIL',
    'FCM_PRIVATE_KEY',
    'FCM_SERVICE_ACCOUNT_FILE',
  ];

  function startServer(env: Record<string, string>) {
    const baseEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !configKeys.includes(key)),
    );
    return spawnSync(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      cwd: apiRoot,
      env: { ...baseEnv, ...env },
      encoding: 'utf8',
      timeout: 30_000,
    });
  }

  it('fails fast with a safe message when configuration is invalid', () => {
    const secretKey = 'sb_secret_STARTUPexampleSTARTUP00';
    const result = startServer({
      NODE_ENV: 'production',
      PORT: 'hunter2-not-a-port',
      SUPABASE_PUBLISHABLE_KEY: secretKey,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid Nilzora API configuration');
    for (const name of ['PORT:', 'CORS_ORIGINS:', 'SUPABASE_URL:', 'SUPABASE_SECRET_KEY:']) {
      expect(result.stderr).toContain(name);
    }
    expect(result.stderr).not.toContain('hunter2');
    expect(result.stderr).not.toContain(secretKey);
    expect(result.stderr).not.toMatch(/\n\s+at /);
    expect(result.stdout).not.toContain('listening');
  }, 30_000);
});
