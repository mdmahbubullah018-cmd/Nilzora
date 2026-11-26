import { isNormalized, normalizeVoiceQuery } from '@/voice/query-normalizer';

/*
 * The Banglish normaliser: the words it knows become Bengali, the words that name products stay
 * exactly as they were, and an English or already-Bengali search is never rewritten.
 */

describe('normalizeVoiceQuery', () => {
  it('turns a Banglish shopping sentence into Bengali while keeping the product words', () => {
    expect(normalizeVoiceQuery('Ami ekta black t-shirt chai')).toBe(
      'আমি একটা black t-shirt চাই',
    );
  });

  it('keeps brand, size and English product words in Latin', () => {
    expect(normalizeVoiceQuery('amar ekta addidas polo xl lagbe')).toBe(
      'আমার একটা addidas polo xl লাগবে',
    );
  });

  it('leaves an ordinary English search alone', () => {
    expect(normalizeVoiceQuery('black bag')).toBe('black bag');
    expect(normalizeVoiceQuery('blue panjabi')).toBe('blue panjabi');
  });

  it('leaves an already-Bengali sentence alone but still normalises a Banglish word inside it', () => {
    expect(normalizeVoiceQuery('আমার জন্য ekta shari chai')).toBe(
      'আমার জন্য একটা শাড়ি চাই',
    );
  });

  it('handles common spellings of the same word and tidies the spacing', () => {
    expect(normalizeVoiceQuery('  ami   akta  lal  jama   chai ')).toBe('আমি একটা লাল জামা চাই');
    expect(normalizeVoiceQuery('amar bhalo ekta ghori dorkar')).toBe(
      'আমার ভালো একটা ঘড়ি দরকার',
    );
  });

  it('never rewrites a number or a price', () => {
    expect(normalizeVoiceQuery('ami 500 takar ekta jama chai')).toBe(
      'আমি 500 টাকার একটা জামা চাই',
    );
  });

  it('reports when it changed the query', () => {
    expect(isNormalized('Ami ekta jama chai', normalizeVoiceQuery('Ami ekta jama chai'))).toBe(
      true,
    );
    expect(isNormalized('black bag', normalizeVoiceQuery('black bag'))).toBe(false);
  });
});
