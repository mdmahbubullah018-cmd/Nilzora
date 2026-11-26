import { randomBytes, randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAuthService, type AuthService } from '../../auth/first-party';
import { hashPassword } from '../../auth/passwords';
import { createSecretBox } from '../../auth/secret-box';
import { base32Decode, totpCode, totpStep } from '../../auth/totp';
import {
  createTwoFactorService,
  TwoFactorError,
  type TwoFactorCaller,
  type TwoFactorService,
} from '../../auth/two-factor';
import { createDatabasePool } from '../../db/pool';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { createErrorHandler } from '../../middleware/error-handler';
import { twoFactorRouter } from '../../modules/auth/two-factor-routes';
import type { AuthGateway } from '../../modules/auth/gateway';
import { createPostgresAccountStore } from '../../modules/users/accounts';
import { usersRouter } from '../../modules/users/routes';
import { createLogger } from '../../logging/logger';

/*
 * Super_admin two-factor authentication against the real database (migration 20261231102000):
 * enrollment, activation, replay protection, recovery codes, lockout, reset, the session-family
 * rule (refresh rotation keeps the verification, a new sign-in does not), and the server-side
 * enforcement in authenticate() for REST.
 */

interface ErrorBody {
  error: { code: string; details?: unknown };
}

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 4 });
const run = randomUUID().slice(0, 8);
const PASSWORD = 'Correct-horse-42';
const users: string[] = [];
let clock = Date.UTC(2026, 10, 22, 12, 0, 0);
const at = (step: number) => step * 30_000 + 5_000;

let auth: AuthService;
let twoFactor: TwoFactorService;
let ownerEmail: string;
let ownerId: string;
let customerEmail: string;
let app: Express;

async function addAccount(
  label: string,
  role: 'super_admin' | 'customer',
): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `it-2fa-${run}-${label}@example.com`;
  await pool.query('select public.provision_account($1::uuid, $2, $3, null, $4, true)', [
    id,
    email,
    `2FA ${label}`,
    await hashPassword(PASSWORD),
  ]);
  if (role !== 'customer')
    await pool.query('update public.user_roles set role = $2 where user_id = $1', [id, role]);
  users.push(id);
  return { id, email };
}

async function signIn(email: string) {
  const session = await auth.login(email, PASSWORD);
  const resolved = await auth.resolve(session.tokens.accessToken);
  if (!resolved) throw new Error('session did not resolve');
  const caller: TwoFactorCaller = { userId: resolved.userId, sessionId: resolved.sessionId, email };
  return { tokens: session.tokens, caller };
}

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    (error: unknown) => (error instanceof TwoFactorError ? error.failure : String(error)),
  );

beforeAll(async () => {
  auth = createAuthService({ pool, email: undefined, codeSecret: randomBytes(32).toString('hex') });
  twoFactor = createTwoFactorService({
    pool,
    box: createSecretBox(randomBytes(32)),
    pepper: randomBytes(32).toString('hex'),
    now: () => clock,
  });
  ({ id: ownerId, email: ownerEmail } = await addAccount('owner', 'super_admin'));
  ({ email: customerEmail } = await addAccount('customer', 'customer'));

  const gateway = { verifyAccessToken: () => Promise.resolve(null) } as unknown as AuthGateway;
  const deps: AuthDependencies = {
    gateway,
    accounts: createPostgresAccountStore(pool),
    sessions: auth,
    twoFactor,
  };
  app = express();
  app.use(express.json());
  app.use(
    '/api/v1',
    twoFactorRouter({
      auth: deps,
      service: twoFactor,
      rateLimit: { windowMs: 60_000, limit: 1000 },
    }),
  );
  app.use('/api/v1', usersRouter(deps));
  app.get('/api/v1/probe', authenticate(deps), (_req, res) => {
    res.json({ ok: true });
  });
  app.use(createErrorHandler(createLogger({ nodeEnv: 'test', logLevel: 'silent' })));
});

afterAll(async () => {
  await pool.query('delete from public.audit_log where actor_id = any($1::uuid[])', [users]);
  await pool.query('delete from public.profiles where id = any($1::uuid[])', [users]);
  await pool.end();
});

describe('super_admin two-factor authentication', () => {
  let secret: Buffer;
  let recoveryCodes: string[];
  let first: Awaited<ReturnType<typeof signIn>>;

  it('is required for the owner and not for a customer, whose sign-in is unchanged', async () => {
    first = await signIn(ownerEmail);
    expect(await twoFactor.state(ownerId, first.caller.sessionId)).toMatchObject({
      required: true,
      enrolled: false,
      verified: false,
    });
    const customer = await signIn(customerEmail);
    expect(
      (await twoFactor.state(customer.caller.userId, customer.caller.sessionId)).required,
    ).toBe(false);
    expect(await failure(twoFactor.enroll(customer.caller, PASSWORD))).toBe('not_required');
    // The customer's session is accepted everywhere, exactly as before.
    const probe = await request(app)
      .get('/api/v1/probe')
      .set('Authorization', `Bearer ${customer.tokens.accessToken}`);
    expect(probe.status).toBe(200);
  });

  it('refuses every privileged request until 2FA passes, but answers /me with the state', async () => {
    const bearer = `Bearer ${first.tokens.accessToken}`;
    const probe = await request(app).get('/api/v1/probe').set('Authorization', bearer);
    expect(probe.status).toBe(403);
    expect((probe.body as ErrorBody).error.code).toBe('two_factor_required');
    const me = await request(app).get('/api/v1/me').set('Authorization', bearer);
    expect(me.status).toBe(200);
    expect((me.body as { user: { twoFactor: unknown } }).user.twoFactor).toEqual({
      required: true,
      enrolled: false,
      verified: false,
    });
  });

  it('needs the password to start enrollment, and never stores the secret in plaintext', async () => {
    expect(await failure(twoFactor.enroll(first.caller, 'wrong-password'))).toBe(
      'invalid_password',
    );
    expect(await failure(twoFactor.enroll(first.caller, undefined))).toBe('invalid_password');
    const enrolled = await twoFactor.enroll(first.caller, PASSWORD);
    secret = base32Decode(new URL(enrolled.otpauthUri).searchParams.get('secret') ?? '');
    expect(secret.length).toBe(20);
    const stored = await pool.query<{ secret_ciphertext: string }>(
      'select secret_ciphertext from public.admin_two_factor where user_id = $1',
      [ownerId],
    );
    expect(stored.rows[0]?.secret_ciphertext.startsWith('v1:')).toBe(true);
    expect(stored.rows[0]?.secret_ciphertext).not.toContain(enrolled.secret.replace(/ /g, ''));
  });

  it('activates only with a current code, then issues ten recovery codes stored as hashes', async () => {
    const step = totpStep(clock);
    expect(
      await failure(
        twoFactor.activate(first.caller, '000000' === totpCode(secret, step) ? '111111' : '000000'),
      ),
    ).toBe('invalid_code');
    // A code from two steps ago is outside the window.
    expect(await failure(twoFactor.activate(first.caller, totpCode(secret, step - 2)))).toBe(
      'invalid_code',
    );
    ({ recoveryCodes } = await twoFactor.activate(first.caller, totpCode(secret, step)));
    expect(recoveryCodes).toHaveLength(10);
    const hashes = await pool.query<{ code_hash: Buffer }>(
      'select code_hash from public.admin_two_factor_recovery_codes where user_id = $1 and used_at is null and revoked_at is null',
      [ownerId],
    );
    expect(hashes.rows).toHaveLength(10);
    for (const row of hashes.rows)
      expect(row.code_hash.toString()).not.toContain(recoveryCodes[0]?.replace(/-/g, ''));
    expect((await twoFactor.state(ownerId, first.caller.sessionId)).verified).toBe(true);
    const probe = await request(app)
      .get('/api/v1/probe')
      .set('Authorization', `Bearer ${first.tokens.accessToken}`);
    expect(probe.status).toBe(200);
  });

  it('keeps the verification across a refresh-token rotation, but not into a new sign-in', async () => {
    const rotated = await auth.refresh(first.tokens.refreshToken);
    const resolved = await auth.resolve(rotated.tokens.accessToken);
    expect(resolved?.sessionId).not.toBe(first.caller.sessionId);
    expect((await twoFactor.state(ownerId, resolved?.sessionId ?? '')).verified).toBe(true);

    const second = await signIn(ownerEmail);
    expect((await twoFactor.state(ownerId, second.caller.sessionId)).verified).toBe(false);
  });

  it('refuses a replayed code (the step already used), and accepts the next one', async () => {
    const second = await signIn(ownerEmail);
    const used = totpStep(clock);
    expect(await failure(twoFactor.verify(second.caller, totpCode(secret, used)))).toBe(
      'invalid_code',
    );
    clock = at(used + 1);
    await twoFactor.verify(second.caller, totpCode(secret, used + 1));
    expect((await twoFactor.state(ownerId, second.caller.sessionId)).verified).toBe(true);
  });

  it('accepts each recovery code once, in any case or spacing', async () => {
    const third = await signIn(ownerEmail);
    const code = recoveryCodes[0] ?? '';
    expect(
      await twoFactor.useRecoveryCode(third.caller, code.toLowerCase().replace(/-/g, ' ')),
    ).toEqual({
      recoveryCodesLeft: 9,
    });
    expect((await twoFactor.state(ownerId, third.caller.sessionId)).verified).toBe(true);
    const fourth = await signIn(ownerEmail);
    expect(await failure(twoFactor.useRecoveryCode(fourth.caller, code))).toBe('invalid_code');
    expect(await failure(twoFactor.useRecoveryCode(fourth.caller, 'ABCD-EFGH-JKMN'))).toBe(
      'invalid_code',
    );
  });

  it('locks verification after five wrong codes, even for a correct one, until the lock ends', async () => {
    const fifth = await signIn(ownerEmail);
    // Two failures already counted by the recovery-code test above.
    const wrong = () => twoFactor.verify(fifth.caller, totpCode(secret, totpStep(clock) + 5));
    const outcomes: string[] = [];
    for (let i = 0; i < 3; i += 1) outcomes.push(await failure(wrong()));
    expect(outcomes.at(-1)).toBe('locked');
    clock = at(totpStep(clock) + 1);
    expect(await failure(twoFactor.verify(fifth.caller, totpCode(secret, totpStep(clock))))).toBe(
      'locked',
    );
    await pool.query(
      "update public.admin_two_factor set locked_until = now() - interval '1 second' where user_id = $1",
      [ownerId],
    );
    await twoFactor.verify(fifth.caller, totpCode(secret, totpStep(clock)));
  });

  it('records every step in the audit log, with no code or secret in it', async () => {
    const audit = await pool.query<{ action: string; details: unknown }>(
      "select action, details from public.audit_log where target_id = $1 and action like 'two_factor.%'",
      [ownerId],
    );
    const actions = new Set(audit.rows.map((row) => row.action));
    for (const action of [
      'two_factor.enrollment_started',
      'two_factor.activated',
      'two_factor.verified',
      'two_factor.recovery_code_used',
      'two_factor.verification_failed',
      'two_factor.locked',
    ]) {
      expect(actions.has(action)).toBe(true);
    }
    const text = JSON.stringify(audit.rows);
    expect(text).not.toContain(recoveryCodes[1]?.replace(/-/g, '') ?? 'x');
    expect(text).not.toContain(totpCode(secret, totpStep(clock)));
  });

  it('resets only with the password and a second factor, and then requires enrollment again', async () => {
    const sixth = await signIn(ownerEmail);
    clock = at(totpStep(clock) + 1);
    expect(
      await failure(
        twoFactor.reset(sixth.caller, 'wrong-password', totpCode(secret, totpStep(clock))),
      ),
    ).toBe('invalid_password');
    await twoFactor.reset(sixth.caller, PASSWORD, recoveryCodes[2] ?? '');
    const after = await twoFactor.state(ownerId, first.caller.sessionId);
    expect(after).toMatchObject({ enrolled: false, verified: false, recoveryCodesLeft: 0 });
    const probe = await request(app)
      .get('/api/v1/probe')
      .set('Authorization', `Bearer ${sixth.tokens.accessToken}`);
    expect(probe.status).toBe(403);
    expect((probe.body as ErrorBody).error).toMatchObject({
      code: 'two_factor_required',
      details: { enrolled: false },
    });
  });

  it('serves the routes only for the caller, and validates the input', async () => {
    const seventh = await signIn(ownerEmail);
    const bearer = `Bearer ${seventh.tokens.accessToken}`;
    const status = await request(app).get('/api/v1/auth/two-factor').set('Authorization', bearer);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ required: true, enrolled: false, verified: false });
    expect(JSON.stringify(status.body)).not.toMatch(/secret|cipher/i);
    const bad = await request(app)
      .post('/api/v1/auth/two-factor/verify')
      .set('Authorization', bearer)
      .send({ code: 'abc' });
    expect(bad.status).toBe(400);
    const anonymous = await request(app)
      .post('/api/v1/auth/two-factor/enroll')
      .send({ password: PASSWORD });
    expect(anonymous.status).toBe(401);
    // A wrong password is a 400 for this request, never a 401 (which clients take as an
    // expired session and answer with a refresh and a retry).
    const wrong = await request(app)
      .post('/api/v1/auth/two-factor/enroll')
      .set('Authorization', bearer)
      .send({ password: 'not-the-password' });
    expect(wrong.status).toBe(400);
    expect((wrong.body as ErrorBody).error.code).toBe('reauthentication_failed');
    const enroll = await request(app)
      .post('/api/v1/auth/two-factor/enroll')
      .set('Authorization', bearer)
      .send({ password: PASSWORD });
    expect(enroll.status).toBe(200);
    expect((enroll.body as { otpauthUri: string }).otpauthUri).toMatch(/^otpauth:\/\/totp\//);
  });
});
