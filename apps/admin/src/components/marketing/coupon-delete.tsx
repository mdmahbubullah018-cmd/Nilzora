'use client';

import { Trash2 } from 'lucide-react';
import { useActionState } from 'react';
import { IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { deleteCouponAction } from '@/lib/coupon-actions';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/** Deletes an unused coupon or voucher after confirmation; a used one is refused. */
export function DeleteCouponForm({
  couponId,
  code,
  csrf,
}: {
  couponId: string;
  code: string;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [state, action] = useActionState(deleteCouponAction, IDLE_STATE);
  return (
    <ConfirmForm
      action={action}
      csrf={csrf}
      align="start"
      triggerVariant="ghost"
      trigger={
        <>
          <Trash2 aria-hidden="true" strokeWidth={1.75} />
          Delete{' '}
          <span className="sr-only">
            <AutoText value={code} />
          </span>
        </>
      }
      title={`Delete ${code}?`}
      description={tx(
        'Customers who collected it lose it. A coupon that was used in an order cannot be deleted: deactivate it instead. This cannot be undone.',
      )}
      confirmLabel={tx('Delete')}
      hiddenFields={{ couponId }}
      error={state.status === 'error' ? state.message : undefined}
    />
  );
}
