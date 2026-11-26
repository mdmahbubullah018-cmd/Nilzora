import { describe, expect, it } from 'vitest';
import { formatBdPhone, formatLongDate, formatMoney } from './format';

describe('formatMoney', () => {
  it('shows poisha as taka with lakh grouping', () => {
    expect(formatMoney(0)).toBe('৳0');
    expect(formatMoney(65_000)).toBe('৳650');
    expect(formatMoney(125_000)).toBe('৳1,250');
    expect(formatMoney(12_500_000)).toBe('৳1,25,000');
  });

  it('keeps poisha when there are any', () => {
    expect(formatMoney(125_050)).toBe('৳1,250.50');
    expect(formatMoney(5)).toBe('৳0.05');
  });

  it('marks negative amounts and refuses non-integers', () => {
    expect(formatMoney(-7_000)).toBe('−৳70');
    expect(formatMoney(12.5)).toBe('');
    expect(formatMoney(Number.NaN)).toBe('');
  });
});

describe('formatBdPhone', () => {
  it('shows a stored E.164 mobile number in the local form', () => {
    expect(formatBdPhone('+8801712345678')).toBe('01712-345678');
    expect(formatBdPhone('+8801912345678')).toBe('01912-345678');
  });

  it('leaves anything else unchanged', () => {
    expect(formatBdPhone('')).toBe('');
    expect(formatBdPhone('01712-345678')).toBe('01712-345678');
    expect(formatBdPhone('+14155550123')).toBe('+14155550123');
  });
});

describe('formatLongDate', () => {
  it('uses the Bangladesh calendar day', () => {
    // 20:30 UTC on 31 December is already 1 January in Dhaka (UTC+6).
    expect(formatLongDate('2025-12-31T20:30:00.000Z')).toBe('1 January 2026');
    expect(formatLongDate('2026-03-05T04:00:00.000Z')).toBe('5 March 2026');
  });

  it('returns an empty string for an invalid date', () => {
    expect(formatLongDate('not a date')).toBe('');
  });
});
