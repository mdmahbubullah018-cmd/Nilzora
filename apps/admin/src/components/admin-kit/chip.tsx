import { cn } from '@nilzora/ui';
import type { ComponentProps } from 'react';
import { STATUS_TONES, type StatusTone } from './status-tones';

export interface ChipProps extends ComponentProps<'span'> {
  tone?: StatusTone;
  /** A colour dot before the label (reinforcement only; the label carries the meaning). */
  dot?: boolean;
}

/**
 * The admin's status chip: a translucent tint with a hairline ring that sits well on
 * glass in both themes. Always carries its label as text; colour only reinforces it.
 */
export function Chip({ tone = 'neutral', dot = false, className, children, ...props }: ChipProps) {
  const style = STATUS_TONES[tone];
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset',
        style.chip,
        className,
      )}
      {...props}
    >
      {dot ? <span aria-hidden="true" className={cn('size-1.5 rounded-full', style.dot)} /> : null}
      {children}
    </span>
  );
}
