import { describe, expect, it } from 'vitest';
import {
  accountEmail,
  accountExistsEmail,
  authCodeEmail,
  AUTH_CODE_EXPIRY_MINUTES,
} from '../auth/emails';
import { mailOptions, type SmtpSettings } from '../auth/sender';

/*
 * The branded authentication emails and the multipart envelope they travel in.
 *
 * These assertions protect the things that must never drift: the subject lines the API has
 * always sent, the code and expiry actually inside the message, a real plain-text fallback,
 * and a footer that names no invented address or business claim.
 */

const SETTINGS: SmtpSettings = {
  host: 'smtp.example.test',
  port: 1025,
  secure: false,
  user: undefined,
  password: undefined,
  from: 'Nilzora <no-reply@example.test>',
};

const CODE = '482913';

describe('auth code emails', () => {
  it('keeps the exact verification subject and text the API sent before', () => {
    const email = authCodeEmail('verify_email', CODE);

    expect(email.subject).toBe('Your Nilzora verification code');
    expect(email.text).toBe(
      `Use this code to verify your email address:\n\n${CODE}\n\nThis code expires in 10 minutes. If you did not ask for it, ignore this message.`,
    );
  });

  it('keeps the exact password-reset subject, with its own wording', () => {
    const email = authCodeEmail('reset_password', CODE);

    expect(email.subject).toBe('Reset your Nilzora password');
    expect(email.text).toContain('Use this code to choose a new password:');
    // A reset email must not look like a verification one.
    expect(email.text).not.toContain('verify your email address');
  });

  it('states the expiry the database actually issues', () => {
    expect(AUTH_CODE_EXPIRY_MINUTES).toBe(10);
    for (const kind of ['verify_email', 'reset_password'] as const) {
      const email = authCodeEmail(kind, CODE);
      expect(email.text).toContain('expires in 10 minutes');
      expect(email.html).toContain('expires in 10 minutes');
    }
  });

  it('puts the code in the HTML part and keeps it readable in the text part', () => {
    const email = authCodeEmail('verify_email', CODE);

    expect(email.text).toContain(CODE);
    expect(email.html).toContain(CODE);
    // The code is the whole point: it is set large and isolated in its own cell.
    expect(email.html).toContain(`>${CODE}</td>`);
  });

  it('warns against sharing the code', () => {
    const email = authCodeEmail('verify_email', CODE);
    expect(email.html.toLowerCase()).toContain('never share this code');
  });

  it('is email-client markup: doctype, a table layout, inline styles and a 600px column', () => {
    const email = authCodeEmail('verify_email', CODE);

    expect(email.html.startsWith('<!doctype html>')).toBe(true);
    expect(email.html).toContain('<table role="presentation"');
    expect(email.html).toContain('max-width:600px');
    expect(email.html).toContain('style=');
    // No external stylesheet or script: email clients strip or block both.
    expect(email.html).not.toContain('<link');
    expect(email.html).not.toContain('<script');
  });

  it('uses the brand primary colour and the official wordmark when no logo is configured', () => {
    const email = authCodeEmail('verify_email', CODE);

    expect(email.html).toContain('#0284C7');
    // No guessed asset URL: the wordmark is text until an official URL is supplied.
    expect(email.html).not.toContain('<img');
    // The wordmark in its brand colours, as text: "Nil" in navy, "zora" in the primary blue.
    expect(email.html).toContain(
      '<span style="color:#0F172A;">Nil</span><span style="color:#0284C7;">zora</span>',
    );
  });

  it('renders the official artwork only when a logo URL is configured, escaped', () => {
    const email = authCodeEmail('verify_email', CODE, {
      logoUrl: 'https://media.example.test/brand/logo"onerror="x',
    });

    expect(email.html).toContain(
      '<img src="https://media.example.test/brand/logo&quot;onerror=&quot;x"',
    );
    expect(email.html).toContain('alt="Nilzora"');
  });

  it('invents no contact details, policies or business claims', () => {
    for (const kind of ['verify_email', 'reset_password'] as const) {
      const email = authCodeEmail(kind, CODE);
      for (const body of [email.text, email.html]) {
        expect(body).not.toMatch(/mailto:|tel:/i);
        expect(body).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
        expect(body).not.toMatch(/\+880|01\d{3}[- ]?\d{6}/);
        expect(body).not.toMatch(/refund|guarantee|free shipping/i);
      }
    }
  });
});

describe('multipart envelope', () => {
  it('sends HTML and text together when an HTML part is provided', () => {
    const options = mailOptions(SETTINGS, {
      to: 'customer@example.test',
      subject: 'Your Nilzora verification code',
      text: 'plain',
      html: '<p>rich</p>',
    });

    expect(options).toMatchObject({
      from: SETTINGS.from,
      to: 'customer@example.test',
      subject: 'Your Nilzora verification code',
      text: 'plain',
      html: '<p>rich</p>',
    });
  });

  it('leaves a text-only message exactly as it was, with no html key at all', () => {
    const options = mailOptions(SETTINGS, {
      to: 'customer@example.test',
      subject: 'Plain',
      text: 'just text',
    });

    expect(options).not.toHaveProperty('html');
    expect(options).toEqual({
      from: SETTINGS.from,
      to: 'customer@example.test',
      subject: 'Plain',
      text: 'just text',
    });
  });
});

describe('account emails', () => {
  it('welcomes by first name, escaped, and states only what the shop really offers', () => {
    const email = accountEmail('welcome', { name: '<b>Rafi</b> Ahmed' });
    expect(email.subject).toBe('Welcome to Nilzora');
    expect(email.text).toContain('Hi <b>Rafi</b>,');
    expect(email.html).toContain('Hi &lt;b&gt;Rafi&lt;/b&gt;,');
    expect(email.html).not.toContain('<b>Rafi</b>');
    expect(email.text).toContain('paid in cash when they are delivered');
    // Six digits that are not part of a colour (#334155) would be a code.
    expect(email.html).not.toMatch(/(?<![#\w])\d{6}\b/);
  });

  it('greets without a name rather than inventing one', () => {
    expect(accountEmail('welcome', { name: null }).text.startsWith('Hi,')).toBe(true);
  });

  it('renders a button only for a configured http(s) site, never a guessed or unsafe link', () => {
    expect(accountEmail('welcome').html).not.toContain('<a ');
    const linked = accountEmail('welcome', { siteUrl: 'https://shop.example.test' });
    expect(linked.html).toContain('href="https://shop.example.test/"');
    expect(linked.text).toContain('https://shop.example.test/');
    const unsafe = accountEmail('welcome', { siteUrl: 'javascript:alert(1)' });
    expect(unsafe.html).not.toContain('<a ');
    expect(
      accountEmail('password_changed', { siteUrl: 'https://shop.example.test' }).html,
    ).toContain('href="https://shop.example.test/login"');
  });

  it('tells the owner their password changed and that every device was signed out', () => {
    const email = accountEmail('password_changed');
    expect(email.subject).toBe('Your Nilzora password was changed');
    expect(email.text).toContain('signed out');
    expect(email.html.toLowerCase()).toContain('did not change it?');
  });

  it('warns the owner of an existing account without giving any code', () => {
    const email = accountExistsEmail();
    expect(email.subject).toBe('You already have a Nilzora account');
    expect(email.text).not.toMatch(/\b\d{6}\b/);
    expect(email.html).not.toMatch(/(?<![#\w])\d{6}\b/);
    expect(email.text).toContain('Forgot password');
  });

  it('keeps every account email client-safe and free of invented contact details', () => {
    for (const email of [
      accountEmail('welcome'),
      accountEmail('password_changed'),
      accountExistsEmail(),
    ]) {
      expect(email.html.startsWith('<!doctype html>')).toBe(true);
      expect(email.html).toContain('max-width:600px');
      expect(email.html).not.toContain('<script');
      expect(email.html).not.toContain('<link');
      for (const body of [email.text, email.html]) {
        expect(body).not.toMatch(/mailto:|tel:/i);
        expect(body).not.toMatch(/\+880|01\d{3}[- ]?\d{6}/);
        expect(body).not.toMatch(/refund|guarantee|free shipping/i);
      }
    }
  });
});
