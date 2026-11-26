// Bangladesh groups digits as lakh and crore (1,00,000), like en-IN.
const wholeTaka = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const takaWithPoisha = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** An amount in poisha as taka: "৳1,250", or "৳1,250.50" when there are poisha. */
export function formatMoney(minor: number): string {
  if (!Number.isSafeInteger(minor)) return '';
  const sign = minor < 0 ? '−' : '';
  const absolute = Math.abs(minor);
  const formatted =
    absolute % 100 === 0 ? wholeTaka.format(absolute / 100) : takaWithPoisha.format(absolute / 100);
  return `${sign}৳${formatted}`;
}

const longDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Dhaka',
});

/** e.g. "23 October 2026", on the Bangladesh calendar day. */
export function formatLongDate(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  return Number.isNaN(date.getTime()) ? '' : longDate.format(date);
}

/**
 * Shows a stored mobile number (E.164, e.g. +8801712345678) the way it is written
 * locally: 01712-345678. Anything else is returned unchanged.
 */
export function formatBdPhone(value: string): string {
  const match = /^\+880(1\d{3})(\d{6})$/.exec(value);
  if (!match?.[1] || !match[2]) return value;
  return `0${match[1]}-${match[2]}`;
}
