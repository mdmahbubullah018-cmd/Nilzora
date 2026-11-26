'use client';

import { useRouter } from 'next/navigation';
import { useActionState } from 'react';
import type { CsrfField } from '@/components/auth/form-kit';
import { restoreRecoveryAction, type RecoveryAnswer } from '@/lib/recovery-actions';

const IDLE: RecoveryAnswer = { ok: false };

/**
 * The one button that matters on a recovery page. It posts to a Server Action, which checks
 * this app's Origin and CSRF token and then asks the API to put the saved lines back into this
 * customer's cart. On success the customer lands on checkout, where the cart is priced again.
 */
export function RecoveryRestoreForm({ token, csrf }: { token: string; csrf: CsrfField }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    async (_previous: RecoveryAnswer, formData: FormData): Promise<RecoveryAnswer> => {
      try {
        const answer = await restoreRecoveryAction(formData);
        if (answer.ok) router.push('/checkout');
        return answer;
      } catch {
        return { ok: false, message: 'That could not be restored. Reload and try again.' };
      }
    },
    IDLE,
  );

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name={csrf.name} value={csrf.token} />
      <input type="hidden" name="token" value={token} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? 'Restoring your cart…' : 'Restore my cart'}
      </button>
      {state.message ? (
        <p role="alert" className="text-sm text-foreground">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
