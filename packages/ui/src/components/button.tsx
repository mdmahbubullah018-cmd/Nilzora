import { LoaderCircle } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

const base =
  'nz-btn inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap transition-colors duration-150 select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0';

/*
 * `nz-btn`, `nz-btn-primary` and `nz-btn-danger` carry no styles here: they are stable hooks
 * an app may skin in its own stylesheet (the admin adds its gradient and press feedback), so
 * the storefront looks exactly as these utilities describe.
 *
 * Filled variants use the "action" roles from @nilzora/design-tokens, whose text
 * contrast is verified in themes.test.ts (white on the brand #0284C7 is only 4.1:1).
 */
const variants = {
  primary:
    'nz-btn-primary bg-primary-action text-primary-action-foreground shadow-xs hover:bg-primary-action-hover',
  secondary: 'bg-surface-muted text-foreground hover:bg-border',
  outline: 'border border-border-strong bg-surface text-foreground hover:bg-surface-muted',
  ghost: 'text-foreground hover:bg-surface-muted',
  danger: 'nz-btn-danger bg-danger-action text-danger-action-foreground shadow-xs hover:bg-danger-action-hover',
  link: 'h-auto px-0 text-link underline-offset-4 hover:underline',
} as const;

const sizes = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
  icon: 'size-10',
} as const;

export type ButtonVariant = keyof typeof variants;
export type ButtonSize = keyof typeof sizes;

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

/** Button styling for elements that are not <button>, such as Next.js links. */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  className,
}: ButtonStyleOptions = {}): string {
  return cn(base, variants[variant], variant === 'link' ? undefined : sizes[size], className);
}

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks repeat submissions while an action is pending. */
  loading?: boolean;
}

export function Button({
  variant,
  size,
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, className })}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : null}
      {children}
    </button>
  );
}
