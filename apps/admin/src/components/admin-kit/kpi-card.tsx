import { Card, cn } from '@nilzora/ui';
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatPercent } from '@/lib/format';
import { Sparkline } from './charts/sparkline';
import type { ChartTone } from './charts/tones';
import { CountUp, type CountUpKind } from './count-up';
import { STATUS_TONES } from './status-tones';
import { ComparisonText } from '@/components/i18n/format-text';
import { AutoText } from '@/components/i18n/translate';

/** Icon well colours, from the admin's status tones. */
export const KPI_CHIP_TONES = {
  primary: STATUS_TONES.primary.well,
  success: STATUS_TONES.success.well,
  warning: STATUS_TONES.warning.well,
  danger: STATUS_TONES.danger.well,
  violet: STATUS_TONES.violet.well,
  moderator: STATUS_TONES.moderator.well,
  neutral: STATUS_TONES.neutral.well,
} as const;

export type KpiTone = keyof typeof KPI_CHIP_TONES;

/** The sparkline colour for each chip tone. */
const sparkTones: Record<KpiTone, ChartTone> = {
  primary: 'primary',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  violet: 'violet',
  moderator: 'moderator',
  neutral: 'neutral',
};

export interface KpiChange {
  /** The change as a ratio (0.25 is 25% up); null when there is nothing to compare with. */
  ratio: number | null;
  /** What it is compared with, e.g. "vs previous 30 days". */
  comparison: string;
  /** Whether a rise is good news (sales) or bad (cancellations). Default: good. */
  increaseIs?: 'good' | 'bad';
}

export interface KpiCardProps {
  label: string;
  /** The figure, already formatted, e.g. "৳1,25,000". Not needed when `animate` is set. */
  value?: ReactNode;
  /**
   * Shows the figure with a one-time count-up instead of `value`: the raw number
   * (integer poisha for money, a ratio for percent) and how to format it. The final
   * figure is still rendered on the server and is what screen readers read.
   */
  animate?: { value: number; kind: CountUpKind };
  icon: LucideIcon;
  tone?: KpiTone;
  /** Change vs the previous period; omit when the data does not allow one. */
  change?: KpiChange;
  /** Values over the period, oldest first, drawn as a decorative sparkline. */
  trend?: readonly number[];
  /** A short line under the figure, e.g. "Delivered, cash not yet recorded". */
  footnote?: ReactNode;
  /** Makes the whole card a link to the figure's detail. */
  href?: Route;
  className?: string;
}

function ChangeLine({ change }: { change: KpiChange }) {
  const { ratio, comparison, increaseIs = 'good' } = change;
  if (ratio === null) {
    // The previous period had nothing to compare with (a percentage of zero is undefined).
    return (
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 font-semibold ring-1 ring-inset',
            STATUS_TONES.neutral.chip,
          )}
        >
          <span aria-hidden="true">—</span>
          <span className="sr-only"><AutoText>No comparison</AutoText></span>
        </span>
        <span><ComparisonText comparison={comparison} /></span>
      </p>
    );
  }
  const direction = ratio > 0 ? 'up' : ratio < 0 ? 'down' : 'flat';
  const good = direction === 'flat' ? undefined : (direction === 'up') === (increaseIs === 'good');
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
      <span
        className={cn(
          'nz-figure inline-flex items-center gap-0.5 rounded-full py-0.5 pr-2 pl-1 font-semibold ring-1 ring-inset',
          good === true && STATUS_TONES.success.chip,
          good === false && STATUS_TONES.danger.chip,
          good === undefined && STATUS_TONES.neutral.chip,
        )}
      >
        <Icon aria-hidden="true" className="size-3.5" />
        <span className="sr-only">
          {direction === 'up' ? 'Up' : direction === 'down' ? 'Down' : 'Unchanged'}
        </span>
        {direction === 'flat' ? null : formatPercent(Math.abs(ratio))}
      </span>
      <span><AutoText value={comparison} /></span>
    </p>
  );
}

/**
 * One headline figure on a glass card: an icon well and label, the value (optionally
 * counting up), and where the data allows, the change vs the previous period (direction
 * in words and icon, never colour alone) and a sparkline of the period along the
 * card's bottom edge.
 */
export function KpiCard({
  label,
  value,
  animate,
  icon: Icon,
  tone = 'primary',
  change,
  trend,
  footnote,
  href,
  className,
}: KpiCardProps) {
  const hasTrend = trend !== undefined && trend.length > 1;
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1.5">
          <p className="text-sm font-medium text-muted-foreground"><AutoText value={label} /></p>
          <p className="nz-figure font-display text-[1.75rem] leading-none font-semibold tracking-tight text-foreground">
            {animate ? <CountUp value={animate.value} kind={animate.kind} /> : value}
          </p>
        </div>
        <span
          aria-hidden="true"
          className={cn(
            'grid size-10 shrink-0 place-items-center rounded-xl ring-1 shadow-glass-xs',
            KPI_CHIP_TONES[tone],
          )}
        >
          <Icon className="size-5" />
        </span>
      </div>
      {change || footnote ? (
        <div className="grid gap-1">
          {change ? <ChangeLine change={change} /> : null}
          {footnote ? <p className="text-xs text-muted-foreground"><AutoText value={footnote} /></p> : null}
        </div>
      ) : null}
    </>
  );

  return (
    <Card
      className={cn(
        'nz-panel nz-panel-sheen relative flex flex-col overflow-hidden rounded-xl',
        href && 'nz-hover-lift',
        className,
      )}
    >
      <div className={cn('grid flex-1 content-start gap-3 p-5', hasTrend && 'pb-2')}>
        {href ? (
          <Link
            href={href}
            className="grid gap-3 rounded-md after:absolute after:inset-0 after:rounded-xl"
          >
            {body}
          </Link>
        ) : (
          body
        )}
      </div>
      {hasTrend ? (
        // Decorative: the figure and change line above already say what it shows.
        <Sparkline values={trend} tone={sparkTones[tone]} className="mt-auto h-12" />
      ) : null}
    </Card>
  );
}
