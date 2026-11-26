'use client';

import type { ReturnStatus } from '@nilzora/contracts';
import { Field, Input, NativeSelect } from '@nilzora/ui';
import { useActionState } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import type { ActionState } from '@/components/admin-kit/act';
import { SubmitButton } from '@/components/admin-kit/submit-button';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { ViewOnly } from '@/components/catalog/catalog-ui';
import {
  cancelRefundAction,
  completeRefundAction,
  decideRefundAction,
  decideReturnAction,
  requestRefundAction,
  restockReturnAction,
} from '@/lib/after-sales-actions';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * The forms of the returns and refunds pages. Each posts to a Server Action that checks
 * the CSRF field and lets the API and the database decide; every outcome (success or a
 * fixed refusal) is shown beside the form that caused it.
 */

const TOUCH = 'max-sm:h-11';

function errorOf(state: ActionState, field: string): string | undefined {
  return state.status === 'error' ? state.fieldErrors?.[field] : undefined;
}

/** The decisions staff may take on a return, by its current status. */
const NEXT_DECISIONS: Record<ReturnStatus, { status: ReturnStatus; label: string }[]> = {
  requested: [
    { status: 'approved', label: 'Approve return' },
    { status: 'rejected', label: 'Reject return' },
    { status: 'cancelled', label: 'Cancel return' },
  ],
  approved: [
    { status: 'received', label: 'Mark goods received' },
    { status: 'cancelled', label: 'Cancel return' },
  ],
  received: [{ status: 'completed', label: 'Complete return' }],
  rejected: [],
  completed: [],
  cancelled: [],
};

export function ReturnSteps({
  returnId,
  status,
  received,
  restocked,
  canDecide,
  canRestock,
  csrf,
}: {
  returnId: string;
  status: ReturnStatus;
  received: boolean;
  restocked: boolean;
  /** orders.update_status */
  canDecide: boolean;
  /** inventory.adjust */
  canRestock: boolean;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [decideState, decide] = useActionState(decideReturnAction, IDLE_STATE);
  const [restockState, restock] = useActionState(restockReturnAction, IDLE_STATE);
  const decisions = NEXT_DECISIONS[status];

  return (
    <div className="grid gap-6">
      {!canDecide ? (
        <ViewOnly><AutoText>Deciding returns needs the “Update order status” permission.</AutoText></ViewOnly>
      ) : decisions.length === 0 ? (
        <ViewOnly><AutoText>This return is closed: no further decision can be taken.</AutoText></ViewOnly>
      ) : (
        <form action={decide} className="grid gap-3 sm:grid-cols-2" noValidate>
          <CsrfField csrf={csrf} />
          <input type="hidden" name="returnId" value={returnId} />
          <Field id="return-decision" label={tx("Decision")}>
            {(control) => (
              <NativeSelect
                {...control}
                name="status"
                defaultValue={decisions[0]?.status}
                className={TOUCH}
              >
                {decisions.map((decision) => (
                  <option key={decision.status} value={decision.status}>
                    {decision.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field
            id="return-note"
            label={tx("Note")}
            hint={tx("Required to reject; kept in the history")}
            error={errorOf(decideState, 'note')}
          >
            {(control) => (
              <Input
                {...control}
                name="note"
                maxLength={300}
                defaultValue={decideState.status === 'error' ? decideState.values?.note : undefined}
                className={TOUCH}
              />
            )}
          </Field>
          <div className="grid gap-3 sm:col-span-2">
            <ActionFeedback state={decideState} />
            <div>
              <SubmitButton variant="secondary" pendingLabel="Recording…" className={TOUCH}><AutoText>Record decision</AutoText></SubmitButton>
            </div>
          </div>
        </form>
      )}

      <div className="grid gap-3 border-t border-hairline pt-5">
        <h3 className="text-sm font-semibold text-foreground"><AutoText>Restock</AutoText></h3>
        {!canRestock ? (
          <ViewOnly><AutoText>Restocking needs the “Adjust stock” permission.</AutoText></ViewOnly>
        ) : restocked ? (
          <ViewOnly><AutoText>The returned units are already back in stock.</AutoText></ViewOnly>
        ) : !received ? (
          <ViewOnly><AutoText>Restocking becomes available once the goods are marked as received.</AutoText></ViewOnly>
        ) : (
          <form action={restock} className="grid gap-3" noValidate>
            <CsrfField csrf={csrf} />
            <input type="hidden" name="returnId" value={returnId} />
            <div className="flex flex-wrap items-start gap-3">
              <Field
                id="restock-note"
                label={tx("Restock note")}
                className="min-w-56 flex-1"
                error={errorOf(restockState, 'note')}
              >
                {(control) => (
                  <Input
                    {...control}
                    name="note"
                    maxLength={300}
                    placeholder={tx("Returned items restocked")}
                    className={TOUCH}
                  />
                )}
              </Field>
              <div className="pt-6.5">
                <SubmitButton pendingLabel="Restocking…" className={TOUCH}><AutoText>Restock received items</AutoText></SubmitButton>
              </div>
            </div>
            <ActionFeedback state={restockState} />
          </form>
        )}
      </div>
    </div>
  );
}

/** Approve or reject, record the payout, or cancel a refund (refunds.approve). */
export function RefundSteps({
  refundId,
  status,
  csrf,
}: {
  refundId: string;
  status: string;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [decideState, decide] = useActionState(decideRefundAction, IDLE_STATE);
  const [completeState, complete] = useActionState(completeRefundAction, IDLE_STATE);
  const [cancelState, cancel] = useActionState(cancelRefundAction, IDLE_STATE);
  const open = status === 'requested' || status === 'approved';

  if (!open) {
    return <ViewOnly><AutoText>This refund is closed: nothing more can be recorded on it.</AutoText></ViewOnly>;
  }

  return (
    <div className="grid gap-6">
      {status === 'requested' ? (
        <form action={decide} className="grid gap-3 sm:grid-cols-2" noValidate>
          <CsrfField csrf={csrf} />
          <input type="hidden" name="refundId" value={refundId} />
          <Field id="refund-decision" label={tx("Decision")}>
            {(control) => (
              <NativeSelect {...control} name="decision" defaultValue="approve" className={TOUCH}>
                <option value="approve"><AutoText>Approve</AutoText></option>
                <option value="reject"><AutoText>Reject</AutoText></option>
              </NativeSelect>
            )}
          </Field>
          <Field
            id="refund-decision-note"
            label={tx("Note")}
            hint={tx("Required to reject")}
            error={errorOf(decideState, 'note')}
          >
            {(control) => <Input {...control} name="note" maxLength={300} className={TOUCH} />}
          </Field>
          <div className="grid gap-3 sm:col-span-2">
            <ActionFeedback state={decideState} />
            <div>
              <SubmitButton variant="secondary" pendingLabel="Recording…" className={TOUCH}><AutoText>Record decision</AutoText></SubmitButton>
            </div>
          </div>
        </form>
      ) : (
        <form action={complete} className="grid gap-3" noValidate>
          <CsrfField csrf={csrf} />
          <input type="hidden" name="refundId" value={refundId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id="refund-reference"
              label={tx("Payout reference")}
              hint={tx("Receipt or transfer id — required")}
              error={errorOf(completeState, 'reference')}
              required
            >
              {(control) => (
                <Input
                  {...control}
                  name="reference"
                  maxLength={120}
                  defaultValue={completeState.status === 'error' ? completeState.values?.reference : undefined}
                  className={TOUCH}
                />
              )}
            </Field>
            <Field id="refund-paid-note" label={tx("Note")} error={errorOf(completeState, 'note')}>
              {(control) => <Input {...control} name="note" maxLength={500} className={TOUCH} />}
            </Field>
          </div>
          <ActionFeedback state={completeState} />
          <div>
            <SubmitButton pendingLabel="Recording payout…" className={TOUCH}><AutoText>Record payout</AutoText></SubmitButton>
          </div>
        </form>
      )}

      <form action={cancel} className="grid gap-3 border-t border-hairline pt-5" noValidate>
        <CsrfField csrf={csrf} />
        <input type="hidden" name="refundId" value={refundId} />
        <div className="flex flex-wrap items-start gap-3">
          <Field
            id="refund-cancel-note"
            label={tx("Reason to cancel")}
            className="min-w-56 flex-1"
            error={errorOf(cancelState, 'note')}
            required
          >
            {(control) => <Input {...control} name="note" maxLength={300} className={TOUCH} />}
          </Field>
          <div className="pt-6.5">
            <SubmitButton variant="ghost" pendingLabel="Cancelling…" className={TOUCH}><AutoText>Cancel refund</AutoText></SubmitButton>
          </div>
        </div>
        <ActionFeedback state={cancelState} />
      </form>
    </div>
  );
}

/** Starts a refund on an order (refunds.request); it needs approval before any payout. */
export function RefundRequestForm({
  csrf,
  defaultOrderNumber,
}: {
  csrf: CsrfInput;
  /** Prefills the order, e.g. when the form sits on that order's own page. */
  defaultOrderNumber?: string;
}) {
  const tx = useTx();
  const [state, action] = useActionState(requestRefundAction, IDLE_STATE);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      <CsrfField csrf={csrf} />
      <Field id="refund-order" label={tx("Order number")} error={errorOf(state, 'orderNumber')} required>
        {(control) => (
          <Input
            {...control}
            name="orderNumber"
            placeholder={tx("NZ100001")}
            defaultValue={defaultOrderNumber}
            autoCapitalize="characters"
            className={`font-mono ${TOUCH}`}
          />
        )}
      </Field>
      <Field
        id="refund-amount"
        label={tx("Amount (৳)")}
        hint={tx("Never more than was collected")}
        error={errorOf(state, 'amount')}
        required
      >
        {(control) => (
          <Input {...control} name="amount" inputMode="decimal" className={`tabular-nums ${TOUCH}`} />
        )}
      </Field>
      <Field id="refund-method" label={tx("Method")}>
        {(control) => (
          <NativeSelect {...control} name="method" defaultValue="cod_manual" className={TOUCH}>
            <option value="cod_manual"><AutoText>Cash paid back by hand</AutoText></option>
            <option value="bank_transfer"><AutoText>Bank transfer</AutoText></option>
          </NativeSelect>
        )}
      </Field>
      <Field id="refund-reason" label={tx("Reason")} error={errorOf(state, 'reason')} required>
        {(control) => <Input {...control} name="reason" maxLength={200} className={TOUCH} />}
      </Field>
      <div className="grid gap-3 sm:col-span-2">
        <ActionFeedback state={state} />
        <div>
          <SubmitButton pendingLabel="Requesting refund…" className={TOUCH}><AutoText>Request refund</AutoText></SubmitButton>
        </div>
      </div>
    </form>
  );
}
