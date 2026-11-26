'use client';

import type { OrderStatus } from '@nilzora/contracts';
import { Field, Input, Textarea } from '@nilzora/ui';
import { Ban, Banknote, CircleCheck } from 'lucide-react';
import { useActionState } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { formatMoney } from '@/lib/format';
import { changeOrderStatusAction, recordCodCollectionAction } from '@/lib/order-actions';
import { isOrderStep, ORDER_STEP } from './order-query';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

export interface OrderStatusActionsProps {
  orderNumber: string;
  status: OrderStatus;
  /** From the API: where the caller may move the order now (shapes the interface only). */
  allowedStatuses: readonly OrderStatus[];
  csrf: CsrfInput;
}

/**
 * The next fulfilment step(s) and cancellation, each confirmed in a second step. Only
 * the moves the API offers are shown; the API decides again when the form is sent.
 */
export function OrderStatusActions({
  orderNumber,
  status,
  allowedStatuses,
  csrf,
}: OrderStatusActionsProps) {
  const tx = useTx();
  const [stepState, stepAction] = useActionState(changeOrderStatusAction, IDLE_STATE);
  const [cancelState, cancelAction] = useActionState(changeOrderStatusAction, IDLE_STATE);
  const steps = allowedStatuses.filter(isOrderStep);
  const canCancel = allowedStatuses.includes('cancelled');
  // One action state serves every step: a failure belongs to the step that sent it.
  const failedStep = stepState.status === 'error' ? stepState.values?.status : undefined;
  const stepError = (step: string) => (failedStep === step ? stepState.message : undefined);
  const cancelError =
    cancelState.status === 'error' && cancelState.values?.status ? cancelState.message : undefined;
  const cancelFieldError = cancelState.fieldErrors?.note;

  return (
    <div className="grid gap-3">
      {steps.length === 0 && !canCancel ? (
        <p className="text-sm text-muted-foreground">
          {status === 'delivered' || status === 'cancelled'
            ? 'This order is closed: there are no further fulfilment steps.'
            : 'Your account cannot change this order’s status.'}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {steps.map((step) => (
          // Keyed by the current status, so a completed step's panel never lingers open.
          <ConfirmForm
            key={`${status}-${step}`}
            action={stepAction}
            csrf={csrf}
            align="start"
            trigger={
              <>
                <CircleCheck aria-hidden="true" />
                {ORDER_STEP[step].action}
              </>
            }
            triggerVariant="primary"
            tone="primary"
            title={`${ORDER_STEP[step].action}: ${orderNumber}?`}
            description={ORDER_STEP[step].description}
            confirmLabel={ORDER_STEP[step].confirm}
            hiddenFields={{ orderNumber, status: step }}
            error={stepError(step)}
          >
            <Field id={`note-${step}`} label={tx("Note for the order history")} hint={tx("Optional")}>
              {(control) => (
                <Textarea
                  {...control}
                  name="note"
                  rows={2}
                  maxLength={300}
                  defaultValue={failedStep === step ? stepState.values?.note : undefined}
                />
              )}
            </Field>
          </ConfirmForm>
        ))}

        {canCancel ? (
          <ConfirmForm
            key={`${status}-cancel`}
            action={cancelAction}
            csrf={csrf}
            align="start"
            trigger={
              <>
                <Ban aria-hidden="true" />
                Cancel order
              </>
            }
            title={`Cancel order ${orderNumber}?`}
            description={tx("Its stock returns to inventory and the customer sees it as cancelled. This cannot be undone.")}
            confirmLabel={tx("Yes, cancel the order")}
            hiddenFields={{ orderNumber, status: 'cancelled' }}
            error={cancelError}
          >
            <Field
              id="cancel-reason"
              label={tx("Reason")}
              hint={tx("5 to 300 characters. Recorded in the order history.")}
              error={cancelFieldError}
              required
            >
              {(control) => (
                <Textarea
                  {...control}
                  name="note"
                  rows={3}
                  minLength={5}
                  maxLength={300}
                  defaultValue={cancelState.values?.note}
                />
              )}
            </Field>
          </ConfirmForm>
        ) : null}
      </div>

      {/* Success redirects with a notice; a failure no step claims shows here. */}
      {stepState.status === 'error' && !failedStep ? <ActionFeedback state={stepState} /> : null}
      {cancelState.status === 'error' && !cancelState.values?.status ? (
        <ActionFeedback state={cancelState} />
      ) : null}
    </div>
  );
}

export interface CodCollectionActionProps {
  orderNumber: string;
  totalMinor: number;
  csrf: CsrfInput;
  /** A short trigger for table rows ("Record cash"; the order number is read out). */
  compact?: boolean;
  /** The list to come back to afterwards (a /admin/cod-collections address); else the order. */
  returnTo?: string;
}

/**
 * Records the courier's cash, after the amount received is typed in and confirmed.
 *
 * The confirmation is a compact panel (not the shared wide one): the order total is stated once,
 * beside the single field, so the question, the figure and the action all fit without scrolling
 * on a phone — and the amount field is set at 16px on small screens so the mobile keyboard does
 * not zoom the page when it opens.
 */
export function CodCollectionAction({
  orderNumber,
  totalMinor,
  csrf,
  compact = false,
  returnTo,
}: CodCollectionActionProps) {
  const tx = useTx();
  const [state, action] = useActionState(recordCodCollectionAction, IDLE_STATE);
  return (
    <div className="grid gap-3">
      <ConfirmForm
        action={action}
        csrf={csrf}
        align="start"
        trigger={
          <>
            <Banknote aria-hidden="true" strokeWidth={1.75} />
            {compact ? (
              <>
                Record cash{' '}
                <span className="sr-only">for {orderNumber}</span>
              </>
            ) : (
              'Record cash collected'
            )}
          </>
        }
        triggerVariant={compact ? 'outline' : 'primary'}
        tone="primary"
        dialogClassName="sm:max-w-md"
        title={`Record the cash for ${orderNumber}?`}
        description={tx("Enter the amount the courier handed over. It must match the order total, and this cannot be undone.")}
        confirmLabel={tx("Record collection")}
        hiddenFields={returnTo ? { orderNumber, returnTo } : { orderNumber }}
        error={state.status === 'error' ? state.message : undefined}
      >
        <div className="grid gap-3">
          <div className="flex items-baseline justify-between gap-3 rounded-lg border border-border/80 bg-surface-muted/60 px-3 py-2">
            <span className="text-sm text-muted-foreground"><AutoText>Order total</AutoText></span>
            <span className="font-display text-lg font-semibold text-foreground tabular-nums">
              {formatMoney(totalMinor)}
            </span>
          </div>
          <Field
            id={`collected-amount-${orderNumber}`}
            label={tx("Amount received (৳)")}
            hint={tx("In taka, exactly as counted.")}
            error={state.fieldErrors?.amount}
            required
          >
            {(control) => (
              <Input
                {...control}
                name="amount"
                inputMode="decimal"
                enterKeyHint="done"
                autoComplete="off"
                pattern="[0-9৳,. ]+"
                maxLength={16}
                className="text-base tabular-nums sm:text-sm"
                defaultValue={state.values?.amount}
              />
            )}
          </Field>
        </div>
      </ConfirmForm>
    </div>
  );
}
