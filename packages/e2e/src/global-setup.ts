import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';

/**
 * End-to-end environment: the built API and both built Next.js apps (`next start`,
 * i.e. production mode with Secure `__Host-` cookies), wired to the running local
 * Supabase stack. Secrets are generated per run and exist only in these processes'
 * environments; nothing is written to disk or printed.
 */

export interface E2eEnvironment {
  supabaseUrl: string;
  supabaseSecretKey: string;
  mailUrl: string;
  apiUrl: string;
  storefrontUrl: string;
  adminUrl: string;
  /** Per-IP limit for sign-in, registration and refresh in this run's API. */
  authRateLimit: number;
}

declare module 'vitest' {
  export interface ProvidedContext {
    e2e: E2eEnvironment;
  }
}

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const AUTH_RATE_LIMIT = 6;

function localStatus(): Record<string, string | undefined> {
  const cli = join(repoRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
  const result = spawnSync(process.execPath, [cli, 'status', '-o', 'json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error('Local Supabase is not running. Start it with `pnpm db:start`.');
  }
  return JSON.parse(result.stdout.slice(result.stdout.indexOf('{'))) as Record<
    string,
    string | undefined
  >;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('No free port'));
      });
    });
  });
}

interface Service {
  name: string;
  child: ChildProcess;
  output: string[];
}

function startService(
  name: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): Service {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString('utf8')));
  child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString('utf8')));
  if (process.env.E2E_DEBUG) {
    // Shows what the services logged while a test was failing; off by default.
    child.stdout?.on('data', (chunk: Buffer) =>
      process.stdout.write(`[${name}] ${chunk.toString('utf8')}`),
    );
    child.stderr?.on('data', (chunk: Buffer) =>
      process.stderr.write(`[${name}] ${chunk.toString('utf8')}`),
    );
  }
  return { name, child, output };
}

async function waitUntilReady(service: Service, url: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (service.child.exitCode !== null) break;
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status < 500) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${service.name} did not start:\n${service.output.join('').slice(-4000)}`);
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const required = [
    'apps/api/dist/server.mjs',
    'apps/storefront/.next/BUILD_ID',
    'apps/admin/.next/BUILD_ID',
  ];
  const missing = required.filter((path) => !existsSync(join(repoRoot, path)));
  if (missing.length > 0) {
    throw new Error(`Build the apps first (pnpm build). Missing: ${missing.join(', ')}`);
  }

  const status = localStatus();
  const { API_URL, PUBLISHABLE_KEY, SECRET_KEY, MAILPIT_URL } = status;
  if (!API_URL || !PUBLISHABLE_KEY || !SECRET_KEY || !MAILPIT_URL) {
    throw new Error('`supabase status` did not report the API URL, mail URL and keys.');
  }
  for (const url of [API_URL, MAILPIT_URL]) {
    const host = new URL(url).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') {
      throw new Error('End-to-end tests only run against a local Supabase stack.');
    }
  }

  const clientSecret = randomBytes(32).toString('base64url');
  const [apiPort, storefrontPort, adminPort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
  ]);
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const storefrontUrl = `http://127.0.0.1:${storefrontPort}`;
  const adminUrl = `http://127.0.0.1:${adminPort}`;
  const nextBin = createRequire(join(repoRoot, 'apps', 'storefront', 'package.json')).resolve(
    'next/dist/bin/next',
  );

  const services: Service[] = [];
  const stop = async () => {
    for (const service of services) service.child.kill();
    await Promise.all(
      services.map(
        (service) =>
          new Promise((resolve) => {
            if (service.child.exitCode !== null) resolve(undefined);
            else service.child.once('exit', resolve);
          }),
      ),
    );
  };

  try {
    const api = startService('API', ['dist/server.mjs'], join(repoRoot, 'apps', 'api'), {
      NODE_ENV: 'test',
      PORT: String(apiPort),
      SUPABASE_URL: API_URL,
      SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
      SUPABASE_SECRET_KEY: SECRET_KEY,
      TRUSTED_CLIENT_SECRET: clientSecret,
      AUTH_RATE_LIMIT_MAX: String(AUTH_RATE_LIMIT),
      RATE_LIMIT_MAX: '10000',
      ...(process.env.E2E_DEBUG ? { LOG_LEVEL: 'info' } : {}),
    });
    services.push(api);
    await waitUntilReady(api, `${apiUrl}/api/v1/health`);

    const web = (name: string, app: string, port: number, origin: string) =>
      startService(
        name,
        [nextBin, 'start', '--port', String(port), '--hostname', '127.0.0.1'],
        join(repoRoot, 'apps', app),
        {
          NILZORA_API_URL: apiUrl,
          APP_ORIGIN: origin,
          SESSION_SECRET: randomBytes(32).toString('base64url'),
          API_CLIENT_SECRET: clientSecret,
          TRUST_PROXY_HOPS: '0',
        },
      );
    const storefront = web('Storefront', 'storefront', storefrontPort, storefrontUrl);
    const admin = web('Admin', 'admin', adminPort, adminUrl);
    services.push(storefront, admin);
    await Promise.all([
      waitUntilReady(storefront, `${storefrontUrl}/`),
      waitUntilReady(admin, `${adminUrl}/login`),
    ]);
  } catch (error) {
    await stop();
    throw error;
  }

  project.provide('e2e', {
    supabaseUrl: API_URL,
    supabaseSecretKey: SECRET_KEY,
    mailUrl: MAILPIT_URL,
    apiUrl,
    storefrontUrl,
    adminUrl,
    authRateLimit: AUTH_RATE_LIMIT,
  });
  return stop;
}
