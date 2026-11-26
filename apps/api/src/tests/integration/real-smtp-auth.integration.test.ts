import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { apiErrorBodySchema, authSessionSchema } from '@nilzora/contracts';
import { createApp } from '../../app';
import { createAuthService } from '../../auth/first-party';
import { createEmailSender } from '../../auth/sender';
import { createDatabasePool } from '../../db/pool';
import { createLogger } from '../../logging/logger';
import type { AuthGateway } from '../../modules/auth/gateway';
import { createPostgresAccountStore } from '../../modules/users/accounts';
import { testConfig } from '../helpers';

/*
 * The whole account journey over HTTP with REAL email delivery: messages go through nodemailer
 * to the local stack's Mailpit SMTP server (port 54325) and are read back from its API, so the
 * codes, the welcome email and the password notice are what a mail server actually accepted —
 * not what a fake sender recorded. Mailpit is a local catcher: nothing leaves the machine.
 */

const { dbUrl, mailUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 4 });
const run = randomUUID().slice(0, 8);
const PASSWORD = 'correct horse battery 2026';
const NEW_PASSWORD = 'another long one 2027';
const addresses: string[] = [];

const email = createEmailSender({
  host: '127.0.0.1',
  port: 54325,
  secure: false,
  user: undefined,
  password: undefined,
  from: 'Nilzora <no-reply@nilzora.local>',
});
if (!email) throw new Error('the SMTP sender could not be created');

const auth = createAuthService({ pool, email, codeSecret: `real-smtp-pepper-${run}-0123456789abcdef` });
const config = testConfig({ RATE_LIMIT_MAX: '10000', AUTH_RATE_LIMIT_MAX: '10000' });
const app = createApp({
  config,
  logger: createLogger(config),
  auth: {
    gateway: { verifyAccessToken: () => Promise.resolve(null) } as unknown as AuthGateway,
    accounts: createPostgresAccountStore(pool),
    sessions: auth,
  },
  firstParty: { service: auth },
});

interface MailSummary {
  ID: string;
  Subject: string;
}

/** Every message Mailpit holds for an address, oldest first. */
async function inbox(to: string): Promise<MailSummary[]> {
  const response = await fetch(
    `${mailUrl}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=50`,
  );
  const body = (await response.json()) as { messages?: MailSummary[] };
  return [...(body.messages ?? [])].reverse();
}

async function message(id: string): Promise<{ Text: string; HTML: string; Subject: string }> {
  const response = await fetch(`${mailUrl}/api/v1/message/${id}`);
  return (await response.json()) as { Text: string; HTML: string; Subject: string };
}

/** Waits for a message with this subject to reach the mail server. */
async function arrived(to: string, subject: string, count = 1): Promise<MailSummary[]> {
  for (let i = 0; i < 80; i += 1) {
    const found = (await inbox(to)).filter((item) => item.Subject === subject);
    if (found.length >= count) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return (await inbox(to)).filter((item) => item.Subject === subject);
}

async function codeFrom(to: string, subject: string, count = 1): Promise<string> {
  const found = await arrived(to, subject, count);
  const last = found[found.length - 1];
  if (!last) throw new Error(`no "${subject}" reached ${to}`);
  const match = (await message(last.ID)).Text.match(/\b(\d{6})\b/);
  if (!match?.[1]) throw new Error('no code in the message');
  return match[1];
}

function address(label: string): string {
  const value = `it-smtp-${run}-${label}@example.com`;
  addresses.push(value);
  return value;
}

afterAll(async () => {
  await pool.query('delete from public.profiles where email like $1', [`it-smtp-${run}-%`]);
  await pool.query('delete from public.auth_pending_registrations where email like $1', [
    `it-smtp-${run}-%`,
  ]);
  await pool.query('delete from public.auth_email_codes where lower(email) like $1', [
    `it-smtp-${run}-%`,
  ]);
  for (const value of addresses) {
    await pool.query(
      "delete from public.auth_mail_log where email_hash = extensions.digest(lower($1), 'sha256')",
      [value],
    );
  }
  await pool.end();
});

describe('the account journey with real SMTP delivery', () => {
  it('registers with an emailed code, welcomes once, and recovers a forgotten password', async () => {
    const to = address('journey');

    const registered = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: to, password: PASSWORD, fullName: 'Nadia Karim' });
    expect(registered.status).toBe(202);
    // Accepted by the mail server, and still no account before the code.
    const code = await codeFrom(to, 'Your Nilzora verification code');
    expect(
      (await pool.query('select 1 from public.profiles where email = $1', [to])).rows,
    ).toHaveLength(0);

    const verification = (await inbox(to))[0];
    const html = (await message(verification?.ID ?? '')).HTML;
    expect(html).toContain(`>${code}</td>`);
    expect(html).toContain('expires in 10 minutes');

    const verified = await request(app).post('/api/v1/auth/verify-otp').send({ email: to, code });
    expect(verified.status).toBe(200);
    authSessionSchema.parse(verified.body);

    // The welcome email reaches the mail server once…
    expect(await arrived(to, 'Welcome to Nilzora')).toHaveLength(1);
    // …and signing in again (twice) never sends another.
    for (let i = 0; i < 2; i += 1) {
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: to, password: PASSWORD });
      expect(login.status).toBe(200);
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect((await inbox(to)).filter((item) => item.Subject === 'Welcome to Nilzora')).toHaveLength(
      1,
    );
    const welcome = await message(
      (await arrived(to, 'Welcome to Nilzora'))[0]?.ID ?? '',
    );
    expect(welcome.Text).toContain('Hi Nadia,');

    // Forgot password → code by email → new password; the old one stops working.
    const forgot = await request(app).post('/api/v1/auth/forgot-password').send({ email: to });
    expect(forgot.status).toBe(202);
    const resetCode = await codeFrom(to, 'Reset your Nilzora password');
    const reset = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: to, code: resetCode, password: NEW_PASSWORD });
    expect(reset.status).toBe(204);
    expect(await arrived(to, 'Your Nilzora password was changed')).toHaveLength(1);

    const oldPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: to, password: PASSWORD });
    expect(oldPassword.status).toBe(401);
    expect(apiErrorBodySchema.parse(oldPassword.body).error.code).toBe('invalid_credentials');
    const newPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: to, password: NEW_PASSWORD });
    expect(newPassword.status).toBe(200);

    // The reset code was single use.
    const replay = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: to, code: resetCode, password: 'a third password 2028' });
    expect(replay.status).toBe(400);
    expect(apiErrorBodySchema.parse(replay.body).error.code).toBe('invalid_code');
  });

  it('tells the owner of an existing account instead of sending a code', async () => {
    const to = address('existing');
    await request(app).post('/api/v1/auth/register').send({ email: to, password: PASSWORD });
    const code = await codeFrom(to, 'Your Nilzora verification code');
    await request(app).post('/api/v1/auth/verify-otp').send({ email: to, code });
    await pool.query(
      "delete from public.auth_mail_log where email_hash = extensions.digest(lower($1), 'sha256')",
      [to],
    );

    const again = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: to, password: NEW_PASSWORD });
    expect(again.status).toBe(202);
    const notice = await arrived(to, 'You already have a Nilzora account');
    expect(notice).toHaveLength(1);
    expect((await message(notice[0]?.ID ?? '')).Text).not.toMatch(/\b\d{6}\b/);
  });
});
