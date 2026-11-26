import { cookies } from 'next/headers';
import { DEFAULT_LANGUAGE, LANGUAGE_COOKIE, parseLanguage, type Language } from '@/lib/language';

/**
 * The reader's language, on the server.
 *
 * The root layout already reads this cookie to set `<html lang>`; pages that format dates,
 * counts or range labels themselves read it again here. `cookies()` is per-request, so nothing
 * leaks between visitors — which is exactly why the formatters take a language instead of
 * guessing one.
 *
 * A component rendered outside a request (a unit test, an isolated preview) has no cookie jar;
 * that is English, never a crash.
 */
export async function getServerLanguage(): Promise<Language> {
  try {
    const jar = await cookies();
    return parseLanguage(jar.get(LANGUAGE_COOKIE)?.value);
  } catch {
    return DEFAULT_LANGUAGE;
  }
}
