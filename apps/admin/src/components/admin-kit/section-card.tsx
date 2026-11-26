import { Card, cn } from '@nilzora/ui';
import type { LucideIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { AutoText } from '@/components/i18n/translate';

export interface SectionCardProps {
  title: ReactNode;
  description?: ReactNode;
  /** A small icon before the title. */
  icon?: LucideIcon;
  /** Controls at the header's end, e.g. a "View all" link or a period switch. */
  actions?: ReactNode;
  /** The title's heading level in the page outline (the page's own title is the h1). */
  titleAs?: 'h2' | 'h3';
  /** Drops the body padding, for tables and lists that run edge to edge. */
  flush?: boolean;
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

/**
 * A titled panel of a workspace page: header (icon, title, description, actions),
 * body and optional footer. A region labelled by its title, so screen-reader users
 * can jump between a page's panels.
 */
export function SectionCard({
  title,
  description,
  icon: Icon,
  actions,
  titleAs: Title = 'h2',
  flush = false,
  footer,
  className,
  bodyClassName,
  children,
}: SectionCardProps) {
  const headingId = useId();
  return (
    <Card
      role="region"
      aria-labelledby={headingId}
      className={cn('nz-panel nz-panel-sheen flex min-w-0 flex-col rounded-2xl', className)}
    >
      {/*
        Title and actions share the first line; the description runs the full width
        beneath, so narrow cards never squeeze it into a column beside the actions.
      */}
      <div className="grid gap-1 px-5 pt-5 sm:px-6">
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <Title
            id={headingId}
            className="flex min-w-0 items-center gap-2.5 font-display text-[0.98rem] font-semibold tracking-tight text-foreground"
          >
            {Icon ? (
              <span
                aria-hidden="true"
                className="grid size-8 shrink-0 place-items-center rounded-lg bg-info-soft text-info-ink ring-1 ring-info-line"
              >
                <Icon className="size-4" strokeWidth={1.75} />
              </span>
            ) : null}
            {<AutoText value={title} />}
          </Title>
          {actions ? <div className="flex shrink-0 items-center gap-2"><AutoText value={actions} /></div> : null}
        </div>
        {description ? <p className="text-sm text-muted-foreground"><AutoText value={description} /></p> : null}
      </div>
      <div className={cn('flex-1', flush ? 'pt-4' : 'p-5 sm:p-6', bodyClassName)}><AutoText value={children} /></div>
      {footer ? (
        <div className="flex items-center gap-3 border-t border-border/70 px-5 py-3 text-sm sm:px-6">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}
