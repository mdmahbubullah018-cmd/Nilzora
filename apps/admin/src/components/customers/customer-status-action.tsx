'use client';

import type { ProfileStatus } from '@nilzora/contracts';
import { Field, Textarea } from '@nilzora/ui';
import { UserCheck, UserX } from 'lucide-react';
import { useActionState } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { setCustomerStatusAction } from '@/lib/customer-actions';
import { useTx } from '@/lib/i18n/provider';

export interface CustomerStatusActionProps {
  customerId: string;
  name: string;
  status: ProfileStatus;
  csrf: CsrfInput;
}

/** Suspend (with a required reason) or reactivate, confirmed in a second step. */
export function CustomerStatusAction({
  customerId,
  name,
  status,
  csrf,
}: CustomerStatusActionProps) {
  const tx = useTx();
  const [state, action] = useActionState(setCustomerStatusAction, IDLE_STATE);
  const error = state.status === 'error' ? state.message : undefined;

  return (
    <div className="grid gap-3">
      {status === 'active' ? (
        <ConfirmForm
          key="suspend"
          action={action}
          csrf={csrf}
          align="start"
          trigger={
            <>
              <UserX aria-hidden="true" />
              Suspend account
            </>
          }
          title={`Suspend ${name}?`}
          description={tx(
            'They are signed out on their next request and cannot sign in or place orders until reactivated. Their orders are kept.',
          )}
          confirmLabel={tx('Yes, suspend')}
          hiddenFields={{ customerId, status: 'suspended' }}
          error={error}
        >
          <Field
            id="suspend-reason"
            label={tx('Reason')}
            hint={tx('5 to 300 characters. Recorded in the audit log.')}
            error={state.fieldErrors?.reason}
            required
          >
            {(control) => (
              <Textarea
                {...control}
                name="reason"
                rows={3}
                minLength={5}
                maxLength={300}
                defaultValue={state.values?.reason}
              />
            )}
          </Field>
        </ConfirmForm>
      ) : (
        <ConfirmForm
          key="reactivate"
          action={action}
          csrf={csrf}
          align="start"
          trigger={
            <>
              <UserCheck aria-hidden="true" />
              Reactivate account
            </>
          }
          triggerVariant="primary"
          tone="primary"
          title={`Reactivate ${name}?`}
          description={tx('They can sign in and place orders again.')}
          confirmLabel={tx('Yes, reactivate')}
          hiddenFields={{ customerId, status: 'active' }}
          error={error}
        />
      )}
      <ActionFeedback state={state} successOnly />
    </div>
  );
}
