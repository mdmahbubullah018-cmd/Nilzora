import { cn } from '@nilzora/ui';
import type { ReactNode } from 'react';
import { AutoText } from '@/components/i18n/translate';
import { DateTimeText } from '@/components/i18n/format-text';

const dotTones = {
  neutral: 'bg-slate-400 ring-slate-100 dark:ring-slate-800',
  primary: 'bg-primary ring-sky-100 dark:ring-sky-400/20',
  success: 'bg-success ring-green-100 dark:ring-green-400/20',
  warning: 'bg-warning ring-amber-100 dark:ring-amber-400/20',
  danger: 'bg-danger ring-red-100 dark:ring-red-400/20',
  violet: 'bg-brand-violet ring-violet-100 dark:ring-violet-400/20',
  moderator: 'bg-moderator ring-teal-100 dark:ring-teal-400/20',
} as const;

export type TimelineTone = keyof typeof dotTones;

export interface TimelineItem {
  key: string;
  /** What happened, e.g. "Confirmed" or "Assigned to Rafi". */
  title: ReactNode;
  /** When, as an ISO date-time (shown on the Bangladesh clock). */
  at: string;
  /** Who or what did it, e.g. "Staff" or a name. */
  actor?: ReactNode;
  /** A note recorded with the step; shown as text, never as markup. */
  note?: string | null;
  tone?: TimelineTone;
  /**
   * A step that was recorded but did not take effect (e.g. a courier event older than the
   * current status): drawn faded, with `dimmedLabel` said beside it in words.
   */
  dimmed?: boolean;
  dimmedLabel?: string;
}

export interface TimelineProps {
  items: readonly TimelineItem[];
  /** Names the list for assistive technology, e.g. "Order history". */
  label: string;
  className?: string;
}

/**
 * A record's history as an ordered list, oldest first: a dot per step, its time,
 * who did it and any note. The order of the list is the order of events.
 */
export function Timeline({ items, label, className }: TimelineProps) {
  return (
    <ol aria-label={label} className={cn('grid', className)}>
      {items.map((item, index) => {
        const last = index === items.length - 1;
        return (
          <li
            key={item.key}
            data-dimmed={item.dimmed ? 'true' : undefined}
            className={cn(
              'relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3',
              item.dimmed && 'opacity-60',
            )}
          >
            {last ? null : (
              <span
                aria-hidden="true"
                className="absolute top-4 bottom-0 left-2.25 w-px bg-border"
              />
            )}
            <span
              aria-hidden="true"
              className={cn(
                'relative mt-1.5 size-2.5 justify-self-center rounded-full ring-4',
                dotTones[item.tone ?? 'neutral'],
              )}
            />
            <div className={cn('grid min-w-0 gap-1', last ? 'pb-0' : 'pb-5')}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                  {item.title}
                  {item.dimmed ? (
                    <span className="rounded-full border border-dashed border-border-strong px-2 text-[11px] font-semibold text-muted-foreground">
                      {item.dimmedLabel ?? 'Not applied'}
                    </span>
                  ) : null}
                </p>
                <time dateTime={item.at} className="text-xs text-muted-foreground tabular-nums">
                  <DateTimeText value={item.at} style="datetime" />
                </time>
              </div>
              {item.actor ? (
                <p className="text-xs text-muted-foreground">
                  <AutoText value={item.actor} />
                </p>
              ) : null}
              {item.note ? (
                <p className="rounded-md bg-surface-muted px-3 py-2 text-sm whitespace-pre-line text-body">
                  {item.note}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
