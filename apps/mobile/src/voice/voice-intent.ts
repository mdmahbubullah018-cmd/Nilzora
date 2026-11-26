/*
 * What the customer meant to search for
 * -------------------------------------
 * The shop's search needs EVERY word of a query to match a product (see the API's prefix query),
 * so the words people naturally speak around a request — "show me", "আমাকে … দেখাও",
 * "amake … dekhao" — would make a perfectly good search find nothing. And the catalogue is
 * written in English, so the Bangla and Banglish words for a colour or a garment ("কালো", "kalo")
 * only find products once they are said the way the catalogue says them ("black").
 *
 * This module turns what was heard into a search query:
 *
 *   - it drops the request words (English, Bangla and Banglish) and keeps every meaningful term;
 *   - it rewrites a small, known list of colours and garments to the English the catalogue uses;
 *   - it leaves everything else exactly as spoken: product names, brands, sizes, numbers and any
 *     word it does not know are never translated, renamed or guessed at;
 *   - when nothing meaningful is left (the customer said only request words) it keeps what was
 *     heard, so a search is never silently emptied.
 *
 * Banglish is written in many spellings ("kalo", "kalu", "kaloo"), so Latin words are compared
 * through a light phonetic key rather than letter for letter. It is a curated list, not a
 * translator: it covers everyday shopping words, and an unknown word is always passed through.
 */

export type VoiceLanguage = 'english' | 'bangla' | 'banglish' | 'mixed';

export interface VoiceIntent {
  /** What was heard, with spacing tidied: shown to the customer so they can see the source. */
  heard: string;
  /** The words to search. Equal to `heard` when there was nothing to remove or rewrite. */
  query: string;
  /** Which way the customer spoke, for the interface. */
  language: VoiceLanguage;
}

/**
 * A key under which common Banglish spellings of one word meet: "kalo", "kalu" and "kaloo" all
 * give the same key, as do "shobuj" and "sobuj". Applied to both the list and the heard word.
 */
export function phoneticKey(word: string): string {
  return word
    .toLowerCase()
    .replace(/sh/g, 's')
    .replace(/ph/g, 'f')
    .replace(/([bcdgjkpt])h/g, '$1')
    .replace(/v/g, 'b')
    .replace(/z/g, 'j')
    .replace(/u/g, 'o')
    .replace(/(.)\1+/g, '$1');
}

/** Request words in English: they ask for something and name nothing. */
const ENGLISH_FILLER: ReadonlySet<string> = new Set([
  'show',
  'me',
  'find',
  'search',
  'for',
  'looking',
  'look',
  'i',
  'want',
  'need',
  'wanna',
  'please',
  'can',
  'you',
  'could',
  'would',
  'like',
  'get',
  'give',
  'buy',
  'to',
  'the',
  'a',
  'an',
  'some',
  'my',
  'us',
  'let',
  'see',
  'display',
  'bring',
  'is',
  'there',
  'any',
  'do',
  'have',
  'am',
  'of',
  'something',
  'pls',
  'plz',
  'kindly',
  'hey',
  'ok',
  'okay',
]);

/** Request words in Bangla script. */
const BANGLA_FILLER: ReadonlySet<string> = new Set([
  'আমাকে',
  'আমি',
  'আমার',
  'আমরা',
  'দেখাও',
  'দেখান',
  'দেখাবেন',
  'দেখি',
  'দেখব',
  'দেখবো',
  'চাই',
  'চাচ্ছি',
  'লাগবে',
  'দরকার',
  'দাও',
  'দিন',
  'দেন',
  'দিবেন',
  'খুঁজে',
  'খুজে',
  'খুঁজো',
  'খুঁজুন',
  'কিনতে',
  'কিনব',
  'কিনবো',
  'একটা',
  'একটি',
  'একটু',
  'কিছু',
  'প্লিজ',
  'প্লীজ',
  'দয়া',
  'শুধু',
  'করো',
  'করুন',
  'করে',
  'আছে',
  'জন্য',
  'সার্চ',
]);

/** Request words in Banglish (spelled any common way; compared by phonetic key). */
const BANGLISH_FILLER_SPELLINGS = [
  'ami',
  'amar',
  'amake',
  'amra',
  'chai',
  'chacchi',
  'lagbe',
  'dorkar',
  'dekhao',
  'dekhan',
  'dekhaben',
  'dekhbo',
  'dekhi',
  'dao',
  'den',
  'din',
  'diben',
  'khuje',
  'khujo',
  'khujun',
  'kinte',
  'kinbo',
  'ekta',
  'akta',
  'ekti',
  'kichu',
  'kisu',
  'kore',
  'koro',
  'korun',
  'ache',
  'jonno',
  'plz',
];
const BANGLISH_FILLER: ReadonlySet<string> = new Set(BANGLISH_FILLER_SPELLINGS.map(phoneticKey));

/** Colours and garments, as the catalogue words them (English). Bangla script, exact. */
const BANGLA_TERMS: Readonly<Record<string, string>> = {
  কালো: 'black',
  কালা: 'black',
  সাদা: 'white',
  লাল: 'red',
  নীল: 'blue',
  নিল: 'blue',
  সবুজ: 'green',
  হলুদ: 'yellow',
  গোলাপি: 'pink',
  গোলাপী: 'pink',
  বেগুনি: 'purple',
  কমলা: 'orange',
  ধূসর: 'grey',
  বাদামি: 'brown',
  খয়েরি: 'brown',
  মেরুন: 'maroon',
  নেভি: 'navy',
  শার্ট: 'shirt',
  জামা: 'shirt',
  গেঞ্জি: 't-shirt',
  প্যান্ট: 'pant',
  জিন্স: 'jeans',
  জুতা: 'shoe',
  জুতো: 'shoe',
  স্যান্ডেল: 'sandal',
  শাড়ি: 'saree',
  শাড়ী: 'saree',
  পাঞ্জাবি: 'panjabi',
  পাঞ্জাবী: 'panjabi',
  কুর্তি: 'kurti',
  কুর্তা: 'kurta',
  ব্যাগ: 'bag',
  ঘড়ি: 'watch',
  চশমা: 'glasses',
  টুপি: 'cap',
  জ্যাকেট: 'jacket',
  হুডি: 'hoodie',
  লুঙ্গি: 'lungi',
  পাজামা: 'pajama',
};

/** The same, spelled in Latin the way Banglish speakers write it. Compared by phonetic key. */
const BANGLISH_TERM_SPELLINGS: Readonly<Record<string, string>> = {
  kalo: 'black',
  kala: 'black',
  sada: 'white',
  shada: 'white',
  lal: 'red',
  nil: 'blue',
  sobuj: 'green',
  shobuj: 'green',
  holud: 'yellow',
  golapi: 'pink',
  beguni: 'purple',
  komola: 'orange',
  dhusor: 'grey',
  badami: 'brown',
  khoyeri: 'brown',
  juta: 'shoe',
  juto: 'shoe',
  joota: 'shoe',
  shari: 'saree',
  sari: 'saree',
  panjabi: 'panjabi',
  punjabi: 'panjabi',
  ghori: 'watch',
  topi: 'cap',
  byag: 'bag',
  // Garments and footwear people name in Banglish: mapped to the word the catalogue uses, so
  // "amake ekta genji dekhao" finds the t-shirts instead of searching for "genji".
  genji: 't-shirt',
  jama: 'shirt',
  jins: 'jeans',
  jeans: 'jeans',
  pant: 'pant',
  kurti: 'kurti',
  kurta: 'kurta',
  chosma: 'glasses',
  sandal: 'sandal',
  lungi: 'lungi',
  pajama: 'pajama',
  hoodi: 'hoodie',
  jeket: 'jacket',
};
const BANGLISH_TERMS: ReadonlyMap<string, string> = new Map(
  Object.entries(BANGLISH_TERM_SPELLINGS).map(([spelling, english]) => [
    phoneticKey(spelling),
    english,
  ]),
);

/**
 * Plurals of the garment words above, written back as the catalogue writes them. A search for
 * "shirts" finds nothing when every product says "Shirt", so these few common plurals are
 * normalised; nothing else is touched.
 */
const GARMENT_PLURALS: Readonly<Record<string, string>> = {
  shirts: 'shirt',
  pants: 'pant',
  shoes: 'shoe',
  sandals: 'sandal',
  sarees: 'saree',
  panjabis: 'panjabi',
  kurtis: 'kurti',
  bags: 'bag',
  watches: 'watch',
  caps: 'cap',
  hoodies: 'hoodie',
  jackets: 'jacket',
};

const BENGALI = /[ঀ-৿]/;
/** Spoken or typed every which way: "t shirt", "tshirt", "t-shirt", "টি শার্ট", "টি-শার্ট". */
const TSHIRT = /\b[tT][\s-]*[sS]hirts?\b|টি[\s-]*শার্ট/gu;
const EDGE_PUNCTUATION = /^[("'“‘]+|[,.!?;:)"'”’।]+$/g;

type Kind = 'english' | 'bangla' | 'banglish';

/** Reads what was heard as a search; see the module note for what is kept and what is rewritten. */
export function interpretVoiceQuery(input: string): VoiceIntent {
  const heard = input.replace(/\s+/g, ' ').trim();
  if (heard === '') return { heard: '', query: '', language: 'english' };

  const spaced = heard.replace(TSHIRT, 't-shirt');
  const kept: string[] = [];
  const kinds = new Set<Kind>();

  for (const token of spaced.split(' ')) {
    const core = token.replace(EDGE_PUNCTUATION, '');
    if (core === '') continue;
    const lower = core.toLowerCase();

    if (BENGALI.test(core)) {
      kinds.add('bangla');
      if (BANGLA_FILLER.has(core)) continue;
      kept.push(BANGLA_TERMS[core] ?? core);
      continue;
    }
    // Numbers (sizes, prices) and the joined t-shirt word are kept as they are; the t-shirt word
    // may have come from Bangla speech, so it says nothing about the language.
    if (/^[0-9]/.test(core) || lower === 't-shirt') {
      kept.push(core);
      continue;
    }

    if (ENGLISH_FILLER.has(lower)) {
      kinds.add('english');
      continue;
    }
    const plural = GARMENT_PLURALS[lower];
    if (plural !== undefined) {
      kinds.add('english');
      kept.push(plural);
      continue;
    }
    const key = phoneticKey(lower);
    if (BANGLISH_FILLER.has(key)) {
      kinds.add('banglish');
      continue;
    }
    const term = BANGLISH_TERMS.get(key);
    if (term !== undefined) {
      kinds.add('banglish');
      kept.push(term);
      continue;
    }
    kinds.add('english');
    kept.push(core);
  }

  const language: VoiceLanguage =
    kinds.has('bangla') && (kinds.has('english') || kinds.has('banglish'))
      ? 'mixed'
      : kinds.has('bangla')
        ? 'bangla'
        : kinds.has('banglish')
          ? 'banglish'
          : 'english';

  // Nothing meaningful left (only request words were said): keep what was heard.
  const query = kept.length === 0 ? heard : kept.join(' ');
  return { heard, query, language };
}
