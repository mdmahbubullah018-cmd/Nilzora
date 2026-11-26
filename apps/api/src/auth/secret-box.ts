import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/*
 * Authenticated encryption for small secrets at rest (the TOTP secrets): AES-256-GCM with a
 * random 96-bit IV per value. The stored form is "v1:" + base64(iv | tag | ciphertext); the
 * version names the key, so a later key rotation can decrypt with the old key and re-encrypt.
 * The key comes from configuration only (TWO_FACTOR_ENCRYPTION_KEY) and is never stored or logged.
 */

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretBoxError extends Error {
  override readonly name = 'SecretBoxError';
}

/**
 * Parses the key setting: 32 bytes, as base64 (44 characters, with or without the "=" padding that
 * secret stores and copy/paste often strip) or hex (64 characters). Anything else is refused rather
 * than stretched, so a short or mistyped key can never be used.
 */
export function parseSecretBoxKey(value: string | undefined): Buffer | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const isHex = /^[0-9a-f]{64}$/i.test(text);
  const bytes = isHex ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64');
  const canonical = bytes.toString('base64');
  const canonicalUnpadded = canonical.replace(/=+$/, '');
  if (bytes.length !== 32 || (!isHex && canonical !== text && canonicalUnpadded !== text)) {
    throw new SecretBoxError('TWO_FACTOR_ENCRYPTION_KEY must be 32 bytes, as base64 or hex');
  }
  return bytes;
}

export interface SecretBox {
  seal(plaintext: Uint8Array): string;
  open(sealed: string): Buffer;
}

export function createSecretBox(key: Buffer): SecretBox {
  if (key.length !== 32) throw new SecretBoxError('the key must be 32 bytes');
  return {
    seal(plaintext) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
    },
    open(sealed) {
      const [version, payload] = sealed.split(':', 2);
      if (version !== VERSION || !payload) throw new SecretBoxError('unknown secret format');
      const raw = Buffer.from(payload, 'base64');
      if (raw.length <= IV_BYTES + TAG_BYTES) throw new SecretBoxError('secret is truncated');
      const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
      decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      try {
        return Buffer.concat([
          decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
          decipher.final(),
        ]);
      } catch (error) {
        // A wrong key or a tampered value: never return partial plaintext.
        throw new SecretBoxError('secret could not be decrypted', { cause: error });
      }
    },
  };
}
