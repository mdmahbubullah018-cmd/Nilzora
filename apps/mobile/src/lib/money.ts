/*
 * Money
 * -----
 * Amounts are integer poisha (1 BDT = 100 poisha) and come from the API; the app only
 * displays them. Formatting matches the storefront ("৳1,250", "৳1,250.50", lakh grouping
 * as in "৳1,25,000") but is written out by hand instead of using Intl.NumberFormat, so it
 * produces the same text on every Hermes build and ICU version.
 */

/** Groups digits the Bangladeshi way: the last three, then pairs (1,25,000). */
function groupLakh(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+$)/g, ',');
  return `${head},${digits.slice(-3)}`;
}

function parts(minor: number): { negative: boolean; taka: string; poisha: number } {
  const absolute = Math.abs(minor);
  return {
    negative: minor < 0,
    taka: groupLakh(String(Math.floor(absolute / 100))),
    poisha: absolute % 100,
  };
}

/**
 * An amount in poisha as taka: "৳1,250", or "৳1,250.50" when there are poisha. Returns an
 * empty string for anything that is not a safe integer.
 */
export function formatMoney(minor: number): string {
  if (!Number.isSafeInteger(minor)) return '';
  const { negative, taka, poisha } = parts(minor);
  const fraction = poisha === 0 ? '' : `.${String(poisha).padStart(2, '0')}`;
  return `${negative ? '−' : ''}৳${taka}${fraction}`;
}

/**
 * The same amount written for a screen reader: "1,250 taka" or "1,250 taka 50 poisha".
 * Screen readers pronounce the currency symbol inconsistently, so accessible labels use this.
 */
export function spokenMoney(minor: number): string {
  if (!Number.isSafeInteger(minor)) return '';
  const { negative, taka, poisha } = parts(minor);
  const amount = poisha === 0 ? `${taka} taka` : `${taka} taka ${poisha} poisha`;
  return negative ? `minus ${amount}` : amount;
}

/** Whole-percent saving against the former price, or null when there is none. */
export function savingPercent(
  priceMinor: number,
  compareAtPriceMinor: number | null | undefined,
): number | null {
  if (compareAtPriceMinor === null || compareAtPriceMinor === undefined) return null;
  if (compareAtPriceMinor <= priceMinor || compareAtPriceMinor <= 0) return null;
  const percent = Math.floor(((compareAtPriceMinor - priceMinor) / compareAtPriceMinor) * 100);
  return percent >= 1 ? percent : null;
}

/** Display text for a unit count: "1 item", "3 items". */
export function itemCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}
