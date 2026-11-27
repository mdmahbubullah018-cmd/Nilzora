'use client';

import { courierVerifyConfirmation, type CourierProvider } from '@nilzora/contracts';
import { Button, Field, Input } from '@nilzora/ui';
import { BadgeCheck, KeyRound, ShieldOff, Trash2 } from 'lucide-react';
import { useActionState, useState } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import { SubmitButton } from '@/components/admin-kit/submit-button';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import {
  clearCourierCredentialAction,
  saveCourierBaseUrlAction,
  setCourierCredentialAction,
  setLiveVerificationAction,
} from '@/lib/courier-actions';
import { credentialLabel, inSentence } from './provider-readiness';
import { TypedConfirmForm } from './typed-confirm';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';
import { DateTimeText } from '@/components/i18n/format-text';

/**
 * One write-only credential: the field is a password input that is never prefilled, the
 * value goes straight to the API (stored encrypted) and is never shown again.
 */
export function CredentialRow({
  provider,
  field,
  status,
  stored,
  csrf,
}: {
  provider: string;
  field: string;
  status: string;
  stored: boolean;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [saveState, saveAction] = useActionState(setCourierCredentialAction, IDLE_STATE);
  const [clearState, clearAction] = useActionState(clearCourierCredentialAction, IDLE_STATE);
  // A new key after each successful save empties the input, so no value lingers in the page.
  const [round, setRound] = useState(0);
  const [seen, setSeen] = useState(saveState);
  if (saveState !== seen) {
    setSeen(saveState);
    if (saveState.status === 'success') setRound(round + 1);
  }
  const label = credentialLabel(field);
  const inputId = `credential-${provider}-${field}`;
  const isSet = status !== 'Not set';

  return (
    <li className="grid gap-2 rounded-xl border border-hairline p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <KeyRound aria-hidden="true" className="size-4 text-muted-foreground" />
          {label}
        </span>
        <span className="text-xs text-muted-foreground" data-testid={`credential-status-${field}`}>
          {status}
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <form action={saveAction} className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
          <CsrfField csrf={csrf} />
          <input type="hidden" name="provider" value={provider} />
          <input type="hidden" name="field" value={field} />
          <Field
            id={inputId}
            label={`New ${inSentence(label)}`}
            error={saveState.fieldErrors?.value}
            className="min-w-0 flex-1"
          >
            {(control) => (
              <Input
                key={round}
                {...control}
                type="password"
                name="value"
                autoComplete="new-password"
                spellCheck={false}
                maxLength={1000}
                required
              />
            )}
          </Field>
          <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">
            {`${isSet ? 'Replace' : 'Save'} `}
            <span className="sr-only">
              <AutoText value={label} />
            </span>
          </SubmitButton>
        </form>
        {stored ? (
          <ConfirmForm
            action={clearAction}
            csrf={csrf}
            trigger={
              <>
                <Trash2 aria-hidden="true" />
                <span className="sr-only">Clear {label}</span>
              </>
            }
            title={`Clear the stored ${inSentence(label)}?`}
            description={tx(
              'Calls that need it stop working and the courier loses its live verification until it is set again.',
            )}
            confirmLabel={tx('Clear credential')}
            hiddenFields={{ provider, field }}
            error={clearState.status === 'error' ? clearState.message : undefined}
          />
        ) : null}
      </div>
      <ActionFeedback state={saveState} inline />
      <ActionFeedback state={clearState} successOnly inline />
    </li>
  );
}

/** The courier's API base URL (non-secret, https on the courier's allow-list). */
export function BaseUrlForm({
  provider,
  apiBaseUrl,
  csrf,
}: {
  provider: string;
  apiBaseUrl: string | null;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [state, action] = useActionState(saveCourierBaseUrlAction, IDLE_STATE);
  return (
    <form action={action} className="grid gap-2">
      <CsrfField csrf={csrf} />
      <input type="hidden" name="provider" value={provider} />
      <div className="flex flex-wrap items-end gap-2">
        <Field
          id={`base-url-${provider}`}
          label={tx('API base URL')}
          hint={tx(
            'An https address on the courier’s own domain (the API allow-lists each courier’s hosts). Empty uses the server default.',
          )}
          error={state.fieldErrors?.apiBaseUrl}
          className="min-w-0 flex-1"
        >
          {(control) => (
            <Input
              {...control}
              name="apiBaseUrl"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              maxLength={300}
              defaultValue={state.values?.apiBaseUrl ?? apiBaseUrl ?? ''}
              placeholder="https://"
            />
          )}
        </Field>
        <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">
          <AutoText>Save URL</AutoText>
        </SubmitButton>
      </div>
      {state.status === 'error' && state.fieldErrors?.apiBaseUrl ? null : (
        <ActionFeedback state={state} inline />
      )}
    </form>
  );
}

/**
 * Verifying a courier for live use (typed confirmation) is offered only once its adapter is
 * verified, its credentials are complete, its URL is valid and a live check has passed.
 */
export function LiveVerificationControls({
  provider,
  csrf,
}: {
  provider: CourierProvider;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [state, action] = useActionState(setLiveVerificationAction, IDLE_STATE);
  const { readiness } = provider;
  const phrase = courierVerifyConfirmation(provider.provider);
  const prerequisites =
    readiness.adapterVerified &&
    readiness.credentialsComplete &&
    readiness.baseUrlValid &&
    readiness.liveCheckPassed;

  return (
    <div className="grid gap-2">
      {provider.liveVerifiedAt ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex items-center gap-2 text-sm font-medium text-success-ink">
            <BadgeCheck aria-hidden="true" className="size-4" />
            Verified for live use <DateTimeText value={provider.liveVerifiedAt} style="datetime" />
          </p>
          <ConfirmForm
            action={action}
            csrf={csrf}
            trigger={
              <>
                <ShieldOff aria-hidden="true" />
                Remove verification
              </>
            }
            title={`Remove ${provider.displayName}’s live verification?`}
            description={tx('Real bookings stop going to this courier until it is verified again.')}
            confirmLabel={tx('Remove verification')}
            hiddenFields={{ provider: provider.provider, verified: 'false' }}
            error={state.status === 'error' ? state.message : undefined}
          />
        </div>
      ) : prerequisites ? (
        <TypedConfirmForm
          action={action}
          csrf={csrf}
          align="start"
          phrase={phrase}
          phraseError={state.fieldErrors?.confirmation}
          trigger={
            <>
              <BadgeCheck aria-hidden="true" />
              Verify for live use
            </>
          }
          triggerVariant="primary"
          tone="primary"
          title={`Verify ${provider.displayName} for live use?`}
          description={tx(
            'You confirm the adapter, credentials and address were checked against the courier’s live account. Real parcels can then be booked with it.',
          )}
          confirmLabel={tx('Verify for live use')}
          hiddenFields={{ provider: provider.provider, verified: 'true' }}
          error={
            state.status === 'error' && !state.fieldErrors?.confirmation ? state.message : undefined
          }
        />
      ) : (
        <div className="grid gap-1">
          <Button type="button" size="sm" className="w-fit" disabled>
            <BadgeCheck aria-hidden="true" />
            <AutoText>Verify for live use</AutoText>
          </Button>
          <p className="text-xs text-muted-foreground">
            Available once the adapter is verified, the credentials are complete, the API address is
            valid and a live connection check has passed.
          </p>
        </div>
      )}
      <ActionFeedback state={state} successOnly inline />
    </div>
  );
}
