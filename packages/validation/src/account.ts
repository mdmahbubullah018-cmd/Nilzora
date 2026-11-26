import { z } from 'zod';

/** Supabase Auth hashes passwords with bcrypt, which only reads the first 72 bytes. */
const BCRYPT_MAX_BYTES = 72;

/** UTF-8 byte length without platform APIs, so the same rule runs on web, Node and React Native. */
function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/** Email address, trimmed and lower-cased so the same mailbox always maps to one account. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Enter a valid email address' }).max(254));

/**
 * New-account password. Matches the Supabase Auth policy (supabase/config.toml):
 * at least 8 characters with letters and digits, and at most 72 bytes so no part
 * of it is silently ignored.
 */
export const passwordSchema = z
  .string()
  .min(8, { error: 'Use at least 8 characters' })
  .refine((value) => utf8ByteLength(value) <= BCRYPT_MAX_BYTES, {
    error: 'Use at most 72 bytes',
  })
  .refine((value) => /\p{L}/u.test(value) && /\p{N}/u.test(value), {
    error: 'Use both letters and numbers',
  });

/** Display name as entered, trimmed; 1–120 characters. */
export const fullNameSchema = z.string().trim().min(1).max(120);
