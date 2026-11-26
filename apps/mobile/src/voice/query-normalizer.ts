/*
 * Banglish → Bangla, for voice search
 * -----------------------------------
 * Customers here search by speaking whatever comes naturally: English, Bangla, or the mix of
 * the two written in Latin letters that everyone here calls Banglish ("Ami ekta black t-shirt
 * chai"). The recogniser returns the words in the script it was configured for, so a Banglish
 * sentence arrives as Latin text. Searching that literally finds nothing, because the catalogue
 * is written in Bangla and English.
 *
 * This module rewrites the words it knows into Bengali script and leaves everything else exactly
 * as it was. That last part is the important half: a product name is not a word to translate.
 * "black", "polo", "t-shirt", "addidas" and "xl" stay in Latin, so the search still matches the
 * catalogue. Only words that are unambiguously Banglish are rewritten.
 *
 * This is a curated word list, not a statistical transliterator: it covers the everyday shopping
 * vocabulary below, not every spelling of every Bangla word. A word it does not know is passed
 * through untouched, which is always safe — it searches for what was said.
 */

/**
 * Everyday shopping Banglish, spelled as people actually type it. Values are in Bengali script.
 * The first spelling of an entry is the preferred one; the rest are common variants.
 */
const VOCABULARY: Readonly<Record<string, string>> = {
  // ---- pronouns and people -------------------------------------------------------------
  ami: 'আমি',
  amar: 'আমার',
  amake: 'আমাকে',
  apni: 'আপনি',
  apnar: 'আপনার',
  tui: 'তুই',
  tumi: 'তুমি',
  tomar: 'তোমার',
  she: 'সে',
  se: 'সে',
  tara: 'তারা',
  amra: 'আমরা',

  // ---- the verbs a shopper uses --------------------------------------------------------
  chai: 'চাই',
  chay: 'চায়',
  cahi: 'চাহি',
  lagbe: 'লাগবে',
  lagbee: 'লাগবে',
  dorkar: 'দরকার',
  dekhao: 'দেখাও',
  dekhan: 'দেখান',
  dekhbo: 'দেখব',
  dekhi: 'দেখি',
  kinbo: 'কিনব',
  kinte: 'কিনতে',
  kino: 'কিনো',
  dao: 'দাও',
  den: 'দেন',
  din: 'দিন',
  nie: 'নিয়ে',
  niye: 'নিয়ে',
  ache: 'আছে',
  ase: 'আছে',
  nai: 'নাই',
  nei: 'নেই',
  hobe: 'হবে',
  hoy: 'হয়',
  koro: 'করো',
  korun: 'করুন',
  kore: 'করে',
  bolun: 'বলুন',
  bolo: 'বলো',
  sunte: 'শুনতে',
  khujo: 'খুঁজো',
  khujte: 'খুঁজতে',
  khoj: 'খোঁজ',
  khuje: 'খুঁজে',
  pathao: 'পাঠাও',
  pathan: 'পাঠান',

  // ---- quantity and degree -------------------------------------------------------------
  ekta: 'একটা',
  akta: 'একটা',
  ekti: 'একটি',
  duto: 'দুইটা',
  duti: 'দুইটি',
  tinta: 'তিনটা',
  beshi: 'বেশি',
  kom: 'কম',
  shob: 'সব',
  sob: 'সব',
  kichu: 'কিছু',
  onek: 'অনেক',
  olpo: 'অল্প',
  valo: 'ভালো',
  bhalo: 'ভালো',
  sundor: 'সুন্দর',
  darun: 'দারুণ',
  notun: 'নতুন',
  puran: 'পুরান',
  sosta: 'সস্তা',
  dame: 'দামে',
  dam: 'দাম',
  taka: 'টাকা',
  takar: 'টাকার',
  tk: 'টাকা',

  // ---- colours -------------------------------------------------------------------------
  lal: 'লাল',
  nil: 'নীল',
  sobuj: 'সবুজ',
  shobuj: 'সবুজ',
  holud: 'হলুদ',
  kalo: 'কালো',
  kala: 'কালা',
  sada: 'সাদা',
  meghla: 'মেঘলা',
  golapi: 'গোলাপি',
  beguni: 'বেগুনি',
  komola: 'কমলা',

  // ---- what is being bought ------------------------------------------------------------
  jama: 'জামা',
  jami: 'জামি',
  shari: 'শাড়ি',
  saree: 'শাড়ি',
  panjabi: 'পাঞ্জাবি',
  punjabi: 'পাঞ্জাবি',
  kabli: 'কাবলি',
  kurta: 'কুর্তা',
  kurthi: 'কুর্তি',
  kurti: 'কুর্তি',
  pant: 'প্যান্ট',
  pantolon: 'প্যান্টুলুন',
  pajama: 'পাজামা',
  lungi: 'লুঙ্গি',
  genji: 'গেঞ্জি',
  juto: 'জুতা',
  juta: 'জুতা',
  sandal: 'স্যান্ডেল',
  chosma: 'চশমা',
  bag: 'ব্যাগ',
  byag: 'ব্যাগ',
  ghori: 'ঘড়ি',
  watch: 'ঘড়ি',
  cap: 'টুপি',
  topi: 'টুপি',
  mosha: 'মশা',

  // ---- shopping and delivery ------------------------------------------------------------
  dukkhan: 'দোকান',
  dokan: 'দোকান',
  bazar: 'বাজার',
  order: 'অর্ডার',
  collection: 'কালেকশন',
  offer: 'অফার',
  chhar: 'ছাড়',
  chhari: 'ছাড়ি',
  discount: 'ডিসকাউন্ট',
  delivery: 'ডেলিভারি',
  courier: 'কুরিয়ার',
  address: 'ঠিকানা',
  bari: 'বাড়ি',
  dhaka: 'ঢাকা',
  bangladesh: 'বাংলাদেশ',
  size: 'সাইজ',
  map: 'মাপ',
  maap: 'মাপ',
  quality: 'কোয়ালিটি',
  original: 'অরিজিনাল',
  copy: 'কপি',

  // ---- people and family (gift searches) ------------------------------------------------
  chele: 'ছেলে',
  meye: 'মেয়ে',
  baccha: 'বাচ্চা',
  bachha: 'বাচ্চা',
  abbu: 'আব্বু',
  ammu: 'আম্মু',
  baba: 'বাবা',
  ma: 'মা',
  vai: 'ভাই',
  bhai: 'ভাই',
  bon: 'বোন',
  didi: 'দিদি',
  apa: 'আপা',
  khala: 'খালা',
  mama: 'মামা',
  bou: 'বউ',
  shami: 'স্বামী',
  stri: 'স্ত্রী',
};

/**
 * Words that must never be rewritten even when they collide with a Banglish spelling, because
 * they are product, brand or size names. Compared in lower case.
 */
const KEEP_AS_IS: ReadonlySet<string> = new Set([
  'mx',
  'xl',
  'xxl',
  'xxxl',
  'tshirt',
  't-shirt',
  'polo',
  'denim',
  'cotton',
  'linen',
  'silk',
  'leather',
  'sneakers',
  'loafer',
  'hoodie',
  'jacket',
  'blazer',
  'saree',
]);

/** A token that is already Bengali, or a number, or a price: nothing to rewrite. */
const BENGALI = /[\u0980-\u09FF]/;
const NUMERIC = /^[0-9,./৳%+-]+$/;

/**
 * Words that only appear in a Banglish sentence — a pronoun, a verb, a quantity. One of these
 * means the customer is speaking Banglish, so the whole utterance is normalised. Without one,
 * an English search that happens to contain a matching word ("black bag") is left alone.
 */
const ANCHORS: ReadonlySet<string> = new Set([
  'ami',
  'amar',
  'amake',
  'apni',
  'apnar',
  'amra',
  'tumi',
  'tomar',
  'tui',
  'tara',
  'chai',
  'chay',
  'cahi',
  'lagbe',
  'lagbee',
  'dorkar',
  'ekta',
  'akta',
  'ekti',
  'duto',
  'duti',
  'tinta',
  'kore',
  'koro',
  'korun',
  'dao',
  'den',
  'din',
  'dekhao',
  'dekhan',
  'dekhbo',
  'dekhi',
  'kinbo',
  'kinte',
  'kino',
  'khuje',
  'khujo',
  'khujte',
  'khoj',
  'ache',
  'ase',
  'nai',
  'nei',
  'hobe',
  'hoy',
  'bolo',
  'bolun',
  'pathao',
  'pathan',
  'sunte',
  'nie',
  'niye',
]);

/** Whether this utterance is Banglish rather than English with one coincidental word. */
function looksBanglish(tokens: readonly string[]): boolean {
  let known = 0;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (ANCHORS.has(lower)) return true;
    if (VOCABULARY[lower] !== undefined) known += 1;
  }
  return known >= 3;
}

/**
 * The query as it should be searched: a Banglish sentence in Bengali script with its English
 * product words kept, and a sentence that is already English (or already Bengali) untouched.
 */
export function normalizeVoiceQuery(input: string): string {
  const collapsed = input.replace(/\s+/g, ' ').trim();
  if (collapsed === '') return '';
  const tokens = collapsed.split(' ');
  if (!looksBanglish(tokens)) return collapsed;
  return tokens
    .map((token) => normalizeToken(token))
    .join(' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
}

function normalizeToken(token: string): string {
  if (token === '' || BENGALI.test(token) || NUMERIC.test(token)) return token;
  // Punctuation stays attached to the word it followed.
  const leading = /^[("'“]+/.exec(token)?.[0] ?? '';
  const trailing = /[,.!?;:)"'”]+$/.exec(token)?.[0] ?? '';
  const core = token.slice(leading.length, token.length - trailing.length);
  if (core === '') return token;
  const lower = core.toLowerCase();
  if (KEEP_AS_IS.has(lower)) return token;
  const bangla = VOCABULARY[lower];
  return bangla === undefined ? token : `${leading}${bangla}${trailing}`;
}

/** Whether anything was actually rewritten, so the UI can say what it searched for. */
export function isNormalized(original: string, normalized: string): boolean {
  return original.trim() !== '' && original.trim() !== normalized;
}
