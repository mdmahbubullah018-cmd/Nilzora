'use client';

import { Button, cn, type ButtonSize, type ButtonVariant } from '@nilzora/ui';
// Type-only: erased at build time, so no server code reaches the browser.
import type { FormState } from '@nilzora/web-session';
import { LogOut } from 'lucide-react';
import { useActionState } from 'react';
import { signOutAction } from '@/lib/actions';
import { CsrfField, type CsrfInput } from './csrf-field';

const INITIAL_STATE: FormState = { status: 'idle' };

export interface SignOutButtonProps {
  csrf: CsrfInput;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** `popover` floats a failure message below the button, for tight spaces like headers. */
  errorPlacement?: 'inline' | 'popover';
  className?: string;
}

/** A plain form, so signing out also works before JavaScript has loaded. */
export function SignOutButton({
  csrf,
  variant = 'outline',
  size = 'md',
  errorPlacement = 'inline',
  className,
}: SignOutButtonProps) {
  const [state, formAction, pending] = useActionState(signOutAction, INITIAL_STATE);

  return (
    <form action={formAction} className={cn('relative', className)}>
      <CsrfField csrf={csrf} />
      <Button type="submit" variant={variant} size={size} loading={pending}>
        {pending ? null : <LogOut aria-hidden="true" />}
        Sign out
      </Button>
      {state.status === 'error' && state.message ? (
        <p
          role="alert"
          className={cn(
            'text-xs font-medium text-red-700 dark:text-red-300',
            errorPlacement === 'popover'
              ? 'absolute top-full right-0 z-40 mt-2 w-64 rounded-md border border-red-200 bg-surface dark:border-red-400/30 p-3 shadow-lg'
              : 'mt-2 max-w-xs',
          )}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
