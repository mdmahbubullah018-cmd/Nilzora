/** At most this many words of a search are used. */
export const MAX_SEARCH_TERMS = 6;
/** Longer words are cut to this many characters (a prefix still matches). */
export const MAX_SEARCH_TERM_LENGTH = 40;

/**
 * Every character with a meaning in tsquery syntax (operators, grouping, weights,
 * prefixes, phrase distance, quoting and escaping), typographic quotes, and all
 * control and invisible format characters. Each becomes a word break.
 */
const UNSAFE = /[&|!():*'"\\<>`\u2018\u2019\u201C\u201D\p{Cc}\p{Cf}]/gu;

/**
 * Builds the prefix query passed to catalog_products from a visitor's words:
 * `'word':* & 'word':*`. Every term is reduced to plain characters and quoted, so no
 * input can add operators or break out of the quoting. Returns null when nothing
 * searchable remains; the caller then answers with an empty page.
 */
export function toPrefixQuery(text: string): string | null {
  const terms = text
    .replace(UNSAFE, ' ')
    .toLowerCase()
    .split(/\s+/u)
    .filter((term) => term !== '')
    .slice(0, MAX_SEARCH_TERMS)
    // Cut by code points so a character outside the BMP is never split in half.
    .map((term) => Array.from(term).slice(0, MAX_SEARCH_TERM_LENGTH).join(''));
  if (terms.length === 0) return null;
  return terms.map((term) => `'${term}':*`).join(' & ');
}
