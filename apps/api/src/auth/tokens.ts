import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** 32 random bytes, base64url: the value a client presents (never stored). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What the database stores for a token. */
export function tokenHash(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/** Six digits from a CSPRNG, zero-padded. */
export function sixDigitCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * A short code has only a million possibilities, so a plain hash would be reversible.
 * The server-held pepper keeps a leaked table useless.
 */
export function codeHash(pepper: string, email: string, purpose: string, code: string): Buffer {
  return createHmac('sha256', pepper)
    .update(`${purpose}:${email.trim().toLowerCase()}:${code}`)
    .digest();
}

/** Constant-time comparison for two byte strings of any length. */
export function sameBytes(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
