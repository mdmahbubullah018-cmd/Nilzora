import { cn } from '@nilzora/ui';
import type { LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { KPI_CHIP_TONES, type KpiTone } from './kpi-card';
import { AutoText } from '@/components/i18n/translate';

export interface MetricTileProps {
  label: string;
  /** The figure, already formatted, e.g. "1,204". */
  value: ReactNode;
  icon: LucideIcon;
  tone?: KpiTone;
  /** A short line under the figure, e.g. "of 1,340 products". */
  hint?: ReactNode;
  /** Makes the whole tile a link to the filtered list the figure came from. */
  href?: Route;
  /** When the figure could not be read: shown instead of a made-up number. */
  unavailable?: string;
  className?: string;
}

/**
 * A compact figure for a strip of counters beside the headline KPIs (catalogue sizes,
 * customer totals). Same data discipline as KpiCard: it shows a real number or says it
 * could not be read, never a placeholder value.
 */
export function MetricTile({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  hint,
  href,
  unavailable,
  className,
}: MetricTileProps) {
  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-lg ring-1',
          KPI_CHIP_TONES[tone],
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate text-xs font-medium text-muted-foreground">
          <AutoText value={label} />
        </span>
        {unavailable ? (
          <span className="text-sm font-semibold text-muted-foreground">
            <span aria-hidden="true">—</span>
            <span className="sr-only">
              <AutoText value={unavailable} />
            </span>
          </span>
        ) : (
          <span className="nz-figure font-display text-lg font-semibold text-foreground">
            {value}
          </span>
        )}
        {unavailable ? (
          <span aria-hidden="true" className="truncate text-[11px] text-muted-foreground">
            {unavailable}
          </span>
        ) : hint ? (
          <span className="truncate text-[11px] text-muted-foreground">
            <AutoText value={hint} />
          </span>
        ) : null}
      </span>
    </>
  );

  return (
    <div className={cn('nz-panel rounded-xl border', href && 'nz-hover-lift', className)}>
      {href ? (
        <Link
          href={href}
          className="relative flex items-center gap-3 p-3.5 after:absolute after:inset-0 after:rounded-xl"
        >
          {body}
        </Link>
      ) : (
        <div className="flex items-center gap-3 p-3.5">
          <AutoText value={body} />
        </div>
      )}
    </div>
  );
}
