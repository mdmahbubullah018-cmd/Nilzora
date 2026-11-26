import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/*
 * Time-based one-time passwords (RFC 6238, built on RFC 4226 HOTP) with the parameters every
 * authenticator app supports: HMAC-SHA1, 6 digits, 30-second steps. One step either side of
 * now is accepted to absorb clock drift; the caller stores the step it accepted and refuses
 * that step (or an earlier one) afterwards, which is what stops a code being replayed.
 */

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Steps accepted before and after the current one. */
export const TOTP_DRIFT_STEPS = 1;
/** 160 bits, the size RFC 4226 recommends for SHA-1. */
const SECRET_BYTES = 20;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new TypeError('not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret, as raw bytes. */
export function generateTotpSecret(): Buffer {
  return randomBytes(SECRET_BYTES);
}

/** The time step a moment falls in. */
export function totpStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** The code for one step (RFC 4226 dynamic truncation). */
export function totpCode(secret: Uint8Array, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', secret).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

const CODE = /^\d{6}$/;

/**
 * The step `code` belongs to, within the drift window around `nowMs`, or null. Every candidate is
 * compared in constant time, and all of them are always checked.
 */
export function matchTotp(
  secret: Uint8Array,
  code: string,
  nowMs: number = Date.now(),
): number | null {
  const candidate = code.replace(/\s/g, '');
  if (!CODE.test(candidate)) return null;
  const now = totpStep(nowMs);
  let matched: number | null = null;
  for (let offset = -TOTP_DRIFT_STEPS; offset <= TOTP_DRIFT_STEPS; offset += 1) {
    const step = now + offset;
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, Buffer.from(candidate)) && matched === null) matched = step;
  }
  return matched;
}

/** The otpauth:// URI an authenticator app scans (Key Uri Format). */
export function otpauthUri(secret: Uint8Array, account: string, issuer = 'Nilzora'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
