import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

/** Light tints with 900-shade text; on the dark theme, deep translucent tints with 100-shade text. */
const tones = {
  info: {
    icon: Info,
    classes:
      'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-100',
    iconClass: 'text-primary',
  },
  success: {
    icon: CircleCheck,
    classes:
      'border-green-200 bg-green-50 text-green-900 dark:border-green-400/30 dark:bg-green-400/10 dark:text-green-100',
    iconClass: 'text-green-600 dark:text-green-300',
  },
  warning: {
    icon: TriangleAlert,
    classes:
      'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100',
    iconClass: 'text-amber-600 dark:text-amber-300',
  },
  danger: {
    icon: CircleAlert,
    classes:
      'border-red-200 bg-red-50 text-red-900 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-100',
    iconClass: 'text-red-600 dark:text-red-300',
  },
} satisfies Record<string, { icon: LucideIcon; classes: string; iconClass: string }>;

export type AlertTone = keyof typeof tones;

export interface AlertProps extends Omit<ComponentProps<'div'>, 'title'> {
  tone?: AlertTone;
  title?: ReactNode;
}

/** Inline feedback. Errors are announced immediately; other tones politely. */
export function Alert({ tone = 'info', title, className, children, ...props }: AlertProps) {
  const { icon: Icon, classes, iconClass } = tones[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-lg border p-4 text-sm', classes, className)}
      {...props}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', iconClass)} />
      <div className="grid gap-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="leading-relaxed">{children}</div> : null}
      </div>
    </div>
  );
}
