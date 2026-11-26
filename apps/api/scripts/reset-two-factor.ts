/*
 * Break-glass reset of one account's two-factor authentication, for an owner who has lost both
 * their authenticator and every recovery code. It is an operator action on the server (it needs
 * DATABASE_URL), never an API route, so no signed-in account can reset another account's 2FA.
 *
 *   pnpm --filter @nilzora/api reset-two-factor --local --email owner@example.com
 *   pnpm --filter @nilzora/api reset-two-factor --project-ref <ref> --email owner@example.com
 *
 * One transaction through public.two_factor_reset(): the encrypted secret is removed, unused
 * recovery codes are revoked, and every session that had passed 2FA must pass it again. The
 * account must enroll again on its next sign-in (it still needs its password). The reset is
 * written to the audit log with a null actor and `by_operator: true`. Nothing else changes.
 */
import { createDatabasePool } from '../src/db/pool';
import { withServiceRole } from '../src/db/user-context';

const PROJECT_REF = /^[a-z0-9]{20}$/;

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

function arg(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const local = args.includes('--local');
  const ref = arg(args, '--project-ref');
  const email = arg(args, '--email')?.trim().toLowerCase();
  const databaseUrl = process.env.DATABASE_URL;
  if ((local ? Boolean(ref) : !ref || !PROJECT_REF.test(ref)) || !email || !email.includes('@')) {
    process.stderr.write(
      'Usage: reset-two-factor (--local | --project-ref <ref>) --email <address>\n',
    );
    return 1;
  }
  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL is not set.\n');
    return 1;
  }
  const url = new URL(databaseUrl);
  const isLocal = /^(127\.|localhost$)/.test(url.hostname);
  if (local !== isLocal) {
    process.stderr.write('The target flag does not match DATABASE_URL. Nothing was changed.\n');
    return 1;
  }
  if (!local && decodeURIComponent(url.username) !== `postgres.${ref}`) {
    process.stderr.write(`DATABASE_URL does not name project ${ref}. Nothing was changed.\n`);
    return 1;
  }

  say(`Target: ${local ? `LOCAL ${url.hostname}:${url.port}` : `HOSTED project ${ref}`}`);
  const pool = createDatabasePool({
    connectionString: databaseUrl,
    max: 1,
    onError: () => undefined,
  });
  try {
    const outcome = await withServiceRole(pool, async (client) => {
      const found = await client.query<{ id: string }>('select id from public.login_lookup($1)', [
        email,
      ]);
      const id = found.rows[0]?.id;
      if (!id) return null;
      const reset = await client.query<{ had: boolean }>(
        'select public.two_factor_reset($1::uuid, null, $2) as had',
        [id, 'operator break-glass reset (scripts/reset-two-factor.ts)'],
      );
      return { id, had: reset.rows[0]?.had === true };
    });
    if (!outcome) {
      process.stderr.write('No account uses that address. Nothing was changed.\n');
      return 1;
    }
    say(
      outcome.had
        ? `Two-factor authentication was reset for ${outcome.id}. The account must set it up again at its next sign-in.`
        : `${outcome.id} had no two-factor setup; any verified sessions were cleared.`,
    );
    return 0;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    process.stderr.write(
      `The reset failed (code ${typeof code === 'string' ? code : 'none'}). Nothing was changed.\n`,
    );
    return 1;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

process.exitCode = await main();
