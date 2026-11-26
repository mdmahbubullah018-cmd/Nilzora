import { LoaderCircle } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

/** Placeholder block shown while content loads. Decorative, so hidden from assistive tech. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    // `nz-skeleton` carries the colour and the sheen (defined once per app, in its stylesheet):
    // the shop's white cards and pale page well both need a placeholder that is clearly darker
    // than either, and the sheen is the cue that something is arriving.
    <div aria-hidden="true" className={cn('nz-skeleton rounded-md', className)} {...props} />
  );
}

export interface SpinnerProps {
  /** Announced to screen readers. */
  label?: string;
  className?: string;
}

export function Spinner({ label = 'Loading', className }: SpinnerProps) {
  return (
    <span role="status" className={cn('inline-flex items-center text-muted-foreground', className)}>
      <LoaderCircle aria-hidden="true" className="size-5 motion-safe:animate-spin" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
