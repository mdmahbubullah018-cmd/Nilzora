import { describe, expect, it } from 'vitest';
import {
  dhakaToday,
  formatRange,
  isCalendarDay,
  parseReportRange,
  rangeParams,
  shiftDay,
  spanDays,
} from './date-range';

// 1 Nov 2026, 20:30 UTC is already 2 Nov in Dhaka (UTC+6).
const LATE_EVENING_UTC = new Date('2026-11-01T20:30:00Z');
const NOON = new Date('2026-11-15T06:00:00Z');

describe('day helpers', () => {
  it('reads today on the Dhaka calendar, not UTC', () => {
    expect(dhakaToday(LATE_EVENING_UTC)).toBe('2026-11-02');
    expect(dhakaToday(new Date('2026-11-01T17:59:00Z'))).toBe('2026-11-01');
  });

  it('moves days across month and year ends', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(spanDays('2026-11-01', '2026-11-30')).toBe(30);
    expect(spanDays('2026-11-05', '2026-11-05')).toBe(1);
  });

  it('accepts only real calendar days', () => {
    expect(isCalendarDay('2026-02-28')).toBe(true);
    for (const value of ['2026-02-30', '2026-13-01', '26-11-01', '2026-11-1', '', undefined]) {
      expect(isCalendarDay(value)).toBe(false);
    }
  });

  it('formats ranges compactly', () => {
    expect(formatRange('2026-11-03', '2026-11-03')).toBe('3 Nov 2026');
    expect(formatRange('2026-11-01', '2026-11-15')).toBe('1–15 Nov 2026');
    expect(formatRange('2026-10-28', '2026-11-03')).toBe('28 Oct – 3 Nov 2026');
    expect(formatRange('2025-12-20', '2026-01-05')).toBe('20 Dec 2025 – 5 Jan 2026');
  });
});

describe('parseReportRange', () => {
  it('defaults to the last 30 days, compared with the 30 before', () => {
    const range = parseReportRange({}, NOON);
    expect(range).toMatchObject({
      preset: '30d',
      from: '2026-10-17',
      to: '2026-11-15',
      days: 30,
      compare: true,
      label: 'Last 30 days',
      comparisonLabel: 'vs previous 30 days',
    });
  });

  it('reads each preset', () => {
    expect(parseReportRange({ range: 'today' }, NOON)).toMatchObject({
      from: '2026-11-15',
      to: '2026-11-15',
      days: 1,
      comparisonLabel: 'vs yesterday',
    });
    expect(parseReportRange({ range: '7d' }, NOON)).toMatchObject({ from: '2026-11-09', days: 7 });
    expect(parseReportRange({ range: 'month' }, NOON)).toMatchObject({
      from: '2026-11-01',
      to: '2026-11-15',
      days: 15,
    });
  });

  it('accepts a valid custom range and labels it', () => {
    expect(
      parseReportRange({ range: 'custom', from: '2026-10-01', to: '2026-10-31' }, NOON),
    ).toMatchObject({ preset: 'custom', days: 31, label: '1–31 Oct 2026' });
  });

  it('falls back for a custom range that is backwards, in the future, too long or malformed', () => {
    for (const params of [
      { range: 'custom', from: '2026-11-10', to: '2026-11-01' },
      { range: 'custom', from: '2026-11-01', to: '2026-11-20' },
      { range: 'custom', from: '2025-01-01', to: '2026-11-15' },
      { range: 'custom', from: '2026-02-30', to: '2026-03-02' },
      { range: 'custom', from: ['2026-11-01', '2026-11-02'], to: '2026-11-03' },
      { range: 'yesterday' },
    ]) {
      expect(parseReportRange(params, NOON).preset).toBe('30d');
    }
  });

  it('keeps old ?days= links working', () => {
    expect(parseReportRange({ days: '7' }, NOON).preset).toBe('7d');
    expect(parseReportRange({ days: '90' }, NOON)).toMatchObject({
      preset: 'custom',
      days: 90,
      label: 'Last 90 days',
    });
  });

  it('turns the comparison off with compare=0', () => {
    expect(parseReportRange({ range: '7d', compare: '0' }, NOON).compare).toBe(false);
  });
});

describe('rangeParams', () => {
  it('round-trips a range through the address', () => {
    const custom = parseReportRange({ range: 'custom', from: '2026-10-01', to: '2026-10-31', compare: '0' }, NOON);
    expect(rangeParams(custom)).toEqual({
      range: 'custom',
      from: '2026-10-01',
      to: '2026-10-31',
      compare: '0',
    });
    expect(parseReportRange(rangeParams(custom), NOON)).toEqual(custom);
    expect(rangeParams(parseReportRange({ range: '7d' }, NOON))).toEqual({ range: '7d' });
  });
});
