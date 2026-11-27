import { cn } from '@nilzora/ui';
import { formatCount } from '@/lib/format';
import { FiguresTable, SrCaption } from './chart-parts';
import { heatLevel } from './scale';
import { CHART_TONES, type ChartTone } from './tones';
import { AutoText } from '@/components/i18n/translate';

export interface HeatmapCell {
  /** 1 = Monday … 7 = Sunday (ISO weekday). */
  weekday: number;
  /** 0–23, on the store's clock. */
  hour: number;
  value: number;
}

export interface HeatmapProps {
  /** Cells with a value; missing cells count as zero. */
  cells: readonly HeatmapCell[];
  /** Names the chart for assistive technology, e.g. "Orders by weekday and hour". */
  title: string;
  summary?: string;
  tone?: ChartTone;
  /** Formats a cell's value, e.g. (n) => plural(n, 'order'). */
  formatValue?: (value: number) => string;
  /** Heading of the table's value column. Default "Count". */
  valueLabel?: string;
  /** Seven row labels, Monday first. */
  rowLabels?: readonly string[];
  /** Shown over the empty grid when no cell has a value. */
  emptyMessage?: string;
  className?: string;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const ROWS = Array.from({ length: 7 }, (_, row) => row);
const LEVELS = 5;
/** Fill opacity of each intensity step (step 0 is the empty track). */
const LEVEL_OPACITY = [0, 0.22, 0.4, 0.6, 0.8, 1] as const;

// Geometry of the grid in viewBox units: 10-unit cells on a 12-unit pitch.
const CELL = 10;
const PITCH = 12;
const WIDTH = 24 * PITCH - (PITCH - CELL);
const HEIGHT = 7 * PITCH - (PITCH - CELL);

const twoDigits = (hour: number) => String(hour).padStart(2, '0');

/** "20:00–21:00". */
function hourRange(hour: number): string {
  return `${twoDigits(hour)}:00–${twoDigits((hour + 1) % 24)}:00`;
}

/**
 * When the orders come in: seven weekday rows by 24 hours, each cell's fill stepping up
 * with its count in one hue (five steps plus empty, shown in the legend). The grid
 * scales with its card (viewBox, full width) while labels keep a readable size. Each
 * cell names its slot and value on hover; the busiest slot is written out; the table
 * lists every slot with a value.
 */
export function Heatmap({
  cells,
  title,
  summary,
  tone = 'primary',
  formatValue = formatCount,
  valueLabel = 'Count',
  rowLabels = WEEKDAYS,
  emptyMessage = 'Nothing recorded in this period',
  className,
}: HeatmapProps) {
  const grid = new Map<string, number>();
  for (const cell of cells) {
    if (cell.weekday < 1 || cell.weekday > 7 || cell.hour < 0 || cell.hour > 23) continue;
    if (!Number.isFinite(cell.value) || cell.value <= 0) continue;
    const key = `${String(cell.weekday)}-${String(cell.hour)}`;
    grid.set(key, (grid.get(key) ?? 0) + cell.value);
  }
  const valueAt = (row: number, hour: number) =>
    grid.get(`${String(row + 1)}-${String(hour)}`) ?? 0;
  const filled = ROWS.flatMap((row) =>
    HOURS.flatMap((hour) => {
      const value = valueAt(row, hour);
      return value > 0 ? [{ row, hour, value }] : [];
    }),
  );
  const max = Math.max(0, ...filled.map((cell) => cell.value));
  const peak = filled.reduce<(typeof filled)[number] | undefined>(
    (best, cell) => (!best || cell.value > best.value ? cell : best),
    undefined,
  );
  const labelOf = (row: number) => rowLabels[row] ?? WEEKDAYS[row] ?? '';

  return (
    <figure className={cn('grid gap-3', className)}>
      <SrCaption title={title} summary={summary} />

      <div
        aria-hidden="true"
        className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1.5"
      >
        <div className="grid grid-rows-7 text-[11px] leading-none text-chart-axis">
          {ROWS.map((row) => (
            <span key={row} className="flex items-center justify-end">
              {labelOf(row)}
            </span>
          ))}
        </div>
        {/*
          Square cells while the card is wide; in a narrow card the rows keep a minimum
          height (cells grow taller, never smaller than their labels).
        */}
        <svg
          viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
          preserveAspectRatio="none"
          className={cn('block h-auto min-h-28 w-full', CHART_TONES[tone].text)}
        >
          {ROWS.map((row) =>
            HOURS.map((hour) => {
              const value = valueAt(row, hour);
              const level = heatLevel(value, max, LEVELS);
              return (
                <rect
                  key={`${String(row)}-${String(hour)}`}
                  x={hour * PITCH}
                  y={row * PITCH}
                  width={CELL}
                  height={CELL}
                  rx={2.5}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  className={cn(
                    'transition-[stroke] hover:stroke-foreground',
                    level === 0 ? 'fill-chart-track' : 'fill-current',
                  )}
                  fillOpacity={level === 0 ? undefined : LEVEL_OPACITY[level]}
                >
                  <title>{`${labelOf(row)} ${hourRange(hour)}: ${formatValue(value)}`}</title>
                </rect>
              );
            }),
          )}
        </svg>

        <span />
        {/* Hours every three, centred on their column. */}
        <div className="relative h-3 text-[10px] leading-none text-chart-axis">
          {HOURS.filter((hour) => hour % 3 === 0).map((hour) => (
            <span
              key={hour}
              className="nz-figure absolute top-0 -translate-x-1/2"
              style={{ left: `${String(((hour * PITCH + CELL / 2) / WIDTH) * 100)}%` }}
            >
              {twoDigits(hour)}
            </span>
          ))}
        </div>

        {filled.length === 0 ? (
          <p className="col-span-2 col-start-1 row-start-1 grid place-items-center">
            <span className="nz-glass rounded-md border px-3 py-1.5 text-xs font-medium text-body">
              {emptyMessage}
            </span>
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
        <span aria-hidden="true" className={cn('flex items-center gap-1', CHART_TONES[tone].text)}>
          <span className="mr-1 text-muted-foreground">
            <AutoText>Less</AutoText>
          </span>
          {LEVEL_OPACITY.map((opacity, level) => (
            <span
              key={level}
              className={cn(
                'size-2.5 rounded-[3px]',
                level === 0 ? 'bg-chart-track' : 'bg-current',
              )}
              style={level === 0 ? undefined : { opacity }}
            />
          ))}
          <span className="ml-1 text-muted-foreground">
            <AutoText>More</AutoText>
          </span>
        </span>
        {peak ? (
          <span className="text-muted-foreground">
            Busiest:{' '}
            <span className="font-medium text-foreground">
              {labelOf(peak.row)} {hourRange(peak.hour)}
            </span>{' '}
            <span className="nz-figure">({formatValue(peak.value)})</span>
          </span>
        ) : null}
      </div>

      {filled.length > 0 ? (
        <FiguresTable
          caption={`${title} (slots with no value are left out)`}
          columns={['Day', 'Hour', valueLabel]}
          rows={filled.map((cell) => ({
            key: `${String(cell.row)}-${String(cell.hour)}`,
            header: labelOf(cell.row),
            cells: [hourRange(cell.hour), formatValue(cell.value)],
          }))}
        />
      ) : null}
    </figure>
  );
}
