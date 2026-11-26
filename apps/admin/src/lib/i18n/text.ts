import { BN } from './messages';
import type { Language } from '@/lib/language';

/**
 * One dictionary line, for code that formats text outside React.
 *
 * `t()` in the provider is the hook; this is the same lookup for functions that receive the
 * language as an argument — the formatters, the date-range parser, a server component that has
 * already read the cookie. Unknown English text comes back unchanged, never as a missing key.
 */
export function translateText(text: string, lang: Language): string {
  if (lang !== 'bn') return text;
  return (BN as Record<string, string>)[text] ?? text;
}

/** The same, with `{name}` placeholders filled from `params`. */
export function translateTextWith(
  text: string,
  lang: Language,
  params: Record<string, string | number>,
): string {
  return translateText(text, lang).replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}
