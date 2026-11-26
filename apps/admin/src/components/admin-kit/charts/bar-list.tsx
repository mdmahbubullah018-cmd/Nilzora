import { cn } from '@nilzora/ui';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { heightPercent } from './scale';
import { CHART_TONES, type ChartTone } from './tones';
import { AutoText } from '@/components/i18n/translate';

export interface BarListItem {
  key: string;
  label: ReactNode;
  /** Sets the bar's length relative to the largest value. */
  value: number;
  /** The value as shown, e.g. "৳12,500". */
  display: string;
  /** A second figure under the label, e.g. "42 units". */
  secondary?: ReactNode;
  href?: Route;
}

export interface BarListProps {
  items: readonly BarListItem[];
  /** Names the list for assistive technology, e.g. "Top products by units sold". */
  label: string;
  tone?: ChartTone;
  /** Numbers each row (1, 2, 3 …), for a ranking such as top products. */
  ranked?: boolean;
  className?: string;
}

/**
 * A ranked list with a horizontal bar under each value: a horizontal bar chart whose
 * labels and values are ordinary text, so it needs no separate text alternative (the
 * list order carries the rank; the visible numbers repeat it). Bars grow in once, one
 * after another.
 */
export function BarList({ items, label, tone = 'primary', ranked = false, className }: BarListProps) {
  const max = Math.max(0, ...items.map((item) => item.value));
  return (
    <ol aria-label={label} className={cn('grid gap-3', className)}>
      {items.map((item, index) => {
        const body = (
          <>
            {ranked ? (
              <span
                aria-hidden="true"
                className={cn(
                  'nz-figure row-span-2 grid size-6 place-items-center self-center rounded-md text-[11px] font-semibold',
                  index < 3 ? 'bg-info-soft text-info-ink' : 'bg-neutral-soft text-neutral-ink',
                )}
              >
                {index + 1}
              </span>
            ) : null}
            <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium text-foreground"><AutoText value={item.label} /></span>
              <span className="nz-figure shrink-0 font-semibold text-foreground"><AutoText value={item.display} /></span>
            </div>
            <div className="flex min-w-0 items-center gap-3">
              <span aria-hidden="true" className="h-1.5 flex-1 overflow-hidden rounded-full bg-chart-track">
                <span
                  className={cn('nz-grow-x block h-full rounded-full', CHART_TONES[tone].swatch)}
                  style={{
                    width: `${String(heightPercent(item.value, max))}%`,
                    animationDelay: `${String(Math.min(index, 10) * 50)}ms`,
                  }}
                />
              </span>
              {item.secondary ? (
                <span className="nz-figure shrink-0 text-xs text-muted-foreground"><AutoText value={item.secondary} /></span>
              ) : null}
            </div>
          </>
        );
        const layout = ranked ? 'grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5' : 'grid gap-1.5';
        return (
          <li key={item.key}>
            {item.href ? (
              <Link
                href={item.href}
                className={cn(layout, '-mx-2 rounded-md px-2 py-1 transition-colors hover:bg-surface-muted')}
              >
                {body}
              </Link>
            ) : (
              <div className={layout}><AutoText value={body} /></div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
