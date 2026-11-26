import { describe, expect, it } from 'vitest';
import { EmailUnavailableError, emailDiagnosticOf, mailOptions, smtpSettings } from '../auth/sender';

/*
 * The safe diagnosis of a refused SMTP send.
 *
 * Registration fails visibly when the mail server will not take the message, and the only way to
 * tell a wrong password (`535`) from a blocked port (no reply at all) is the reply code — but the
 * reply *text* must never reach a log, because providers echo the recipient's address in it.
 * These tests pin both halves: the numbers survive, the words do not.
 */

/** A nodemailer failure, shaped the way nodemailer actually raises one. */
function nodemailerError(fields: Record<string, unknown>): Error {
  return Object.assign(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'), {
    response: '535-5.7.8 Username and Password not accepted. customer@example.test - gsmtp',
    ...fields,
  });
}

describe('emailDiagnosticOf', () => {
  it('keeps the reply code and command of a refused login, and drops the reply text', () => {
    const diagnostic = emailDiagnosticOf(
      nodemailerError({ code: 'EAUTH', responseCode: 535, command: 'AUTH PLAIN' }),
    );

    expect(diagnostic).toStrictEqual({ code: 'EAUTH', responseCode: 535, command: 'AUTH PLAIN' });
    // The address the server echoed back is not part of the diagnosis.
    expect(JSON.stringify(diagnostic)).not.toContain('customer@example.test');
    expect(JSON.stringify(diagnostic)).not.toContain('Username and Password not accepted');
  });

  it('marks an unreachable server, which is a different fault from a refused one', () => {
    expect(emailDiagnosticOf(nodemailerError({ code: 'ECONNECTION' }))).toStrictEqual({
      code: 'ECONNECTION',
      connectionFailed: true,
    });
    expect(emailDiagnosticOf(nodemailerError({ code: 'ETIMEDOUT' }))).toStrictEqual({
      code: 'ETIMEDOUT',
      connectionFailed: true,
    });
  });

  it('does not call a refused message a connection failure', () => {
    // A refused recipient or sender is a reply the server gave, not a socket that never opened.
    expect(emailDiagnosticOf(nodemailerError({ code: 'EENVELOPE', responseCode: 550 }))).toStrictEqual(
      { code: 'EENVELOPE', responseCode: 550 },
    );
  });

  it('answers with nothing rather than guessing when the error is not an SMTP one', () => {
    expect(emailDiagnosticOf(new Error('boom'))).toStrictEqual({});
    expect(emailDiagnosticOf(undefined)).toStrictEqual({});
    expect(emailDiagnosticOf({ code: 42, responseCode: '535' })).toStrictEqual({});
  });
});

describe('EmailUnavailableError', () => {
  it('carries the diagnosis and keeps the cause', () => {
    const cause = nodemailerError({ code: 'EAUTH', responseCode: 535, command: 'AUTH PLAIN' });
    const error = new EmailUnavailableError('the email could not be sent', {
      cause,
      diagnostic: emailDiagnosticOf(cause),
    });

    expect(error.name).toBe('EmailUnavailableError');
    expect(error.cause).toBe(cause);
    expect(error.diagnostic).toStrictEqual({
      code: 'EAUTH',
      responseCode: 535,
      command: 'AUTH PLAIN',
    });
  });

  it('is diagnosable even when no details were supplied', () => {
    expect(new EmailUnavailableError('refused').diagnostic).toStrictEqual({});
  });
});

describe('smtpSettings', () => {
  it('reads the settings the API actually uses', () => {
    expect(
      smtpSettings({
        SMTP_HOST: 'smtp.example.test',
        SMTP_PORT: '587',
        SMTP_SECURE: 'false',
        SMTP_USER: 'sender@example.test',
        SMTP_PASSWORD: 'secret',
        EMAIL_FROM: 'Nilzora <sender@example.test>',
      }),
    ).toStrictEqual({
      host: 'smtp.example.test',
      port: 587,
      secure: false,
      user: 'sender@example.test',
      password: 'secret',
      from: 'Nilzora <sender@example.test>',
    });
  });

  it('stays off without a host or a sender, so email routes answer 503 instead of hanging', () => {
    expect(smtpSettings({ EMAIL_FROM: 'sender@example.test' })).toBeUndefined();
    expect(smtpSettings({ SMTP_HOST: 'smtp.example.test' })).toBeUndefined();
    expect(smtpSettings({})).toBeUndefined();
  });

  it('falls back to the local catcher port for an unusable one', () => {
    expect(
      smtpSettings({ SMTP_HOST: 'h', EMAIL_FROM: 'f', SMTP_PORT: 'not-a-port' })?.port,
    ).toBe(1025);
  });
});

describe('mailOptions', () => {
  const settings = {
    host: 'smtp.example.test',
    port: 587,
    secure: false,
    user: undefined,
    password: undefined,
    from: 'Nilzora <sender@example.test>',
  };

  it('sends the sender the settings name', () => {
    expect(
      mailOptions(settings, { to: 'a@example.test', subject: 'S', text: 'T' }),
    ).toStrictEqual({
      from: settings.from,
      to: 'a@example.test',
      subject: 'S',
      text: 'T',
    });
  });
});
