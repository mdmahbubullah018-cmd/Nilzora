import type { Pool, PoolClient } from 'pg';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The claim set a PostgREST request carried for a signed-in user. The RLS policies and
 * the security-definer functions read `sub` (through `auth.uid()`) and `role`. A
 * first-party session adds `session_id`, which device tokens read to bind a push device to
 * the session that registered it; a Supabase JWT carries that claim itself and the token
 * is used through PostgREST instead.
 */
function userClaims(userId: string, sessionId?: string | null): string {
  if (sessionId === undefined || sessionId === null) {
    return JSON.stringify({ sub: userId, role: 'authenticated' });
  }
  return JSON.stringify({ sub: userId, role: 'authenticated', session_id: sessionId });
}

/**
 * Server-side limits for every transaction the API opens. The API's own connection has none of
 * the role timeouts PostgREST requests run with (those apply to a login, not to SET ROLE), so
 * without these a slow query or a transaction left open by a stuck request could hold a pooled
 * connection, and its row locks, indefinitely. Both are transaction-local, so they are safe
 * behind Supabase's transaction pooler and never leak into the next request on that connection.
 */
export interface TransactionLimits {
  /** One statement is cancelled after this long (PostgreSQL error 57014). */
  statementTimeoutMs: number;
  /** A transaction left idle (no statement running) this long is terminated. */
  idleInTransactionTimeoutMs: number;
}

export const DEFAULT_TRANSACTION_LIMITS: TransactionLimits = {
  statementTimeoutMs: 30_000,
  idleInTransactionTimeoutMs: 60_000,
};

function limitValues(limits: TransactionLimits): [string, string] {
  return [
    `${Math.round(limits.statementTimeoutMs)}ms`,
    `${Math.round(limits.idleInTransactionTimeoutMs)}ms`,
  ];
}

async function inTransaction<T>(
  pool: Pool,
  assumeRole: (client: PoolClient) => Promise<void>,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await assumeRole(client);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    // SET LOCAL is undone by the rollback, whatever the failure was.
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The role and the claims in one statement, both transaction-local. They used to be two
 * statements, which doubled the setup cost of every pool-backed request: the API is often
 * a continent away from the database, so each extra statement is an extra network round
 * trip before the query itself. `set_config('role', …)` is the function form of SET LOCAL
 * ROLE, and the role still comes in as a parameter, never as interpolated SQL.
 */
async function assumeIdentity(
  client: PoolClient,
  role: string,
  claims: string,
  limits: TransactionLimits = DEFAULT_TRANSACTION_LIMITS,
): Promise<void> {
  await client.query(
    "select set_config('role', $1, true), set_config('request.jwt.claims', $2, true), set_config('statement_timeout', $3, true), set_config('idle_in_transaction_session_timeout', $4, true)",
    [role, claims, ...limitValues(limits)],
  );
}

/**
 * Runs `fn` as one authenticated account, exactly as PostgREST did for a user-scoped
 * request: the `authenticated` role plus the JWT claims behind `auth.uid()`. Every
 * existing policy, trigger and security-definer function therefore keeps working
 * unchanged, and no other request can see the assumed identity.
 *
 * `userId` must be the verified account id of the caller — never a value taken from a
 * URL, the request body or an unverified token. `sessionId`, likewise, is only ever the
 * session the first-party resolver verified for that token: a caller-supplied value would
 * let one account attach its work to another account's session.
 */
export async function withUser<T>(
  pool: Pool,
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
  sessionId?: string | null,
): Promise<T> {
  if (!UUID.test(userId)) throw new TypeError('withUser requires a UUID account id');
  if (sessionId !== undefined && sessionId !== null && !UUID.test(sessionId)) {
    throw new TypeError('withUser requires a UUID session id');
  }
  return inTransaction(
    pool,
    (client) => assumeIdentity(client, 'authenticated', userClaims(userId, sessionId)),
    fn,
  );
}

/**
 * Runs `fn` as an anonymous visitor, exactly as PostgREST did for a request without a
 * session: the `anon` role and no `sub` claim, so `auth.uid()` is null inside. A function
 * that offers different content to a guest than to a customer can therefore tell them
 * apart without trusting anything from the request.
 */
export async function withAnon<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return inTransaction(pool, (client) => assumeIdentity(client, 'anon', '{"role":"anon"}'), fn);
}

/**
 * Runs `fn` with the privileges the API's service key had: the trusted server path for
 * routines such as `assign_user_role`. There is no `auth.uid()` in this context, so only
 * routines that take the acting account as a parameter may be called here.
 */
export async function withServiceRole<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
  limits: TransactionLimits = DEFAULT_TRANSACTION_LIMITS,
): Promise<T> {
  return inTransaction(
    pool,
    async (client) => {
      await client.query(
        "select set_config('role', 'service_role', true), set_config('statement_timeout', $1, true), set_config('idle_in_transaction_session_timeout', $2, true)",
        limitValues(limits),
      );
    },
    fn,
  );
}
