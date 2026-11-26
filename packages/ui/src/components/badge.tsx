import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

/**
 * Tinted badges pair a light background with a 700-shade label for AA contrast;
 * the brand status colour appears in the optional dot. On the dark theme they invert:
 * a deep translucent tint with a 200-shade label.
 */
const tones = {
  neutral: {
    badge:
      'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600',
    dot: 'bg-slate-400',
  },
  primary: {
    badge:
      'bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-400/10 dark:text-sky-200 dark:ring-sky-400/30',
    dot: 'bg-primary',
  },
  success: {
    badge:
      'bg-green-50 text-green-800 ring-green-200 dark:bg-green-400/10 dark:text-green-200 dark:ring-green-400/30',
    dot: 'bg-success',
  },
  warning: {
    badge:
      'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/30',
    dot: 'bg-warning',
  },
  danger: {
    badge:
      'bg-red-50 text-red-700 ring-red-200 dark:bg-red-400/10 dark:text-red-200 dark:ring-red-400/30',
    dot: 'bg-danger',
  },
  violet: {
    badge:
      'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-400/10 dark:text-violet-200 dark:ring-violet-400/30',
    dot: 'bg-brand-violet',
  },
  moderator: {
    badge:
      'bg-teal-50 text-teal-800 ring-teal-200 dark:bg-teal-400/10 dark:text-teal-200 dark:ring-teal-400/30',
    dot: 'bg-moderator',
  },
  // Darker than the brand #F43F5E (3.7:1 with white) so the label meets AA.
  offer: {
    badge: 'bg-offer-badge text-offer-badge-foreground ring-transparent font-semibold',
    dot: 'bg-white',
  },
} as const;

export type BadgeTone = keyof typeof tones;

export interface BadgeProps extends ComponentProps<'span'> {
  tone?: BadgeTone;
  dot?: boolean;
}

export function Badge({
  tone = 'neutral',
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        tones[tone].badge,
        className,
      )}
      {...props}
    >
      {dot ? (
        <span aria-hidden="true" className={cn('size-1.5 rounded-full', tones[tone].dot)} />
      ) : null}
      {children}
    </span>
  );
}
