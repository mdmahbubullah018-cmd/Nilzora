import type { ComponentProps, ElementType } from 'react';
import { cn } from '../lib/cn';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      // `nz-card` carries no styles here: an app may skin it (the admin makes it glass).
      className={cn('nz-card rounded-lg border border-border bg-surface shadow-xs', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('flex flex-col gap-1 p-5 pb-0 sm:p-6 sm:pb-0', className)} {...props} />
  );
}

export interface CardTitleProps extends ComponentProps<'h2'> {
  /** Heading level that fits the surrounding document outline. */
  as?: Extract<ElementType, 'h2' | 'h3' | 'h4'>;
}

export function CardTitle({ as: Heading = 'h3', className, ...props }: CardTitleProps) {
  return (
    <Heading className={cn('text-base font-semibold text-foreground', className)} {...props} />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-5 sm:p-6', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex items-center gap-3 border-t border-border px-5 py-4 sm:px-6', className)}
      {...props}
    />
  );
}
