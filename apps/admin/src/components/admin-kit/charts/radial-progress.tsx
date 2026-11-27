import { cn } from '@nilzora/ui';
import { formatPercent } from '@/lib/format';
import { useChartId } from './chart-parts';
import { RING_CENTRE, RING_RADIUS, RING_SIZE, RingReveal } from './ring';
import { CHART_TONES, type ChartTone } from './tones';
import { AutoText } from '@/components/i18n/translate';

export interface RadialProgressProps {
  /** Progress from 0 to 1 (above 1 fills the ring); null when the data cannot give one. */
  value: number | null;
  /** What is measured, e.g. "Fulfilment rate". */
  label: string;
  /** The figure in the centre; defaults to the value as a percentage. */
  valueText?: string;
  /** A short line under the figure inside the ring, e.g. "delivered". */
  centerLabel?: string;
  /** What the value is measured against, e.g. "of ৳5,00,000 target". */
  targetLabel?: string;
  /** Why there is no value, shown with "No data", e.g. "No delivered orders yet". */
  emptyReason?: string;
  tone?: ChartTone;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = {
  sm: { ring: 'size-24', value: 'text-lg', stroke: 4.5 },
  md: { ring: 'size-32', value: 'text-2xl', stroke: 4 },
  lg: { ring: 'size-40', value: 'text-3xl', stroke: 3.5 },
} as const;

/**
 * One ratio as a ring: the share filled clockwise from the top over a track, the figure
 * in the centre, the label and target beneath. With no value it draws an honest empty
 * ring that says "No data" and why, never a made-up zero.
 */
export function RadialProgress({
  value,
  label,
  valueText,
  centerLabel,
  targetLabel,
  emptyReason,
  tone = 'primary',
  size = 'md',
  className,
}: RadialProgressProps) {
  const maskId = useChartId('nz-radial');
  const known = value !== null && Number.isFinite(value);
  const share = known ? Math.min(1, Math.max(0, value)) : 0;
  const text = known ? (valueText ?? formatPercent(value)) : 'No data';
  const dims = SIZES[size];
  const description = known
    ? `${label}: ${text}${targetLabel ? `, ${targetLabel}` : ''}`
    : `${label}: no data${emptyReason ? `. ${emptyReason}` : ''}`;

  return (
    <figure className={cn('flex flex-col items-center gap-3 text-center', className)}>
      <div className={cn('relative', dims.ring)}>
        <svg
          viewBox={`0 0 ${String(RING_SIZE)} ${String(RING_SIZE)}`}
          role="img"
          aria-label={description}
          className={cn('size-full -rotate-90', CHART_TONES[tone].text)}
        >
          <defs>
            <RingReveal id={maskId} />
          </defs>
          <circle
            cx={RING_CENTRE}
            cy={RING_CENTRE}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={dims.stroke}
            className="stroke-chart-track"
            strokeDasharray={known ? undefined : '1.5 2'}
          />
          {share > 0 ? (
            <circle
              cx={RING_CENTRE}
              cy={RING_CENTRE}
              r={RING_RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth={dims.stroke}
              strokeLinecap={share < 1 ? 'round' : 'butt'}
              strokeDasharray={`${(share * 100).toFixed(2)} 100`}
              mask={`url(#${maskId})`}
            />
          ) : null}
        </svg>
        <div aria-hidden="true" className="absolute inset-0 grid place-content-center gap-0.5 px-3">
          <span
            className={cn(
              'nz-figure font-display leading-none font-semibold',
              known ? cn(dims.value, 'text-foreground') : 'text-sm text-muted-foreground',
            )}
          >
            {text}
          </span>
          {known && centerLabel ? (
            <span className="text-[11px] leading-tight text-muted-foreground">
              <AutoText value={centerLabel} />
            </span>
          ) : null}
        </div>
      </div>
      <figcaption className="grid gap-0.5">
        <span className="text-sm font-medium text-foreground">
          <AutoText value={label} />
        </span>
        {known && targetLabel ? (
          <span className="text-xs text-muted-foreground">
            <AutoText value={targetLabel} />
          </span>
        ) : null}
        {!known && emptyReason ? (
          <span className="text-xs text-muted-foreground">
            <AutoText value={emptyReason} />
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
