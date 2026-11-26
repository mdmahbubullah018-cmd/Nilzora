'use client';

import {
  MANUAL_SHIPMENT_STATUSES,
  SHIPMENT_STATUS_LABELS,
  type CodState,
} from '@nilzora/contracts';
import { Field, Input, NativeSelect, Textarea } from '@nilzora/ui';
import { Ban, ChevronDown, RefreshCw } from 'lucide-react';
import { useActionState, useState, type ReactNode } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import { SubmitButton } from '@/components/admin-kit/submit-button';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import {
  cancelShipmentAction,
  recordCodAdjustmentAction,
  recordCodCollectedAction,
  recordShipmentStatusAction,
  refreshShipmentAction,
  resolveBookingAction,
  setCodStateAction,
} from '@/lib/courier-actions';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * The staff steps on one shipment. Each is a small form posting to a Server Action that
 * the API authorises again; the page shows only the steps the account's permissions
 * allow. None of them changes the order's status or marks its cash collected.
 */

interface ShipmentFormProps {
  shipmentId: string;
  csrf: CsrfInput;
}

/** A quiet disclosure so a shipment's less common steps do not crowd the page. */
export function ActionDisclosure({
  title,
  description,
  open = false,
  children,
}: {
  title: string;
  description?: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={open || undefined}
      className="group rounded-xl border border-hairline bg-surface/60"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
        <span className="grid gap-0.5">
          {title}
          {description ? (
            <span className="text-xs font-normal text-muted-foreground"><AutoText value={description} /></span>
          ) : null}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-hairline p-4"><AutoText value={children} /></div>
    </details>
  );
}

function Hidden({ shipmentId, csrf }: ShipmentFormProps) {
  return (
    <>
      <CsrfField csrf={csrf} />
      <input type="hidden" name="shipmentId" value={shipmentId} />
    </>
  );
}

/** Asks the courier for the latest status; says whether it synced, queued or cannot. */
export function RefreshTrackingForm({ shipmentId, csrf }: ShipmentFormProps) {
  const [state, action] = useActionState(refreshShipmentAction, IDLE_STATE);
  return (
    <form action={action} className="grid gap-2">
      <Hidden shipmentId={shipmentId} csrf={csrf} />
      <SubmitButton
        variant="outline"
        size="sm"
        className="w-fit"
        pendingLabel="Asking the courier…"
      >
        <RefreshCw aria-hidden="true" /><AutoText>Refresh tracking</AutoText></SubmitButton>
      <ActionFeedback state={state} inline />
    </form>
  );
}

/** A status staff saw in the courier's portal, with where it came from. */
export function RecordStatusForm({ shipmentId, csrf }: ShipmentFormProps) {
  const tx = useTx();
  const [state, action] = useActionState(recordShipmentStatusAction, IDLE_STATE);
  const id = (name: string) => `${name}-${shipmentId}`;
  return (
    <form action={action} className="grid gap-3">
      <Hidden shipmentId={shipmentId} csrf={csrf} />
      <Field id={id('status')} label={tx("Status")} error={state.fieldErrors?.status} required>
        {(control) => (
          <NativeSelect {...control} name="status" defaultValue={state.values?.status ?? ''}>
            <option value="" disabled><AutoText>Choose a status</AutoText></option>
            {MANUAL_SHIPMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {SHIPMENT_STATUS_LABELS[status]}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field
        id={id('occurred')}
        label={tx("When it happened")}
        hint={tx("Optional, Bangladesh time. Leave empty for now.")}
        error={state.fieldErrors?.occurredAt}
      >
        {(control) => (
          <Input
            {...control}
            type="datetime-local"
            name="occurredAt"
            defaultValue={state.values?.occurredAt}
          />
        )}
      </Field>
      <Field
        id={id('note')}
        label={tx("Where this comes from")}
        hint={tx("5 to 300 characters, e.g. “Seen in the Pathao portal at 3 pm”.")}
        error={state.fieldErrors?.note}
        required
      >
        {(control) => (
          <Textarea
            {...control}
            name="note"
            rows={2}
            minLength={5}
            maxLength={300}
            defaultValue={state.values?.note}
          />
        )}
      </Field>
      <SubmitButton size="sm" className="w-fit" pendingLabel="Recording…"><AutoText>Record status</AutoText></SubmitButton>
      <ActionFeedback state={state} inline />
    </form>
  );
}

export interface CancelShipmentFormProps extends ShipmentFormProps {
  courier: string;
  /** The courier has no cancel API here: staff confirm they cancelled it in its portal. */
  needsPortal: boolean;
}

/** Cancels the shipment after a reason (and, without a cancel API, the portal confirmation). */
export function CancelShipmentForm({
  shipmentId,
  csrf,
  courier,
  needsPortal,
}: CancelShipmentFormProps) {
  const tx = useTx();
  const [state, action] = useActionState(cancelShipmentAction, IDLE_STATE);
  return (
    <div className="grid gap-2">
      <ConfirmForm
        action={action}
        csrf={csrf}
        align="start"
        trigger={
          <>
            <Ban aria-hidden="true" />
            Cancel shipment
          </>
        }
        title={tx("Cancel this shipment?")}
        description={
          needsPortal
            ? `${courier} cannot be cancelled from Nilzora. Cancel the parcel in the ${courier} portal first, then record it here. The order itself is not changed.`
            : `Nilzora asks ${courier} to cancel the parcel. The order itself is not changed.`
        }
        confirmLabel={tx("Cancel the shipment")}
        hiddenFields={{ shipmentId, needsPortal: needsPortal ? '1' : '0' }}
        error={state.status === 'error' ? state.message : undefined}
      >
        <Field
          id={`cancel-reason-${shipmentId}`}
          label={tx("Reason")}
          hint={tx("3 to 300 characters. Recorded on the shipment.")}
          error={state.fieldErrors?.reason}
          required
        >
          {(control) => (
            <Textarea
              {...control}
              name="reason"
              rows={2}
              minLength={3}
              maxLength={300}
              defaultValue={state.values?.reason}
            />
          )}
        </Field>
        {needsPortal ? (
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              name="cancelledInPortal"
              required
              className="mt-0.5 size-4 accent-primary-action"
            />
            <span>I cancelled it in the {courier} portal</span>
          </label>
        ) : null}
      </ConfirmForm>
      <ActionFeedback state={state} successOnly inline />
    </div>
  );
}

/** Settles an uncertain booking: booked (with the portal's consignment) or not created. */
export function ResolveBookingForm({ shipmentId, csrf }: ShipmentFormProps) {
  const tx = useTx();
  const [state, action] = useActionState(resolveBookingAction, IDLE_STATE);
  const [outcome, setOutcome] = useState(state.values?.outcome ?? 'booked');
  const id = (name: string) => `${name}-${shipmentId}`;
  return (
    <form action={action} className="grid gap-3">
      <Hidden shipmentId={shipmentId} csrf={csrf} />
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium text-foreground">
          What does the courier portal show?
        </legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="outcome"
            value="booked"
            checked={outcome === 'booked'}
            onChange={() => setOutcome('booked')}
            className="size-4 accent-primary-action"
          /><AutoText>The parcel exists (it was booked)</AutoText></label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="outcome"
            value="not_created"
            checked={outcome === 'not_created'}
            onChange={() => setOutcome('not_created')}
            className="size-4 accent-primary-action"
          /><AutoText>No parcel was created</AutoText></label>
      </fieldset>
      {outcome === 'booked' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            id={id('consignment')}
            label={tx("Consignment id")}
            error={state.fieldErrors?.consignmentId}
            required
          >
            {(control) => (
              <Input
                {...control}
                name="consignmentId"
                maxLength={80}
                autoComplete="off"
                defaultValue={state.values?.consignmentId}
              />
            )}
          </Field>
          <Field id={id('tracking')} label={tx("Tracking code")} hint={tx("Optional")}>
            {(control) => (
              <Input
                {...control}
                name="trackingCode"
                maxLength={80}
                autoComplete="off"
                defaultValue={state.values?.trackingCode}
              />
            )}
          </Field>
        </div>
      ) : null}
      <Field
        id={id('resolve-note')}
        label={tx("What you checked")}
        hint={tx("5 to 300 characters.")}
        error={state.fieldErrors?.note}
        required
      >
        {(control) => (
          <Textarea
            {...control}
            name="note"
            rows={2}
            minLength={5}
            maxLength={300}
            defaultValue={state.values?.note}
          />
        )}
      </Field>
      <SubmitButton size="sm" className="w-fit" pendingLabel="Saving…"><AutoText>Resolve booking</AutoText></SubmitButton>
      <ActionFeedback state={state} inline />
    </form>
  );
}

/** The courier's report of cash it collected for this parcel (not the order's payment). */
export function CodCollectedForm({ shipmentId, csrf }: ShipmentFormProps) {
  const tx = useTx();
  const [state, action] = useActionState(recordCodCollectedAction, IDLE_STATE);
  const id = (name: string) => `${name}-${shipmentId}`;
  return (
    <form action={action} className="grid gap-3">
      <Hidden shipmentId={shipmentId} csrf={csrf} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={id('cod-amount')} label={tx("Amount (৳)")} error={state.fieldErrors?.amount} required>
          {(control) => (
            <Input
              {...control}
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              maxLength={16}
              defaultValue={state.values?.amount}
              className="tabular-nums"
            />
          )}
        </Field>
        <Field
          id={id('evidence')}
          label={tx("Courier report or invoice ref.")}
          error={state.fieldErrors?.evidenceRef}
          required
        >
          {(control) => (
            <Input
              {...control}
              name="evidenceRef"
              maxLength={80}
              autoComplete="off"
              defaultValue={state.values?.evidenceRef}
            />
          )}
        </Field>
      </div>
      <Field id={id('cod-note')} label={tx("Note")} hint={tx("Optional")}>
        {(control) => (
          <Input {...control} name="note" maxLength={300} defaultValue={state.values?.note} />
        )}
      </Field>
      <p className="text-xs text-muted-foreground">
        This records the courier’s side only. The order’s cash is still recorded with “Record cash
        collected” on the order.
      </p>
      <SubmitButton size="sm" className="w-fit" pendingLabel="Recording…"><AutoText>Record courier collection</AutoText></SubmitButton>
      <ActionFeedback state={state} inline />
    </form>
  );
}

/** A signed correction (a courier credit or an agreed write-off), with its reason. */
export function CodAdjustmentForm({ shipmentId, csrf }: ShipmentFormProps) {
  const tx = useTx();
  const [state, action] = useActionState(recordCodAdjustmentAction, IDLE_STATE);
  const id = (name: string) => `${name}-${shipmentId}`;
  return (
    <form action={action} className="grid gap-3">
      <Hidden shipmentId={shipmentId} csrf={csrf} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={id('direction')} label={tx("Direction")} required>
          {(control) => (
            <NativeSelect
              {...control}
              name="direction"
              defaultValue={state.values?.direction ?? 'credit'}
            >
              <option value="credit"><AutoText>Add (courier owes more)</AutoText></option>
              <option value="debit"><AutoText>Subtract (courier owes less)</AutoText></option>
            </NativeSelect>
          )}
        </Field>
        <Field id={id('adj-amount')} label={tx("Amount (৳)")} error={state.fieldErrors?.amount} required>
          {(control) => (
            <Input
              {...control}
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              maxLength={16}
              defaultValue={state.values?.amount}
              className="tabular-nums"
            />
          )}
        </Field>
      </div>
      <Field
        id={id('adj-note')}
        label={tx("Reason")}
        hint={tx("5 to 300 characters.")}
        error={state.fieldErrors?.note}
        required
      >
        {(control) => (
          <Textarea
            {...control}
            name="note"
            rows={2}
            minLength={5}
            maxLength={300}
            defaultValue={state.values?.note}
          />
        )}
      </Field>
      <SubmitButton size="sm" variant="outline" className="w-fit" pendingLabel="Recording…"><AutoText>Record adjustment</AutoText></SubmitButton>
      <ActionFeedback state={state} inline />
    </form>
  );
}

const STATE_CHOICES: Record<CodState, { value: CodState; label: string }[]> = {
  open: [
    { value: 'reconciled', label: 'Reconcile and close' },
    { value: 'disputed', label: 'Mark as disputed' },
  ],
  disputed: [
    { value: 'reconciled', label: 'Reconcile and close' },
    { value: 'open', label: 'Reopen' },
  ],
  reconciled: [{ value: 'open', label: 'Reopen' }],
};

const STATE_STEP: Record<
  CodState,
  {
    trigger: string;
    title: string;
    description: string;
    confirm: string;
    tone: 'danger' | 'primary';
  }
> = {
  reconciled: {
    trigger: 'Reconcile and close',
    title: 'Reconcile and close this COD?',
    description:
      'The shipment’s cash is marked as settled with the courier. It can be reopened later.',
    confirm: 'Reconcile and close',
    tone: 'primary',
  },
  disputed: {
    trigger: 'Mark as disputed',
    title: 'Mark this COD as disputed?',
    description: 'Flags the courier’s figures for follow-up. Say what is disputed.',
    confirm: 'Mark as disputed',
    tone: 'danger',
  },
  open: {
    trigger: 'Reopen',
    title: 'Reopen this COD?',
    description: 'It returns to open and counts again as awaiting reconciliation.',
    confirm: 'Reopen',
    tone: 'primary',
  },
};

/** Dispute, reconcile (close) or reopen this shipment's COD, each confirmed in a dialog. */
export function CodStateForm({
  shipmentId,
  csrf,
  codState,
  differenceMinor,
}: ShipmentFormProps & { codState: CodState; differenceMinor: number }) {
  const tx = useTx();
  const [state, action] = useActionState(setCodStateAction, IDLE_STATE);
  const failed = state.status === 'error' ? state.values?.state : undefined;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {STATE_CHOICES[codState].map((choice) => {
          const step = STATE_STEP[choice.value];
          const noteNeeded =
            choice.value === 'disputed' || (choice.value === 'reconciled' && differenceMinor !== 0);
          return (
            <ConfirmForm
              key={`${codState}-${choice.value}`}
              action={action}
              csrf={csrf}
              align="start"
              trigger={step.trigger}
              tone={step.tone}
              title={step.title}
              description={step.description}
              confirmLabel={step.confirm}
              hiddenFields={{ shipmentId, state: choice.value }}
              error={failed === choice.value ? state.message : undefined}
            >
              <Field
                id={`cod-note-${choice.value}-${shipmentId}`}
                label={tx("Note")}
                hint={
                  noteNeeded
                    ? choice.value === 'disputed'
                      ? 'Required: what is disputed (5 to 300 characters).'
                      : 'Required: the amounts differ, so say why it is closed anyway.'
                    : 'Optional.'
                }
                error={failed === choice.value ? state.fieldErrors?.note : undefined}
                required={noteNeeded}
              >
                {(control) => (
                  <Textarea
                    {...control}
                    name="note"
                    rows={2}
                    minLength={noteNeeded ? 5 : undefined}
                    maxLength={300}
                    defaultValue={failed === choice.value ? state.values?.note : undefined}
                  />
                )}
              </Field>
            </ConfirmForm>
          );
        })}
      </div>
      <ActionFeedback state={state} successOnly inline />
    </div>
  );
}
