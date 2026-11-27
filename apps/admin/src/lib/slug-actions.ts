'use server';

import { slugAvailabilityQuerySchema } from '@nilzora/contracts';
import { session } from './session';

/*
 * The live address check of the product, category and brand forms. A Server Action is a
 * public POST endpoint, so this one also goes through session.act (this app's Origin and
 * CSRF token, before any API call); the API checks products.read itself. It only reads,
 * and it never redirects: a check that cannot be answered says "unknown" and the save
 * stays the authority (a later save can still find the address taken).
 */

export type SlugCheck =
  | { state: 'available' }
  | { state: 'taken' | 'reserved'; suggestion: string | null }
  | { state: 'invalid' }
  | { state: 'unknown' };

const UNKNOWN: SlugCheck = { state: 'unknown' };

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Whether an address is free, from the form fields `kind`, `slug` and `excludeId`. */
export async function checkSlugAction(formData: FormData): Promise<SlugCheck> {
  const query = slugAvailabilityQuerySchema.safeParse({
    kind: text(formData, 'kind'),
    slug: text(formData, 'slug'),
    excludeId: text(formData, 'excludeId'),
  });
  if (!query.success)
    return query.error.issues.some((issue) => issue.path[0] === 'slug')
      ? { state: 'invalid' }
      : UNKNOWN;

  let outcome;
  try {
    outcome = await session.act(formData, (api, token) =>
      api.adminSlugAvailability(token, query.data),
    );
  } catch {
    return UNKNOWN;
  }
  if (outcome.kind !== 'ok') return UNKNOWN;
  const answer = outcome.value;
  if (answer.available) return { state: 'available' };
  if (answer.reason === 'invalid') return { state: 'invalid' };
  return {
    state: answer.reason === 'reserved' ? 'reserved' : 'taken',
    suggestion: answer.suggestion,
  };
}
