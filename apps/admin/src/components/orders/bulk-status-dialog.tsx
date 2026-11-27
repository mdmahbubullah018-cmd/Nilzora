'use client';

import type { AdminOrderSummary, BulkOrderStatusResponse, Permission } from '@nilzora/contracts';
import { Alert, Button, Dialog, Field, NativeSelect, Textarea } from '@nilzora/ui';
import { CircleCheck, CircleX } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { Chip } from '@/components/admin-kit/chip';
import { OrderStatusBadge } from '@/components/admin-kit/status-badge';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { bulkChangeStatusAction, loadSelectedOrdersAction } from '@/lib/order-bulk-actions';
import {
  allowedBulkTargets,
  BULK_TARGET_LABEL,
  bulkErrorText,
  CANCEL_REASON_MIN,
  classifyStatusChange,
  STATUS_NOTE_MAX,
  type BulkTargetStatus,
  type StatusPreviewRow,
} from './bulk-logic';
import { actionForm, orderPageHref } from './bulk-shared';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';
import { CountText } from '@/components/i18n/format-text';
import { plural } from '@/lib/format';

/*
 * Change the status of the selected orders together. The current statuses are read fresh
 * when the dialog opens; each order is classified against ORDER_TRANSITIONS, and only the
 * eligible ones are sent, after a confirmation that states exactly how many will change.
 * The API decides again for every order and answers per order.
 */

type Step =
  | { kind: 'loading' }
  | { kind: 'load_failed'; message: string }
  | { kind: 'choose' }
  | { kind: 'confirm' }
  | { kind: 'done'; response: BulkOrderStatusResponse };

export interface BulkStatusDialogProps {
  onClose: () => void;
  /** The selection when the dialog opened (it is rendered only while open). */
  selection: readonly string[];
  permissions: readonly Permission[];
  csrf: CsrfInput;
  /** Called with the per-order outcome once the API has answered. */
  onFinished: (result: { succeeded: string[]; failed: string[] }) => void;
}

export function BulkStatusDialog({
  onClose,
  selection,
  permissions,
  csrf,
  onFinished,
}: BulkStatusDialogProps) {
  const tx = useTx();
  const targets = allowedBulkTargets(permissions);
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [orders, setOrders] = useState<readonly AdminOrderSummary[]>([]);
  const [target, setTarget] = useState<BulkTargetStatus | ''>('');
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ids = useId();

  // Reads the selected orders' current statuses when the dialog opens (and on "Try again").
  useEffect(() => {
    let current = true;
    loadSelectedOrdersAction(actionForm(csrf, { orderNumber: selection })).then(
      (answer) => {
        if (!current) return;
        if (answer.ok) {
          setOrders(answer.value.orders);
          setStep({ kind: 'choose' });
        } else setStep({ kind: 'load_failed', message: answer.message });
      },
      () => {
        if (current) {
          setStep({
            kind: 'load_failed',
            message: 'The selected orders could not be read. Check your connection and try again.',
          });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [csrf, selection, attempt]);

  const rows: StatusPreviewRow[] = target ? classifyStatusChange(selection, orders, target) : [];
  const eligible = rows.filter((row) => row.eligible).map((row) => row.orderNumber);
  const cancelling = target === 'cancelled';
  const trimmed = note.trim();
  const noteProblem = cancelling
    ? trimmed.length < CANCEL_REASON_MIN
      ? `Give a reason of ${String(CANCEL_REASON_MIN)} to ${String(STATUS_NOTE_MAX)} characters.`
      : null
    : null;

  function close() {
    if (!sending) onClose();
  }

  function review() {
    if (noteProblem) {
      setNoteError(noteProblem);
      return;
    }
    setNoteError(null);
    setSendError(null);
    setStep({ kind: 'confirm' });
  }

  async function send() {
    if (!target || eligible.length === 0) return;
    setSending(true);
    setSendError(null);
    try {
      const answer = await bulkChangeStatusAction(
        actionForm(csrf, { orderNumber: eligible, status: target, note: trimmed }),
      );
      if (answer.ok) {
        const succeeded = answer.value.results.filter((r) => r.ok).map((r) => r.orderNumber);
        const failed = answer.value.results.filter((r) => !r.ok).map((r) => r.orderNumber);
        onFinished({ succeeded, failed });
        setStep({ kind: 'done', response: answer.value });
      } else if (answer.noteError) {
        setNoteError(answer.noteError);
        setStep({ kind: 'choose' });
      } else {
        setSendError(answer.message);
      }
    } catch {
      setSendError(
        'Nilzora could not be reached, so the change could not be confirmed. Close this, reload the list to check, then try again.',
      );
    } finally {
      setSending(false);
    }
  }

  const title =
    step.kind === 'confirm' && target
      ? `Change ${plural(eligible.length, 'order')} to ${BULK_TARGET_LABEL[target].toLowerCase()}?`
      : step.kind === 'done'
        ? 'Status change results'
        : `Change status of ${plural(selection.length, 'selected order')}`;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={title}
      description={
        step.kind === 'confirm'
          ? cancelling
            ? 'Their stock returns to inventory and customers see them as cancelled. This cannot be undone.'
            : 'Each order is checked again as it changes; any that moved on in the meantime are refused and reported.'
          : undefined
      }
      className="sm:max-w-2xl"
      footer={
        step.kind === 'choose' ? (
          <>
            <Button variant="ghost" onClick={close}>
              <AutoText>Cancel</AutoText>
            </Button>
            <Button
              variant={cancelling ? 'danger' : 'primary'}
              disabled={!target || eligible.length === 0}
              onClick={review}
            >
              {target && eligible.length > 0
                ? `Review: change ${plural(eligible.length, 'order')}`
                : 'Review change'}
            </Button>
          </>
        ) : step.kind === 'confirm' ? (
          <>
            <Button variant="ghost" disabled={sending} onClick={() => setStep({ kind: 'choose' })}>
              <AutoText>Back</AutoText>
            </Button>
            <Button
              variant={cancelling ? 'danger' : 'primary'}
              loading={sending}
              onClick={() => void send()}
            >
              {`Yes, change ${plural(eligible.length, 'order')}`}
            </Button>
          </>
        ) : (
          <Button variant={step.kind === 'done' ? 'primary' : 'ghost'} onClick={close}>
            {step.kind === 'done' ? 'Done' : 'Cancel'}
          </Button>
        )
      }
    >
      {step.kind === 'loading' ? (
        <p role="status" className="text-sm text-muted-foreground">
          <AutoText>Reading the selected orders’ current statuses…</AutoText>
        </p>
      ) : step.kind === 'load_failed' ? (
        <div className="grid gap-3">
          <Alert tone="danger" title={tx('The orders could not be read')}>
            {step.message}
          </Alert>
          <Button
            variant="outline"
            className="w-fit"
            onClick={() => {
              setStep({ kind: 'loading' });
              setAttempt((n) => n + 1);
            }}
          >
            <AutoText>Try again</AutoText>
          </Button>
        </div>
      ) : step.kind === 'choose' ? (
        <div className="grid gap-4">
          {targets.length === 0 ? (
            <Alert tone="info" title={tx('No status changes available')}>
              <AutoText>Your account cannot change order statuses.</AutoText>
            </Alert>
          ) : (
            <Field id={`${ids}-target`} label={tx('Change to')}>
              {(control) => (
                <NativeSelect
                  {...control}
                  value={target}
                  onChange={(event) => {
                    setTarget(event.currentTarget.value as BulkTargetStatus | '');
                    setNoteError(null);
                  }}
                >
                  <option value="">
                    <AutoText>Choose a status</AutoText>
                  </option>
                  {targets.map((status) => (
                    <option key={status} value={status}>
                      {BULK_TARGET_LABEL[status]}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          )}

          {target ? (
            <>
              <p className="text-sm text-foreground" aria-live="polite">
                <strong>
                  <CountText count={eligible.length} one="order" />
                </strong>{' '}
                of {selection.length} selected will change to{' '}
                {BULK_TARGET_LABEL[target].toLowerCase()}.
                {rows.length - eligible.length > 0
                  ? ` ${plural(rows.length - eligible.length, 'order')} cannot and will be left as ${rows.length - eligible.length === 1 ? 'it is' : 'they are'}.`
                  : ''}
              </p>
              <PreviewTable rows={rows} />
              <Field
                id={`${ids}-note`}
                label={cancelling ? 'Reason for cancelling' : 'Note for each order’s history'}
                hint={
                  cancelling
                    ? `${String(CANCEL_REASON_MIN)} to ${String(STATUS_NOTE_MAX)} characters. Recorded on every cancelled order.`
                    : 'Optional.'
                }
                error={noteError ?? undefined}
                required={cancelling}
              >
                {(control) => (
                  <Textarea
                    {...control}
                    rows={2}
                    maxLength={STATUS_NOTE_MAX}
                    value={note}
                    onChange={(event) => setNote(event.currentTarget.value)}
                  />
                )}
              </Field>
            </>
          ) : null}
        </div>
      ) : step.kind === 'confirm' && target ? (
        <div className="grid gap-3">
          <p className="text-sm text-foreground">
            Exactly these <CountText count={eligible.length} one="order" /> will be sent:
          </p>
          <ul
            aria-label={tx('Orders that will change')}
            className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto"
          >
            {eligible.map((orderNumber) => (
              <li key={orderNumber} className="font-mono text-xs">
                <Chip tone="primary">
                  <AutoText value={orderNumber} />
                </Chip>
              </li>
            ))}
          </ul>
          {rows.length > eligible.length ? (
            <p className="text-xs text-muted-foreground">
              <CountText count={rows.length - eligible.length} one="other selected order" /> will
              not be sent.
            </p>
          ) : null}
          {cancelling ? (
            <p className="text-sm text-muted-foreground">Reason: {trimmed}</p>
          ) : trimmed ? (
            <p className="text-sm text-muted-foreground">Note: {trimmed}</p>
          ) : null}
          {sendError ? (
            <p role="alert" className="text-sm font-medium text-danger-ink">
              {sendError}
            </p>
          ) : null}
        </div>
      ) : step.kind === 'done' ? (
        <StatusResults response={step.response} />
      ) : null}
    </Dialog>
  );
}

function PreviewTable({ rows }: { rows: readonly StatusPreviewRow[] }) {
  return (
    <div className="max-h-72 overflow-y-auto rounded-xl border border-hairline">
      <table className="w-full text-sm">
        <caption className="sr-only">
          <AutoText>Which selected orders will change</AutoText>
        </caption>
        <thead className="sticky top-0 bg-surface-muted text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              <AutoText>Order</AutoText>
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              <AutoText>Now</AutoText>
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              <AutoText>Result</AutoText>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {rows.map((row) => (
            <tr key={row.orderNumber}>
              <td className="px-3 py-2 font-mono text-xs">
                <AutoText value={row.orderNumber} />
              </td>
              <td className="px-3 py-2">
                {row.current ? <OrderStatusBadge status={row.current} /> : '—'}
              </td>
              <td className="px-3 py-2">
                {row.eligible ? (
                  <span className="inline-flex items-center gap-1.5 text-success-ink">
                    <CircleCheck aria-hidden="true" className="size-4" />
                    <AutoText>Will change</AutoText>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <CircleX aria-hidden="true" className="size-4 shrink-0" />
                    {row.reason}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The API's answer, order by order. */
export function StatusResults({ response }: { response: BulkOrderStatusResponse }) {
  const tx = useTx();
  return (
    <div className="grid gap-3">
      <p role="status" className="text-sm text-foreground">
        <strong>
          <CountText count={response.succeeded} one="order" /> changed
        </strong>
        {response.failed > 0 ? (
          <>
            {' · '}
            <strong className="text-danger-ink">{response.failed} not changed</strong>. Those stay
            selected so you can check them and try again.
          </>
        ) : (
          '.'
        )}
      </p>
      <ul aria-label={tx('Result for each order')} className="grid max-h-72 gap-1 overflow-y-auto">
        {response.results.map((row) => (
          <li
            key={row.orderNumber}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-hairline px-3 py-2 text-sm"
          >
            <Link
              href={orderPageHref(row.orderNumber)}
              className="font-mono text-xs font-semibold text-link underline-offset-4 hover:underline"
            >
              {row.orderNumber}
            </Link>
            {row.ok ? (
              <span className="inline-flex items-center gap-1.5 text-success-ink">
                <CircleCheck aria-hidden="true" className="size-4" />
                Changed
                {row.status ? (
                  <>
                    {' to '}
                    <OrderStatusBadge status={row.status} />
                  </>
                ) : null}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-danger-ink">
                <CircleX aria-hidden="true" className="size-4 shrink-0" />
                {bulkErrorText(row.error)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
