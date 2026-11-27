import { cn } from '@nilzora/ui';
import type { CSSProperties, ReactNode } from 'react';
import { TOOLTIP_CLASS } from './chart-parts';
import { bandCenter, heightPercent, labelIndexes } from './scale';
import { AutoText } from '@/components/i18n/translate';

export interface PlotAxis {
  ticks: readonly number[];
  max: number;
  format: (value: number) => string;
}

export interface PlotFrameProps {
  /** One short label per band, e.g. "25 Oct". */
  labels: readonly string[];
  left: PlotAxis;
  /** A second axis on the right, whose ticks sit on the left axis's gridlines. */
  right?: PlotAxis;
  /** Height of the plot, as a Tailwind class. */
  heightClass: string;
  /** Colours the marks drawn with currentColor (the plot layer and the bands). */
  toneClass?: string;
  /** SVG layers across the whole plot: areas and lines. */
  plot?: ReactNode;
  /** Marks inside each band (bars, hover dots), which react to that band's hover. */
  band?: (index: number) => ReactNode;
  /** The tooltip content of a band. */
  tooltip: (index: number) => ReactNode;
  /** A hairline that follows the hovered band (lines and areas; bars are their own target). */
  crosshair?: boolean;
}

/** The first and last x labels align to the plot's edges so they never overflow it. */
function xLabelPosition(index: number, count: number): { left: string; className: string } {
  if (count > 1 && index === 0) return { left: '0%', className: 'translate-x-0' };
  if (count > 1 && index === count - 1) return { left: '100%', className: '-translate-x-full' };
  return { left: `${String(bandCenter(index, count))}%`, className: '-translate-x-1/2' };
}

function YAxis({
  axis,
  side,
  heightClass,
}: {
  axis: PlotAxis;
  side: 'left' | 'right';
  heightClass: string;
}) {
  return (
    <div className={cn('relative shrink-0', side === 'left' ? 'w-12' : 'w-9', heightClass)}>
      {axis.ticks.map((tick) => (
        <span
          key={tick}
          className={cn(
            'nz-figure absolute translate-y-1/2 text-[11px] leading-none whitespace-nowrap text-chart-axis',
            side === 'left' ? 'right-0' : 'left-0',
          )}
          style={{ bottom: `${String(heightPercent(tick, axis.max))}%` }}
        >
          {axis.format(tick)}
        </span>
      ))}
    </div>
  );
}

/**
 * The frame every cartesian chart shares: y-axis ticks on solid hairline gridlines, x-axis
 * labels, and one hover band per point carrying its marks and a glass tooltip. The
 * drawing is hidden from assistive technology; each chart pairs it with a FiguresTable.
 * Tooltips are CSS-only (no JavaScript), so the frame renders on the server.
 */
export function PlotFrame({
  labels,
  left,
  right,
  heightClass,
  toneClass,
  plot,
  band,
  tooltip,
  crosshair = true,
}: PlotFrameProps) {
  const count = labels.length;
  // Up to six x labels where the chart is wide, three (first, middle, last) where it is
  // narrow: decided by the chart's own width (a container query), not the viewport's, so
  // a half-width card on a desktop never crowds its axis either.
  const wide = new Set(labelIndexes(count, 6));
  const narrow = new Set(labelIndexes(count, 3));
  const shown = new Map(
    [...new Set([...wide, ...narrow])].map((index) => [
      index,
      wide.has(index) && narrow.has(index) ? '' : wide.has(index) ? '@max-md:hidden' : '@md:hidden',
    ]),
  );

  return (
    <div aria-hidden="true" className="@container flex gap-2">
      <YAxis axis={left} side="left" heightClass={heightClass} />

      <div className="min-w-0 flex-1">
        <div className={cn('group/plot relative', heightClass)}>
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
          >
            {left.ticks.map((tick) => {
              const y = 100 - heightPercent(tick, left.max);
              return (
                <line
                  key={tick}
                  x1={0}
                  x2={100}
                  y1={y}
                  y2={y}
                  vectorEffect="non-scaling-stroke"
                  className={tick === 0 ? 'stroke-border-strong' : 'stroke-chart-grid'}
                  strokeWidth={1}
                />
              );
            })}
          </svg>

          {plot ? (
            <div className={cn('absolute inset-0', toneClass)}>
              <AutoText value={plot} />
            </div>
          ) : null}

          {/* Hover targets span the whole height of each band, wider than the mark. */}
          <div className={cn('absolute inset-0 flex', toneClass)}>
            {labels.map((label, index) => {
              // Tooltips open beside the band (never over its own mark), towards the middle.
              const share = (index + 0.5) / count;
              const opensRight = share < 0.6;
              return (
                <div
                  key={`${label}-${String(index)}`}
                  className="group/band relative h-full min-w-0 flex-1"
                >
                  {crosshair ? (
                    <span className="absolute inset-y-0 left-1/2 w-px bg-chart-axis/40 opacity-0 transition-opacity group-hover/band:opacity-100" />
                  ) : null}
                  {band?.(index)}
                  <span
                    className={cn(
                      TOOLTIP_CLASS,
                      'top-1 group-hover/band:grid group-hover/band:gap-1',
                      opensRight ? 'left-1/2 ml-4' : 'right-1/2 mr-4',
                    )}
                  >
                    {tooltip(index)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* X axis: a few evenly spaced labels; the first and last align to the edges. */}
        <div className="relative mt-2 h-4">
          {labels.map((label, index) => {
            if (!shown.has(index)) return null;
            const position = xLabelPosition(index, count);
            return (
              <span
                key={`${label}-${String(index)}`}
                className={cn(
                  'absolute top-0 text-[11px] whitespace-nowrap text-chart-axis',
                  position.className,
                  shown.get(index),
                )}
                style={{ left: position.left }}
              >
                {label}
              </span>
            );
          })}
        </div>
      </div>

      {right ? <YAxis axis={right} side="right" heightClass={heightClass} /> : null}
    </div>
  );
}

/** A round point on a band (HTML, so it stays circular however the plot stretches). */
export function BandPoint({
  bottom,
  className,
  style,
}: {
  /** Height from the baseline, as a percentage. */
  bottom: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cn(
        'absolute left-1/2 size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-current ring-2 ring-surface',
        className,
      )}
      style={{ bottom: `${String(bottom)}%`, ...style }}
    />
  );
}
