import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';

export interface LocalSupabase {
  url: string;
  publishableKey: string;
  secretKey: string;
  jwtSecret: string;
  /** Local mail catcher (Mailpit) that receives every email the Auth server sends. */
  mailUrl: string;
  /** Direct PostgreSQL connection to the local database (RLS-scoped queries). */
  dbUrl: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    supabase: LocalSupabase;
  }
}

/**
 * Reads the running local stack's URL and keys from `supabase status`. They stay in
 * memory for the test run and are never written to disk. Refuses to run against
 * anything that is not a loopback address.
 */
export default function setup(project: TestProject): void {
  const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
  const cli = join(repoRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
  const result = spawnSync(process.execPath, [cli, 'status', '-o', 'json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error('Local Supabase is not running. Start it with `pnpm supabase start`.');
  }

  const status = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'))) as Record<
    string,
    string | undefined
  >;
  const { API_URL, PUBLISHABLE_KEY, SECRET_KEY, JWT_SECRET, MAILPIT_URL, DB_URL } = status;
  if (!API_URL || !PUBLISHABLE_KEY || !SECRET_KEY || !JWT_SECRET || !MAILPIT_URL || !DB_URL) {
    throw new Error(
      '`supabase status` did not report the API URL, database URL, mail URL and keys.',
    );
  }
  for (const url of [API_URL, MAILPIT_URL]) {
    const host = new URL(url).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') {
      throw new Error('Integration tests only run against a local Supabase stack.');
    }
  }
  if (!/^postgres(ql)?:\/\/([^@]*@)?(127\.0\.0\.1|localhost):/.test(DB_URL)) {
    throw new Error('Integration tests only run against a local database.');
  }

  project.provide('supabase', {
    url: API_URL,
    publishableKey: PUBLISHABLE_KEY,
    secretKey: SECRET_KEY,
    jwtSecret: JWT_SECRET,
    mailUrl: MAILPIT_URL,
    dbUrl: DB_URL,
  });
}
