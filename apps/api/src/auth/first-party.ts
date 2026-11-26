import type { Pool, PoolClient } from 'pg';
import { withServiceRole } from '../db/user-context';
import {
  accountEmail,
  accountExistsEmail,
  authCodeEmail,
  type AccountEmailKind,
  type AuthEmailContext,
  type AuthEmailKind,
} from './emails';
import { hashPassword, verifyPassword } from './passwords';
import { codeHash, randomToken, sixDigitCode, tokenHash } from './tokens';
import { EmailUnavailableError, type EmailDiagnostic, type EmailSender } from './sender';

/** Every outcome the API turns into a stable error code. */
export type AuthFailure =
  | 'invalid_credentials'
  | 'account_suspended'
  | 'email_not_confirmed'
  | 'invalid_refresh_token'
  | 'weak_password'
  | 'account_exists'
  | 'invalid_code'
  | 'rate_limited'
  | 'unavailable'
  | 'email_unavailable'
  | 'oauth_unavailable'
  | 'invitation_invalid';

export class AuthError extends Error {
  override readonly name = 'AuthError';
  readonly failure: AuthFailure;

  constructor(failure: AuthFailure, options?: ErrorOptions) {
    super(`authentication failed: ${failure}`, options);
    this.failure = failure;
  }
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'bearer';
  expiresIn: number;
  expiresAt: number;
}

export interface IssuedSession {
  tokens: SessionTokens;
  userId: string;
}

/** What an opaque access token proves, read from the database rather than the token. */
export interface ResolvedSession {
  userId: string;
  sessionId: string;
  email: string | null;
}

export interface RegisterInput {
  email: string;
  password: string;
  fullName?: string | undefined;
  phone?: string | undefined;
}

export interface AuthService {
  register(input: RegisterInput): Promise<void>;
  /** Re-issues the verification code. Silent when the address has no claimable account. */
  resendEmailCode(email: string): Promise<void>;
  verifyEmail(email: string, code: string): Promise<IssuedSession>;
  login(email: string, password: string, userAgent?: string, ip?: string): Promise<IssuedSession>;
  refresh(refreshToken: string, userAgent?: string, ip?: string): Promise<IssuedSession>;
  logout(accessToken: string): Promise<void>;
  /**
   * Starts a session for an account that was authenticated another way (Google sign-in),
   * so every session this API issues goes through the same rotation and revocation rules.
   */
  createSession(userId: string): Promise<IssuedSession>;
  /** The first-party session behind an access token, or null. */
  resolve(accessToken: string): Promise<ResolvedSession | null>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(email: string, code: string, newPassword: string): Promise<void>;
  /**
   * Sends the account's queued emails (welcome, password changed) that the mail server has not
   * accepted yet. Each one is claimed atomically first, so concurrent calls never send one
   * twice and a sent one is never sent again. Resolves to how many were accepted.
   */
  deliverAccountEmails(userId: string): Promise<number>;
}

export interface AuthServiceOptions {
  pool: Pool;
  /** Undefined when SMTP is not configured: email-dependent routes answer 503. */
  email:
    | EmailSender
    | undefined; /** Pepper for six-digit codes. Required; the API refuses to start without it. */
  codeSecret: string;
  accessTtlSeconds?: number;
  refreshTtlSeconds?: number;
  passwordMinLength?: number;
  /**
   * Told which flow could not deliver a mail (never the address, code or provider message), so
   * the server can log it. The second argument is the safe SMTP diagnosis — reply code and
   * command, no reply text — which is what tells a broken credential from a blocked port.
   */
  onEmailFailure?: (
    flow: 'verify_email' | 'reset_password' | AccountEmailKind,
    diagnostic?: EmailDiagnostic,
  ) => void;
}

const DEFAULT_ACCESS_TTL = 900;
const DEFAULT_REFRESH_TTL = 30 * 24 * 60 * 60;

type SessionRow = {
  session_id: string;
  user_id: string;
  expires_at: Date;
  refresh_expires_at?: Date;
};

let decoy: Promise<string> | undefined;

/** A hash of a random secret, made once: what a sign-in for an unknown address is checked against. */
function decoyHash(): Promise<string> {
  decoy ??= hashPassword(randomToken());
  return decoy;
}

/** PostgreSQL custom SQLSTATEs the identity functions raise. */
function failureOf(error: unknown): AuthFailure | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'NZ409') return 'account_exists';
  if (code === 'NZ429') return 'rate_limited';
  return undefined;
}

export function createAuthService({
  pool,
  email,
  codeSecret,
  accessTtlSeconds = DEFAULT_ACCESS_TTL,
  refreshTtlSeconds = DEFAULT_REFRESH_TTL,
  passwordMinLength = 10,
  onEmailFailure,
}: AuthServiceOptions): AuthService {
  const access = `${accessTtlSeconds} seconds`;
  const refresh = `${refreshTtlSeconds} seconds`;
  const pepper = tokenHash(codeSecret).toString('hex');

  function requireEmail(): EmailSender {
    if (!email) throw new AuthError('email_unavailable');
    return email;
  }

  /** Optional public artwork and storefront links; nothing is guessed when they are unset. */
  function emailContext(): AuthEmailContext {
    return { logoUrl: process.env.EMAIL_LOGO_URL, siteUrl: process.env.EMAIL_SITE_URL };
  }

  async function sendCode(to: string, code: string, kind: AuthEmailKind): Promise<void> {
    await requireEmail().send({ to, ...authCodeEmail(kind, code, emailContext()) });
  }

  /** Runs a database step and turns its custom refusals into AuthErrors. */
  async function db<T>(step: (client: PoolClient) => Promise<T>): Promise<T> {
    try {
      return await withServiceRole(pool, step);
    } catch (error) {
      const failure = failureOf(error);
      if (failure) throw new AuthError(failure, { cause: error });
      throw new AuthError('unavailable', { cause: error });
    }
  }

  /** Sends whatever is due for an account, never throwing: the outbox keeps the state. */
  async function deliverAccountEmails(userId: string): Promise<number> {
    if (!email) return 0;
    const sender = email;
    let accepted = 0;
    let due: string[];
    try {
      due = await withServiceRole(pool, async (client) => {
        const result = await client.query<{ id: string }>(
          'select public.account_emails_due($1::uuid) as id',
          [userId],
        );
        return result.rows.map((row) => row.id);
      });
    } catch {
      return 0;
    }
    for (const id of due) {
      const claimed = await withServiceRole(pool, async (client) => {
        const result = await client.query<{
          id: string;
          kind: AccountEmailKind;
          email: string | null;
          full_name: string | null;
        }>('select * from public.claim_account_email($1::uuid)', [id]);
        return result.rows[0] ?? null;
      }).catch(() => null);
      // Someone else is sending it (or already did): never twice.
      if (!claimed || !claimed.email) continue;
      let sent = false;
      let problem: string | null = null;
      try {
        await sender.send({
          to: claimed.email,
          ...accountEmail(claimed.kind, { ...emailContext(), name: claimed.full_name }),
        });
        sent = true;
      } catch (error) {
        // Only a short reason is stored, never the provider's message (it can echo the address).
        problem = error instanceof EmailUnavailableError ? 'smtp_not_accepted' : 'send_error';
        onEmailFailure?.(
          claimed.kind,
          error instanceof EmailUnavailableError ? error.diagnostic : undefined,
        );
      }
      await withServiceRole(pool, async (client) => {
        await client.query('select public.finish_account_email($1::uuid, $2, $3)', [
          id,
          sent,
          problem,
        ]);
      }).catch(() => undefined);
      if (sent) accepted += 1;
    }
    return accepted;
  }

  /** Starts delivery without holding up the response; the outbox records the outcome. */
  function deliverInBackground(userId: string): void {
    void deliverAccountEmails(userId).catch(() => undefined);
  }

  function tokensOf(row: SessionRow, accessToken: string, refreshToken: string): SessionTokens {
    return {
      accessToken,
      refreshToken,
      tokenType: 'bearer',
      expiresIn: accessTtlSeconds,
      expiresAt: Math.floor(row.expires_at.getTime() / 1000),
    };
  }

  async function issueSession(
    userId: string,
    userAgent: string | undefined,
    ip: string | undefined,
  ): Promise<SessionTokens> {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const rows = await withServiceRole(pool, async (client) => {
      const result = await client.query<SessionRow>(
        `select session_id, family_id, expires_at, refresh_expires_at
           from public.create_session($1::uuid, $2, $3, $4::interval, $5::interval, $6, $7)`,
        [
          userId,
          tokenHash(accessToken),
          tokenHash(refreshToken),
          access,
          refresh,
          userAgent ?? null,
          ip ?? null,
        ],
      );
      return result.rows;
    });
    const row = rows[0];
    if (!row) throw new AuthError('unavailable');
    return tokensOf(row, accessToken, refreshToken);
  }

  return {
    /*
     * Sign-up creates no account. The details wait in a pending registration until the
     * emailed code is redeemed (verifyEmail), which creates the account in the same
     * transaction. If the code cannot be sent, the pending registration and its code are
     * removed again and the caller is told: a delivery failure leaves nothing behind.
     *
     * An address that already belongs to a verified account gets a notice instead of a code,
     * through the same send, so both cases answer alike (202, or 503 when mail fails, or 429
     * when the per-address throttle trips) and the form cannot be used to find accounts.
     */
    async register({ email: address, password, fullName, phone }) {
      // Refuse before storing anything when mail could never be delivered.
      const sender = requireEmail();
      if (password.length < passwordMinLength) throw new AuthError('weak_password');
      const normalized = address.trim().toLowerCase();
      const hashValue = await hashPassword(password);
      const code = sixDigitCode();

      const outcome = await db(async (client) => {
        const result = await client.query<{ outcome: 'code_issued' | 'account_exists' }>(
          `select public.begin_registration($1, $2, $3, $4, $5, interval '10 minutes') as outcome`,
          [
            normalized,
            hashValue,
            fullName ?? null,
            phone ?? null,
            codeHash(pepper, normalized, 'verify_email', code),
          ],
        );
        return result.rows[0]?.outcome ?? null;
      });
      if (outcome === null) throw new AuthError('unavailable');

      try {
        if (outcome === 'account_exists') {
          await sender.send({ to: normalized, ...accountExistsEmail(emailContext()) });
        } else {
          await sendCode(normalized, code, 'verify_email');
        }
      } catch (error) {
        if (outcome === 'code_issued') {
          await withServiceRole(pool, async (client) => {
            await client.query('select public.cancel_registration($1)', [normalized]);
          }).catch(() => undefined);
        }
        onEmailFailure?.(
          'verify_email',
          error instanceof EmailUnavailableError ? error.diagnostic : undefined,
        );
        if (error instanceof EmailUnavailableError) {
          throw new AuthError('email_unavailable', { cause: error });
        }
        throw error;
      }
    },

    async resendEmailCode(address) {
      requireEmail();
      const normalized = address.trim().toLowerCase();
      const code = sixDigitCode();
      // Throttled per address before anything is looked up; unknown and already-verified
      // addresses get no mail, so this route cannot be used to discover who has an account.
      const issued = await db(async (client) => {
        const result = await client.query<{ issued: boolean }>(
          `select public.reissue_verification_code($1, $2, interval '10 minutes') as issued`,
          [normalized, codeHash(pepper, normalized, 'verify_email', code)],
        );
        return result.rows[0]?.issued === true;
      });
      if (!issued) return;
      try {
        await sendCode(normalized, code, 'verify_email');
      } catch (error) {
        if (error instanceof EmailUnavailableError) {
          onEmailFailure?.('verify_email', error.diagnostic);
          throw new AuthError('email_unavailable', { cause: error });
        }
        throw error;
      }
    },

    async verifyEmail(address, code) {
      const normalized = address.trim().toLowerCase();
      // Redeems the code and creates (or activates) the account in one transaction; a wrong,
      // expired, reused or exhausted code changes nothing.
      const userId = await db(async (client) => {
        const result = await client.query<{ user_id: string | null }>(
          'select public.complete_registration($1, $2) as user_id',
          [normalized, codeHash(pepper, normalized, 'verify_email', code)],
        );
        return result.rows[0]?.user_id ?? null;
      });
      if (!userId) throw new AuthError('invalid_code');

      const session = { tokens: await issueSession(userId, undefined, undefined), userId };
      // The account exists now, so its welcome email (queued once by the database) can go.
      deliverInBackground(userId);
      return session;
    },

    async login(address, password, userAgent, ip) {
      const normalized = address.trim().toLowerCase();
      let row:
        | {
            id: string;
            password_hash: string | null;
            status: string;
            email_verified_at: Date | null;
            locked_until: Date | null;
          }
        | undefined;
      try {
        const rows = await withServiceRole(pool, async (client) => {
          const result = await client.query<{
            id: string;
            password_hash: string | null;
            status: string;
            email_verified_at: Date | null;
            locked_until: Date | null;
          }>('select * from public.login_lookup($1)', [normalized]);
          return result.rows;
        });
        row = rows[0];
      } catch (error) {
        throw new AuthError('unavailable', { cause: error });
      }

      const locked =
        row?.locked_until !== null && row?.locked_until !== undefined
          ? row.locked_until.getTime() > Date.now()
          : false;
      if (!row || !row.password_hash || locked) {
        // Spend the same Argon2 work as a real check, so the response time does not reveal
        // whether the address has an account (or a password, or a lock).
        await verifyPassword(await decoyHash(), password);
        throw new AuthError('invalid_credentials');
      }

      const ok = await verifyPassword(row.password_hash, password);
      if (!ok) {
        await withServiceRole(pool, async (client) => {
          await client.query('select public.record_login_failure($1::uuid, 8)', [row.id]);
        }).catch(() => undefined);
        throw new AuthError('invalid_credentials');
      }
      if (row.email_verified_at === null) throw new AuthError('email_not_confirmed');
      if (row.status !== 'active') throw new AuthError('account_suspended');

      await withServiceRole(pool, async (client) => {
        await client.query('select public.clear_login_failures($1::uuid)', [row.id]);
      }).catch(() => undefined);

      const session = { tokens: await issueSession(row.id, userAgent, ip), userId: row.id };
      // Retries only an email the mail server never accepted; a sent welcome is never resent.
      deliverInBackground(row.id);
      return session;
    },

    async refresh(refreshToken, userAgent, ip) {
      const accessToken = randomToken();
      const nextRefresh = randomToken();
      let row: SessionRow | undefined;
      try {
        const rows = await withServiceRole(pool, async (client) => {
          const result = await client.query<SessionRow>(
            `select session_id, user_id, expires_at, refresh_expires_at
               from public.rotate_session($1, $2, $3, $4::interval, $5::interval, $6, $7)`,
            [
              tokenHash(refreshToken),
              tokenHash(accessToken),
              tokenHash(nextRefresh),
              access,
              refresh,
              userAgent ?? null,
              ip ?? null,
            ],
          );
          return result.rows;
        });
        row = rows[0];
      } catch (error) {
        throw new AuthError('unavailable', { cause: error });
      }
      if (!row) throw new AuthError('invalid_refresh_token');
      return { tokens: tokensOf(row, accessToken, nextRefresh), userId: row.user_id };
    },

    async logout(accessToken) {
      try {
        await withServiceRole(pool, async (client) => {
          await client.query('select public.revoke_session($1)', [tokenHash(accessToken)]);
        });
      } catch (error) {
        throw new AuthError('unavailable', { cause: error });
      }
    },

    async createSession(userId) {
      const session = { tokens: await issueSession(userId, undefined, undefined), userId };
      // A Google sign-up queues its welcome email; a later Google sign-in finds nothing due.
      deliverInBackground(userId);
      return session;
    },

    async resolve(accessToken) {
      try {
        return await withServiceRole(pool, async (client) => {
          const result = await client.query<{ user_id: string; session_id: string }>(
            'select user_id, session_id from public.resolve_session($1)',
            [tokenHash(accessToken)],
          );
          const row = result.rows[0];
          if (!row) return null;
          // The email travels with the identity so callers never need a second lookup.
          const profile = await client.query<{ email: string | null }>(
            'select email from public.profiles where id = $1::uuid',
            [row.user_id],
          );
          return {
            userId: row.user_id,
            sessionId: row.session_id,
            email: profile.rows[0]?.email ?? null,
          };
        });
      } catch {
        return null;
      }
    },

    /*
     * Answers the same way whether or not the address has an account: the per-address
     * throttle runs first for every address, and a failed send for a known address is not
     * reported to the caller (that would reveal the account). The unsent code is spent at
     * once, so it can never be used, and the failure is visible in the server logs only.
     */
    async requestPasswordReset(address) {
      // With no mail configured at all, every address gets the same 503.
      requireEmail();
      const normalized = address.trim().toLowerCase();
      const code = sixDigitCode();
      const issued = await db(async (client) => {
        const result = await client.query<{ issued: boolean }>(
          `select public.begin_password_reset($1, $2, interval '10 minutes') as issued`,
          [normalized, codeHash(pepper, normalized, 'reset_password', code)],
        );
        return result.rows[0]?.issued === true;
      });
      if (!issued) return;
      try {
        await sendCode(normalized, code, 'reset_password');
      } catch (error) {
        await withServiceRole(pool, async (client) => {
          await client.query('select public.cancel_password_reset($1)', [normalized]);
        }).catch(() => undefined);
        if (!(error instanceof EmailUnavailableError)) throw error;
        onEmailFailure?.('reset_password', error.diagnostic);
      }
    },

    async resetPassword(address, code, newPassword) {
      if (newPassword.length < passwordMinLength) throw new AuthError('weak_password');
      const normalized = address.trim().toLowerCase();
      // Hashed before the transaction so the code, the new password and the revocation of
      // every session commit together; a refused code leaves the account exactly as it was.
      const hashValue = await hashPassword(newPassword);
      const userId = await db(async (client) => {
        const result = await client.query<{ user_id: string | null }>(
          'select public.complete_password_reset($1, $2, $3) as user_id',
          [normalized, codeHash(pepper, normalized, 'reset_password', code), hashValue],
        );
        return result.rows[0]?.user_id ?? null;
      });
      if (!userId) throw new AuthError('invalid_code');
      // The "your password was changed" notice the database queued with the change.
      deliverInBackground(userId);
    },

    deliverAccountEmails,
  };
}
