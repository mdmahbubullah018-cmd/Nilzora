/*
 * Display formatting for the workspaces. Money is always an integer number of poisha
 * (100 poisha = 1 taka); dates and times are shown on the Bangladesh clock
 * (Asia/Dhaka), whatever the server's or browser's own time zone.
 *
 * Language
 * --------
 * Money, counts and percentages read the same in both languages — Western digits, ৳, lakh
 * grouping — so they need no switch. Dates, relative times, plurals and audit sentences do:
 * those take an optional `lang` that defaults to English, so every existing call keeps its
 * output exactly. Formatters are built once per language at module load, never per render.
 */

import { translateText } from '@/lib/i18n/text';
import type { Language } from '@/lib/language';

const TIME_ZONE = 'Asia/Dhaka';

/** Bengali month and weekday names with Western digits: "শুক্রবার, 20 নভেম্বর 2026". */
const LOCALES: Record<Language, string> = { en: 'en-GB', bn: 'bn-BD-u-nu-latn' };

function build(lang: Language) {
  const locale = LOCALES[lang];
  return {
    date: new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: TIME_ZONE,
    }),
    dateTime: new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: TIME_ZONE,
    }),
    time: new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: TIME_ZONE,
    }),
    // Calendar days ("2026-10-25") have no time zone: format them as UTC so they never shift.
    dayShort: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    dayLong: new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }),
    fullDate: new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: TIME_ZONE,
    }),
  };
}

const FORMATTERS: Record<Language, ReturnType<typeof build>> = { en: build('en'), bn: build('bn') };

const bdHour = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  hourCycle: 'h23',
  timeZone: TIME_ZONE,
});

/** A Bangla dictionary line, or the English text when there is none yet. */
const bnText = (text: string): string => translateText(text, 'bn');

/** Fills `{name}` placeholders in a translated sentence. */
function fill(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

// Bangladesh groups digits as lakh and crore (1,00,000), like en-IN.
const wholeTaka = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const takaWithPoisha = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const counts = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('en-IN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const percent = new Intl.NumberFormat('en-IN', { style: 'percent', maximumFractionDigits: 1 });

/** An amount in poisha as taka: "৳1,250", or "৳1,250.50" when there are poisha. */
export function formatMoney(minor: number): string {
  if (!Number.isSafeInteger(minor)) return '';
  const sign = minor < 0 ? '−' : '';
  const absolute = Math.abs(minor);
  const formatted =
    absolute % 100 === 0 ? wholeTaka.format(absolute / 100) : takaWithPoisha.format(absolute / 100);
  return `${sign}৳${formatted}`;
}

/** A short amount for chart axes and tight spaces: "৳950", "৳12.5K", "৳12.5L", "৳3Cr". */
export function formatCompactMoney(minor: number): string {
  if (!Number.isSafeInteger(minor)) return '';
  const sign = minor < 0 ? '−' : '';
  return `${sign}৳${compact.format(Math.abs(minor) / 100)}`;
}

/** A count with lakh grouping: 1,25,000. */
export function formatCount(value: number): string {
  return Number.isFinite(value) ? counts.format(value) : '';
}

/** A ratio as a percentage: 0.125 → "12.5%". */
export function formatPercent(ratio: number): string {
  return Number.isFinite(ratio) ? percent.format(ratio) : '';
}

/**
 * The change from `previous` to `current` as a ratio (0.25 is 25% up), or null when
 * there is nothing to compare with (a previous value of zero).
 */
export function changeRatio(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/** "Thursday, 30 October 2026" on the Bangladesh calendar. */
export function formatFullDate(value: Date, lang: Language = 'en'): string {
  return FORMATTERS[lang].fullDate.format(value);
}

/** "Good morning", "Good afternoon" or "Good evening", by the Bangladesh clock. */
export function greetingFor(value: Date, lang: Language = 'en'): string {
  const hour = Number(bdHour.format(value));
  const greeting = !Number.isFinite(hour)
    ? 'Welcome back'
    : hour < 12
      ? 'Good morning'
      : hour < 17
        ? 'Good afternoon'
        : 'Good evening';
  return lang === 'bn' ? bnText(greeting) : greeting;
}

function parse(isoDateTime: string): Date | undefined {
  const value = new Date(isoDateTime);
  return Number.isNaN(value.getTime()) ? undefined : value;
}

/** "25 Oct 2026" on the Bangladesh calendar day. */
export function formatDate(isoDateTime: string, lang: Language = 'en'): string {
  const value = parse(isoDateTime);
  return value ? FORMATTERS[lang].date.format(value) : '';
}

/** "25 Oct 2026, 14:05" on the Bangladesh clock. */
export function formatDateTime(isoDateTime: string, lang: Language = 'en'): string {
  const value = parse(isoDateTime);
  return value ? FORMATTERS[lang].dateTime.format(value) : '';
}

/** "14:05" on the Bangladesh clock. */
export function formatTime(isoDateTime: string, lang: Language = 'en'): string {
  const value = parse(isoDateTime);
  return value ? FORMATTERS[lang].time.format(value) : '';
}

function parseDay(isoDate: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return undefined;
  return parse(`${isoDate}T00:00:00Z`);
}

/** A calendar day ("2026-10-25", as the API sends report days) as "25 Oct". */
export function formatDay(isoDate: string, lang: Language = 'en'): string {
  const value = parseDay(isoDate);
  return value ? FORMATTERS[lang].dayShort.format(value) : '';
}

/** A calendar day as "Sun, 25 Oct 2026". */
export function formatDayLong(isoDate: string, lang: Language = 'en'): string {
  const value = parseDay(isoDate);
  return value ? FORMATTERS[lang].dayLong.format(value) : '';
}

/**
 * How long ago something happened: "just now", "5 min ago", "3 h ago", "2 days ago",
 * then the date. Pass `now` from the request so one page uses one clock.
 */
export function formatRelativeTime(
  isoDateTime: string,
  now: Date = new Date(),
  lang: Language = 'en',
): string {
  const value = parse(isoDateTime);
  if (!value) return '';
  const seconds = Math.round((now.getTime() - value.getTime()) / 1000);
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);

  if (lang === 'bn') {
    if (seconds < 45) return bnText('just now');
    if (minutes < 60) return fill(bnText('{count} min ago'), { count: minutes });
    if (hours < 24) return fill(bnText('{count} h ago'), { count: hours });
    if (days < 7) {
      return days === 1 ? bnText('yesterday') : fill(bnText('{count} days ago'), { count: days });
    }
    return formatDate(isoDateTime, lang);
  }

  if (seconds < 45) return 'just now';
  if (minutes < 60) return `${String(minutes)} min ago`;
  if (hours < 24) return `${String(hours)} h ago`;
  if (days < 7) return days === 1 ? 'yesterday' : `${String(days)} days ago`;
  return formatDate(isoDateTime, lang);
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

/**
 * "1 item" / "3 items", and — because Bangla does not inflect the noun — "1টি আইটেম" /
 * "3টি আইটেম". The noun is looked up in the dictionary, so a new count needs no code.
 */
export function plural(count: number, one: string, many = `${one}s`, lang: Language = 'en'): string {
  const number = formatCount(count);
  if (lang === 'bn') return `${number}টি ${bnText(one)}`;
  return `${number} ${count === 1 ? one : many}`;
}

/** Audit log actions as sentences; unknown actions are spelled out from their name. */
const AUDIT_ACTIONS: Record<string, string> = {
  'category.created': 'Created a category',
  'category.updated': 'Updated a category',
  'customer.status_changed': 'Changed a customer’s status',
  'inventory.adjusted': 'Adjusted stock',
  'moderation.assigned': 'Assigned a content review',
  'moderation.decided': 'Decided a content review',
  'moderation.submitted': 'Submitted a product for review',
  'moderation.withdrawn': 'Withdrew a content review',
  'order.payment_collected': 'Recorded cash collected',
  'order.status_changed': 'Changed an order’s status',
  'product.created': 'Created a product',
  'product.image_added': 'Added a product image',
  'product.image_removed': 'Removed a product image',
  'product.image_updated': 'Changed a product image’s description',
  'product.images_reordered': 'Reordered a product’s images',
  'product.status_changed': 'Changed a product’s status',
  'product.updated': 'Updated a product',
  'settings.delivery_charge_changed': 'Changed a delivery charge',
  'shipment.booking_started': 'Started a courier booking',
  'shipment.booked': 'Booked a courier shipment',
  'shipment.booking_failed': 'A courier refused a booking',
  'shipment.booking_uncertain': 'A courier booking went unanswered',
  'shipment.booking_resolved': 'Resolved an uncertain courier booking',
  'shipment.status_recorded': 'Recorded a shipment status',
  'shipment.cancelled': 'Cancelled a shipment',
  'courier.settings_saved': 'Changed courier settings',
  'courier.provider_saved': 'Changed a courier provider',
  'courier.connection_checked': 'Checked a courier connection',
  'courier.rate_card_saved': 'Saved a courier rate',
  'courier.rate_card_deleted': 'Removed a courier rate',
  'courier.cod_collected_recorded': 'Recorded courier-collected cash',
  'courier.cod_adjusted': 'Adjusted a shipment’s COD',
  'courier.cod_state_changed': 'Changed a shipment’s COD state',
  'courier.settlement_recorded': 'Recorded a courier settlement',
  'staff.permission_changed': 'Changed a staff permission',
  'staff.role_changed': 'Changed a staff role',
};

/** e.g. "order.status_changed" → "Changed an order’s status"; "x.some_thing" → "X: some thing". */
export function formatAuditAction(action: string, lang: Language = 'en'): string {
  const known = AUDIT_ACTIONS[action];
  if (known) return lang === 'bn' ? bnText(known) : known;
  const [subject = '', ...rest] = action.split('.');
  const words = (text: string) => text.replaceAll('_', ' ').trim();
  const head = words(subject);
  const tail = words(rest.join(' '));
  const capitalised = head.charAt(0).toUpperCase() + head.slice(1);
  return tail ? `${capitalised}: ${tail}` : capitalised;
}
