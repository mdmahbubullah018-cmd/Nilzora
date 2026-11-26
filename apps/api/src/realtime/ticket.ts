import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/*
 * Socket tickets
 * --------------
 * The web apps keep the API tokens in HttpOnly cookies, so a browser cannot read them to
 * open a socket — that is the whole point of storing them there. Instead the Next.js
 * server asks the API for a short-lived ticket, and the browser opens the socket with it.
 *
 * A ticket:
 *   - names exactly one account, and only that;
 *   - expires in two minutes, which is long enough for one handshake;
 *   - is accepted by the socket handshake only. No REST route reads it, so leaking one
 *     cannot be replayed against the API, and the socket still re-checks the account on
 *     every room join.
 *
 * The mobile app has the access token in the device keychain and connects with it
 * directly, so it never needs a ticket.
 */

export const CHAT_TICKET_TTL_SECONDS = 120;
const PREFIX = 'v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ChatTicket {
  ticket: string;
  /** Unix time (seconds) after which the ticket is refused. */
  expiresAt: number;
}

export interface ChatTicketSigner {
  /** Mints a ticket for one verified account. `now` is injectable for tests. */
  issue(userId: string, now?: number): ChatTicket;
  /** The account a ticket names, or null when it is malformed, forged or expired. */
  verify(ticket: string, now?: number): string | null;
}

function encode(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function signature(secret: string, signed: string): Buffer {
  return createHmac('sha256', secret).update(signed).digest();
}

/**
 * `secret` must be high-entropy and server-only. When the deployment does not set one, a
 * distinct key is derived from the first-party authentication secret: separation by
 * context string keeps the two uses from ever producing the same MAC.
 */
export function deriveChatTicketSecret(source: string): string {
  return createHmac('sha256', source).update('nilzora.chat.socket.ticket.v1').digest('base64url');
}

export function createChatTicketSigner(secret: string): ChatTicketSigner {
  if (secret.length < 32) {
    throw new TypeError('A chat ticket secret must be at least 32 characters');
  }

  return {
    issue(userId, now = Math.floor(Date.now() / 1000)) {
      if (!UUID.test(userId)) throw new TypeError('A chat ticket names an account id');
      const expiresAt = now + CHAT_TICKET_TTL_SECONDS;
      const payload = encode(
        JSON.stringify({ sub: userId, exp: expiresAt, n: randomBytes(6).toString('base64url') }),
      );
      const signed = `${PREFIX}.${payload}`;
      return { ticket: `${signed}.${encode(signature(secret, signed))}`, expiresAt };
    },

    verify(ticket, now = Math.floor(Date.now() / 1000)) {
      const parts = ticket.split('.');
      if (parts.length !== 3 || parts[0] !== PREFIX) return null;
      const [, payload, mac] = parts as [string, string, string];
      const expected = signature(secret, `${PREFIX}.${payload}`);
      const given = Buffer.from(mac, 'base64url');
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

      let claims: unknown;
      try {
        claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      } catch {
        return null;
      }
      const value = claims as { sub?: unknown; exp?: unknown } | null;
      if (typeof value?.sub !== 'string' || !UUID.test(value.sub)) return null;
      if (typeof value.exp !== 'number' || !Number.isSafeInteger(value.exp)) return null;
      if (value.exp <= now) return null;
      return value.sub;
    },
  };
}
