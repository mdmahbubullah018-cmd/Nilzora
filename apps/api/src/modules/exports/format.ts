import type { ReportColumn, ReportColumnType } from '@nilzora/contracts';

/*
 * Shared value handling for the export writers. Report rows carry raw values (money in
 * integer poisha, percentages as fractions, dates as YYYY-MM-DD, date-times as ISO
 * instants); each writer turns them into what its format shows best.
 */

export type ReportValue = string | number | null;
export type ReportRow = Readonly<Record<string, ReportValue>>;

/** A table to write: the columns in order and the rows keyed by column key. */
export interface TabularData {
  columns: readonly ReportColumn[];
  rows: readonly ReportRow[];
}

/** Bangladesh has no daylight saving: Dhaka time is always UTC+6. */
const DHAKA_OFFSET_MS = 6 * 3_600_000;

function dhakaParts(instant: string | Date): string | null {
  const time = instant instanceof Date ? instant.getTime() : Date.parse(instant);
  if (Number.isNaN(time)) return null;
  return new Date(time + DHAKA_OFFSET_MS).toISOString();
}

/** "2026-11-02 16:05" in Dhaka time, or the value unchanged when it is not a date-time. */
export function dhakaDateTime(instant: string | Date): string {
  const iso = dhakaParts(instant);
  return iso === null ? String(instant) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** "2026-11-02" in Dhaka time. */
export function dhakaDate(instant: string | Date): string {
  const iso = dhakaParts(instant);
  return iso === null ? String(instant) : iso.slice(0, 10);
}

/** Poisha to taka (two decimals). */
export function takaOf(poisha: number): number {
  return Math.round(poisha) / 100;
}

/** "1,234.50" — taka with thousands separators and two decimals. */
export function takaText(poisha: number): string {
  return takaOf(poisha).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** "12.5%" from a fraction. */
export function percentText(fraction: number): string {
  return `${(Math.round(fraction * 1000) / 10).toFixed(1)}%`;
}

/** A finite number, or null for anything else (null, text, NaN). */
export function numberOf(value: ReportValue | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/** The value as people read it (PDF, previews): money in taka, times in Dhaka. */
export function displayValue(type: ReportColumnType, value: ReportValue | undefined): string {
  if (value === null || value === undefined) return '';
  const number = numberOf(value);
  switch (type) {
    case 'money':
      return number === null ? String(value) : `Tk ${takaText(number)}`;
    case 'count':
      return number === null ? String(value) : number.toLocaleString('en-US');
    case 'percent':
      return number === null ? String(value) : percentText(number);
    case 'datetime':
      return dhakaDateTime(String(value));
    case 'date':
      return String(value).slice(0, 10);
    case 'text':
      return String(value);
  }
}

/** Header shown for a column in data files: date-times say which clock they use. */
export function dataHeader(column: ReportColumn): string {
  return column.type === 'datetime' ? `${column.header} (Dhaka time)` : column.header;
}
