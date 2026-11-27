/**
 * Where the API's database actually lives, described in terms that are safe to log and
 * to return from the health endpoint. Nothing here is derived from a credential: the
 * classification comes from the URL's host alone, and the project ref is the public
 * identifier Supabase already puts in every hosted hostname.
 */
export type TargetMode = 'local' | 'hosted' | 'other';

/** How a hosted Supabase database is reached. `local` is the loopback dev stack. */
export type ConnectionKind = 'local' | 'pooler' | 'direct' | 'other';

export interface DatabaseTarget {
  mode: TargetMode;
  connection: ConnectionKind;
  /** Public Supabase project ref, when one can be read from a host. Never a secret. */
  projectRef: string | null;
}

const LOCAL_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '0.0.0.0',
  '[::1]',
  'host.docker.internal',
]);
const SUPABASE_HOST = /(^|\.)supabase\.(co|com|in)$/i;
/** `db.<ref>.supabase.co` is the direct (non-pooled) host for a project. */
const SUPABASE_DIRECT = /^db\.([a-z0-9]{20})\.supabase\.(co|com|in)$/i;
const SUPABASE_POOLER = /(^|\.)pooler\.supabase\.com$/i;
/** `https://<ref>.supabase.co` — the project's own API host. */
const SUPABASE_PROJECT = /^([a-z0-9]{20})\.supabase\.(co|com|in)$/i;

function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Classifies a `DATABASE_URL`. An unparseable value is `other` rather than `local`, so an
 * unknown target can never be mistaken for the safe one.
 */
export function classifyDatabaseUrl(databaseUrl: string | undefined): DatabaseTarget {
  if (databaseUrl === undefined) return { mode: 'other', connection: 'other', projectRef: null };
  const host = hostOf(databaseUrl);
  if (host === null) return { mode: 'other', connection: 'other', projectRef: null };
  if (LOCAL_HOSTS.has(host)) return { mode: 'local', connection: 'local', projectRef: null };

  const direct = SUPABASE_DIRECT.exec(host);
  if (direct) return { mode: 'hosted', connection: 'direct', projectRef: direct[1] ?? null };
  if (SUPABASE_POOLER.test(host)) return { mode: 'hosted', connection: 'pooler', projectRef: null };
  if (SUPABASE_HOST.test(host)) return { mode: 'hosted', connection: 'other', projectRef: null };
  return { mode: 'other', connection: 'other', projectRef: null };
}

/** Classifies `SUPABASE_URL`, which names the project the API's Auth and RPC calls reach. */
export function classifySupabaseUrl(supabaseUrl: string): DatabaseTarget {
  const host = hostOf(supabaseUrl);
  if (host === null) return { mode: 'other', connection: 'other', projectRef: null };
  if (LOCAL_HOSTS.has(host)) return { mode: 'local', connection: 'local', projectRef: null };
  const project = SUPABASE_PROJECT.exec(host);
  if (project) return { mode: 'hosted', connection: 'other', projectRef: project[1] ?? null };
  if (SUPABASE_HOST.test(host)) return { mode: 'hosted', connection: 'other', projectRef: null };
  return { mode: 'other', connection: 'other', projectRef: null };
}

/**
 * Why a database and Supabase API pairing is unsafe, or an empty list. `DATABASE_URL` and
 * `SUPABASE_URL` must describe the same stack: running Auth against a hosted project while
 * writing data to a local database (or the reverse) silently splits an account from its rows.
 */
export function targetProblems(database: DatabaseTarget, supabase: DatabaseTarget): string[] {
  const problems: string[] = [];
  if (database.mode !== supabase.mode) {
    problems.push(
      `DATABASE_URL and SUPABASE_URL point at different stacks (${database.mode} vs ${supabase.mode}); set both to the same environment`,
    );
  }
  if (
    database.mode === 'hosted' &&
    database.projectRef !== null &&
    supabase.projectRef !== null &&
    database.projectRef !== supabase.projectRef
  ) {
    problems.push('DATABASE_URL and SUPABASE_URL name different Supabase projects');
  }
  return problems;
}

/**
 * Fills in the project ref from `SUPABASE_URL` when the database host does not carry one.
 * A pooler host (`aws-0-<region>.pooler.supabase.com`) names no project, yet the ref is the
 * one fact that proves which project the process is talking to, and it is public.
 */
export function withProjectRef(target: DatabaseTarget, supabase: DatabaseTarget): DatabaseTarget {
  if (target.projectRef !== null || supabase.projectRef === null) return target;
  if (target.mode !== 'hosted') return target;
  return { ...target, projectRef: supabase.projectRef };
}

/** A one-line description for logs: classification only, never a host or a credential. */
export function describeTarget(target: DatabaseTarget): string {
  const ref = target.projectRef === null ? '' : ` ref=${target.projectRef}`;
  return `${target.mode}/${target.connection}${ref}`;
}
