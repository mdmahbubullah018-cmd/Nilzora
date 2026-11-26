import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSecretBox, parseSecretBoxKey, SecretBoxError } from '../auth/secret-box';
import {
  base32Decode,
  base32Encode,
  matchTotp,
  otpauthUri,
  totpCode,
  totpStep,
} from '../auth/totp';
import { newRecoveryCode, normalizeRecoveryCode } from '../auth/two-factor';

// RFC 6238 Appendix B, SHA-1 key "12345678901234567890"; the RFC lists 8 digits, we use the last 6.
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const RFC_VECTORS: [number, string][] = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
];

describe('TOTP (RFC 6238)', () => {
  it.each(RFC_VECTORS)('matches the published vector at T=%i', (seconds, code) => {
    expect(totpCode(RFC_SECRET, totpStep(seconds * 1000))).toBe(code);
  });

  it('accepts the current step and one either side, and names the step it matched', () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step), now)).toBe(step);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now)).toBe(step + 1);
  });

  it('refuses an expired code, a wrong code and anything that is not six digits', () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), now)).toBeNull();
    expect(
      matchTotp(RFC_SECRET, '000000', now) === null || totpCode(RFC_SECRET, step) === '000000',
    ).toBe(true);
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 5']) {
      expect(matchTotp(RFC_SECRET, bad, now)).toBeNull();
    }
  });

  it('round-trips base32 and builds a standard otpauth URI without leaking anything else', () => {
    const secret = randomBytes(20);
    expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true);
    const uri = new URL(otpauthUri(secret, 'owner@example.com'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.searchParams.get('secret')).toBe(base32Encode(secret));
    expect(uri.searchParams.get('issuer')).toBe('Nilzora');
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe('30');
  });
});

describe('secret box (AES-256-GCM)', () => {
  const key = randomBytes(32);

  it('round-trips and uses a fresh IV every time', () => {
    const box = createSecretBox(key);
    const plain = randomBytes(20);
    const a = box.seal(plain);
    const b = box.seal(plain);
    expect(a).not.toBe(b);
    expect(a.startsWith('v1:')).toBe(true);
    expect(a).not.toContain(plain.toString('base64'));
    expect(box.open(a).equals(plain)).toBe(true);
  });

  it('refuses a tampered value and the wrong key, never returning partial plaintext', () => {
    const sealed = createSecretBox(key).seal(randomBytes(20));
    const raw = Buffer.from(sealed.slice(3), 'base64');
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 1;
    expect(() => createSecretBox(key).open(`v1:${raw.toString('base64')}`)).toThrow(SecretBoxError);
    expect(() => createSecretBox(randomBytes(32)).open(sealed)).toThrow(SecretBoxError);
    expect(() => createSecretBox(key).open('v2:abc')).toThrow(SecretBoxError);
  });

  it('accepts exactly 32 bytes as base64 or hex, and refuses anything else', () => {
    expect(parseSecretBoxKey(undefined)).toBeUndefined();
    expect(parseSecretBoxKey('  ')).toBeUndefined();
    expect(parseSecretBoxKey(key.toString('base64'))?.equals(key)).toBe(true);
    expect(parseSecretBoxKey(key.toString('hex'))?.equals(key)).toBe(true);
    expect(() => parseSecretBoxKey('short')).toThrow(SecretBoxError);
    expect(() => parseSecretBoxKey(randomBytes(16).toString('base64'))).toThrow(SecretBoxError);
  });

  it('accepts the same key with the base64 padding stripped, as secret stores often do', () => {
    const unpadded = key.toString('base64').replace(/=+$/, '');
    expect(unpadded).not.toBe(key.toString('base64'));
    expect(parseSecretBoxKey(unpadded)?.equals(key)).toBe(true);
    expect(() => parseSecretBoxKey(randomBytes(16).toString('base64').replace(/=+$/, ''))).toThrow(
      SecretBoxError
    );
  });
});

describe('recovery codes', () => {
  it('are 12 unambiguous characters in three groups, and normalise case and dashes', () => {
    const codes = new Set(Array.from({ length: 50 }, newRecoveryCode));
    expect(codes.size).toBe(50);
    for (const code of codes) {
      expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
      expect(normalizeRecoveryCode(code.toLowerCase().replace(/-/g, ' '))).toBe(
        code.replace(/-/g, ''),
      );
    }
  });
});
