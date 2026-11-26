import { describe, expect, it } from 'vitest';
import {
  changeRatio,
  formatAuditAction,
  formatBdPhone,
  formatCompactMoney,
  formatCount,
  formatDate,
  formatDateTime,
  formatDay,
  formatDayLong,
  formatFullDate,
  formatMoney,
  formatPercent,
  formatRelativeTime,
  formatTime,
  greetingFor,
  plural,
} from './format';

describe('money', () => {
  it('shows poisha as taka with lakh grouping', () => {
    expect(formatMoney(125_000)).toBe('৳1,250');
    expect(formatMoney(12_500_000_00)).toBe('৳1,25,00,000');
    expect(formatMoney(125_050)).toBe('৳1,250.50');
    expect(formatMoney(0)).toBe('৳0');
    expect(formatMoney(-5_000)).toBe('−৳50');
    expect(formatMoney(1.5)).toBe('');
  });

  it('abbreviates amounts for axes in thousands, lakh and crore', () => {
    expect(formatCompactMoney(95_000)).toBe('৳950');
    expect(formatCompactMoney(1_250_000)).toBe('৳12.5K');
    expect(formatCompactMoney(125_000_000)).toBe('৳12.5L');
    expect(formatCompactMoney(3_000_000_000)).toBe('৳3Cr');
  });
});

describe('numbers', () => {
  it('groups counts and formats ratios as percentages', () => {
    expect(formatCount(125_000)).toBe('1,25,000');
    expect(formatPercent(0.125)).toBe('12.5%');
    expect(plural(1, 'item')).toBe('1 item');
    expect(plural(1200, 'item')).toBe('1,200 items');
  });

  it('compares with the previous period only when it had a value', () => {
    expect(changeRatio(150, 100)).toBe(0.5);
    expect(changeRatio(50, 100)).toBe(-0.5);
    expect(changeRatio(10, 0)).toBeNull();
  });
});

describe('dates', () => {
  // 20:05 UTC on 25 October is 02:05 on 26 October in Dhaka (UTC+6).
  const lateEvening = '2026-10-25T20:05:00.000Z';

  it('shows instants on the Bangladesh clock', () => {
    expect(formatDate(lateEvening)).toBe('26 Oct 2026');
    expect(formatDateTime(lateEvening)).toBe('26 Oct 2026, 02:05');
    expect(formatTime(lateEvening)).toBe('02:05');
    expect(formatDate('not a date')).toBe('');
  });

  it('shows calendar days without shifting them', () => {
    expect(formatDay('2026-10-25')).toBe('25 Oct');
    expect(formatDayLong('2026-10-25')).toBe('Sun, 25 Oct 2026');
    expect(formatDay('25/10/2026')).toBe('');
  });

  it('describes recent times relative to the page clock', () => {
    const now = new Date('2026-10-25T12:00:00.000Z');
    expect(formatRelativeTime('2026-10-25T11:59:40.000Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-10-25T11:55:00.000Z', now)).toBe('5 min ago');
    expect(formatRelativeTime('2026-10-25T09:00:00.000Z', now)).toBe('3 h ago');
    expect(formatRelativeTime('2026-10-24T12:00:00.000Z', now)).toBe('yesterday');
    expect(formatRelativeTime('2026-10-22T12:00:00.000Z', now)).toBe('3 days ago');
    expect(formatRelativeTime('2026-10-01T12:00:00.000Z', now)).toBe('1 Oct 2026');
  });
});

describe('formatBdPhone', () => {
  it('writes stored numbers the local way and leaves others alone', () => {
    expect(formatBdPhone('+8801712345678')).toBe('01712-345678');
    expect(formatBdPhone('12345')).toBe('12345');
  });
});

describe('formatAuditAction', () => {
  it('describes known audit actions and spells out unknown ones', () => {
    expect(formatAuditAction('order.status_changed')).toBe('Changed an order’s status');
    expect(formatAuditAction('product.image_added')).toBe('Added a product image');
    expect(formatAuditAction('product.image_updated')).toBe(
      'Changed a product image’s description',
    );
    expect(formatAuditAction('product.images_reordered')).toBe('Reordered a product’s images');
    expect(formatAuditAction('product.image_removed')).toBe('Removed a product image');
    expect(formatAuditAction('coupon.usage_limit_reached')).toBe('Coupon: usage limit reached');
    expect(formatAuditAction('login')).toBe('Login');
  });
});

describe('greetingFor and formatFullDate', () => {
  // Bangladesh is UTC+6, so these UTC instants land at the stated Dhaka hour.
  it('greets by the Bangladesh clock, not the viewer’s', () => {
    expect(greetingFor(new Date('2026-10-25T01:00:00.000Z'))).toBe('Good morning');
    expect(greetingFor(new Date('2026-10-25T05:59:00.000Z'))).toBe('Good morning');
    expect(greetingFor(new Date('2026-10-25T06:00:00.000Z'))).toBe('Good afternoon');
    expect(greetingFor(new Date('2026-10-25T10:59:00.000Z'))).toBe('Good afternoon');
    expect(greetingFor(new Date('2026-10-25T11:00:00.000Z'))).toBe('Good evening');
    expect(greetingFor(new Date('2026-10-25T12:00:00.000Z'))).toBe('Good evening');
    expect(greetingFor(new Date('2026-10-25T18:30:00.000Z'))).toBe('Good morning');
  });

  it('writes the full Bangladesh date for the overview header', () => {
    expect(formatFullDate(new Date('2026-10-25T12:00:00.000Z'))).toBe(
      'Sunday, 25 October 2026',
    );
  });
});
