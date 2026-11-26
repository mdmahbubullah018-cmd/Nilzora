/*
 * Workspace language
 * ------------------
 * The admin and moderator workspaces are written in English and can be read in Bangla. The
 * choice lives in a plain cookie — exactly like the theme preference (see lib/theme.ts): not
 * HttpOnly (the menu writes it in the browser), SameSite=Lax, for the whole app, for a year.
 * It is not a credential and grants nothing.
 *
 * The root layout reads it on the server so <html lang> is right on the first paint, and hands
 * it to the client provider, which translates the screen without a reload. English is the
 * default: a missing or unexpected cookie reads as English.
 *
 * Kept free of Next.js and server-only imports: the layout, the provider and the menu share it.
 */

export const LANGUAGES = ['en', 'bn'] as const;
export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';

export const LANGUAGE_COOKIE = 'nza_language';

/** One year, in seconds. */
export const LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The language a cookie value names; missing or unknown values read as English. */
export function parseLanguage(value: string | null | undefined): Language {
  return value === 'bn' ? 'bn' : DEFAULT_LANGUAGE;
}

/** The `document.cookie` assignment that stores `language`. */
export function languageCookie(
  language: Language,
  { secure = false }: { secure?: boolean } = {},
): string {
  const attributes = [
    `${LANGUAGE_COOKIE}=${language}`,
    'Path=/',
    `Max-Age=${String(LANGUAGE_COOKIE_MAX_AGE)}`,
    'SameSite=Lax',
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

/** The BCP 47 tag for <html lang>, so a screen reader switches voice. */
export function htmlLang(language: Language): string {
  return language === 'bn' ? 'bn-BD' : 'en';
}
