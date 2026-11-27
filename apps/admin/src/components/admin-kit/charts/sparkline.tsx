import { cn } from '@nilzora/ui';
import { AreaGradient, RevealClip, useChartId } from './chart-parts';
import { areaPath, linePath } from './scale';
import { CHART_TONES, type ChartTone } from './tones';

export interface SparklineProps {
  values: readonly number[];
  tone?: ChartTone;
  /**
   * Describes the trend for screen readers, e.g. "Daily sales, last 30 days". Without
   * it the sparkline is decorative, for use beside a figure that already says it.
   */
  label?: string;
  /** A soft gradient under the line (default on). */
  area?: boolean;
  className?: string;
}

/** A small trend line without axes, scaled to its own range; it draws itself in once. */
export function Sparkline({
  values,
  tone = 'primary',
  label,
  area = true,
  className,
}: SparklineProps) {
  const gradientId = useChartId('nz-spark');
  const clipId = useChartId('nz-spark-reveal');
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  // A 2-unit margin keeps the line's stroke inside the box.
  const points = values.map(
    (value, index) =>
      [(index / (values.length - 1)) * 100, 98 - ((value - min) / range) * 96] as const,
  );

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('h-10 w-full overflow-visible', CHART_TONES[tone].text, className)}
    >
      <defs>
        {area ? <AreaGradient id={gradientId} from={0.22} to={0} /> : null}
        <RevealClip id={clipId} />
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {area ? <path d={areaPath(points)} fill={`url(#${gradientId})`} /> : null}
        <path
          d={linePath(points)}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </svg>
  );
}
