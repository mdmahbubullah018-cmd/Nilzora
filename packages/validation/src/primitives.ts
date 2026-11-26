import { z } from 'zod';

/** Identifier of any Nilzora entity (Postgres uuid primary keys). */
export const uuidSchema = z.uuid();

/**
 * Bangladeshi mobile number. Accepts the local form (01XXXXXXXXX) or the
 * international form (+8801XXXXXXXXX / 8801XXXXXXXXX), ignoring spaces and
 * dashes, and normalises to E.164 (+8801XXXXXXXXX).
 */
export const bdMobilePhoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .pipe(
    z.string().regex(/^(?:\+?88)?01[3-9]\d{8}$/, {
      error: 'Enter a valid Bangladeshi mobile number',
    }),
  )
  .transform((value) => `+880${value.slice(-10)}`);
