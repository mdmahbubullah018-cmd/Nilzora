import { cn } from '@nilzora/ui';
import { ArrowDown } from 'lucide-react';
import { formatCount, formatPercent } from '@/lib/format';
import { funnelSteps, shareOf } from './scale';
import { CHART_TONES, type ChartTone } from './tones';
import { AutoText } from '@/components/i18n/translate';

export interface FunnelStage {
  key: string;
  /** e.g. "Carts created". */
  label: string;
  value: number;
  /** A short note under the label, e.g. "Started by signed-in shoppers". */
  hint?: string;
}

export interface FunnelProps {
  /** The stages in journey order; bars are scaled to the widest (normally the first). */
  stages: readonly FunnelStage[];
  /** Names the funnel for assistive technology, e.g. "Shopping journey, last 30 days". */
  title: string;
  formatValue?: (value: number) => string;
  tone?: ChartTone;
  /** Shown when every stage is zero. */
  emptyMessage?: string;
  /** Adds how many were lost between stages, next to the share that went on. */
  showDropOff?: boolean;
  /**
   * Turns the step-to-step shares and the overall line off. Used when the stages were recorded
   * over different spans, where a share of the previous stage would be meaningless.
   */
  showConversion?: boolean;
  className?: string;
}

/**
 * A journey in stages (e.g. carts → checkouts → orders): each stage's count with a bar
 * proportional to the first stage, and between stages the share that went on. Every
 * figure is text, so the list is its own text alternative. A stage after an empty one
 * has no conversion (a share of nothing is undefined), shown as "—".
 */
export function Funnel({
  stages,
  title,
  formatValue = formatCount,
  tone = 'primary',
  emptyMessage = 'Nothing recorded in this period',
  showDropOff = false,
  showConversion = true,
  className,
}: FunnelProps) {
  const steps = funnelSteps(stages.map((stage) => stage.value));
  const empty = stages.every((stage) => !(stage.value > 0));
  const first = stages[0];
  const last = stages.at(-1);
  const overall =
    showConversion && first && last && stages.length > 2 ? shareOf(last.value, first.value) : null;

  return (
    <figure className={cn('grid gap-3', className)}>
      <figcaption className="sr-only">
        <AutoText value={title} />
      </figcaption>
      <ol className="grid">
        {stages.map((stage, index) => {
          const step = steps[index];
          const previous = stages[index - 1];
          return (
            <li key={stage.key} className="grid gap-1.5">
              {previous && showConversion ? (
                <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 py-1.5 pl-1 text-xs text-muted-foreground">
                  <ArrowDown aria-hidden="true" className="size-3.5 text-chart-axis" />
                  <span className="nz-figure font-semibold text-foreground">
                    {step?.conversion == null ? (
                      <>
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">
                          <AutoText>No conversion</AutoText>
                        </span>
                      </>
                    ) : (
                      formatPercent(step.conversion)
                    )}
                  </span>
                  <span>
                    of {previous.label.toLowerCase()} went on
                    <span className="sr-only"> to {stage.label.toLowerCase()}</span>
                  </span>
                  {showDropOff && step?.conversion != null ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-1.5 py-0.5 font-medium text-warning">
                      <span className="nz-figure">
                        {formatValue(Math.max(0, previous.value - stage.value))}
                      </span>
                      <AutoText>lost</AutoText>
                    </span>
                  ) : null}
                </p>
              ) : null}
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">
                    <AutoText value={stage.label} />
                  </span>
                  {stage.hint ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      <AutoText value={stage.hint} />
                    </span>
                  ) : null}
                </span>
                <span className="nz-figure shrink-0 font-semibold text-foreground">
                  {formatValue(stage.value)}
                </span>
              </div>
              <span
                aria-hidden="true"
                className="block h-2.5 overflow-hidden rounded-full bg-chart-track"
              >
                <span
                  className={cn('nz-grow-x block h-full rounded-full', CHART_TONES[tone].swatch)}
                  style={{
                    width: `${String(step?.width ?? 0)}%`,
                    minWidth: stage.value > 0 ? 4 : 0,
                    animationDelay: `${String(index * 90)}ms`,
                  }}
                />
              </span>
            </li>
          );
        })}
      </ol>
      {empty ? (
        <p className="text-xs text-muted-foreground">
          <AutoText value={emptyMessage} />
        </p>
      ) : overall !== null && first && last ? (
        <p className="border-t border-hairline pt-3 text-xs text-muted-foreground">
          <span className="nz-figure font-semibold text-foreground">
            <AutoText value={formatPercent(overall)} />
          </span>{' '}
          overall, from {first.label.toLowerCase()} to {last.label.toLowerCase()}
        </p>
      ) : null}
    </figure>
  );
}
