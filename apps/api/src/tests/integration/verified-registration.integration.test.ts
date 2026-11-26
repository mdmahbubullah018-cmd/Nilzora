import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createAuthService, type AuthService } from '../../auth/first-party';
import { resolveGoogleAccount } from '../../auth/oauth';
import { hashPassword } from '../../auth/passwords';
import { EmailUnavailableError, type EmailMessage, type EmailSender } from '../../auth/sender';
import { createDatabasePool } from '../../db/pool';

/*
 * Registration, verification, password reset and account emails against the local
 * PostgreSQL database (migration 20261226090000). Mail is captured or made to fail by fake
 * senders; nothing leaves the machine. Fixtures use this run's own address prefix and are
 * removed afterwards.
 */

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 6 });
const run = randomUUID().slice(0, 8);
const PASSWORD = 'correct horse battery 2026';
const NEW_PASSWORD = 'another long one 2027';
const codeSecret = 'integration-test-code-pepper-at-least-32-chars';
const used = new Set<string>();

function address(label: string): string {
  const value = `it-vr-${run}-${label}@example.com`;
  used.add(value);
  return value;
}

/** A sender that records every message, or refuses them all while `failing` is true. */
function sender() {
  const sent: EmailMessage[] = [];
  const state = { failing: false };
  const email: EmailSender = {
    send(message) {
      if (state.failing) return Promise.reject(new EmailUnavailableError('refused by the test'));
      sent.push(message);
      return Promise.resolve();
    },
    // The in-memory double is always "reachable": these tests exercise the flows, not the wire.
    verify() {
      return state.failing
        ? Promise.reject(new EmailUnavailableError('refused by the test'))
        : Promise.resolve();
    },
  };
  return { sent, state, email };
}

function service(email: EmailSender): AuthService {
  return createAuthService({
    pool,
    email,
    codeSecret,
    accessTtlSeconds: 900,
    refreshTtlSeconds: 3600,
  });
}

function codeIn(sent: EmailMessage[], to: string): string {
  const message = [...sent].reverse().find((item) => item.to === to);
  const match = message?.text.match(/\b(\d{6})\b/);
  if (!match?.[1]) throw new Error(`no code was emailed to ${to}`);
  return match[1];
}

async function clearThrottle(emailAddress: string): Promise<void> {
  await pool.query(
    "delete from public.auth_mail_log where email_hash = extensions.digest(lower($1), 'sha256')",
    [emailAddress],
  );
}

async function rows(sql: string, values: unknown[]): Promise<Record<string, unknown>[]> {
  return (await pool.query(sql, values)).rows as Record<string, unknown>[];
}

async function profileOf(emailAddress: string) {
  const result = await pool.query<{
    id: string;
    password_hash: string | null;
    email_verified_at: Date | null;
  }>('select id, password_hash, email_verified_at from public.profiles where email = $1', [
    emailAddress,
  ]);
  return result.rows[0] ?? null;
}

async function welcomeRows(userId: string) {
  return (
    await pool.query<{ status: string; attempts: number }>(
      "select status, attempts from public.account_emails where user_id = $1 and kind = 'welcome'",
      [userId],
    )
  ).rows;
}

/** Waits until background delivery for an account has settled (every email sent or failed). */
async function settled(userId: string): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    const busy = await rows(
      "select 1 from public.account_emails where user_id = $1 and status in ('pending', 'sending')",
      [userId],
    );
    if (busy.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

afterAll(async () => {
  await pool.query('delete from public.profiles where email like $1', [`it-vr-${run}-%`]);
  await pool.query('delete from public.auth_pending_registrations where email like $1', [
    `it-vr-${run}-%`,
  ]);
  await pool.query('delete from public.auth_email_codes where lower(email) like $1', [
    `it-vr-${run}-%`,
  ]);
  for (const emailAddress of used) await clearThrottle(emailAddress);
  await pool.end();
});

describe('a registration whose email cannot be delivered', () => {
  it('leaves no account, no pending sign-up and no usable code, and says so', async () => {
    const mail = sender();
    mail.state.failing = true;
    const auth = service(mail.email);
    const emailAddress = address('undeliverable');

    await expect(auth.register({ email: emailAddress, password: PASSWORD })).rejects.toMatchObject({
      failure: 'email_unavailable',
    });

    expect(await profileOf(emailAddress)).toBeNull();
    expect(
      await rows('select 1 from public.auth_pending_registrations where email = $1', [
        emailAddress,
      ]),
    ).toHaveLength(0);
    expect(
      await rows(
        'select 1 from public.auth_email_codes where lower(email) = $1 and consumed_at is null',
        [emailAddress],
      ),
    ).toHaveLength(0);
  });

  it('refuses outright, storing nothing, when no mail server is configured', async () => {
    const auth = createAuthService({ pool, email: undefined, codeSecret });
    const emailAddress = address('no-smtp');
    await expect(auth.register({ email: emailAddress, password: PASSWORD })).rejects.toMatchObject({
      failure: 'email_unavailable',
    });
    expect(
      await rows('select 1 from public.auth_pending_registrations where email = $1', [
        emailAddress,
      ]),
    ).toHaveLength(0);
  });
});

describe('verification codes', () => {
  it('locks a code after five wrong attempts; even the right code then creates nothing', async () => {
    const mail = sender();
    const auth = service(mail.email);
    const emailAddress = address('attempts');
    await auth.register({ email: emailAddress, password: PASSWORD });
    const code = codeIn(mail.sent, emailAddress);
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i += 1) {
      await expect(auth.verifyEmail(emailAddress, wrong)).rejects.toMatchObject({
        failure: 'invalid_code',
      });
    }
    await expect(auth.verifyEmail(emailAddress, code)).rejects.toMatchObject({
      failure: 'invalid_code',
    });
    expect(await profileOf(emailAddress)).toBeNull();
  });

  it('refuses an expired code and creates nothing', async () => {
    const mail = sender();
    const auth = service(mail.email);
    const emailAddress = address('expired');
    await auth.register({ email: emailAddress, password: PASSWORD });
    await pool.query(
      "update public.auth_email_codes set expires_at = now() - interval '1 second' where lower(email) = $1",
      [emailAddress],
    );
    await expect(
      auth.verifyEmail(emailAddress, codeIn(mail.sent, emailAddress)),
    ).rejects.toMatchObject({ failure: 'invalid_code' });
    expect(await profileOf(emailAddress)).toBeNull();
  });

  it('redeems a code once even when two verifications race', async () => {
    const mail = sender();
    const auth = service(mail.email);
    const emailAddress = address('race');
    await auth.register({ email: emailAddress, password: PASSWORD });
    const code = codeIn(mail.sent, emailAddress);

    const outcomes = await Promise.allSettled([
      auth.verifyEmail(emailAddress, code),
      auth.verifyEmail(emailAddress, code),
      auth.verifyEmail(emailAddress, code),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(
      await rows('select 1 from public.profiles where email = $1', [emailAddress]),
    ).toHaveLength(1);
    const userId = (await profileOf(emailAddress))?.id ?? '';
    await settled(userId);
    expect(await welcomeRows(userId)).toHaveLength(1);
  });

  it('resends a fresh code for a waiting sign-up and invalidates the previous one', async () => {
    const mail = sender();
    const auth = service(mail.email);
    const emailAddress = address('resend');
    await auth.register({ email: emailAddress, password: PASSWORD });
    const first = codeIn(mail.sent, emailAddress);
    await clearThrottle(emailAddress);
    await auth.resendEmailCode(emailAddress);
    const second = codeIn(mail.sent, emailAddress);

    if (first !== second) {
      await expect(auth.verifyEmail(emailAddress, first)).rejects.toMatchObject({
        failure: 'invalid_code',
      });
    }
    await expect(auth.verifyEmail(emailAddress, second)).resolves.toMatchObject({
      userId: expect.any(String) as unknown,
    });
  });

  it('sends nothing to an address that has no waiting sign-up', async () => {
    const mail = sender();
    const auth = service(mail.email);
    const emailAddress = address('resend-unknown');
    await auth.resendEmailCode(emailAddress);
    expect(mail.sent.filter((message) => message.to === emailAddress)).toHaveLength(0);
  });

  it('throttles codes per address: a minute apart, at most five an hour', async () => {
    const mail = sender();
    const auth = service(mail.email);
    const emailAddress = address('throttle');
    await auth.register({ email: emailAddress, password: PASSWORD });
    await expect(auth.resendEmailCode(emailAddress)).rejects.toMatchObject({
      failure: 'rate_limited',
    });
    // Five within the hour (spaced past the one-minute rule) is the limit.
    await pool.query(
      "update public.auth_mail_log set created_at = now() - interval '2 minutes' where email_hash = extensions.digest(lower($1), 'sha256')",
      [emailAddress],
    );
    for (let i = 0; i < 4; i += 1) {
      await pool.query(
        "insert into public.auth_mail_log (email_hash, kind, created_at) values (extensions.digest(lower($1), 'sha256'), 'register', now() - interval '5 minutes')",
        [emailAddress],
      );
    }
    await expect(auth.resendEmailCode(emailAddress)).rejects.toMatchObject({
      failure: 'rate_limited',
    });
  });
});

describe('a sign-up for an address held by a never-verified profile', () => {
  it('lets the verified owner take it over; the earlier password stops working', async () => {
    const mail = sender();
    const auth = service(mail.email);
    const emailAddress = address('legacy');
    // A profile the old flow created before codes were checked, with someone's password.
    await pool.query('select public.provision_account($1::uuid, $2, null, null, $3, false)', [
      randomUUID(),
      emailAddress,
      await hashPassword('the earlier password 1'),
    ]);

    await auth.register({ email: emailAddress, password: PASSWORD });
    const session = await auth.verifyEmail(emailAddress, codeIn(mail.sent, emailAddress));

    expect(session.userId).toBe((await profileOf(emailAddress))?.id);
    await expect(auth.login(emailAddress, PASSWORD)).resolves.toMatchObject({
      userId: session.userId,
    });
    await expect(auth.login(emailAddress, 'the earlier password 1')).rejects.toMatchObject({
      failure: 'invalid_credentials',
    });
  });
});

describe('the welcome email', () => {
  it('is sent once after verification, and never again on later sign-ins', async () => {
    const mail = sender();
    const auth = service(mail.email);
    const emailAddress = address('welcome');
    await auth.register({ email: emailAddress, password: PASSWORD, fullName: 'Rafi Ahmed' });
    const { userId } = await auth.verifyEmail(emailAddress, codeIn(mail.sent, emailAddress));
    await settled(userId);
    // Repeated calls, a sign-out and new sign-ins find nothing left to send.
    await auth.deliverAccountEmails(userId);
    await auth.login(emailAddress, PASSWORD);
    await auth.login(emailAddress, PASSWORD);
    await settled(userId);
    await auth.deliverAccountEmails(userId);

    const welcomes = mail.sent.filter(
      (message) => message.to === emailAddress && message.subject === 'Welcome to Nilzora',
    );
    expect(welcomes).toHaveLength(1);
    expect(welcomes[0]?.text).toContain('Hi Rafi,');
    expect(await welcomeRows(userId)).toEqual([{ status: 'sent', attempts: 1 }]);
  });

  it('records a refused send as failed, and a later attempt sends it exactly once', async () => {
    const mail = sender();
    const auth = service(mail.email);
    const emailAddress = address('welcome-retry');
    await auth.register({ email: emailAddress, password: PASSWORD });
    const code = codeIn(mail.sent, emailAddress);
    mail.state.failing = true;
    const { userId } = await auth.verifyEmail(emailAddress, code);
    await settled(userId);
    expect(await welcomeRows(userId)).toEqual([{ status: 'failed', attempts: 1 }]);

    mail.state.failing = false;
    const results = await Promise.all([
      auth.deliverAccountEmails(userId),
      auth.deliverAccountEmails(userId),
    ]);
    expect(results.reduce((total, value) => total + value, 0)).toBe(1);
    expect(await welcomeRows(userId)).toEqual([{ status: 'sent', attempts: 2 }]);
  });
});

describe('password reset', () => {
  it('changes the password with a single-use code, ends every session and sends a notice', async () => {
    const mail = sender();
    const auth = service(mail.email);
    const emailAddress = address('reset');
    await auth.register({ email: emailAddress, password: PASSWORD });
    const { userId } = await auth.verifyEmail(emailAddress, codeIn(mail.sent, emailAddress));
    const before = await auth.login(emailAddress, PASSWORD);

    await auth.requestPasswordReset(emailAddress);
    const code = codeIn(mail.sent, emailAddress);
    await auth.resetPassword(emailAddress, code, NEW_PASSWORD);
    await settled(userId);

    await expect(auth.login(emailAddress, PASSWORD)).rejects.toMatchObject({
      failure: 'invalid_credentials',
    });
    await expect(auth.login(emailAddress, NEW_PASSWORD)).resolves.toMatchObject({ userId });
    expect(await auth.resolve(before.tokens.accessToken)).toBeNull();
    await expect(
      auth.resetPassword(emailAddress, code, 'a third password 2028'),
    ).rejects.toMatchObject({ failure: 'invalid_code' });
    expect(
      mail.sent.filter(
        (message) =>
          message.to === emailAddress && message.subject === 'Your Nilzora password was changed',
      ),
    ).toHaveLength(1);
  });

  it('changes nothing with a wrong code', async () => {
    const mail = sender();
    const auth = service(mail.email);
    const emailAddress = address('reset-wrong');
    await auth.register({ email: emailAddress, password: PASSWORD });
    await auth.verifyEmail(emailAddress, codeIn(mail.sent, emailAddress));
    await auth.requestPasswordReset(emailAddress);
    const code = codeIn(mail.sent, emailAddress);
    const wrong = code === '000000' ? '111111' : '000000';
    await expect(auth.resetPassword(emailAddress, wrong, NEW_PASSWORD)).rejects.toMatchObject({
      failure: 'invalid_code',
    });
    await expect(auth.login(emailAddress, PASSWORD)).resolves.toBeTruthy();
  });

  it('answers an unknown address like a known one and sends it nothing', async () => {
    const mail = sender();
    const auth = service(mail.email);
    const emailAddress = address('reset-unknown');
    await expect(auth.requestPasswordReset(emailAddress)).resolves.toBeUndefined();
    expect(mail.sent.filter((message) => message.to === emailAddress)).toHaveLength(0);
  });

  it('spends a code it could not deliver, without revealing the account', async () => {
    const mail = sender();
    const auth = service(mail.email);
    const emailAddress = address('reset-undelivered');
    await auth.register({ email: emailAddress, password: PASSWORD });
    await auth.verifyEmail(emailAddress, codeIn(mail.sent, emailAddress));
    mail.state.failing = true;
    await expect(auth.requestPasswordReset(emailAddress)).resolves.toBeUndefined();
    expect(
      await rows(
        "select 1 from public.auth_email_codes where lower(email) = $1 and purpose = 'reset_password' and consumed_at is null",
        [emailAddress],
      ),
    ).toHaveLength(0);
  });
});

describe('Google sign-in on an address a password sign-up claimed but never verified', () => {
  it('drops that unverified password, activates the account and queues one welcome', async () => {
    const emailAddress = address('google-legacy');
    const id = randomUUID();
    await pool.query('select public.provision_account($1::uuid, $2, null, null, $3, false)', [
      id,
      emailAddress,
      await hashPassword('chosen by someone else 1'),
    ]);

    const identity = {
      subject: `google-${run}-legacy`,
      email: emailAddress,
      emailVerified: true,
      name: 'Owner',
    };
    expect(await resolveGoogleAccount(pool, identity)).toBe(id);
    expect(await resolveGoogleAccount(pool, identity)).toBe(id);

    const profile = await profileOf(emailAddress);
    expect(profile?.password_hash).toBeNull();
    expect(profile?.email_verified_at).not.toBeNull();
    expect(await welcomeRows(id)).toHaveLength(1);

    const auth = service(sender().email);
    await expect(auth.login(emailAddress, 'chosen by someone else 1')).rejects.toMatchObject({
      failure: 'invalid_credentials',
    });
  });

  it('creates one account and one welcome for a new Google user, however often they sign in', async () => {
    const emailAddress = address('google-new');
    const identity = {
      subject: `google-${run}-new`,
      email: emailAddress,
      emailVerified: true,
      name: 'New Google',
    };
    const first = await resolveGoogleAccount(pool, identity);
    const second = await resolveGoogleAccount(pool, identity);
    expect(second).toBe(first);
    expect(
      await rows('select 1 from public.profiles where email = $1', [emailAddress]),
    ).toHaveLength(1);
    expect(await welcomeRows(first)).toHaveLength(1);
  });
});
