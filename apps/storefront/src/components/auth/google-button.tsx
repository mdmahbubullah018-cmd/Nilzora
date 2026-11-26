'use client';

import { Button } from '@nilzora/ui';
import { useActionState } from 'react';
import type { FormAction } from './form-kit';
import { CsrfInput, FormMessage, IDLE_STATE, type CsrfField } from './form-kit';
import { GoogleMark } from './google-mark';

/**
 * "Continue with Google". Rendered only when the API reports the provider as configured,
 * so the button never leads to a dead end. The pending state covers the round trip to the
 * API that builds the authorization URL before the browser leaves for Google.
 *
 * The surface stays white with Google's own four-colour mark, as Google's sign-in branding
 * requires; the size, radius and focus ring come from the shared Button.
 */
export function GoogleButton({
  action,
  csrf,
  next,
}: {
  action: FormAction;
  csrf: CsrfField;
  /** Where to return after signing in; re-validated by the action and the API. */
  next: string;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_STATE);

  return (
    <form action={formAction} className="grid gap-3">
      <CsrfInput csrf={csrf} />
      <input type="hidden" name="next" value={next} />
      <FormMessage state={state} />
      <Button
        type="submit"
        variant="outline"
        size="lg"
        loading={pending}
        className="w-full bg-surface hover:bg-surface-muted"
      >
        <GoogleMark className="size-5" />
        Continue with Google
      </Button>
    </form>
  );
}

/** The rule between the password form and the Google button. */
export function AuthSeparator() {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3" aria-hidden="true">
      <span className="h-px bg-slate-200" />
      <span className="text-xs uppercase tracking-wide text-slate-500">or</span>
      <span className="h-px bg-slate-200" />
    </div>
  );
}
