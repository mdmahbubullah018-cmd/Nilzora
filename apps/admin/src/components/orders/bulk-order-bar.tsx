'use client';

import type { AdminOrderSummary, Permission } from '@nilzora/contracts';
import { Button } from '@nilzora/ui';
import { ChevronDown, Download, ListChecks, Truck, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { OrderStatusBadge } from '@/components/admin-kit/status-badge';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { formatMoney, plural } from '@/lib/format';
import { loadSelectedOrdersAction } from '@/lib/order-bulk-actions';
import { BulkCourierDialog, type BookingKeys } from './bulk-courier-dialog';
import { selectedOrdersCsv, selectedOrdersFileName } from './bulk-export';
import { allowedBulkTargets, BULK_ORDER_LIMIT } from './bulk-logic';
import { actionForm, downloadTextFile, orderPageHref } from './bulk-shared';
import { BulkStatusDialog } from './bulk-status-dialog';
import { useOrderSelection } from './order-selection';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';
import { CountText } from '@/components/i18n/format-text';

/*
 * The bulk toolbar of the orders list: a sticky bar that appears once at least one order
 * is selected. It counts the selection, selects or clears the page, lists selected orders
 * from other pages, and offers the bulk actions this account may use. Every action opens
 * its own confirmed step; selecting alone never changes anything.
 */

export interface BulkOrderBarProps {
  permissions: readonly Permission[];
  csrf: CsrfInput;
}

type Dialog = { kind: 'status' | 'courier'; selection: readonly string[] } | null;

/*
 * Phone layout of the action row (below sm), which jsdom cannot measure, so it is pinned by
 * class in the tests. Each action is `grow shrink-0 basis-auto`: it is never narrower than its
 * label (a flex-1 button had basis 0 and was squeezed to 103px, clipping "Change status"),
 * and the wrapping row moves an action to the next line when it does not fit. At 320px that is
 * one full-width action per line; at 390px "Change status" and "Export selected (CSV)" share
 * a line and "Prepare courier booking" takes the next. From sm up the buttons keep their size.
 */
export const BULK_ACTION_CLASS = 'max-sm:min-h-11 max-sm:shrink-0 max-sm:grow max-sm:basis-auto';

export function BulkOrderBar({ permissions, csrf }: BulkOrderBarProps) {
  const tx = useTx();
  const selection = useOrderSelection();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [announcement, setAnnouncement] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // Booking keys of this tab's booking attempts (see BulkCourierDialog): kept across dialogs.
  const bookingKeys = useRef<Record<string, string>>({});
  // The button that opened a dialog: it gets focus back when the dialog closes (Escape too).
  const opener = useRef<HTMLElement | null>(null);
  function openDialog(event: MouseEvent<HTMLElement>, next: NonNullable<Dialog>) {
    opener.current = event.currentTarget;
    setDialog(next);
  }
  function closeDialog() {
    setDialog(null);
    const target = opener.current;
    opener.current = null;
    // After the dialog has left the DOM, or the browser would move focus on to <body>.
    requestAnimationFrame(() => {
      if (target?.isConnected) target.focus();
    });
  }
  const keys: BookingKeys = {
    get: () => bookingKeys.current,
    set: (next) => {
      bookingKeys.current = next;
    },
  };

  const canChangeStatus = allowedBulkTargets(permissions).length > 0;
  const canExport = permissions.includes('orders.read');
  const canBook = permissions.includes('shipments.create');

  if (!selection) return null;
  const { selected, pageOrders } = selection;
  const onPage = pageOrders.filter((orderNumber) => selection.isSelected(orderNumber)).length;
  const offPage = selected.filter((orderNumber) => !pageOrders.includes(orderNumber));
  const pageFullySelected = pageOrders.length > 0 && onPage === pageOrders.length;

  async function exportSelected() {
    if (!selection) return;
    setExporting(true);
    setExportError(null);
    try {
      const answer = await loadSelectedOrdersAction(actionForm(csrf, { orderNumber: selected }));
      if (!answer.ok) {
        setExportError(answer.message);
        return;
      }
      const { orders, missing } = answer.value;
      downloadTextFile(selectedOrdersCsv(orders), selectedOrdersFileName(new Date()));
      setAnnouncement(
        `Exported ${plural(orders.length, 'order')} to CSV.${
          missing.length > 0
            ? ` ${plural(missing.length, 'selected order')} could not be found and ${missing.length === 1 ? 'was' : 'were'} left out.`
            : ''
        }`,
      );
    } catch {
      setExportError(
        'The selected orders could not be exported. Check your connection and try again.',
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      {/* Present before anything is announced, so screen readers pick up each result. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {selected.length > 0 ? (
        <div className="nz-fade-in sticky bottom-3 z-30 sm:bottom-4">
          <section
            aria-label={tx('Bulk actions')}
            className="nz-glass nz-bulk-bar grid gap-3 rounded-2xl border px-4 py-3 shadow-glass-lg sm:px-5"
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-semibold text-foreground">
                  <CountText count={selected.length} one="order" /> selected
                </span>
                <span className="text-muted-foreground">
                  {onPage} on this page
                  {offPage.length > 0 ? ` · ${String(offPage.length)} on other pages` : ''}
                  {' · '}
                  up to {BULK_ORDER_LIMIT}
                </span>
                <span className="flex flex-wrap items-center gap-1">
                  {!pageFullySelected && pageOrders.length > 0 ? (
                    <Button
                      variant="link"
                      size="sm"
                      className="text-sm"
                      onClick={() => selection.selectMany(pageOrders)}
                    >
                      Select all {pageOrders.length} on this page
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="max-sm:min-h-10"
                    onClick={() => {
                      selection.clear();
                      setAnnouncement('Selection cleared.');
                    }}
                  >
                    <X aria-hidden="true" />
                    <AutoText>Clear selection</AutoText>
                  </Button>
                </span>
              </div>
              <div
                role="group"
                aria-label={tx('Actions for the selected orders')}
                className="flex flex-wrap items-center gap-2"
              >
                {canChangeStatus ? (
                  <Button
                    size="sm"
                    className={BULK_ACTION_CLASS}
                    onClick={(event) => openDialog(event, { kind: 'status', selection: selected })}
                  >
                    <ListChecks aria-hidden="true" />
                    <AutoText>Change status</AutoText>
                  </Button>
                ) : null}
                {canBook ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className={BULK_ACTION_CLASS}
                    onClick={(event) => openDialog(event, { kind: 'courier', selection: selected })}
                  >
                    <Truck aria-hidden="true" />
                    <AutoText>Prepare courier booking</AutoText>
                  </Button>
                ) : null}
                {canExport ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className={BULK_ACTION_CLASS}
                    loading={exporting}
                    onClick={() => void exportSelected()}
                  >
                    {exporting ? null : <Download aria-hidden="true" />}
                    Export selected (CSV)
                  </Button>
                ) : null}
              </div>
            </div>

            {selection.notice ? (
              <p role="alert" className="text-sm font-medium text-warning-ink">
                {selection.notice}
              </p>
            ) : null}
            {exportError ? (
              <p role="alert" className="text-sm font-medium text-danger-ink">
                {exportError}
              </p>
            ) : null}
            {offPage.length > 0 ? <SelectedTray orderNumbers={offPage} csrf={csrf} /> : null}
          </section>
        </div>
      ) : null}

      {dialog?.kind === 'status' ? (
        <BulkStatusDialog
          selection={dialog.selection}
          permissions={permissions}
          csrf={csrf}
          onClose={closeDialog}
          onFinished={({ succeeded, failed }) => {
            // Successes leave the selection; failures stay selected for a retry.
            selection.deselectMany(succeeded);
            setAnnouncement(
              `${plural(succeeded.length, 'order')} changed.${
                failed.length > 0
                  ? ` ${plural(failed.length, 'order')} not changed and still selected.`
                  : ''
              }`,
            );
          }}
        />
      ) : null}
      {dialog?.kind === 'courier' ? (
        <BulkCourierDialog
          selection={dialog.selection}
          csrf={csrf}
          keys={keys}
          onClose={closeDialog}
          onFinished={(response) =>
            setAnnouncement(
              `${plural(response.booked, 'parcel')} booked, ${String(response.failed)} not booked, ${String(response.uncertain)} to check.`,
            )
          }
        />
      ) : null}
    </>
  );
}

type TrayState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | { kind: 'ok'; orders: AdminOrderSummary[]; missing: string[] };

/**
 * Selected orders that are not on this page, resolved through the API when the tray is
 * opened (and again when that set changes while it is open).
 */
export function SelectedTray({
  orderNumbers,
  csrf,
}: {
  orderNumbers: readonly string[];
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const selection = useOrderSelection();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<TrayState>({ kind: 'idle' });
  const listId = useId();
  const key = orderNumbers.join(',');

  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    const timer = setTimeout(() => {
      setState({ kind: 'loading' });
      loadSelectedOrdersAction(actionForm(csrf, { orderNumber: key.split(',') })).then(
        (answer) => {
          if (!current) return;
          setState(
            answer.ok
              ? { kind: 'ok', orders: answer.value.orders, missing: answer.value.missing }
              : { kind: 'failed', message: answer.message },
          );
        },
        () => {
          if (current) {
            setState({
              kind: 'failed',
              message: 'These orders could not be loaded. Check your connection and try again.',
            });
          }
        },
      );
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [open, key, csrf]);

  return (
    <div className="grid gap-2 border-t border-hairline pt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-9 w-fit items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ChevronDown
          aria-hidden="true"
          className={`size-4 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
        />
        Selected orders on other pages ({orderNumbers.length})
      </button>
      <div id={listId} hidden={!open} className="max-h-56 overflow-y-auto">
        {state.kind === 'loading' || state.kind === 'idle' ? (
          <p role="status" className="text-sm text-muted-foreground">
            <AutoText>Loading the selected orders…</AutoText>
          </p>
        ) : state.kind === 'failed' ? (
          <p role="alert" className="text-sm text-danger-ink">
            {state.message}
          </p>
        ) : (
          <div className="grid gap-2">
            <ul aria-label={tx('Selected orders on other pages')} className="grid gap-1">
              {state.orders
                .filter((order) => orderNumbers.includes(order.orderNumber))
                .map((order) => (
                  <li
                    key={order.orderNumber}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1 text-sm hover:bg-surface-muted"
                  >
                    <Link
                      href={orderPageHref(order.orderNumber)}
                      className="font-mono text-xs font-semibold text-link underline-offset-4 hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                    <OrderStatusBadge status={order.status} />
                    <span className="text-muted-foreground tabular-nums">
                      {formatMoney(order.totalMinor)}
                    </span>
                    <span className="max-w-40 truncate text-muted-foreground">
                      {order.recipientName}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-8"
                      aria-label={`Remove ${order.orderNumber} from the selection`}
                      onClick={() => selection?.deselectMany([order.orderNumber])}
                    >
                      <AutoText>Remove</AutoText>
                    </Button>
                  </li>
                ))}
            </ul>
            {state.missing.length > 0 ? (
              <div className="grid gap-1 rounded-lg border border-warning-line bg-warning-soft/40 px-3 py-2 text-sm">
                <p className="font-medium text-warning-ink">
                  <CountText count={state.missing.length} one="selected order" /> could not be
                  found, or {state.missing.length === 1 ? 'is' : 'are'} not visible to your account:
                </p>
                <p className="font-mono text-xs text-foreground">
                  <AutoText value={state.missing.join(', ')} />
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() => selection?.deselectMany(state.missing)}
                >
                  Remove {state.missing.length === 1 ? 'it' : 'them'} from the selection
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
