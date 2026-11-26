import { createTransport } from 'nodemailer';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /**
   * Optional branded HTML part. When given, the message is sent as multipart/alternative:
   * HTML for the clients that render it, `text` for everything else. A caller that leaves it
   * out keeps sending exactly the plain-text message it always did.
   */
  html?: string;
}

/** What nodemailer is given for one message; separated so it can be tested without SMTP. */
export interface MailOptions {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Builds the transport payload, omitting `html` entirely for a text-only message. */
export function mailOptions(settings: SmtpSettings, message: EmailMessage): MailOptions {
  return {
    from: settings.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    ...(message.html === undefined ? {} : { html: message.html }),
  };
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
  /**
   * Checks that the server is reachable and accepts the credentials, sending no mail.
   * Used by the startup probe; a refusal means every verification and welcome email will fail.
   */
  verify(): Promise<void>;
}

/**
 * What a refused send can safely say about itself.
 *
 * Only the machine-readable parts of the SMTP failure are kept: the nodemailer error code
 * (`EAUTH`, `ETIMEDOUT`, `ESOCKET`), the server's numeric reply (`535`, `550`, `421`), the
 * command it refused (`AUTH PLAIN`, `MAIL FROM`) and whether the socket reached the server at
 * all. The server's reply *text* is deliberately dropped: providers echo the address back in
 * it, and a log line must never carry a customer's email address.
 */
export interface EmailDiagnostic {
  /** nodemailer's own code for the failure, e.g. `EAUTH` or `EENVELOPE`. */
  code?: string;
  /** The SMTP reply code (`535` for a refused login), when the server answered at all. */
  responseCode?: number;
  /** The command the server refused, e.g. `AUTH PLAIN`. */
  command?: string;
  /** True when the connection was never established, so nothing was attempted. */
  connectionFailed?: boolean;
}

/** Nothing is configured, or delivery failed: the caller answers 503, never a fake success. */
export class EmailUnavailableError extends Error {
  override readonly name = 'EmailUnavailableError';
  /** Safe, address-free details of the refusal, for the server log. */
  readonly diagnostic: EmailDiagnostic;

  constructor(message: string, options?: ErrorOptions & { diagnostic?: EmailDiagnostic }) {
    super(message, options);
    this.diagnostic = options?.diagnostic ?? {};
  }
}

/**
 * Reads the diagnosable parts of a nodemailer failure.
 *
 * Every field is optional and every field is a number or a short protocol token, so this can be
 * logged as it is. `connectionFailed` is set for the errors nodemailer raises before the server
 * has said anything (a wrong host or port, a firewall, a TLS handshake that never completed).
 */
export function emailDiagnosticOf(error: unknown): EmailDiagnostic {
  const source = error as
    | { code?: unknown; responseCode?: unknown; command?: unknown }
    | null
    | undefined;
  const code = typeof source?.code === 'string' ? source.code : undefined;
  const responseCode =
    typeof source?.responseCode === 'number' && Number.isInteger(source.responseCode)
      ? source.responseCode
      : undefined;
  const command = typeof source?.command === 'string' ? source.command : undefined;
  // The failures nodemailer raises before the server says anything at all.
  const unreachable = new Set([
    'ECONNECTION',
    'ETIMEDOUT',
    'ESOCKET',
    'EDNS',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ECONNREFUSED',
  ]);
  const connectionFailed = responseCode === undefined && code !== undefined && unreachable.has(code);
  return {
    ...(code === undefined ? {} : { code }),
    ...(responseCode === undefined ? {} : { responseCode }),
    ...(command === undefined ? {} : { command }),
    ...(connectionFailed ? { connectionFailed } : {}),
  };
}

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string | undefined;
  password: string | undefined;
  from: string;
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text === undefined || text === '' ? undefined : text;
}

/** Reads the SMTP settings from the environment; undefined when the integration is off. */
export function smtpSettings(env: NodeJS.ProcessEnv = process.env): SmtpSettings | undefined {
  const host = trimmed(env.SMTP_HOST);
  const from = trimmed(env.EMAIL_FROM);
  if (!host || !from) return undefined;
  const port = Number(trimmed(env.SMTP_PORT) ?? '1025');
  return {
    host,
    port: Number.isInteger(port) && port > 0 ? port : 1025,
    secure: trimmed(env.SMTP_SECURE) === 'true',
    user: trimmed(env.SMTP_USER),
    password: trimmed(env.SMTP_PASSWORD),
    from,
  };
}

/**
 * SMTP delivery through nodemailer. The local Supabase stack's Inbucket accepts
 * unauthenticated SMTP once its port is published; a real provider supplies user and
 * password. Message bodies never contain anything but the code and the expiry.
 */
export function createEmailSender(
  settings: SmtpSettings | undefined = smtpSettings(),
): EmailSender | undefined {
  if (!settings) return undefined;

  const transport = createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    ...(settings.user && settings.password
      ? { auth: { user: settings.user, pass: settings.password } }
      : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  return {
    async send(message) {
      try {
        await transport.sendMail(mailOptions(settings, message));
      } catch (error) {
        throw new EmailUnavailableError('the email could not be sent', {
          cause: error,
          diagnostic: emailDiagnosticOf(error),
        });
      }
    },
    /**
     * Opens a connection and authenticates, without sending anything: what a startup check
     * needs to tell an operator that the mail settings are wrong before a customer finds out.
     */
    async verify() {
      try {
        await transport.verify();
      } catch (error) {
        throw new EmailUnavailableError('the mail server refused the connection', {
          cause: error,
          diagnostic: emailDiagnosticOf(error),
        });
      }
    },
  };
}
