'use client';

import { cn } from '@nilzora/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';
import { useChartId } from './chart-parts';
import { RING_CENTRE, RING_RADIUS, RING_SIZE, RingReveal } from './ring';
import { CHART_TONES, type ChartTone } from './tones';
import { AutoText } from '@/components/i18n/translate';

/** A segment as the server prepared it: formatted text and ring geometry. */
export interface DonutFigureSegment {
  key: string;
  label: string;
  tone: ChartTone;
  href?: Route;
  /** "3", "৳1,250". */
  valueText: string;
  /** "75%". */
  shareText: string;
  /** Length and start along the ring, as percentages of the circumference (0 when not drawn). */
  length: number;
  offset: number;
}

export interface DonutFigureProps {
  title: string;
  segments: readonly DonutFigureSegment[];
  centerValue: string;
  centerLabel: string;
}

const STROKE = 5;

/**
 * The donut's interactive half. The server renders it complete (ring, centre figure and
 * legend); once hydrated, hovering a segment or a legend row, or focusing a legend link,
 * highlights that segment and shows its value and share in the centre. The legend stays
 * the text alternative (the ring is hidden from assistive technology).
 */
export function DonutFigure({ title, segments, centerValue, centerLabel }: DonutFigureProps) {
  const maskId = useChartId('nz-donut');
  const [active, setActive] = useState<string | null>(null);
  const focus = segments.find((segment) => segment.key === active && segment.length > 0);
  const drawn = segments.filter((segment) => segment.length > 0);

  const hover = (key: string) => ({
    onPointerEnter: () => setActive(key),
    onPointerLeave: () => setActive((current) => (current === key ? null : current)),
  });

  return (
    // Side by side only when the panel is wide enough; stacked in narrow columns.
    <figure className="grid gap-5 @sm:grid-cols-[10rem_minmax(0,1fr)] @sm:items-center">
      <figcaption className="sr-only"><AutoText value={title} /></figcaption>
      <div className="relative mx-auto size-40" aria-hidden="true">
        <svg viewBox={`0 0 ${String(RING_SIZE)} ${String(RING_SIZE)}`} className="size-full -rotate-90">
          <defs>
            <RingReveal id={maskId} />
          </defs>
          <circle
            cx={RING_CENTRE}
            cy={RING_CENTRE}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={STROKE}
            className="stroke-chart-track"
          />
          <g mask={`url(#${maskId})`}>
            {drawn.map((segment) => (
              <circle
                key={segment.key}
                cx={RING_CENTRE}
                cy={RING_CENTRE}
                r={RING_RADIUS}
                fill="none"
                stroke="currentColor"
                strokeWidth={focus?.key === segment.key ? STROKE + 1.5 : STROKE}
                strokeDasharray={`${segment.length.toFixed(2)} ${(100 - segment.length).toFixed(2)}`}
                strokeDashoffset={-segment.offset}
                className={cn(
                  'cursor-default transition-[opacity,stroke-width] duration-200',
                  CHART_TONES[segment.tone].text,
                  focus && focus.key !== segment.key && 'opacity-30',
                )}
                {...hover(segment.key)}
              />
            ))}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-content-center px-6 text-center">
          <span className="nz-figure font-display text-2xl leading-tight font-semibold text-foreground">
            {focus ? focus.valueText : centerValue}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {focus ? `${focus.label} · ${focus.shareText}` : centerLabel}
          </span>
        </div>
      </div>

      <ul className="grid gap-1">
        {segments.map((segment) => {
          const content = (
            <>
              <span
                aria-hidden="true"
                className={cn('size-2.5 shrink-0 rounded-full', CHART_TONES[segment.tone].swatch)}
              />
              <span className="min-w-0 flex-1 truncate text-body"><AutoText value={segment.label} /></span>
              <span className="nz-figure font-semibold text-foreground"><AutoText value={segment.valueText} /></span>
              <span className="nz-figure w-12 text-right text-xs text-muted-foreground">
                {segment.shareText}
              </span>
            </>
          );
          const row = cn(
            'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
            focus?.key === segment.key && 'bg-surface-muted',
          );
          return (
            <li key={segment.key} {...hover(segment.key)}>
              {segment.href ? (
                <Link
                  href={segment.href}
                  className={cn(row, 'hover:bg-surface-muted')}
                  onFocus={() => setActive(segment.key)}
                  onBlur={() => setActive((current) => (current === segment.key ? null : current))}
                >
                  {content}
                </Link>
              ) : (
                <div className={row}><AutoText value={content} /></div>
              )}
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
