import { cn } from '@nilzora/ui';
import type { ReactNode } from 'react';

/** The one horizontal rhythm every section shares. */
export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8', className)}>{children}</div>
  );
}

export interface SectionHeadingProps {
  id: string;
  eyebrow?: string;
  title: string;
  description?: string;
  /** A trailing link or button, aligned with the heading on wide screens. */
  action?: ReactNode;
  className?: string;
}

/**
 * Eyebrow, title and optional description with an optional trailing action. The heading id is
 * derived from the section id so `aria-labelledby` always resolves to a real element.
 */
export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  action,
  className,
}: SectionHeadingProps) {
  const headingId = `${id}-heading`;
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-3', className)}>
      <div className="grid gap-1.5">
        {eyebrow ? (
          <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h2
          id={headingId}
          className="font-display text-[clamp(1.375rem,1.1rem+1vw,1.875rem)] leading-tight font-semibold tracking-tight text-foreground"
        >
          {title}
        </h2>
        {description ? (
          <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
