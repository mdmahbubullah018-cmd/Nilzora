'use client';

import { useActionState } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { setCouponActiveAction } from '@/lib/coupon-actions';

/**
 * The coupon's on/off switch, confirmed first. A refusal shows inside the confirmation,
 * a success under the button (the page refreshes with the new state).
 */
export function CouponActiveToggle({
  couponId,
  code,
  isActive,
  csrf,
}: {
  couponId: string;
  code: string;
  isActive: boolean;
  csrf: CsrfInput;
}) {
  const [state, action] = useActionState(setCouponActiveAction, IDLE_STATE);
  const next = !isActive;
  return (
    <div className="grid gap-3">
      <ConfirmForm
        action={action}
        csrf={csrf}
        align="start"
        trigger={next ? 'Activate coupon' : 'Deactivate coupon'}
        triggerVariant={next ? 'primary' : 'danger'}
        triggerSize="sm"
        title={next ? `Activate ${code}?` : `Deactivate ${code}?`}
        description={
          next
            ? 'Checkout will accept this code again.'
            : 'Checkout will refuse this code from now on. Past orders are unchanged.'
        }
        confirmLabel={next ? 'Yes, activate it' : 'Yes, deactivate it'}
        tone={next ? 'primary' : 'danger'}
        hiddenFields={{ couponId, isActive: String(next) }}
        error={state.status === 'error' ? state.message : undefined}
      />
      <ActionFeedback state={state} successOnly inline />
    </div>
  );
}
