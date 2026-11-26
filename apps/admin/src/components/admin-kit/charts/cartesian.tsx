import { cn } from '@nilzora/ui';
import { AreaGradient, FiguresTable, RevealClip, SrCaption, useChartId } from './chart-parts';
import { BandPoint, PlotFrame } from './plot-frame';
import {
  areaPath,
  bandCenter,
  heightPercent,
  linePath,
  niceScale,
  smoothAreaPath,
  smoothLinePath,
} from './scale';
import { CHART_TONES, type ChartTone } from './tones';
import { AutoText } from '@/components/i18n/translate';

/** One point of a time series or one category of a bar chart. */
export interface ChartPoint {
  /** Short axis label, e.g. "25 Oct". */
  label: string;
  value: number;
  /** Longer label for the tooltip and the data table, e.g. "Sun, 25 Oct 2026". */
  detail?: string;
}

export interface CartesianChartProps {
  data: readonly ChartPoint[];
  /** Names the chart for assistive technology, e.g. "Daily sales, last 30 days". */
  title: string;
  /** Column headings of the screen-reader data table, e.g. ["Day", "Sales"]. */
  columns: readonly [string, string];
  /** Formats values in tooltips and the data table. */
  formatValue: (value: number) => string;
  /** Formats the y-axis ticks; defaults to formatValue. */
  formatAxis?: (value: number) => string;
  tone?: ChartTone;
  /** A sentence that sums the chart up for screen readers (shown to no one else). */
  summary?: string;
  /** Height of the plot, as a Tailwind class. */
  heightClass?: string;
  /** Whole-number axis steps, for counts. */
  integerAxis?: boolean;
  /** Area charts only: a smooth monotone curve (default) or straight segments. */
  curve?: 'smooth' | 'linear';
  className?: string;
}

function PointTooltip({ point, formatValue }: { point: ChartPoint; formatValue: (value: number) => string }) {
  return (
    <>
      <span className="text-muted-foreground">{point.detail ?? point.label}</span>
      <span className="nz-figure text-sm font-semibold text-foreground"><AutoText value={formatValue(point.value)} /></span>
    </>
  );
}

function figureRows(data: readonly ChartPoint[], formatValue: (value: number) => string) {
  return data.map((point, index) => ({
    key: `${point.label}-${String(index)}`,
    header: point.detail ?? point.label,
    cells: [formatValue(point.value)],
  }));
}

/**
 * A single-series line over a gradient area, for a measure over time (one value per
 * band). Hovering a band shows its point and a tooltip; the latest point is marked. One
 * axis only: a second measure belongs in a ComboChart or a chart of its own.
 */
export function AreaChart({
  data,
  title,
  columns,
  formatValue,
  formatAxis = formatValue,
  tone = 'primary',
  summary,
  heightClass = 'h-56',
  integerAxis,
  curve = 'smooth',
  className,
}: CartesianChartProps) {
  const gradientId = useChartId('nz-area');
  const clipId = useChartId('nz-reveal');
  const scale = niceScale(Math.max(0, ...data.map((point) => point.value)), 4, {
    integer: integerAxis,
  });
  const points = data.map(
    (point, index) => [bandCenter(index, data.length), 100 - heightPercent(point.value, scale.max)] as const,
  );
  const smooth = curve === 'smooth';
  const last = data.length - 1;

  return (
    <figure className={cn('grid gap-2', className)}>
      <SrCaption title={title} summary={summary} />
      <PlotFrame
        labels={data.map((point) => point.label)}
        left={{ ...scale, format: formatAxis }}
        heightClass={heightClass}
        toneClass={CHART_TONES[tone].text}
        plot={
          points.length > 1 ? (
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 size-full overflow-visible"
            >
              <defs>
                <AreaGradient id={gradientId} />
                <RevealClip id={clipId} />
              </defs>
              <g clipPath={`url(#${clipId})`}>
                <path d={smooth ? smoothAreaPath(points) : areaPath(points)} fill={`url(#${gradientId})`} />
                <path
                  d={smooth ? smoothLinePath(points) : linePath(points)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            </svg>
          ) : undefined
        }
        band={(index) => {
          const point = data[index];
          if (!point) return null;
          const latest = index === last;
          return (
            <BandPoint
              bottom={heightPercent(point.value, scale.max)}
              className={
                latest ? 'nz-fade-in' : 'opacity-0 transition-opacity group-hover/band:opacity-100'
              }
              style={latest && last > 0 ? { animationDelay: '650ms' } : undefined}
            />
          );
        }}
        tooltip={(index) => {
          const point = data[index];
          return point ? <PointTooltip point={point} formatValue={formatValue} /> : null;
        }}
      />
      <FiguresTable caption={title} columns={columns} rows={figureRows(data, formatValue)} />
    </figure>
  );
}

/**
 * Vertical bars, one per band, with 4px rounded tops on the baseline; they grow in once.
 * Hovering a band lifts its bar (the others recede) and shows its tooltip.
 */
export function BarChart({
  data,
  title,
  columns,
  formatValue,
  formatAxis = formatValue,
  tone = 'primary',
  summary,
  heightClass = 'h-56',
  integerAxis,
  className,
}: CartesianChartProps) {
  const scale = niceScale(Math.max(0, ...data.map((point) => point.value)), 4, {
    integer: integerAxis,
  });

  return (
    <figure className={cn('grid gap-2', className)}>
      <SrCaption title={title} summary={summary} />
      <PlotFrame
        labels={data.map((point) => point.label)}
        left={{ ...scale, format: formatAxis }}
        heightClass={heightClass}
        toneClass={CHART_TONES[tone].text}
        crosshair={false}
        band={(index) => {
          const point = data[index];
          if (!point) return null;
          return (
            <span className="absolute inset-x-0 bottom-0 flex h-full items-end justify-center px-[max(1px,15%)]">
              <span
                className="nz-grow-y block w-full max-w-6 rounded-t-[4px] bg-current transition-opacity group-hover/plot:opacity-55 group-hover/band:opacity-100!"
                style={{
                  height: `${String(heightPercent(point.value, scale.max))}%`,
                  minHeight: point.value > 0 ? 2 : 0,
                  animationDelay: `${String(Math.min(index, 24) * 14)}ms`,
                }}
              />
            </span>
          );
        }}
        tooltip={(index) => {
          const point = data[index];
          return point ? <PointTooltip point={point} formatValue={formatValue} /> : null;
        }}
      />
      <FiguresTable caption={title} columns={columns} rows={figureRows(data, formatValue)} />
    </figure>
  );
}
