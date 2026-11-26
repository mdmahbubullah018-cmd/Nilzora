import { interpretVoiceQuery, phoneticKey } from '@/voice/voice-intent';

/*
 * Automated checks of how what was heard becomes a search, for the three ways customers speak.
 * These test the interpretation only: they say nothing about how well the phone's recogniser
 * hears a voice, which only a real device can show.
 */
describe('interpretVoiceQuery', () => {
  it('English: drops the request words, keeps the product terms', () => {
    expect(interpretVoiceQuery('Show me black t-shirts')).toMatchObject({
      query: 'black t-shirt',
      language: 'english',
    });
    expect(interpretVoiceQuery('I want a red panjabi size XL').query).toBe('red panjabi size XL');
  });

  it('Bangla: request words dropped, colour and garment in the catalogue’s English', () => {
    expect(interpretVoiceQuery('আমাকে কালো টি-শার্ট দেখাও')).toMatchObject({
      query: 'black t-shirt',
      language: 'bangla',
    });
    expect(interpretVoiceQuery('একটা সাদা শার্ট লাগবে').query).toBe('white shirt');
  });

  it('Banglish: the same meaning, in any common spelling', () => {
    for (const said of [
      'Amake kalo t-shirt dekhao',
      'amake kalu tshirt dekhao',
      'ami kaloo t shirt chai',
    ]) {
      expect(interpretVoiceQuery(said)).toMatchObject({
        query: 'black t-shirt',
        language: 'banglish',
      });
    }
    expect(interpretVoiceQuery('amar ekta shobuj juta lagbe').query).toBe('green shoe');
  });

  it('mixed speech: "Black t-shirt দেখাও"', () => {
    expect(interpretVoiceQuery('Black t-shirt দেখাও')).toMatchObject({
      // Case is kept as said; the search itself ignores it.
      query: 'Black t-shirt',
      language: 'mixed',
    });
  });

  it('keeps product names, brands, sizes and numbers exactly as said', () => {
    expect(interpretVoiceQuery('amake addidas polo xl 42 dekhao').query).toBe('addidas polo xl 42');
    expect(interpretVoiceQuery('Nike Air Max').query).toBe('Nike Air Max');
  });

  it('never empties the search: only request words keeps what was heard', () => {
    expect(interpretVoiceQuery('show me').query).toBe('show me');
    expect(interpretVoiceQuery('  ').query).toBe('');
  });

  it('meets Banglish spellings at one phonetic key', () => {
    expect(phoneticKey('kalo')).toBe(phoneticKey('kaloo'));
    expect(phoneticKey('shobuj')).toBe(phoneticKey('sobuj'));
  });
});
