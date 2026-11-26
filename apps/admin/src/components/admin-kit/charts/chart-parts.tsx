import { cn } from '@nilzora/ui';
import { useId, type CSSProperties, type ReactNode } from 'react';
import { CHART_TONES, type ChartTone } from './tones';
import { AutoText } from '@/components/i18n/translate';

/*
 * Pieces every chart in the kit shares: unique SVG ids, the legend, the tooltip card and
 * the "Show the figures" table that is each drawing's text alternative. All of them
 * render on the server (useId is available to server components).
 */

/** A document-unique id for an SVG gradient, clip or mask (safe inside `url(#…)`). */
export function useChartId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^\w-]/g, '')}`;
}

/** Inline style that sets the draw-in length used by `.nz-draw`. */
export function drawLength(length: number): CSSProperties {
  return { '--nz-draw-length': length } as CSSProperties;
}

/** A vertical wash of the series colour, strongest under the line, fading to the axis. */
export function AreaGradient({ id, from = 0.26, to = 0.02 }: { id: string; from?: number; to?: number }) {
  return (
    <linearGradient id={id} x1={0} y1={0} x2={0} y2={1}>
      <stop offset="0%" stopColor="currentColor" stopOpacity={from} />
      <stop offset="100%" stopColor="currentColor" stopOpacity={to} />
    </linearGradient>
  );
}

/**
 * A clip that wipes the marks in from the left once (`.nz-grow-x`): lines and areas draw
 * themselves in without relying on stroke dashes, which a non-scaling stroke distorts.
 * Under reduced motion the rect simply stands at full width.
 */
export function RevealClip({ id }: { id: string }) {
  return (
    <clipPath id={id}>
      <rect className="nz-grow-x" x={-2} y={-10} width={104} height={120} />
    </clipPath>
  );
}

/** The floating card of a hover tooltip (glass, above the marks, mouse only). */
export const TOOLTIP_CLASS =
  'nz-glass pointer-events-none absolute z-20 hidden min-w-32 rounded-lg border px-3 py-2 text-xs whitespace-nowrap';

export type LegendMark = 'square' | 'line' | 'dashed' | 'point';

/** A series key mirroring its mark: a square for areas and bars, a stroke for lines. */
export function LegendKey({ tone, mark = 'square' }: { tone: ChartTone; mark?: LegendMark }) {
  const colours = CHART_TONES[tone];
  if (mark === 'square') {
    return <span aria-hidden="true" className={cn('size-2.5 shrink-0 rounded-[3px]', colours.swatch)} />;
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 16 8" className={cn('h-2 w-4 shrink-0 overflow-visible', colours.text)}>
      <line
        x1={1}
        x2={15}
        y1={4}
        y2={4}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={mark === 'dashed' ? '3 3' : undefined}
      />
      {mark === 'point' ? <circle cx={8} cy={4} r={2.75} fill="currentColor" /> : null}
    </svg>
  );
}

export interface LegendItem {
  key: string;
  label: string;
  tone: ChartTone;
  mark?: LegendMark;
  /** A figure beside the label, e.g. the series total. */
  value?: string;
  /** A muted note after it, e.g. "left axis". */
  note?: string;
}

/** The series named in text, each beside its key, so identity never rests on colour. */
export function ChartLegend({ items, className }: { items: readonly LegendItem[]; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs', className)}>
      {items.map((item) => (
        <li key={item.key} className="flex min-w-0 items-center gap-1.5">
          <LegendKey tone={item.tone} mark={item.mark} />
          <span className="text-body"><AutoText value={item.label} /></span>
          {item.value ? (
            <span className="nz-figure font-semibold text-foreground"><AutoText value={item.value} /></span>
          ) : null}
          {item.note ? <span className="text-muted-foreground"><AutoText value={item.note} /></span> : null}
        </li>
      ))}
    </ul>
  );
}

/** One line of a tooltip: the value leads, the series name follows. */
export function TooltipRow({
  tone,
  mark = 'line',
  label,
  value,
}: {
  tone?: ChartTone;
  mark?: LegendMark;
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <span className="flex items-center gap-2">
      {tone ? <LegendKey tone={tone} mark={mark} /> : null}
      <span className="nz-figure font-semibold text-foreground"><AutoText value={value} /></span>
      <span className="text-muted-foreground"><AutoText value={label} /></span>
    </span>
  );
}

export interface FiguresTableProps {
  /** The table's caption (screen readers), usually the chart title. */
  caption: string;
  /** Column headings; the first labels the row headers, the rest are figures. */
  columns: readonly string[];
  rows: readonly { key: string; header: ReactNode; cells: readonly ReactNode[] }[];
  className?: string;
}

/**
 * The figures behind a drawing, for keyboard and screen-reader users (hover tooltips are
 * mouse-only): a native disclosure, so it works without JavaScript.
 */
export function FiguresTable({ caption, columns, rows, className }: FiguresTableProps) {
  const [first = '', ...rest] = columns;
  return (
    <details className={cn('group', className)}>
      <summary className="w-fit cursor-pointer rounded-sm text-xs font-medium text-link underline-offset-4 hover:underline">
        <span className="group-open:hidden"><AutoText>Show the figures</AutoText></span>
        <span className="hidden group-open:inline"><AutoText>Hide the figures</AutoText></span>
      </summary>
      <div className="nz-scroll mt-2 max-h-64 overflow-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <caption className="sr-only"><AutoText value={caption} /></caption>
          <thead className="sticky top-0 bg-surface-muted">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold text-foreground">
                {first}
              </th>
              {rest.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="px-3 py-2 text-right font-semibold whitespace-nowrap text-foreground"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-border">
                <th scope="row" className="px-3 py-1.5 text-left font-normal text-body">
                  {row.header}
                </th>
                {row.cells.map((cell, index) => (
                  <td
                    // Cells are positional: the column order never changes within a table.
                    key={index}
                    className="px-3 py-1.5 text-right whitespace-nowrap text-foreground tabular-nums"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** The screen-reader caption of a figure: its title and, when given, a one-line summary. */
export function SrCaption({ title, summary }: { title: string; summary?: string }) {
  return (
    <figcaption className="sr-only">
      {title}
      {summary ? `. ${summary}` : ''}
    </figcaption>
  );
}
