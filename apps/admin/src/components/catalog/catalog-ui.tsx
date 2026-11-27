import { cn } from '@nilzora/ui';
import { Info, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { AutoText } from '@/components/i18n/translate';

/*
 * Small presentational pieces the catalog pages share, on the admin's glass tokens. They
 * render on the server and in client components alike (no hooks, no browser APIs).
 */

/** Extra height for controls on phones, so every tap target is at least 44 px. */
export const TOUCH = 'max-sm:min-h-11';

const wells = {
  info: 'bg-info-soft text-info-ink ring-info-soft',
  success: 'bg-success-soft text-success-ink ring-success-soft',
  warning: 'bg-warning-soft text-warning-ink ring-warning-soft',
  neutral: 'bg-neutral-soft text-neutral-ink ring-neutral-soft',
  violet: 'bg-violet-soft text-violet-ink ring-violet-soft',
} as const;

/** "12/70": how much of a field's limit is used; turns to the danger ink beyond it. */
export function Counter({ value, max }: { value: string; max: number }) {
  return (
    <span
      className={cn(
        'text-xs tabular-nums',
        value.length > max ? 'font-medium text-danger-ink' : 'text-muted-foreground',
      )}
    >
      {value.length.toLocaleString('en-US')}/{max.toLocaleString('en-US')}
    </span>
  );
}

export interface EmptyPanelProps {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  tone?: keyof typeof wells;
  /** The title's element: a heading when the empty state is a section's only content. */
  titleAs?: 'p' | 'h2' | 'h3';
  className?: string;
}

/**
 * An honest empty state: why there is nothing here and, when useful, what to do. The icon
 * floats in a soft tinted circle (still under reduced motion).
 */
export function EmptyPanel({
  icon: Icon,
  title,
  description,
  action,
  tone = 'info',
  titleAs: Title = 'p',
  className,
}: EmptyPanelProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-10 text-center',
        className,
      )}
    >
      <span
        className={cn(
          'nz-float grid size-14 place-items-center rounded-full shadow-glass ring-8',
          wells[tone],
        )}
      >
        <Icon aria-hidden="true" className="size-6" strokeWidth={1.75} />
      </span>
      <div className="grid max-w-sm gap-1">
        <Title className="text-sm font-semibold text-foreground">
          <AutoText value={title} />
        </Title>
        {description ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            <AutoText value={description} />
          </p>
        ) : null}
      </div>
      {action ? (
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <AutoText value={action} />
        </div>
      ) : null}
    </div>
  );
}

/** A note under a panel the account may see but not change. */
export function ViewOnly({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('flex items-start gap-2 text-xs text-muted-foreground', className)}>
      <Info aria-hidden="true" className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
      {children}
    </p>
  );
}

export interface GlassTableProps {
  /** Filters, tabs or a title above the table. */
  header?: ReactNode;
  /** Pagination or a summary below it. */
  footer?: ReactNode;
  /** Region name for assistive technology, when the panel stands for a section. */
  label?: string;
  className?: string;
  children: ReactNode;
}

/**
 * A data table on the near-opaque glass surface. The table scrolls sideways inside the
 * panel on narrow screens (never the page), and on large screens long lists scroll
 * inside the panel under a sticky header row.
 */
export function GlassTable({ header, footer, label, className, children }: GlassTableProps) {
  return (
    <section
      aria-label={label}
      className={cn(
        'nz-panel-strong nz-panel-sheen min-w-0 overflow-hidden rounded-2xl border',
        className,
      )}
    >
      {header ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 border-b border-hairline p-4 sm:p-5">
          <AutoText value={header} />
        </div>
      ) : null}
      {/*
        The table's own wrapper (the first child div) is the scroll container, so the sticky
        header row sticks to it rather than to the page.
      */}
      <div className="nz-sticky-head lg:[&>div]:max-h-[min(72vh,52rem)] lg:[&>div]:overflow-y-auto">
        {children}
      </div>
      {footer ? (
        <div className="border-t border-hairline px-4 py-3 sm:px-5">
          <AutoText value={footer} />
        </div>
      ) : null}
    </section>
  );
}

/** A heading and description for a GlassTable header. */
export function TableHeading({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="grid min-w-0 gap-0.5">
        <h2 className="font-display text-[0.98rem] font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {description ? (
          <p className="text-sm text-muted-foreground">
            <AutoText value={description} />
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <AutoText value={actions} />
        </div>
      ) : null}
    </div>
  );
}
