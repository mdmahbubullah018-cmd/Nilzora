import { cn } from '@nilzora/ui';
import type { Route } from 'next';
import { formatCount, formatPercent } from '@/lib/format';
import { DonutFigure, type DonutFigureSegment } from './donut-figure';
import type { ChartTone } from './tones';

export interface DonutSegment {
  /** Stable identity (e.g. the status), so colours never follow rank. */
  key: string;
  label: string;
  value: number;
  tone: ChartTone;
  /** Makes the legend entry a link, e.g. to the matching filtered list. */
  href?: Route;
}

export interface DonutChartProps {
  segments: readonly DonutSegment[];
  /** Names the chart for assistive technology, e.g. "Orders by status". */
  title: string;
  /** The figure in the hole, e.g. the total; defaults to the formatted total. */
  centerValue?: string;
  /** What the figure counts, e.g. "orders". */
  centerLabel: string;
  formatValue?: (value: number) => string;
  className?: string;
}

/** The space left between neighbouring segments, as a percentage of the ring. */
const GAP = 0.8;

/**
 * Parts of a whole. The legend is the text alternative: every segment's label, value
 * and share are written out (the ring is hidden from assistive technology). Segments
 * keep a small gap so neighbouring colours never touch, draw themselves in once, and
 * highlight on hover or focus (see DonutFigure). Values are formatted here, on the
 * server, so the formatter never has to cross into the client component.
 */
export function DonutChart({
  segments,
  title,
  centerValue,
  centerLabel,
  formatValue = formatCount,
  className,
}: DonutChartProps) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  const drawnCount = segments.filter((segment) => segment.value > 0).length;
  const gap = drawnCount > 1 ? GAP : 0;

  // Each segment's share of the ring, and where it starts (the sum of those before it).
  const shares = segments.map((segment) => (total > 0 ? Math.max(0, segment.value) / total : 0));
  const prepared: DonutFigureSegment[] = segments.map((segment, index) => {
    const share = shares[index] ?? 0;
    const length = share * 100;
    return {
      key: segment.key,
      label: segment.label,
      tone: segment.tone,
      ...(segment.href ? { href: segment.href } : {}),
      valueText: formatValue(segment.value),
      shareText: formatPercent(share),
      length: segment.value > 0 ? Math.max(0, length - gap) : 0,
      offset: shares.slice(0, index).reduce((sum, before) => sum + before * 100, 0),
    };
  });

  return (
    <div className={cn('@container', className)}>
      <DonutFigure
        title={title}
        segments={prepared}
        centerValue={centerValue ?? formatValue(total)}
        centerLabel={centerLabel}
      />
    </div>
  );
}
