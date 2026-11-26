import { formatDate, formatDateTime } from '../lib/dates';
import { formatMoney, itemCountLabel, savingPercent, spokenMoney } from '../lib/money';

describe('formatMoney (matches the storefront)', () => {
  it('shows whole taka without decimals, with lakh and crore grouping', () => {
    expect(formatMoney(0)).toBe('৳0');
    expect(formatMoney(99_900)).toBe('৳999');
    expect(formatMoney(65_000)).toBe('৳650');
    expect(formatMoney(125_000)).toBe('৳1,250');
    expect(formatMoney(12_345_600)).toBe('৳1,23,456');
    expect(formatMoney(12_500_000)).toBe('৳1,25,000');
    expect(formatMoney(123_456_700)).toBe('৳12,34,567');
    expect(formatMoney(1_000_000_000)).toBe('৳1,00,00,000');
  });

  it('shows poisha only when there are any', () => {
    expect(formatMoney(125_050)).toBe('৳1,250.50');
    expect(formatMoney(5)).toBe('৳0.05');
    expect(formatMoney(10_001)).toBe('৳100.01');
    expect(formatMoney(15_010)).toBe('৳150.10');
  });

  it('marks negative amounts and refuses anything that is not a safe integer', () => {
    expect(formatMoney(-7_000)).toBe('−৳70');
    expect(formatMoney(12.5)).toBe('');
    expect(formatMoney(Number.NaN)).toBe('');
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe('');
    expect(formatMoney(Number.MAX_SAFE_INTEGER + 2)).toBe('');
  });
});

describe('spokenMoney', () => {
  it('reads the amount in words, without the currency symbol', () => {
    expect(spokenMoney(125_000)).toBe('1,250 taka');
    expect(spokenMoney(125_050)).toBe('1,250 taka 50 poisha');
    expect(spokenMoney(5)).toBe('0 taka 5 poisha');
    expect(spokenMoney(-7_000)).toBe('minus 70 taka');
    expect(spokenMoney(1.5)).toBe('');
  });
});

describe('savingPercent', () => {
  it('rounds down to a whole percent and ignores non-savings', () => {
    expect(savingPercent(75_000, 100_000)).toBe(25);
    expect(savingPercent(66_700, 100_000)).toBe(33);
    expect(savingPercent(100_000, 100_000)).toBeNull();
    expect(savingPercent(100_000, 90_000)).toBeNull();
    expect(savingPercent(99_999, 100_000)).toBeNull(); // under 1%
    expect(savingPercent(100, null)).toBeNull();
    expect(savingPercent(100, undefined)).toBeNull();
  });
});

describe('itemCountLabel', () => {
  it('pluralises', () => {
    expect(itemCountLabel(1)).toBe('1 item');
    expect(itemCountLabel(0)).toBe('0 items');
    expect(itemCountLabel(12)).toBe('12 items');
  });
});

describe('dates (Bangladesh calendar, UTC+6)', () => {
  it('formats the Bangladesh calendar day', () => {
    expect(formatDate('2026-01-05T10:00:00.000Z')).toBe('5 January 2026');
    // 20:30 UTC on 31 December is already 1 January in Dhaka.
    expect(formatDate('2025-12-31T20:30:00.000Z')).toBe('1 January 2026');
    // 17:59 UTC is still the same day in Dhaka; 18:00 UTC is the next.
    expect(formatDate('2026-03-05T17:59:59.000Z')).toBe('5 March 2026');
    expect(formatDate('2026-03-05T18:00:00.000Z')).toBe('6 March 2026');
  });

  it('adds the Bangladesh time of day', () => {
    expect(formatDateTime('2026-01-05T10:05:00.000Z')).toBe('5 January 2026, 16:05');
    expect(formatDateTime('2026-10-25T18:30:00.000Z')).toBe('26 October 2026, 00:30');
  });

  it('returns an empty string for anything that is not a date', () => {
    expect(formatDate('not a date')).toBe('');
    expect(formatDate('')).toBe('');
    expect(formatDateTime('2026-13-45')).toBe('');
  });

  it('does not depend on Intl', () => {
    const intl = globalThis.Intl;
    Reflect.set(globalThis, 'Intl', undefined); // a Hermes build without Intl
    try {
      expect(formatDate('2026-01-05T10:00:00.000Z')).toBe('5 January 2026');
      expect(formatMoney(125_050)).toBe('৳1,250.50');
    } finally {
      Reflect.set(globalThis, 'Intl', intl);
    }
  });
});
