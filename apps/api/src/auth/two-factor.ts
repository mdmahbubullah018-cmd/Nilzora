import { createHmac, randomInt } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withServiceRole } from '../db/user-context';
import { verifyPassword } from './passwords';
import type { SecretBox } from './secret-box';
import { base32Encode, generateTotpSecret, matchTotp, otpauthUri } from './totp';

/*
 * Two-factor authentication (TOTP) for the accounts that must use it (super_admin; see
 * private.two_factor_required). The flow:
 *
 *   enroll   password (re-authentication) -> new secret, encrypted, stored as "pending";
 *            the caller shows the QR code once
 *   activate a current code -> 2FA active, ten single-use recovery codes shown once, and this
 *            session family marked as verified
 *   verify   on every new sign-in: a current code (or one recovery code) marks the family
 *   reset    password + a current code (or recovery code) removes 2FA; the account must enroll
 *            again before any privileged request succeeds
 *
 * Secrets are decrypted only in this process and only to check a code. Codes, secrets and
 * recovery codes are never logged or returned except where the flow shows them to the owner.
 */

export type TwoFactorFailure =
  | 'invalid_code'
  | 'locked'
  | 'invalid_password'
  | 'reauthentication_required'
  | 'already_active'
  | 'not_enrolled'
  | 'not_required'
  | 'unavailable';

export class TwoFactorError extends Error {
  override readonly name = 'TwoFactorError';
  constructor(
    readonly failure: TwoFactorFailure,
    readonly lockedUntil: Date | null = null,
    options?: ErrorOptions,
  ) {
    super(`two-factor: ${failure}`, options);
  }
}

export interface TwoFactorState {
  /** Whether this account must pass 2FA before any privileged request. */
  required: boolean;
  enrolled: boolean;
  /** An enrollment was started but not confirmed with a code. */
  pending: boolean;
  /** This session (family) passed 2FA. */
  verified: boolean;
  lockedUntil: Date | null;
  recoveryCodesLeft: number;
  sessionIssuedAt: Date | null;
}

export interface TwoFactorCaller {
  userId: string;
  sessionId: string;
  email: string | null;
}

export interface TwoFactorService {
  state(userId: string, sessionId: string): Promise<TwoFactorState>;
  enroll(
    caller: TwoFactorCaller,
    password: string | undefined,
  ): Promise<{ otpauthUri: string; secret: string }>;
  activate(caller: TwoFactorCaller, code: string): Promise<{ recoveryCodes: string[] }>;
  verify(caller: TwoFactorCaller, code: string): Promise<void>;
  useRecoveryCode(caller: TwoFactorCaller, code: string): Promise<{ recoveryCodesLeft: number }>;
  replaceRecoveryCodes(caller: TwoFactorCaller, code: string): Promise<{ recoveryCodes: string[] }>;
  reset(caller: TwoFactorCaller, password: string | undefined, code: string): Promise<void>;
}

export interface TwoFactorServiceOptions {
  pool: Pool;
  box: SecretBox;
  /** Server pepper for the recovery-code hashes (the first-party OTP_HASH_SECRET). */
  pepper: string;
  /** For accounts without a password (Google sign-in): how recent the sign-in must be. */
  recentSignInSeconds?: number;
  now?: () => number;
}

const RECOVERY_CODE_COUNT = 10;
/** Unambiguous characters only (no 0/O, 1/I/L). 12 of them: about 60 bits each. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const RECOVERY_LENGTH = 12;

export function newRecoveryCode(): string {
  let code = '';
  for (let i = 0; i < RECOVERY_LENGTH; i += 1)
    code += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

/** Maps the database's refusals to stable failures. */
function failureOf(error: unknown): TwoFactorFailure | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'NZ429') return 'locked';
  if (code === 'NZ409') return 'already_active';
  if (code === 'NZ412' || code === 'NZ404') return 'not_enrolled';
  if (code === 'NZ403') return 'reauthentication_required';
  return undefined;
}

export function createTwoFactorService({
  pool,
  box,
  pepper,
  recentSignInSeconds = 10 * 60,
  now = Date.now,
}: TwoFactorServiceOptions): TwoFactorService {
  const recoveryHash = (code: string): Buffer =>
    createHmac('sha256', pepper)
      .update(`two-factor-recovery:${normalizeRecoveryCode(code)}`)
      .digest();

  async function db<T>(step: (client: PoolClient) => Promise<T>): Promise<T> {
    try {
      return await withServiceRole(pool, step);
    } catch (error) {
      const failure = failureOf(error);
      throw new TwoFactorError(failure ?? 'unavailable', null, { cause: error });
    }
  }

  async function state(userId: string, sessionId: string): Promise<TwoFactorState> {
    const row = await db(async (client) => {
      const result = await client.query<{
        required: boolean;
        enrolled: boolean;
        pending: boolean;
        verified: boolean;
        locked_until: Date | null;
        session_issued_at: Date | null;
        recovery_codes_left: number;
      }>('select * from public.two_factor_status($1::uuid, $2::uuid)', [userId, sessionId]);
      return result.rows[0];
    });
    return {
      required: row?.required ?? false,
      enrolled: row?.enrolled ?? false,
      pending: row?.pending ?? false,
      verified: row?.verified ?? false,
      lockedUntil: row?.locked_until ?? null,
      recoveryCodesLeft: row?.recovery_codes_left ?? 0,
      sessionIssuedAt: row?.session_issued_at ?? null,
    };
  }

  async function recordFailure(userId: string, reason: string): Promise<Date | null> {
    return db(async (client) => {
      const result = await client.query<{ locked: Date | null }>(
        'select public.two_factor_record_failure($1::uuid, $2) as locked',
        [userId, reason],
      );
      return result.rows[0]?.locked ?? null;
    }).catch(() => null);
  }

  /**
   * Re-authentication for the sensitive changes: the account password when it has one, else a
   * sign-in within the last few minutes (an account that only signs in with Google).
   */
  async function reauthenticate(
    caller: TwoFactorCaller,
    password: string | undefined,
  ): Promise<void> {
    const lookup = caller.email
      ? await db(async (client) => {
          const result = await client.query<{ id: string; password_hash: string | null }>(
            'select id, password_hash from public.login_lookup($1)',
            [caller.email?.trim().toLowerCase()],
          );
          return result.rows[0];
        })
      : undefined;
    const hash = lookup?.id === caller.userId ? lookup.password_hash : null;
    if (hash) {
      if (!password || !(await verifyPassword(hash, password))) {
        await db(async (client) => {
          await client.query('select public.record_login_failure($1::uuid, 8)', [caller.userId]);
        }).catch(() => undefined);
        throw new TwoFactorError('invalid_password');
      }
      return;
    }
    const current = await state(caller.userId, caller.sessionId);
    const issued = current.sessionIssuedAt?.getTime() ?? 0;
    if (now() - issued > recentSignInSeconds * 1000)
      throw new TwoFactorError('reauthentication_required');
  }

  /** Decrypts the secret and finds the step the code belongs to; counts a failure if none. */
  async function checkCode(
    userId: string,
    code: string,
    expected: 'pending' | 'active',
  ): Promise<number> {
    const material = await db(async (client) => {
      const result = await client.query<{
        secret_ciphertext: string;
        status: string;
        locked_until: Date | null;
      }>('select * from public.two_factor_material($1::uuid)', [userId]);
      return result.rows[0];
    });
    if (!material || material.status !== expected) throw new TwoFactorError('not_enrolled');
    if (material.locked_until) throw new TwoFactorError('locked', material.locked_until);
    let secret: Buffer;
    try {
      secret = box.open(material.secret_ciphertext);
    } catch (error) {
      // A wrong or rotated key: fail closed, never fall back to "no 2FA".
      throw new TwoFactorError('unavailable', null, { cause: error });
    }
    const step = matchTotp(secret, code, now());
    secret.fill(0);
    if (step === null) {
      const locked = await recordFailure(userId, 'invalid_code');
      throw new TwoFactorError(locked ? 'locked' : 'invalid_code', locked);
    }
    return step;
  }

  async function confirm(
    caller: TwoFactorCaller,
    step: number,
    activate: boolean,
    hashes: Buffer[],
  ) {
    const accepted = await db(async (client) => {
      const result = await client.query<{ ok: boolean }>(
        'select public.two_factor_confirm($1::uuid, $2::uuid, $3::bigint, $4, $5::bytea[]) as ok',
        [caller.userId, caller.sessionId, step, activate, hashes],
      );
      return result.rows[0]?.ok === true;
    });
    if (!accepted) {
      // The same code (or an older one) was already used: a replay.
      const locked = await recordFailure(caller.userId, 'replayed_code');
      throw new TwoFactorError(locked ? 'locked' : 'invalid_code', locked);
    }
  }

  function freshRecoveryCodes(): { codes: string[]; hashes: Buffer[] } {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    return { codes, hashes: codes.map(recoveryHash) };
  }

  async function verify(caller: TwoFactorCaller, code: string): Promise<void> {
    const step = await checkCode(caller.userId, code, 'active');
    await confirm(caller, step, false, []);
  }

  async function useRecoveryCode(
    caller: TwoFactorCaller,
    code: string,
  ): Promise<{ recoveryCodesLeft: number }> {
    const left = await db(async (client) => {
      const result = await client.query<{ left: number }>(
        'select public.two_factor_use_recovery_code($1::uuid, $2::uuid, $3) as left',
        [caller.userId, caller.sessionId, recoveryHash(code)],
      );
      return result.rows[0]?.left ?? -1;
    });
    if (left < 0) {
      const locked = await recordFailure(caller.userId, 'invalid_recovery_code');
      throw new TwoFactorError(locked ? 'locked' : 'invalid_code', locked);
    }
    return { recoveryCodesLeft: left };
  }

  return {
    state,
    verify,
    useRecoveryCode,

    async enroll(caller, password) {
      const current = await state(caller.userId, caller.sessionId);
      if (!current.required) throw new TwoFactorError('not_required');
      if (current.enrolled) throw new TwoFactorError('already_active');
      await reauthenticate(caller, password);
      const secret = generateTotpSecret();
      const sealed = box.seal(secret);
      await db(async (client) => {
        await client.query('select public.two_factor_begin($1::uuid, $2)', [caller.userId, sealed]);
      });
      const uri = otpauthUri(secret, caller.email ?? caller.userId);
      const text = base32Encode(secret)
        .replace(/(.{4})/g, '$1 ')
        .trim();
      secret.fill(0);
      return { otpauthUri: uri, secret: text };
    },

    async activate(caller, code) {
      const step = await checkCode(caller.userId, code, 'pending');
      const { codes, hashes } = freshRecoveryCodes();
      await confirm(caller, step, true, hashes);
      return { recoveryCodes: codes };
    },

    async replaceRecoveryCodes(caller, code) {
      await verify(caller, code);
      const { codes, hashes } = freshRecoveryCodes();
      await db(async (client) => {
        await client.query(
          'select public.two_factor_replace_recovery_codes($1::uuid, $2::uuid, $3::bytea[])',
          [caller.userId, caller.sessionId, hashes],
        );
      });
      return { recoveryCodes: codes };
    },

    async reset(caller, password, code) {
      await reauthenticate(caller, password);
      // Proof of the second factor too: a current code, or one of the recovery codes.
      const cleaned = code.replace(/\s/g, '');
      if (/^\d{6}$/.test(cleaned)) await verify(caller, cleaned);
      else await useRecoveryCode(caller, code);
      await db(async (client) => {
        await client.query('select public.two_factor_reset($1::uuid, $1::uuid, $2)', [
          caller.userId,
          'self-service reset after password and second factor',
        ]);
      });
    },
  };
}

/** True when the account's session may not make privileged requests yet. */
export function blocksPrivilegedUse(state: TwoFactorState): boolean {
  return state.required && !state.verified;
}
