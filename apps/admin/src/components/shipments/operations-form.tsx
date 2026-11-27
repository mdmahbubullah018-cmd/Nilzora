'use client';

import {
  COURIER_LIVE_CONFIRMATION,
  type CourierConfigResponse,
  type CourierMode,
} from '@nilzora/contracts';
import { Button, cn, Dialog, Field, Input } from '@nilzora/ui';
import { Save, ShieldAlert } from 'lucide-react';
import { useActionState, useState, type ReactNode } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { SubmitButton } from '@/components/admin-kit/submit-button';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { saveCourierOperationsAction } from '@/lib/courier-actions';
import { MOCK_REFUSED_REASON, MODE_CHOICES } from './courier-modes';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/** Whether saving these choices turns on live mode or live bookings (needs the typed phrase). */
export function needsLiveConfirmation(
  saved: { mode: CourierMode; bookingEnabled: boolean },
  next: { mode: CourierMode; bookingEnabled: boolean },
): boolean {
  if (next.mode !== 'live') return false;
  return saved.mode !== 'live' || (next.bookingEnabled && !saved.bookingEnabled);
}

function Toggle({
  name,
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  name: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        'flex items-start gap-3 rounded-xl border p-3 text-sm',
        checked ? 'border-info-line bg-info-soft/30' : 'border-hairline',
        disabled && 'opacity-60',
      )}
    >
      <input
        type="checkbox"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="mt-0.5 size-5 accent-primary-action"
      />
      <span className="grid gap-0.5">
        <span className="font-semibold text-foreground">
          <AutoText value={label} />
        </span>
        <span className="text-xs text-muted-foreground">
          <AutoText value={description} />
        </span>
      </span>
    </label>
  );
}

export interface OperationsFormProps {
  config: Pick<CourierConfigResponse, 'operations' | 'mockAllowed'>;
  csrf: CsrfInput;
}

/**
 * The courier operating switches (couriers.configure). Saving a change that turns on live
 * mode or live bookings first opens a dialog asking for the typed phrase, which is sent as
 * `confirmation`; the API refuses the change without it.
 */
export function OperationsForm({ config, csrf }: OperationsFormProps) {
  const tx = useTx();
  const saved = config.operations;
  const [state, action] = useActionState(saveCourierOperationsAction, IDLE_STATE);
  // A saved test mode this API refuses starts the choice at Off.
  const [mode, setMode] = useState<CourierMode>(
    saved.mode === 'mock' && !config.mockAllowed ? 'off' : saved.mode,
  );
  const [bookingEnabled, setBookingEnabled] = useState(saved.bookingEnabled);
  const [trackingSync, setTrackingSync] = useState(saved.trackingSyncEnabled);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.status === 'success') {
      setOpen(false);
      setTyped('');
    }
  }
  const confirmNeeded = needsLiveConfirmation(saved, { mode, bookingEnabled });

  return (
    <form action={action} className="grid gap-5" aria-label={tx('Courier operations')}>
      <CsrfField csrf={csrf} />
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold text-foreground">
          <AutoText>Operating mode</AutoText>
        </legend>
        <div className="grid gap-2 md:grid-cols-3">
          {MODE_CHOICES.map((choice) => {
            const refused = choice.value === 'mock' && !config.mockAllowed;
            const descriptionId = `mode-${choice.value}-description`;
            return (
              <label
                key={choice.value}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors',
                  mode === choice.value
                    ? 'border-info-line bg-info-soft/40'
                    : 'border-hairline bg-surface',
                  refused && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type="radio"
                  name="mode"
                  value={choice.value}
                  checked={mode === choice.value}
                  disabled={refused}
                  aria-describedby={descriptionId}
                  onChange={() => setMode(choice.value)}
                  className="mt-0.5 size-4 accent-primary-action"
                />
                <span className="grid gap-1">
                  <span className="font-semibold text-foreground">
                    <AutoText value={choice.label} />
                  </span>
                  <span id={descriptionId} className="text-xs text-muted-foreground">
                    {refused ? MOCK_REFUSED_REASON : choice.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {state.fieldErrors?.mode ? (
          <p role="alert" className="text-xs font-medium text-danger-ink">
            {state.fieldErrors.mode}
          </p>
        ) : null}
      </fieldset>

      <div className="grid gap-3 md:grid-cols-2">
        <Toggle
          name="bookingEnabled"
          checked={bookingEnabled}
          onChange={setBookingEnabled}
          label={tx('Real bookings')}
          description={
            mode === 'live'
              ? 'Lets staff book real parcels through verified courier APIs. Off: compare only, and record portal bookings by hand.'
              : 'Only applies in Live mode.'
          }
        />
        <Toggle
          name="trackingSyncEnabled"
          checked={trackingSync}
          onChange={setTrackingSync}
          label={tx('Automatic tracking sync')}
          description={tx(
            'Asks the couriers for status updates on open shipments at the interval below.',
          )}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id="tracking-interval"
          label={tx('Tracking sync interval (minutes)')}
          hint={tx('1 to 1,440 minutes.')}
          error={state.fieldErrors?.trackingSyncMinutes}
          required
        >
          {(control) => (
            <Input
              {...control}
              name="trackingSyncMinutes"
              type="number"
              min={1}
              max={1440}
              defaultValue={
                state.values?.trackingSyncMinutes ??
                String(Math.round(saved.trackingSyncIntervalSeconds / 60))
              }
            />
          )}
        </Field>
        <Field
          id="request-timeout"
          label={tx('Courier request timeout (seconds)')}
          hint={tx(
            '1 to 60 seconds. A booking without an answer in time is marked uncertain, never retried.',
          )}
          error={state.fieldErrors?.timeoutSeconds}
          required
        >
          {(control) => (
            <Input
              {...control}
              name="timeoutSeconds"
              type="number"
              min={1}
              max={60}
              defaultValue={
                state.values?.timeoutSeconds ?? String(Math.round(saved.httpTimeoutMs / 1000))
              }
            />
          )}
        </Field>
      </div>

      {confirmNeeded ? (
        <>
          <Button type="button" className="w-fit" onClick={() => setOpen(true)}>
            <ShieldAlert aria-hidden="true" />
            <AutoText>Save and turn on live couriers…</AutoText>
          </Button>
          <Dialog
            open={open}
            onOpenChange={setOpen}
            title={tx('Turn on live couriers?')}
            description={
              mode === 'live' && saved.mode !== 'live'
                ? 'Nilzora will call the real courier APIs for every verified, enabled courier.'
                : 'Staff will be able to book real parcels that couriers collect and charge for.'
            }
            closeLabel="Keep it off"
            className="sm:max-w-md"
          >
            <div className="grid gap-3">
              <Field
                id="live-confirmation"
                label={
                  <>
                    Type{' '}
                    <span className="font-mono font-semibold">
                      <AutoText value={COURIER_LIVE_CONFIRMATION} />
                    </span>{' '}
                    to confirm
                  </>
                }
                error={state.fieldErrors?.confirmation}
                required
              >
                {(control) => (
                  <Input
                    {...control}
                    name="confirmation"
                    autoComplete="off"
                    spellCheck={false}
                    value={typed}
                    onChange={(event) => setTyped(event.currentTarget.value)}
                    className="font-mono"
                  />
                )}
              </Field>
              {state.status === 'error' && !state.fieldErrors?.confirmation ? (
                <ActionFeedback state={state} inline />
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  <AutoText>Keep it off</AutoText>
                </Button>
                <SubmitButton
                  size="sm"
                  variant="danger"
                  disabled={typed.trim() !== COURIER_LIVE_CONFIRMATION}
                  pendingLabel="Saving…"
                >
                  <AutoText>Turn on live couriers</AutoText>
                </SubmitButton>
              </div>
            </div>
          </Dialog>
        </>
      ) : (
        <SubmitButton className="w-fit" pendingLabel="Saving…">
          <Save aria-hidden="true" />
          <AutoText>Save operations</AutoText>
        </SubmitButton>
      )}
      <ActionFeedback state={state} />
    </form>
  );
}
