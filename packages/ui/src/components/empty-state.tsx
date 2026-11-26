import type { ComponentType, ReactNode } from 'react';
import { cn } from '../lib/cn';

/** Any outline icon component: the Lucide set, or a shared glyph such as the cart. */
export type EmptyStateIcon = ComponentType<{ className?: string; strokeWidth?: number }>;

export interface EmptyStateProps {
  icon?: EmptyStateIcon;
  title: ReactNode;
  description?: ReactNode;
  /** Optional call to action, e.g. a button or link. */
  action?: ReactNode;
  className?: string;
  /** The title's element: a heading when the empty state is the whole page's content. */
  titleAs?: 'p' | 'h1' | 'h2';
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  titleAs: Title = 'p',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 px-6 py-10 text-center',
        className,
      )}
    >
      {Icon ? (
        <span
          aria-hidden="true"
          className="grid size-16 place-items-center rounded-full bg-primary/10 text-primary ring-8 ring-primary/5"
        >
          <Icon className="size-7" strokeWidth={1.6} />
        </span>
      ) : null}
      <div className="grid max-w-sm gap-1">
        <Title className="font-display text-lg font-semibold tracking-tight text-foreground">
          {title}
        </Title>
        {description ? (
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
