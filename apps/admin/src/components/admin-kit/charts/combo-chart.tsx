import { cn } from '@nilzora/ui';
import {
  AreaGradient,
  ChartLegend,
  FiguresTable,
  RevealClip,
  SrCaption,
  TooltipRow,
  useChartId,
  type LegendItem,
} from './chart-parts';
import { BandPoint, PlotFrame } from './plot-frame';
import {
  alignedScale,
  bandCenter,
  heightPercent,
  niceScale,
  smoothAreaPath,
  smoothLinePath,
} from './scale';
import { CHART_TONES, type ChartTone } from './tones';

/** One day (or other band) of a combo chart. */
export interface ComboPoint {
  /** Short axis label, e.g. "25 Oct". */
  label: string;
  /** Longer label for the tooltip and the table, e.g. "Sun, 25 Oct 2026". */
  detail?: string;
  /** The area series (left axis), e.g. revenue in poisha. */
  area: number;
  /** The line series (right axis), e.g. the order count. */
  line: number;
  /** The same band of the comparison period, when there is one. */
  previousArea?: number | null;
  previousLine?: number | null;
}

export interface ComboSeries {
  /** e.g. "Revenue", "Orders". */
  label: string;
  tone?: ChartTone;
}

export interface ComboChartProps {
  data: readonly ComboPoint[];
  /** Names the chart for assistive technology, e.g. "Revenue and orders, last 30 days". */
  title: string;
  /** A sentence that sums the chart up for screen readers. */
  summary?: string;
  areaSeries: ComboSeries;
  lineSeries: ComboSeries;
  formatArea: (value: number) => string;
  formatLine: (value: number) => string;
  /** Axis tick formats; default to the value formats. */
  formatAreaAxis?: (value: number) => string;
  formatLineAxis?: (value: number) => string;
  /** Names the comparison period, e.g. "Previous 30 days"; its lines are dashed. */
  previousLabel?: string;
  /** Heading of the table's first column. Default "Day". */
  bandLabel?: string;
  /** Whole-number steps on the right axis (default, for counts). */
  integerLine?: boolean;
  heightClass?: string;
  className?: string;
}

/** Point markers sit on every band while they have room; past this they show on hover. */
const MARKER_LIMIT = 31;

const finite = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Two measures of one period: the area (e.g. revenue) on the left axis and a line with
 * point markers (e.g. orders) on the right. The right axis is aligned to the left one's
 * gridlines, the legend names which axis each series uses, and every band's tooltip
 * lists both values with the date; the comparison period, when given, draws as dashed
 * lines. A data table carries all of it for keyboard and screen-reader users.
 */
export function ComboChart({
  data,
  title,
  summary,
  areaSeries,
  lineSeries,
  formatArea,
  formatLine,
  formatAreaAxis = formatArea,
  formatLineAxis = formatLine,
  previousLabel = 'Previous period',
  bandLabel = 'Day',
  integerLine = true,
  heightClass = 'h-64',
  className,
}: ComboChartProps) {
  const gradientId = useChartId('nz-combo-area');
  const clipId = useChartId('nz-combo-reveal');
  const areaTone = areaSeries.tone ?? 'primary';
  const lineTone = lineSeries.tone ?? 'violet';
  const count = data.length;

  const hasPrevious = data.some((point) => finite(point.previousArea) || finite(point.previousLine));
  const left = niceScale(
    Math.max(0, ...data.flatMap((point) => [point.area, point.previousArea ?? 0])),
  );
  const right = alignedScale(
    Math.max(0, ...data.flatMap((point) => [point.line, point.previousLine ?? 0])),
    left.ticks.length - 1,
    { integer: integerLine },
  );

  const x = (index: number) => bandCenter(index, count);
  const areaPoints = data.map((point, index) => [x(index), 100 - heightPercent(point.area, left.max)] as const);
  const linePoints = data.map((point, index) => [x(index), 100 - heightPercent(point.line, right.max)] as const);
  const previousArea = data.flatMap((point, index) =>
    finite(point.previousArea) ? [[x(index), 100 - heightPercent(point.previousArea, left.max)] as const] : [],
  );
  const previousLine = data.flatMap((point, index) =>
    finite(point.previousLine) ? [[x(index), 100 - heightPercent(point.previousLine, right.max)] as const] : [],
  );

  const stroke = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinejoin: 'round',
    strokeLinecap: 'round',
    vectorEffect: 'non-scaling-stroke',
  } as const;

  const legend: LegendItem[] = [
    { key: 'area', label: areaSeries.label, tone: areaTone, mark: 'square', note: 'left axis' },
    { key: 'line', label: lineSeries.label, tone: lineTone, mark: 'point', note: 'right axis' },
    ...(hasPrevious
      ? [{ key: 'previous', label: previousLabel, tone: 'neutral' as const, mark: 'dashed' as const, note: 'dashed' }]
      : []),
  ];

  const columns = [
    bandLabel,
    areaSeries.label,
    lineSeries.label,
    ...(hasPrevious ? [`${areaSeries.label}, ${previousLabel}`, `${lineSeries.label}, ${previousLabel}`] : []),
  ];

  return (
    <figure className={cn('grid gap-3', className)}>
      <SrCaption title={title} summary={summary} />
      <ChartLegend items={legend} />
      <PlotFrame
        labels={data.map((point) => point.label)}
        left={{ ...left, format: formatAreaAxis }}
        right={{ ...right, format: formatLineAxis }}
        heightClass={heightClass}
        plot={
          count > 1 ? (
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 size-full overflow-visible"
            >
              <defs>
                <RevealClip id={clipId} />
              </defs>
              <g clipPath={`url(#${clipId})`}>
                <g className={CHART_TONES[areaTone].text}>
                  <AreaGradient id={gradientId} />
                  <path d={smoothAreaPath(areaPoints)} fill={`url(#${gradientId})`} />
                  <path d={smoothLinePath(areaPoints)} {...stroke} strokeWidth={2} />
                  {previousArea.length > 1 ? (
                    <path d={smoothLinePath(previousArea)} {...stroke} strokeWidth={1.5} strokeDasharray="4 4" opacity={0.55} />
                  ) : null}
                </g>
                <g className={CHART_TONES[lineTone].text}>
                  {previousLine.length > 1 ? (
                    <path d={smoothLinePath(previousLine)} {...stroke} strokeWidth={1.5} strokeDasharray="4 4" opacity={0.55} />
                  ) : null}
                  <path d={smoothLinePath(linePoints)} {...stroke} strokeWidth={2} />
                </g>
              </g>
            </svg>
          ) : undefined
        }
        band={(index) => {
          const point = data[index];
          if (!point) return null;
          const marked = count <= MARKER_LIMIT;
          return (
            <>
              <BandPoint
                bottom={heightPercent(point.area, left.max)}
                className={cn(
                  CHART_TONES[areaTone].text,
                  count > 1 && 'opacity-0 transition-opacity group-hover/band:opacity-100',
                )}
              />
              <BandPoint
                bottom={heightPercent(point.line, right.max)}
                className={cn(
                  CHART_TONES[lineTone].text,
                  'size-2 transition-transform group-hover/band:scale-125',
                  // Visibility, not opacity: the fade-in animation owns opacity once run.
                  marked ? 'nz-fade-in' : 'invisible group-hover/band:visible',
                  // In a narrow chart a long series keeps its markers for hover only.
                  marked && count > 10 && '@max-md:invisible @max-md:group-hover/band:visible',
                )}
                style={marked && count > 1 ? { animationDelay: '650ms' } : undefined}
              />
            </>
          );
        }}
        tooltip={(index) => {
          const point = data[index];
          if (!point) return null;
          return (
            <>
              <span className="text-muted-foreground">{point.detail ?? point.label}</span>
              <TooltipRow tone={areaTone} mark="square" label={areaSeries.label} value={formatArea(point.area)} />
              <TooltipRow tone={lineTone} mark="point" label={lineSeries.label} value={formatLine(point.line)} />
              {finite(point.previousArea) || finite(point.previousLine) ? (
                <span className="border-t border-hairline pt-1 text-muted-foreground">
                  {previousLabel}:{' '}
                  <span className="nz-figure text-body">
                    {[
                      finite(point.previousArea) ? formatArea(point.previousArea) : null,
                      finite(point.previousLine) ? formatLine(point.previousLine) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              ) : null}
            </>
          );
        }}
      />
      <FiguresTable
        caption={title}
        columns={columns}
        rows={data.map((point, index) => ({
          key: `${point.label}-${String(index)}`,
          header: point.detail ?? point.label,
          cells: [
            formatArea(point.area),
            formatLine(point.line),
            ...(hasPrevious
              ? [
                  finite(point.previousArea) ? formatArea(point.previousArea) : '—',
                  finite(point.previousLine) ? formatLine(point.previousLine) : '—',
                ]
              : []),
          ],
        }))}
      />
    </figure>
  );
}
