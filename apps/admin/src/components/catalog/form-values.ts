import { validationErrorDetailsSchema } from '@nilzora/contracts';

/*
 * Turning the catalog forms' text fields into API values and back. Shoppers and staff
 * think in taka; the API counts poisha (100 poisha = 1 taka). Kept free of server and
 * Next.js imports so the Server Actions and the forms share it and it is unit-tested.
 */

export type FormValues = Partial<Record<string, string>>;
export type FieldErrors = Partial<Record<string, string>>;

/** The trimmed text of a form field ('' when missing or a file). */
export function fieldText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** A checkbox: checked boxes send their value ('on' unless set), unchecked ones nothing. */
export function fieldChecked(formData: FormData, name: string): boolean {
  return formData.has(name);
}

/**
 * Taka as typed ("1250", "1,250.50", "৳ 1,250") to poisha, or undefined when it is not
 * an amount with at most two decimals. The API checks the allowed range.
 */
export function takaToPoisha(text: string): number | undefined {
  const cleaned = text.replace(/[৳,\s]/g, '');
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match?.[1]) return undefined;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  return whole * 100 + fraction;
}

/** Poisha as an editable taka amount: 125000 → "1250", 125050 → "1250.50". */
export function poishaToTaka(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || !Number.isSafeInteger(minor)) return '';
  const whole = Math.trunc(minor / 100);
  const fraction = minor % 100;
  return fraction === 0 ? String(whole) : `${String(whole)}.${String(fraction).padStart(2, '0')}`;
}

/** A whole number as typed, or undefined (signs allowed only when `signed`). */
export function wholeNumber(text: string, { signed = false } = {}): number | undefined {
  const pattern = signed ? /^[-+]?\d{1,7}$/ : /^\d{1,7}$/;
  return pattern.test(text) ? Number(text) : undefined;
}

/**
 * A catalog address (slug) from a name: lower-case latin letters and digits joined by
 * single hyphens. Empty when the name has none (e.g. only Bangla script), in which case
 * the address has to be typed.
 */
export function slugify(name: string, max = 120): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/** The first message of each field, from contract issues, renamed to the form's fields. */
export function fieldErrorsFrom(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  messages: FieldErrors,
  renames: Readonly<Record<string, string>> = {},
): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key !== 'string') continue;
    const field = renames[key] ?? key;
    errors[field] ??= messages[field] ?? issue.message;
  }
  return errors;
}

/**
 * The API's validation issues on body fields (`details.issues` of validation_failed),
 * with the form's own wording. Fields the form does not have are left out.
 */
export function apiFieldErrors(
  details: unknown,
  fields: readonly string[],
  messages: FieldErrors,
  renames: Readonly<Record<string, string>> = {},
): FieldErrors {
  const parsed = validationErrorDetailsSchema.safeParse(details);
  if (!parsed.success) return {};
  const errors: FieldErrors = {};
  for (const issue of parsed.data.issues) {
    if (issue.location !== 'body') continue;
    const [key = ''] = issue.path.split('.');
    const field = renames[key] ?? key;
    if (!fields.includes(field)) continue;
    errors[field] ??= messages[field] ?? 'Check this field.';
  }
  return errors;
}
