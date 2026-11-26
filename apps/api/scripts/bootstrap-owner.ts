/*
 * One-time owner bootstrap for a fresh installation. Non-interactive: the account comes
 * from the API environment, never from arguments.
 *
 *   pnpm --filter @nilzora/api bootstrap-owner --project-ref <supabase-project-ref>
 *   pnpm --filter @nilzora/api bootstrap-owner --local
 *
 * Reads SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD (never printed or logged) and
 * DATABASE_URL, then in ONE transaction:
 *
 *   1. refuses when a different owner already exists;
 *   2. creates the account with public.provision_account (argon2id hash, address marked
 *      verified: this explicitly authorised, one-time path replaces the emailed code), or,
 *      when the address already has a verified account with a password, reuses it;
 *   3. grants the owner role with the database's one-time bootstrap_owner().
 *
 * Because it is one transaction, a failure leaves nothing behind, and nothing is ever
 * deleted. Customer registration is untouched: it still requires the emailed code.
 *
 * The target must be named explicitly. `--project-ref` must match the project in the
 * connection string (user `postgres.<ref>`) and in SUPABASE_URL; a local database is only
 * accepted with `--local`. A hosted connection is encrypted and verified against the
 * Supabase root CA (see src/db/pool.ts): certificate verification is never switched off.
 */
import { emailSchema, passwordSchema } from '@nilzora/validation';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../src/auth/passwords';
import { createDatabasePool } from '../src/db/pool';
import { withServiceRole } from '../src/db/user-context';

/** The shared rules allow 8 characters; the owner holds every permission, so require more. */
const OWNER_PASSWORD_MIN_LENGTH = 12;
const PROJECT_REF = /^[a-z0-9]{20}$/;

class Refusal extends Error {}

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

function fail(line: string): number {
  process.stderr.write(`${line}\n`);
  return 1;
}

function isLocalHost(hostname: string): boolean {
  return /^(127\.|localhost$|\[?::1\]?$|0\.0\.0\.0$)/.test(hostname);
}

interface Target {
  connectionString: string;
  description: string;
}

/** Works out, and cross-checks, which database the run will touch. Throws Refusal if unsure. */
function resolveTarget(args: string[], databaseUrl: string | undefined): Target {
  const local = args.includes('--local');
  const refFlag = args.indexOf('--project-ref');
  const ref = refFlag >= 0 ? args[refFlag + 1] : undefined;
  const expected = local ? 1 : 2;
  if (args.length !== expected || (local ? false : refFlag !== 0 || !ref || !PROJECT_REF.test(ref))) {
    throw new Refusal('Usage: bootstrap-owner --project-ref <20-character project ref> | --local');
  }
  if (!databaseUrl) throw new Refusal('DATABASE_URL is not set.');

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Refusal('DATABASE_URL is not a valid connection string.');
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Refusal('DATABASE_URL is not a postgres:// string.');

  if (local) {
    if (!isLocalHost(url.hostname)) throw new Refusal('--local was given but DATABASE_URL is not a local database.');
    return { connectionString: databaseUrl, description: `LOCAL database ${url.hostname}:${url.port || '5432'}` };
  }

  // Hosted: the project must be named consistently by the flag, the connection user and SUPABASE_URL.
  if (isLocalHost(url.hostname) || url.port === '54322') {
    throw new Refusal(`DATABASE_URL points at a local database, not project ${ref}. Nothing was changed.`);
  }
  const userRef = /^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(url.username))?.[1];
  if (userRef !== ref) {
    throw new Refusal(`DATABASE_URL does not name project ${ref} (user postgres.${ref}). Nothing was changed.`);
  }
  let apiHost = '';
  try {
    apiHost = new URL(process.env.SUPABASE_URL ?? '').hostname;
  } catch {
    // reported below
  }
  if (apiHost !== `${ref}.supabase.co`) {
    throw new Refusal(`SUPABASE_URL does not name project ${ref}. Nothing was changed.`);
  }

  // The pool verifies a hosted Supabase connection against Supabase's root CA (src/db/pool.ts).
  return { connectionString: databaseUrl, description: `HOSTED Supabase project ${ref} (${url.hostname}), TLS verified` };
}

interface Outcome {
  accountId: string;
  created: boolean;
  alreadyOwner: boolean;
}

/** One transaction: create or reuse the account, then grant the owner role. */
async function bootstrap(connectionString: string, email: string, password: string): Promise<Outcome> {
  const pool = createDatabasePool({ connectionString, max: 1, onError: () => undefined });
  try {
    return await withServiceRole(pool, async (client) => {
      const owners = await client.query<{ email: string | null }>(
        `select p.email from public.user_roles r join public.profiles p on p.id = r.user_id where r.role = 'super_admin'`,
      );
      if (owners.rows.length > 0) {
        const ours = owners.rows.length === 1 && owners.rows[0]?.email?.toLowerCase() === email;
        if (!ours) throw new Refusal('A different owner already exists. Nothing was changed.');
        const found = await client.query<{ id: string }>('select id from public.login_lookup($1)', [email]);
        return { accountId: found.rows[0]?.id ?? '', created: false, alreadyOwner: true };
      }

      const existing = await client.query<{ id: string; has_password: boolean; verified: boolean }>(
        `select id, (password_hash is not null) as has_password, (email_verified_at is not null) as verified
           from public.login_lookup($1)`,
        [email],
      );
      const account = existing.rows[0];
      let accountId: string;
      let created = false;
      if (!account) {
        accountId = randomUUID();
        await client.query('select public.provision_account($1::uuid, $2, null, null, $3, true)', [
          accountId,
          email,
          await hashPassword(password),
        ]);
        created = true;
      } else if (account.has_password && account.verified) {
        accountId = account.id;
      } else {
        throw new Refusal(
          'That address already has an account that is unverified or has no password. It was left unchanged; resolve it deliberately (for example with "Forgot your password?"), then run this again.',
        );
      }

      await client.query('select public.bootstrap_owner($1)', [email]);
      return { accountId, created, alreadyOwner: false };
    });
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/** Name and codes only: a driver message can echo connection details. */
function sanitized(error: unknown): string {
  const e = error as { name?: unknown; code?: unknown; severity?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : 'none';
  const name = typeof e?.name === 'string' ? e.name : 'Error';
  const hints: Record<string, string> = {
    SELF_SIGNED_CERT_IN_CHAIN: 'the server certificate is not trusted: see src/db/supabase-ca.ts',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'the server certificate is not trusted: see src/db/supabase-ca.ts',
    ENOTFOUND: 'the database host name did not resolve',
    ECONNREFUSED: 'the connection was refused',
    ETIMEDOUT: 'the connection timed out',
    '28P01': 'the database rejected the password in DATABASE_URL',
    '28000': 'the database rejected the login',
    '42501': 'the connecting role lacks a privilege (service_role access)',
    NZ005: 'an owner already exists',
    NZ404: 'no verified account uses that address',
    NZ409: 'an account already uses that address',
  };
  return `${name} (code ${code})${hints[code] ? `: ${hints[code]}` : ''}`;
}

async function main(): Promise<number> {
  let target: Target;
  try {
    target = resolveTarget(process.argv.slice(2), process.env.DATABASE_URL);
  } catch (error) {
    if (error instanceof Refusal) return fail(error.message);
    throw error;
  }

  const email = emailSchema.safeParse(process.env.SUPER_ADMIN_EMAIL);
  if (!email.success) return fail('SUPER_ADMIN_EMAIL is missing or not a valid email address.');
  const password = process.env.SUPER_ADMIN_PASSWORD ?? '';
  if (password.length < OWNER_PASSWORD_MIN_LENGTH || !passwordSchema.safeParse(password).success) {
    return fail(
      `SUPER_ADMIN_PASSWORD is missing or too weak (at least ${OWNER_PASSWORD_MIN_LENGTH} characters, with letters and numbers, at most 72 bytes).`,
    );
  }

  say(`Target: ${target.description}`);
  say(`Owner account: ${email.data}`);
  try {
    const outcome = await bootstrap(target.connectionString, email.data, password);
    if (outcome.alreadyOwner) say(`This account is already the owner (${outcome.accountId}). Nothing was changed.`);
    else say(`${outcome.created ? 'Account created and ' : 'Existing verified account '}granted the owner role (${outcome.accountId}).`);
    return 0;
  } catch (error) {
    if (error instanceof Refusal) return fail(error.message);
    return fail(`Owner setup failed and was rolled back: ${sanitized(error)}`);
  }
}

process.exitCode = await main();
