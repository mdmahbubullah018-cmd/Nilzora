import { describe, expect, it } from 'vitest';
import { MAX_SEARCH_TERM_LENGTH, MAX_SEARCH_TERMS, toPrefixQuery } from './search-query';

/** Each term must be exactly 'plain-text':* with nothing tsquery could interpret inside. */
const SAFE_TERM = /^'[^&|!():*'"\\<>`\p{Cc}\p{Cf}\s]+':\*$/u;
const HOSTILE_ALPHABET = Array.from(`&|!():*'"\\<>\`-_ \t\n\u0000\u200b\u2019abcXYZ019চ😀`);

function terms(query: string | null): string[] {
  expect(query).not.toBeNull();
  return (query ?? '').split(' & ');
}

describe('toPrefixQuery', () => {
  it('turns words into an AND of quoted prefix terms', () => {
    expect(toPrefixQuery('rice')).toBe("'rice':*");
    expect(toPrefixQuery('  Chinigura   RICE ')).toBe("'chinigura':* & 'rice':*");
  });

  it('keeps letters and digits of any script', () => {
    expect(toPrefixQuery('চাল ১ কেজি')).toBe("'চাল':* & '১':* & 'কেজি':*");
    expect(toPrefixQuery('usb-c 25w')).toBe("'usb-c':* & '25w':*");
  });

  it.each(['', '   ', '\t\n', '&', "''", '""', '!!!', '( ) | & : * < >', '\\', '\u0000\u001f'])(
    'returns null when nothing searchable remains in %j',
    (input) => {
      expect(toPrefixQuery(input)).toBeNull();
    },
  );

  it.each([
    ["rice' | 'oil", "'rice':* & 'oil':*"],
    ["rice':* | !'oil", "'rice':* & 'oil':*"],
    ['rice&oil', "'rice':* & 'oil':*"],
    ['rice|oil', "'rice':* & 'oil':*"],
    ['!rice', "'rice':*"],
    ['(rice | oil) & !tea', "'rice':* & 'oil':* & 'tea':*"],
    ['rice <-> oil', "'rice':* & '-':* & 'oil':*"],
    ['rice <2> oil', "'rice':* & '2':* & 'oil':*"],
    ['rice:A', "'rice':* & 'a':*"],
    ['rice:*', "'rice':*"],
    ["\\' OR 1=1 --", "'or':* & '1=1':* & '--':*"],
    ["rice\\'oil", "'rice':* & 'oil':*"],
    ['"rice" `oil`', "'rice':* & 'oil':*"],
    ['\u2018rice\u2019 \u201Coil\u201D', "'rice':* & 'oil':*"],
    ['rice\u0000oil\u001btea', "'rice':* & 'oil':* & 'tea':*"],
    ['ri\u200bce', "'ri':* & 'ce':*"],
    ['rice\u202eoil', "'rice':* & 'oil':*"],
    ["'); drop table products; --", "';':* & 'drop':* & 'table':* & 'products;':* & '--':*"],
  ])('neutralises the operator injection %j', (input, expected) => {
    const query = toPrefixQuery(input);
    expect(query).toBe(expected);
    for (const term of terms(query)) expect(term).toMatch(SAFE_TERM);
  });

  it(`uses at most ${MAX_SEARCH_TERMS} terms`, () => {
    expect(terms(toPrefixQuery('a b c d e f g h i'))).toEqual([
      "'a':*",
      "'b':*",
      "'c':*",
      "'d':*",
      "'e':*",
      "'f':*",
    ]);
  });

  it(`cuts terms to ${MAX_SEARCH_TERM_LENGTH} characters`, () => {
    const query = toPrefixQuery(`${'x'.repeat(100)} rice`);
    expect(terms(query)).toEqual([`'${'x'.repeat(MAX_SEARCH_TERM_LENGTH)}':*`, "'rice':*"]);
  });

  it('never splits a character outside the basic plane', () => {
    const query = toPrefixQuery('😀'.repeat(50));
    expect(query).toBe(`'${'😀'.repeat(MAX_SEARCH_TERM_LENGTH)}':*`);
    // In unicode mode this class matches only unpaired (broken) surrogates.
    expect(query).not.toMatch(/[\uD800-\uDFFF]/u);
  });

  it('produces only safe terms for arbitrary hostile input', () => {
    for (let seed = 1; seed <= 500; seed += 1) {
      // A small deterministic generator, so any failure is reproducible.
      let state = seed;
      const input = Array.from({ length: 1 + (seed % 120) }, () => {
        state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
        return HOSTILE_ALPHABET[state % HOSTILE_ALPHABET.length];
      }).join('');
      const query = toPrefixQuery(input);
      if (query === null) continue;
      const parts = terms(query);
      expect(parts.length).toBeLessThanOrEqual(MAX_SEARCH_TERMS);
      for (const part of parts) {
        expect(part).toMatch(SAFE_TERM);
        expect(Array.from(part.slice(1, -3)).length).toBeLessThanOrEqual(MAX_SEARCH_TERM_LENGTH);
      }
    }
  });
});
