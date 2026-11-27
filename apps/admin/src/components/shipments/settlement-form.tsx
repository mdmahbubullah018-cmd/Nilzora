'use client';

import { COURIER_PROVIDER_IDS } from '@nilzora/contracts';
import { cn, Field, Input, NativeSelect } from '@nilzora/ui';
import { useActionState, useMemo, useState } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { SubmitButton } from '@/components/admin-kit/submit-button';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { recordSettlementAction } from '@/lib/courier-actions';
import { formatMoney } from '@/lib/format';
import { takaTextToMinor } from './money-input';
import { TestChip } from './shipment-chips';
import { providerName } from './shipment-labels';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/** A shipment the courier may be paying out for, with what is still outstanding. */
export interface SettlementCandidate {
  shipmentId: string;
  orderNumber: string;
  provider: string;
  consignmentId: string | null;
  isMock: boolean;
  /** Expected settlement still unpaid, in poisha. */
  outstandingMinor: number;
}

export interface SettlementLineDraft {
  shipmentId: string;
  settled: string;
  deliveryCharge: string;
  codFee: string;
  returnCharge: string;
  other: string;
}

/**
 * The client-side form of the server's rule: every line has a valid settled amount and the
 * settled amounts add up exactly to the payout. The server (and the database) check again.
 */
export function checkSettlement(
  amountText: string,
  lines: readonly SettlementLineDraft[],
): { ok: boolean; linesMinor: number | null; amountMinor: number | null; message: string } {
  const amountMinor = takaTextToMinor(amountText);
  let sum = 0;
  for (const line of lines) {
    const settled = takaTextToMinor(line.settled);
    if (settled === null) {
      return {
        ok: false,
        linesMinor: null,
        amountMinor,
        message: 'Every chosen shipment needs a settled amount in taka.',
      };
    }
    for (const part of [line.deliveryCharge, line.codFee, line.returnCharge, line.other]) {
      if (part.trim() !== '' && takaTextToMinor(part) === null) {
        return {
          ok: false,
          linesMinor: null,
          amountMinor,
          message: 'Deductions must be amounts in taka (or left empty).',
        };
      }
    }
    sum += settled;
  }
  if (lines.length === 0) {
    return { ok: false, linesMinor: 0, amountMinor, message: 'Choose at least one shipment.' };
  }
  if (amountMinor === null) {
    return { ok: false, linesMinor: sum, amountMinor, message: 'Enter the payout amount in taka.' };
  }
  if (sum !== amountMinor) {
    return {
      ok: false,
      linesMinor: sum,
      amountMinor,
      message: `The lines add up to ${formatMoney(sum)} but the payout is ${formatMoney(amountMinor)}.`,
    };
  }
  return {
    ok: true,
    linesMinor: sum,
    amountMinor,
    message: `The lines add up to the payout of ${formatMoney(sum)}.`,
  };
}

function emptyLine(candidate: SettlementCandidate): SettlementLineDraft {
  const outstanding = Math.max(0, candidate.outstandingMinor);
  return {
    shipmentId: candidate.shipmentId,
    settled: outstanding % 100 === 0 ? String(outstanding / 100) : (outstanding / 100).toFixed(2),
    deliveryCharge: '',
    codFee: '',
    returnCharge: '',
    other: '',
  };
}

export interface SettlementFormProps {
  csrf: CsrfInput;
  candidates: readonly SettlementCandidate[];
  /** Offer the "test settlement" switch (only while test data is shown). */
  allowTest: boolean;
  today: string;
}

/** Records one courier payout and how it splits over that courier's shipments. */
export function SettlementForm({ csrf, candidates, allowTest, today }: SettlementFormProps) {
  const tx = useTx();
  const [state, action] = useActionState(recordSettlementAction, IDLE_STATE);
  const [provider, setProvider] = useState<string>(
    state.values?.provider ?? COURIER_PROVIDER_IDS[0],
  );
  const [isTest, setIsTest] = useState(false);
  const [amount, setAmount] = useState(state.values?.amount ?? '');
  const [lines, setLines] = useState<SettlementLineDraft[]>([]);
  // A recorded payout starts the form afresh (its shipments have left the list).
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.status === 'success') {
      setLines([]);
      setAmount('');
    }
  }
  const available = candidates.filter((c) => c.provider === provider && c.isMock === isTest);
  const check = useMemo(() => checkSettlement(amount, lines), [amount, lines]);

  const toggle = (candidate: SettlementCandidate, on: boolean) =>
    setLines((current) =>
      on
        ? [...current, emptyLine(candidate)]
        : current.filter((line) => line.shipmentId !== candidate.shipmentId),
    );
  const update = (shipmentId: string, field: keyof SettlementLineDraft, value: string) =>
    setLines((current) =>
      current.map((line) => (line.shipmentId === shipmentId ? { ...line, [field]: value } : line)),
    );

  return (
    <form action={action} className="grid gap-4">
      <CsrfField csrf={csrf} />
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          id="settlement-provider"
          label={tx('Courier')}
          error={state.fieldErrors?.provider}
          required
        >
          {(control) => (
            <NativeSelect
              {...control}
              name="provider"
              value={provider}
              onChange={(event) => {
                setProvider(event.currentTarget.value);
                setLines([]);
              }}
            >
              {COURIER_PROVIDER_IDS.map((id) => (
                <option key={id} value={id}>
                  {providerName(id)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field
          id="settlement-reference"
          label={tx('Payout reference')}
          hint={tx('The courier’s payout id or invoice number')}
          error={state.fieldErrors?.reference}
          required
        >
          {(control) => (
            <Input
              {...control}
              name="reference"
              minLength={2}
              maxLength={80}
              autoComplete="off"
              defaultValue={state.values?.reference}
            />
          )}
        </Field>
        <Field
          id="settlement-date"
          label={tx('Received on')}
          error={state.fieldErrors?.receivedOn}
          required
        >
          {(control) => (
            <Input
              {...control}
              type="date"
              name="receivedOn"
              max={today}
              defaultValue={state.values?.receivedOn ?? today}
            />
          )}
        </Field>
        <Field
          id="settlement-amount"
          label={tx('Amount received (৳)')}
          error={state.fieldErrors?.amount}
          required
        >
          {(control) => (
            <Input
              {...control}
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              maxLength={16}
              value={amount}
              onChange={(event) => setAmount(event.currentTarget.value)}
              className="tabular-nums"
            />
          )}
        </Field>
      </div>
      {allowTest ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isMock"
            checked={isTest}
            onChange={(event) => {
              setIsTest(event.currentTarget.checked);
              setLines([]);
            }}
            className="size-4 accent-primary-action"
          />
          Test settlement (settles test shipments only) <TestChip />
        </label>
      ) : null}

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium text-foreground">
          <AutoText>Shipments in this payout</AutoText>
        </legend>
        {available.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No {providerName(provider)} shipments are waiting for a settlement.
          </p>
        ) : (
          <ul className="grid gap-2">
            {available.map((candidate) => {
              const line = lines.find((l) => l.shipmentId === candidate.shipmentId);
              const rowId = `line-${candidate.shipmentId}`;
              return (
                <li
                  key={candidate.shipmentId}
                  className={cn(
                    'grid gap-3 rounded-xl border p-3',
                    line ? 'border-info-line bg-info-soft/30' : 'border-hairline',
                  )}
                >
                  <label className="flex flex-wrap items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(line)}
                      onChange={(event) => toggle(candidate, event.currentTarget.checked)}
                      className="size-4 accent-primary-action"
                    />
                    <span className="font-mono font-medium text-foreground">
                      {candidate.orderNumber}
                    </span>
                    {candidate.consignmentId ? (
                      <span className="font-mono text-xs text-muted-foreground">
                        {candidate.consignmentId}
                      </span>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      Outstanding {formatMoney(candidate.outstandingMinor)}
                    </span>
                  </label>
                  {line ? (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                      {(
                        [
                          ['settled', 'Settled (৳)'],
                          ['deliveryCharge', 'Delivery charge'],
                          ['codFee', 'COD fee'],
                          ['returnCharge', 'Return charge'],
                          ['other', 'Other deduction'],
                        ] as const
                      ).map(([field, label]) => (
                        <div key={field} className="grid gap-1">
                          <label
                            htmlFor={`${rowId}-${field}`}
                            className="text-xs text-muted-foreground"
                          >
                            {label}
                            <span className="sr-only"> for {candidate.orderNumber}</span>
                          </label>
                          <Input
                            id={`${rowId}-${field}`}
                            inputMode="decimal"
                            autoComplete="off"
                            maxLength={16}
                            required={field === 'settled'}
                            value={line[field]}
                            onChange={(event) =>
                              update(candidate.shipmentId, field, event.currentTarget.value)
                            }
                            className="tabular-nums"
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      <p
        role="status"
        aria-live="polite"
        data-testid="settlement-check"
        className={cn('text-sm font-medium', check.ok ? 'text-success-ink' : 'text-warning-ink')}
      >
        {check.message}
      </p>
      {state.fieldErrors?.lines ? (
        <p role="alert" className="text-sm font-medium text-danger-ink">
          {state.fieldErrors.lines}
        </p>
      ) : null}
      <Field id="settlement-note" label={tx('Note')} hint={tx('Optional')}>
        {(control) => (
          <Input {...control} name="note" maxLength={300} defaultValue={state.values?.note} />
        )}
      </Field>
      <SubmitButton className="w-fit" disabled={!check.ok} pendingLabel="Recording…">
        <AutoText>Record settlement</AutoText>
      </SubmitButton>
      <ActionFeedback state={state} />
    </form>
  );
}
