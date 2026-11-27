import { cn } from '@nilzora/ui';
import { formatCount } from '@/lib/format';
import { ChartLegend, FiguresTable, SrCaption, TooltipRow } from './chart-parts';
import { PlotFrame } from './plot-frame';
import { heightPercent, niceScale } from './scale';
import { CHART_TONES, type ChartTone } from './tones';
import { AutoText } from '@/components/i18n/translate';

export interface StackedSeries {
  /** Stable identity (e.g. the order status), so colours never follow rank. */
  key: string;
  label: string;
  tone: ChartTone;
}

export interface StackedBarDatum {
  /** Short axis label, e.g. "25 Oct". */
  label: string;
  /** Longer label for the tooltip and the table. */
  detail?: string;
  /** Each series' value by its key; a missing key counts as zero. */
  values: Readonly<Partial<Record<string, number>>>;
}

export interface StackedBarChartProps {
  data: readonly StackedBarDatum[];
  /** Stacked bottom-up in this order; the legend and tables follow it too. */
  series: readonly StackedSeries[];
  /** Names the chart for assistive technology, e.g. "Orders per day by status". */
  title: string;
  summary?: string;
  formatValue?: (value: number) => string;
  formatAxis?: (value: number) => string;
  /** Heading of the table's first column. Default "Day". */
  bandLabel?: string;
  /** Name of the stack total. Default "Total". */
  totalLabel?: string;
  /** Whole-number axis steps (default, for counts). */
  integerAxis?: boolean;
  heightClass?: string;
  className?: string;
}

function valueOf(datum: StackedBarDatum, key: string): number {
  const value = datum.values[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Per-band stacked bars by series (e.g. orders per day by status). Segments are split by
 * a 2px gap, not an outline; the legend names every series with its period total; each
 * band's tooltip lists its stack top-down with the total; the table holds every value.
 */
export function StackedBarChart({
  data,
  series,
  title,
  summary,
  formatValue = formatCount,
  formatAxis = formatValue,
  bandLabel = 'Day',
  totalLabel = 'Total',
  integerAxis = true,
  heightClass = 'h-56',
  className,
}: StackedBarChartProps) {
  const totals = data.map((datum) =>
    series.reduce((sum, item) => sum + valueOf(datum, item.key), 0),
  );
  const scale = niceScale(Math.max(0, ...totals), 4, { integer: integerAxis });
  const seriesTotals = series.map((item) =>
    data.reduce((sum, datum) => sum + valueOf(datum, item.key), 0),
  );

  return (
    <figure className={cn('grid gap-3', className)}>
      <SrCaption title={title} summary={summary} />
      <ChartLegend
        items={series.map((item, index) => ({
          key: item.key,
          label: item.label,
          tone: item.tone,
          value: formatValue(seriesTotals[index] ?? 0),
        }))}
      />
      <PlotFrame
        labels={data.map((datum) => datum.label)}
        left={{ ...scale, format: formatAxis }}
        heightClass={heightClass}
        crosshair={false}
        band={(index) => {
          const datum = data[index];
          const total = totals[index] ?? 0;
          if (!datum || total <= 0) return null;
          const filled = series.filter((item) => valueOf(datum, item.key) > 0);
          const top = filled.at(-1)?.key;
          return (
            <span className="absolute inset-x-0 bottom-0 flex h-full items-end justify-center px-[max(1px,15%)]">
              <span
                className="nz-grow-y flex w-full max-w-6 flex-col-reverse transition-opacity group-hover/plot:opacity-55 group-hover/band:opacity-100!"
                style={{
                  height: `${String(heightPercent(total, scale.max))}%`,
                  minHeight: 2,
                  animationDelay: `${String(Math.min(index, 24) * 14)}ms`,
                }}
              >
                {filled.map((item) => (
                  <span
                    key={item.key}
                    className={cn(
                      'block w-full shrink-0',
                      CHART_TONES[item.tone].swatch,
                      // The 2px surface gap: padding the background does not paint.
                      item.key === top ? 'rounded-t-[4px]' : 'bg-clip-content pt-0.5',
                    )}
                    style={{ height: `${String((valueOf(datum, item.key) / total) * 100)}%` }}
                  />
                ))}
              </span>
            </span>
          );
        }}
        tooltip={(index) => {
          const datum = data[index];
          if (!datum) return null;
          const filled = series.filter((item) => valueOf(datum, item.key) > 0).reverse();
          return (
            <>
              <span className="text-muted-foreground">{datum.detail ?? datum.label}</span>
              {filled.map((item) => (
                <TooltipRow
                  key={item.key}
                  tone={item.tone}
                  mark="square"
                  label={item.label}
                  value={formatValue(valueOf(datum, item.key))}
                />
              ))}
              <span
                className={cn(
                  'flex items-center gap-2',
                  filled.length > 0 && 'border-t border-hairline pt-1',
                )}
              >
                <span className="nz-figure font-semibold text-foreground">
                  <AutoText value={formatValue(totals[index] ?? 0)} />
                </span>
                <span className="text-muted-foreground">
                  <AutoText value={totalLabel} />
                </span>
              </span>
            </>
          );
        }}
      />
      <FiguresTable
        caption={title}
        columns={[bandLabel, ...series.map((item) => item.label), totalLabel]}
        rows={data.map((datum, index) => ({
          key: `${datum.label}-${String(index)}`,
          header: datum.detail ?? datum.label,
          cells: [
            ...series.map((item) => formatValue(valueOf(datum, item.key))),
            formatValue(totals[index] ?? 0),
          ],
        }))}
      />
    </figure>
  );
}
