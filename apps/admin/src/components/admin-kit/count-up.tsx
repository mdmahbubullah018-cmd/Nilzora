'use client';

import { cn } from '@nilzora/ui';
import { useEffect, useState } from 'react';
import { formatCount, formatMoney, formatPercent } from '@/lib/format';
import { AutoText } from '@/components/i18n/translate';

/**
 * How the figure is formatted. A formatter function cannot cross from a server component
 * into this client component, so callers name the kind and the helpers in lib/format
 * do the formatting on both sides.
 */
export type CountUpKind = 'money' | 'count' | 'percent';

const FORMATS: Record<CountUpKind, (value: number) => string> = {
  /** Integer poisha → "৳1,25,000". */
  money: formatMoney,
  count: formatCount,
  /** A ratio → "12.5%". */
  percent: formatPercent,
};

export function formatCountUp(value: number, kind: CountUpKind): string {
  return FORMATS[kind](value);
}

/** Ease-out cubic: quick at first, settling gently on the final value. */
export function easeOut(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return 1 - (1 - t) ** 3;
}

/**
 * The figure shown at `progress` (0–1, eased) of the way to `value`: whole taka for
 * money, whole units for counts and 0.1% steps for percentages, so a frame never shows a
 * precision the final figure lacks. The last frame is the exact value.
 */
export function countUpFrame(value: number, progress: number, kind: CountUpKind): number {
  if (progress >= 1) return value;
  const raw = value * Math.max(0, progress);
  if (kind === 'money') return Math.round(raw / 100) * 100;
  if (kind === 'percent') return Math.round(raw * 1000) / 1000;
  return Math.round(raw);
}

function prefersReducedMotion(): boolean {
  // Without matchMedia (very old browsers, test environments) the figure stays still.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface CountUpProps {
  /** The final figure: integer poisha for money, a ratio (0.125) for percent. */
  value: number;
  kind: CountUpKind;
  /** Length of the count, in milliseconds. */
  durationMs?: number;
  className?: string;
}

/**
 * A headline figure that counts up from zero once, on mount. The server renders the
 * final value (correct without JavaScript, and what assistive technology reads); a
 * hidden copy of it reserves the width so the counting never shifts the layout. The
 * moving digits are aria-hidden and nothing is announced live. Under
 * prefers-reduced-motion the final value simply stays.
 */
export function CountUp({ value, kind, durationMs = 700, className }: CountUpProps) {
  // The frame being shown; null shows the final value.
  const [frame, setFrame] = useState<number | null>(null);
  const final = formatCountUp(value, kind);

  useEffect(() => {
    if (!Number.isFinite(value) || value === 0 || prefersReducedMotion()) return undefined;
    let handle = 0;
    let start: number | undefined;
    const step = (now: number) => {
      start ??= now;
      const progress = durationMs > 0 ? (now - start) / durationMs : 1;
      if (progress >= 1) {
        setFrame(null);
        return;
      }
      setFrame(countUpFrame(value, easeOut(progress), kind));
      handle = requestAnimationFrame(step);
    };
    handle = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(handle);
      setFrame(null);
    };
  }, [value, kind, durationMs]);

  return (
    <span className={cn('inline-grid', className)}>
      <span aria-hidden="true" className="invisible col-start-1 row-start-1">
        {final}
      </span>
      <span aria-hidden="true" className="col-start-1 row-start-1">
        {frame === null ? final : formatCountUp(frame, kind)}
      </span>
      <span className="sr-only"><AutoText value={final} /></span>
    </span>
  );
}
