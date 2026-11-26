import { Card, Skeleton, cn } from '@nilzora/ui';
import { LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';

/*
 * The admin's loader kit: one set of placeholders and spinners for the admin, moderator and staff
 * areas, built on the theme's surface and primary tokens so each reads correctly in light and dark.
 *
 *   skeletons   StatTilesSkeleton, ChartSkeleton, ListSkeleton, FormSkeleton (and, beside them in
 *               ./skeletons, TableSkeleton and DetailSkeleton). Each has the same outer shape as
 *               what replaces it, so nothing jumps when the data arrives.
 *   spinners    InlineSpinner (inside a line of text or a button), SectionLoader (a panel waiting
 *               for data) and PageLoader (a whole page). The shared Button has its own `loading`
 *               state for submit buttons.
 *   overlay     LoadingOverlay dims and blocks a region while a save or delete runs.
 *   progress    RouteProgress (./route-progress) is the thin bar across the top during navigation.
 *
 * Motion: every spinning or pulsing element sits behind `motion-safe:`, so someone who asks for
 * reduced motion sees a still placeholder or a still glyph, never movement. Each loader that
 * stands alone carries one polite status for screen readers; the decorative blocks inside are
 * hidden from them.
 */

/** A row of stat tiles: label, figure and a trend line, the shape of a KPI card. */
export function StatTilesSkeleton({
  count = 4,
  label = 'Loading figures',
}: {
  count?: number;
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      data-loader="stat-tiles"
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, index) => (
        <Card key={index} className="grid gap-3 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="size-9 rounded-xl" />
          </div>
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-3 w-36" />
        </Card>
      ))}
    </div>
  );
}

/** A chart card: a title, then a plot area with bars of varying height. */
export function ChartSkeleton({
  heightClass = 'h-56',
  label = 'Loading chart',
}: {
  heightClass?: string;
  label?: string;
}) {
  const bars = [38, 62, 48, 80, 55, 70, 44, 90, 60, 75, 52, 66];
  return (
    <Card role="status" aria-busy="true" className="grid gap-4 p-4 sm:p-5" data-loader="chart">
      <span className="sr-only">{label}</span>
      <div className="grid gap-1.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56 max-w-full" />
      </div>
      <div className={cn('flex items-end gap-2', heightClass)}>
        {bars.map((height, index) => (
          <Skeleton
            key={index}
            className="flex-1 rounded-t-md rounded-b-none"
            style={{ height: `${String(height)}%` }}
          />
        ))}
      </div>
    </Card>
  );
}

/** A list of rows with an avatar or icon, two lines of text and a trailing badge. */
export function ListSkeleton({
  rows = 6,
  label = 'Loading list',
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <Card role="status" aria-busy="true" className="overflow-hidden" data-loader="list">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 border-t border-hairline px-4 py-3.5 first:border-t-0"
        >
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="grid min-w-0 flex-1 gap-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="hidden h-6 w-16 rounded-full sm:block" />
        </div>
      ))}
    </Card>
  );
}

/** A form card: labelled fields and a button, in the layout of the admin's editors. */
export function FormSkeleton({
  fields = 4,
  label = 'Loading form',
}: {
  fields?: number;
  label?: string;
}) {
  return (
    <Card role="status" aria-busy="true" className="grid gap-5 p-5 sm:p-6" data-loader="form">
      <span className="sr-only">{label}</span>
      {Array.from({ length: fields }, (_, index) => (
        <div key={index} className="grid gap-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
      ))}
      <Skeleton className="h-10 w-32 rounded-xl" />
    </Card>
  );
}

const SPINNER_SIZES = { xs: 'size-3', sm: 'size-4', md: 'size-5', lg: 'size-8' } as const;

/**
 * A small rounded spinner for a line of text or a button. Decorative by default; pass `label` for
 * a spinner that stands alone and should be announced.
 */
export function InlineSpinner({
  size = 'sm',
  label,
  className,
}: {
  size?: keyof typeof SPINNER_SIZES;
  label?: string;
  className?: string;
}) {
  const glyph = (
    <LoaderCircle
      aria-hidden="true"
      className={cn(SPINNER_SIZES[size], 'shrink-0 motion-safe:animate-spin', className)}
    />
  );
  if (label === undefined) return glyph;
  return (
    <span role="status" className="inline-flex items-center gap-2">
      {glyph}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** A panel waiting for its data: a centred spinner and a short line. */
export function SectionLoader({
  label = 'Loading',
  minHeightClass = 'min-h-40',
}: {
  label?: string;
  minHeightClass?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      data-loader="section"
      className={cn('grid place-items-center gap-2 py-8 text-muted-foreground', minHeightClass)}
    >
      <InlineSpinner size="lg" className="text-primary" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/** A whole page waiting: the section loader, centred in the viewport's height. */
export function PageLoader({ label = 'Loading' }: { label?: string }) {
  return <SectionLoader label={label} minHeightClass="min-h-[60dvh]" />;
}

/**
 * Dims and blocks a region while an action (a save, a delete) runs. The content stays in place,
 * so nothing moves; the overlay catches clicks and announces the busy state once.
 */
export function LoadingOverlay({
  active,
  label = 'Working',
  children,
}: {
  active: boolean;
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className="relative" aria-busy={active}>
      {children}
      {active ? (
        <div
          role="status"
          data-loader="overlay"
          className="absolute inset-0 z-10 grid place-items-center rounded-[inherit] bg-surface/70 backdrop-blur-[1px]"
        >
          <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm font-medium text-foreground shadow-md ring-1 ring-hairline">
            <InlineSpinner className="text-primary" />
            {label}
          </span>
        </div>
      ) : null}
    </div>
  );
}
