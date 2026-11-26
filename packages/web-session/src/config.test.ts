import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getApiUrl,
  getWebSessionConfig,
  loadApiUrl,
  loadWebSessionConfig,
  WebSessionConfigError,
} from './config';
import { TEST_API_CLIENT_SECRET, TEST_SESSION_SECRET } from './testing/fixtures';

const PRODUCTION_ENV = {
  NILZORA_API_URL: 'https://api.nilzora.test',
  APP_ORIGIN: 'https://shop.nilzora.test',
  SESSION_SECRET: TEST_SESSION_SECRET,
  API_CLIENT_SECRET: TEST_API_CLIENT_SECRET,
};

/** The thrown configuration error, so tests can inspect its problems. */
function loadError(...args: Parameters<typeof loadWebSessionConfig>): WebSessionConfigError {
  try {
    loadWebSessionConfig(...args);
  } catch (error) {
    if (error instanceof WebSessionConfigError) return error;
    throw error;
  }
  throw new Error('expected loadWebSessionConfig to throw');
}

describe('loadWebSessionConfig in development', () => {
  it.each([
    ['storefront', 'http://localhost:3000'],
    ['admin', 'http://localhost:3001'],
  ] as const)('uses local defaults for the %s', (app, origin) => {
    const config = loadWebSessionConfig(app, {}, false);

    expect(config).toMatchObject({
      app,
      production: false,
      apiUrl: 'http://localhost:4000',
      appOrigin: origin,
      apiClientSecret: undefined,
      trustProxyHops: 0,
    });
  });

  it('generates one random 32-byte session key per app and process when SESSION_SECRET is unset', () => {
    const first = loadWebSessionConfig('storefront', {}, false).sessionSecret;
    const second = loadWebSessionConfig('storefront', {}, false).sessionSecret;
    const admin = loadWebSessionConfig('admin', {}, false).sessionSecret;

    // A page, a Server Action and a route handler are separate bundles of one server, so the
    // key has to survive a second load: a per-load key refuses every form its own process rendered.
    expect(first).toHaveLength(32);
    expect(first.equals(second)).toBe(true);
    // The two apps sign differently, as they always have.
    expect(first.equals(admin)).toBe(false);
  });

  it('keeps that key across module instances, as separate bundles of one server see it', async () => {
    const first = loadWebSessionConfig('storefront', {}, false).sessionSecret;
    // A fresh module registry is what the page, action and route bundles each get.
    vi.resetModules();
    const reloaded = await import('./config');
    const second = reloaded.loadWebSessionConfig('storefront', {}, false).sessionSecret;

    expect(first.equals(second)).toBe(true);
  });

  it('treats empty strings as unset', () => {
    const config = loadWebSessionConfig(
      'admin',
      {
        NILZORA_API_URL: '',
        APP_ORIGIN: '',
        SESSION_SECRET: '',
        API_CLIENT_SECRET: '',
        TRUST_PROXY_HOPS: '',
      },
      false,
    );

    expect(config).toMatchObject({
      apiUrl: 'http://localhost:4000',
      appOrigin: 'http://localhost:3001',
      apiClientSecret: undefined,
      trustProxyHops: 0,
    });
    expect(config.sessionSecret).toHaveLength(32);
  });

  it('uses the configured values', () => {
    const config = loadWebSessionConfig(
      'storefront',
      {
        NILZORA_API_URL: 'http://127.0.0.1:4100//',
        APP_ORIGIN: 'http://127.0.0.1:3100',
        SESSION_SECRET: TEST_SESSION_SECRET,
        API_CLIENT_SECRET: TEST_API_CLIENT_SECRET,
        TRUST_PROXY_HOPS: '2',
      },
      false,
    );

    expect(config).toMatchObject({
      apiUrl: 'http://127.0.0.1:4100',
      appOrigin: 'http://127.0.0.1:3100',
      apiClientSecret: TEST_API_CLIENT_SECRET,
      trustProxyHops: 2,
    });
    expect(config.sessionSecret.equals(Buffer.from(TEST_SESSION_SECRET, 'utf8'))).toBe(true);
  });

  it.each([
    ['a path', 'http://localhost:3000/shop'],
    ['a trailing slash', 'http://localhost:3000/'],
    ['a query', 'http://localhost:3000?x=1'],
    ['a fragment', 'http://localhost:3000#top'],
    ['credentials', 'http://user:pass@localhost:3000'],
  ])('rejects an APP_ORIGIN with %s', (_, origin) => {
    const error = loadError('storefront', { APP_ORIGIN: origin }, false);
    expect(error.problems).toEqual([
      'APP_ORIGIN: must be a bare origin without a path or trailing slash',
    ]);
  });

  it.each(['ftp://localhost:3000', 'javascript:alert(1)', 'localhost:3000', 'not a url'])(
    'rejects the non-http APP_ORIGIN %j',
    (origin) => {
      const error = loadError('storefront', { APP_ORIGIN: origin }, false);
      expect(error.problems.some((problem) => problem.startsWith('APP_ORIGIN:'))).toBe(true);
    },
  );

  it('rejects a non-http API URL', () => {
    const error = loadError('storefront', { NILZORA_API_URL: 'file:///etc/passwd' }, false);
    expect(error.problems.some((problem) => problem.startsWith('NILZORA_API_URL:'))).toBe(true);
  });

  it.each(['-1', '11', '1.5', 'many'])('rejects TRUST_PROXY_HOPS=%j', (hops) => {
    const error = loadError('storefront', { TRUST_PROXY_HOPS: hops }, false);
    expect(error.problems.some((problem) => problem.startsWith('TRUST_PROXY_HOPS:'))).toBe(true);
  });

  it('requires SESSION_SECRET to differ from API_CLIENT_SECRET', () => {
    const error = loadError(
      'storefront',
      { SESSION_SECRET: TEST_SESSION_SECRET, API_CLIENT_SECRET: TEST_SESSION_SECRET },
      false,
    );
    expect(error.problems).toEqual(['SESSION_SECRET: must differ from API_CLIENT_SECRET']);
  });

  it('rejects secrets shorter than 32 characters', () => {
    const error = loadError(
      'admin',
      { SESSION_SECRET: 'short-session-key', API_CLIENT_SECRET: 'short-client-key' },
      false,
    );
    expect(error.problems.map((problem) => problem.split(':')[0]).sort()).toEqual([
      'API_CLIENT_SECRET',
      'SESSION_SECRET',
    ]);
  });
});

describe('loadWebSessionConfig in production', () => {
  it('accepts a complete https configuration', () => {
    const config = loadWebSessionConfig('storefront', PRODUCTION_ENV, true);

    expect(config).toMatchObject({
      production: true,
      apiUrl: 'https://api.nilzora.test',
      appOrigin: 'https://shop.nilzora.test',
      apiClientSecret: TEST_API_CLIENT_SECRET,
    });
    expect(config.sessionSecret.equals(Buffer.from(TEST_SESSION_SECRET, 'utf8'))).toBe(true);
  });

  it('requires every variable, with no development defaults', () => {
    const error = loadError('admin', {}, true);

    expect(error).toBeInstanceOf(WebSessionConfigError);
    expect(error.name).toBe('WebSessionConfigError');
    expect(error.problems.map((problem) => problem.split(':')[0]).sort()).toEqual([
      'API_CLIENT_SECRET',
      'APP_ORIGIN',
      'NILZORA_API_URL',
      'SESSION_SECRET',
    ]);
    expect(error.message).toContain('admin');
  });

  it('treats empty strings as unset', () => {
    const error = loadError(
      'storefront',
      { NILZORA_API_URL: '', APP_ORIGIN: '', SESSION_SECRET: '', API_CLIENT_SECRET: '' },
      true,
    );
    expect(error.problems).toHaveLength(4);
  });

  it.each(['SESSION_SECRET', 'API_CLIENT_SECRET', 'NILZORA_API_URL', 'APP_ORIGIN'] as const)(
    'refuses to start without %s',
    (name) => {
      const error = loadError('storefront', { ...PRODUCTION_ENV, [name]: undefined }, true);
      expect(error.problems).toHaveLength(1);
      expect(error.problems[0]).toMatch(new RegExp(`^${name}: required in production`));
    },
  );

  it('requires an https APP_ORIGIN', () => {
    const error = loadError(
      'storefront',
      { ...PRODUCTION_ENV, APP_ORIGIN: 'http://shop.nilzora.test' },
      true,
    );
    expect(error.problems).toEqual([
      'APP_ORIGIN: must use https in production unless it is on this machine',
    ]);
  });

  it.each(['http://localhost:3000', 'http://127.0.0.1:3001', 'http://[::1]:3000'])(
    'allows a local production run at %s',
    (origin) => {
      const config = loadWebSessionConfig(
        'storefront',
        { ...PRODUCTION_ENV, APP_ORIGIN: origin },
        true,
      );
      expect(config.appOrigin).toBe(new URL(origin).origin);
    },
  );

  it.each(['http://localhost.evil.test', 'http://127.0.0.2:3000'])(
    'still requires https for %s',
    (origin) => {
      const error = loadError('storefront', { ...PRODUCTION_ENV, APP_ORIGIN: origin }, true);
      expect(error.problems).toEqual([
        'APP_ORIGIN: must use https in production unless it is on this machine',
      ]);
    },
  );

  it.each(['http://localhost:4000', 'http://127.0.0.1:4000', 'http://[::1]:4000'])(
    'allows the loopback API URL %s over http',
    (apiUrl) => {
      const config = loadWebSessionConfig(
        'storefront',
        { ...PRODUCTION_ENV, NILZORA_API_URL: apiUrl },
        true,
      );
      expect(config.apiUrl).toBe(apiUrl);
    },
  );

  it.each([
    'http://api.nilzora.test',
    'http://localhost.evil.test:4000',
    'http://127.0.0.2:4000',
    'http://10.0.0.5:4000',
  ])('refuses the non-loopback http API URL %s', (apiUrl) => {
    const error = loadError('storefront', { ...PRODUCTION_ENV, NILZORA_API_URL: apiUrl }, true);
    expect(error.problems).toEqual([
      'NILZORA_API_URL: must use https in production unless it is on this machine',
    ]);
  });

  it('requires SESSION_SECRET to differ from API_CLIENT_SECRET', () => {
    const error = loadError(
      'storefront',
      { ...PRODUCTION_ENV, API_CLIENT_SECRET: TEST_SESSION_SECRET },
      true,
    );
    expect(error.problems).toEqual(['SESSION_SECRET: must differ from API_CLIENT_SECRET']);
  });
});

describe('WebSessionConfigError messages', () => {
  const submitted = [
    'short-session-value-x',
    'short-client-value-y',
    TEST_SESSION_SECRET,
    'https://user:hunter2@api.nilzora.test',
  ];

  it.each([
    [{ SESSION_SECRET: submitted[0], API_CLIENT_SECRET: submitted[1] }, false],
    [{ ...PRODUCTION_ENV, API_CLIENT_SECRET: TEST_SESSION_SECRET }, true],
    [{ ...PRODUCTION_ENV, APP_ORIGIN: submitted[3] }, true],
    [{ SESSION_SECRET: `${'x'.repeat(600)}`, NILZORA_API_URL: 'nope' }, false],
  ] as const)('never contain submitted values (case %#)', (env, production) => {
    const error = loadError('storefront', env, production);
    const text = `${error.message}\n${error.problems.join('\n')}`;

    expect(error.problems.length).toBeGreaterThan(0);
    for (const value of [...submitted, 'x'.repeat(600), 'hunter2']) {
      expect(text).not.toContain(value);
    }
  });
});

describe('getWebSessionConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('validates process.env once and reuses the result', () => {
    vi.stubEnv('NODE_ENV', 'test');
    for (const name of ['NILZORA_API_URL', 'APP_ORIGIN', 'API_CLIENT_SECRET', 'TRUST_PROXY_HOPS']) {
      vi.stubEnv(name, '');
    }
    vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);

    const first = getWebSessionConfig('admin');
    expect(first).toMatchObject({ app: 'admin', production: false });
    expect(getWebSessionConfig('admin')).toBe(first);
  });
});

describe('loadApiUrl', () => {
  it('needs only NILZORA_API_URL in production, none of the session secrets', () => {
    expect(loadApiUrl('storefront', { NILZORA_API_URL: 'https://api.nilzora.test/' }, true)).toBe(
      'https://api.nilzora.test',
    );
  });

  it('falls back to the local API outside production', () => {
    expect(loadApiUrl('storefront', {}, false)).toBe('http://localhost:4000');
    expect(loadApiUrl('admin', { NILZORA_API_URL: '' }, false)).toBe('http://localhost:4000');
  });

  it.each([
    ['missing', {}, 'NILZORA_API_URL: required in production'],
    [
      'plain http to another host',
      { NILZORA_API_URL: 'http://api.nilzora.test' },
      'NILZORA_API_URL: must use https in production unless it is on this machine',
    ],
  ])('refuses an API URL that is %s in production', (_, env, problem) => {
    expect(() => loadApiUrl('storefront', env, true)).toThrow(WebSessionConfigError);
    try {
      loadApiUrl('storefront', env, true);
    } catch (error) {
      expect((error as WebSessionConfigError).problems).toStrictEqual([problem]);
    }
  });

  it('allows http on this machine, for local production runs', () => {
    expect(loadApiUrl('storefront', { NILZORA_API_URL: 'http://127.0.0.1:4000' }, true)).toBe(
      'http://127.0.0.1:4000',
    );
  });

  it('refuses a value that is not a URL without echoing it', () => {
    let caught: unknown;
    try {
      loadApiUrl('admin', { NILZORA_API_URL: 'secret-looking-value' }, false);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WebSessionConfigError);
    expect((caught as Error).message).not.toContain('secret-looking-value');
  });
});

describe('getApiUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('works in production with only the API URL set', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NILZORA_API_URL', 'https://api.nilzora.test');
    for (const name of ['APP_ORIGIN', 'SESSION_SECRET', 'API_CLIENT_SECRET']) vi.stubEnv(name, '');

    expect(getApiUrl('storefront')).toBe('https://api.nilzora.test');
    expect(getApiUrl('storefront')).toBe('https://api.nilzora.test');
  });
});
