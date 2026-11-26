import { REPORT_MAX_DAYS } from '@nilzora/contracts';
import { dhakaToday, shiftDay, spanDays } from './date-range';

/*
 * The date range an export carries. Reports always need `from` and `to` (Dhaka days) and
 * accept at most REPORT_MAX_DAYS days, while most lists have no date filter of their own.
 * A list without dates exports the last year ending today; a list with a one-sided range
 * fills the other side; a range longer than a report allows is cut to its latest days
 * (the end of the range is what staff are looking at).
 */

export interface ExportRange {
  from: string;
  to: string;
}

export function exportRange(
  range: { from?: string | undefined; to?: string | undefined } = {},
  now: Date = new Date(),
): ExportRange {
  const to = range.to ?? dhakaToday(now);
  const earliest = shiftDay(to, -(REPORT_MAX_DAYS - 1));
  const from = range.from ?? shiftDay(to, -364);
  if (from > to) return { from: to, to };
  return { from: spanDays(from, to) > REPORT_MAX_DAYS ? earliest : from, to };
}
