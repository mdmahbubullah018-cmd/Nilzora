/*
 * Dates
 * -----
 * Orders and accounts are dated on the Bangladesh calendar (UTC+6, no daylight saving),
 * like the storefront. The text is built by hand rather than with Intl.DateTimeFormat:
 * Intl is optional on some Hermes builds and its output differs between ICU versions,
 * and a missing or throwing Intl must never crash a screen.
 */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const BANGLADESH_OFFSET_MS = 6 * 60 * 60 * 1000;

function bangladeshClock(iso: string): Date | null {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  // Shifting the instant makes the UTC getters read Bangladesh wall-clock time.
  return new Date(instant.getTime() + BANGLADESH_OFFSET_MS);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** e.g. "5 January 2026"; an empty string when `iso` is not a valid date. */
export function formatDate(iso: string): string {
  const clock = bangladeshClock(iso);
  if (clock === null) return '';
  return `${clock.getUTCDate()} ${MONTHS[clock.getUTCMonth()]} ${clock.getUTCFullYear()}`;
}

/** e.g. "5 January 2026, 16:30"; an empty string when `iso` is not a valid date. */
export function formatDateTime(iso: string): string {
  const clock = bangladeshClock(iso);
  if (clock === null) return '';
  return `${formatDate(iso)}, ${pad(clock.getUTCHours())}:${pad(clock.getUTCMinutes())}`;
}
