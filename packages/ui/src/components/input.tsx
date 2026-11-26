import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

// The input border meets the 3:1 non-text minimum; the focus outline is fully opaque
// so it keeps the ring's verified contrast.
const control =
  'w-full rounded-md border border-input-border bg-surface px-3 text-sm text-foreground shadow-xs transition-colors placeholder:text-muted-foreground hover:border-body focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:cursor-not-allowed disabled:border-border-strong disabled:bg-surface-muted disabled:text-muted-foreground aria-invalid:border-red-600 aria-invalid:focus-visible:outline-red-600 dark:aria-invalid:border-red-400 dark:aria-invalid:focus-visible:outline-red-400';

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return <input type={type} className={cn(control, 'h-10', className)} {...props} />;
}

export function Textarea({ className, rows = 4, ...props }: ComponentProps<'textarea'>) {
  return <textarea rows={rows} className={cn(control, 'min-h-24 py-2', className)} {...props} />;
}

export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(control, 'h-10 pr-8', className)} {...props} />;
}
