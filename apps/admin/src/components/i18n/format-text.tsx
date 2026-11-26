'use client';

import { useLanguage } from '@/lib/i18n/provider';
import { translateText } from '@/lib/i18n/text';
import {
  formatAuditAction,
  formatDate,
  formatDateTime,
  formatDay,
  formatDayLong,
  formatFullDate,
  formatRelativeTime,
  formatTime,
  plural,
} from '@/lib/format';

/*
 * Formatting at the language boundary
 * -----------------------------------
 * A server component cannot call a hook, and a plain function cannot know the reader's
 * language. These small client components bridge the two: they read the language from the
 * provider and hand it to the formatters in `lib/format`, which build their `Intl` objects once
 * per language at module load — never per render.
 *
 * Each one renders a bare string — never an element — so it is valid inside `<td>`, `<caption>`
 * and `<option>` as well as in running text.
 */

/** "5 categories" in English, "5টি ক্যাটাগরি" in Bangla. */
export function CountText({ count, one, many }: { count: number; one: string; many?: string }) {
  const { language } = useLanguage();
  return <>{plural(count, one, many, language)}</>;
}

/** A stored timestamp as "25 Oct 2026", "25 Oct 2026, 14:05" or "14:05". */
export function DateTimeText({
  value,
  style = 'date',
}: {
  value: string;
  style?: 'date' | 'datetime' | 'time';
}) {
  const { language } = useLanguage();
  const text =
    style === 'time'
      ? formatTime(value, language)
      : style === 'datetime'
        ? formatDateTime(value, language)
        : formatDate(value, language);
  return <>{text}</>;
}

/** A calendar day ("2026-10-25") as "25 Oct" or "Sun, 25 Oct 2026". */
export function CalendarDayText({ day, long = false }: { day: string; long?: boolean }) {
  const { language } = useLanguage();
  return <>{long ? formatDayLong(day, language) : formatDay(day, language)}</>;
}

/** A `Date` as "Friday, 20 November 2026" / "শুক্রবার, 20 নভেম্বর 2026". */
export function FullDateText({ at }: { at: Date }) {
  const { language } = useLanguage();
  return <>{formatFullDate(at, language)}</>;
}

/** "5 min ago", "yesterday", then the date. */
export function RelativeTimeText({ value, now }: { value: string; now?: Date }) {
  const { language } = useLanguage();
  return <>{formatRelativeTime(value, now, language)}</>;
}

/** An audit action code as a sentence in the reader's language. */
export function AuditActionText({ action }: { action: string }) {
  const { language } = useLanguage();
  return <>{formatAuditAction(action, language)}</>;
}

/**
 * "vs previous 30 days: no earlier figures" as one sentence, so it stays a single text node —
 * screen readers read it in one go and tests can match it whole. The tail is translated; the
 * comparison itself already arrives in the reader's language.
 */
export function ComparisonText({ comparison }: { comparison: string }) {
  const { language } = useLanguage();
  const tail = translateText('no earlier figures', language);
  return <>{`${comparison}: ${tail}`}</>;
}
