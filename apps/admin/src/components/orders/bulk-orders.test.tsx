// @vitest-environment jsdom
import type {
  AdminOrderListResponse,
  AdminOrderSummary,
  BulkCourierCheckResponse,
  Permission,
} from '@nilzora/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bulkBookShipmentsAction,
  bulkChangeStatusAction,
  checkCourierBookingAction,
  loadSelectedOrdersAction,
} from '@/lib/order-bulk-actions';
import { ROLE_PERMISSIONS } from '@/test/fixtures';
import { BULK_ACTION_CLASS } from './bulk-order-bar';
import { SELECTION_CAP_MESSAGE, SELECTION_STORAGE_KEY } from './bulk-logic';
import type * as BulkSharedModule from './bulk-shared';
import { downloadTextFile } from './bulk-shared';
import { orderSummary } from './fixtures';
import { OrdersTable } from './orders-results';

/*
 * The orders list's selection and bulk toolbar, with the Server Actions mocked: selecting
 * never calls anything; each action runs only from its own confirmed step, sends only what
 * the preview showed, and reports the API's answer order by order.
 */

vi.mock('@/lib/order-bulk-actions', () => ({
  loadSelectedOrdersAction: vi.fn(),
  bulkChangeStatusAction: vi.fn(),
  checkCourierBookingAction: vi.fn(),
  bulkBookShipmentsAction: vi.fn(),
}));
vi.mock('./bulk-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof BulkSharedModule>()),
  downloadTextFile: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/orders', redirect: vi.fn() }));
vi.mock('next/form', () => ({
  default: ({ action, ...props }: ComponentProps<'form'> & { action: string }) => (
    <form action={action} method="get" {...props} />
  ),
}));

// jsdom lacks the modal methods of <dialog>; this mirrors what the Dialog relies on.
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

const csrf = { name: 'csrf_token', token: 'signed-test-token' };
const now = new Date('2026-10-25T12:00:00.000Z');

function order(orderNumber: string, overrides: Partial<AdminOrderSummary> = {}): AdminOrderSummary {
  return { ...orderSummary, orderNumber, ...overrides };
}

function list(
  orders: AdminOrderSummary[],
  page = 1,
  total = orders.length,
): AdminOrderListResponse {
  return { orders, page, pageSize: 25, total, totalPages: Math.max(1, Math.ceil(total / 25)) };
}

const PAGE_ONE = [
  order('NZ100001', { status: 'pending' }),
  order('NZ100002', { status: 'confirmed' }),
  order('NZ100003', { status: 'delivered' }),
];

function renderList(
  orders: AdminOrderSummary[] = PAGE_ONE,
  permissions: readonly Permission[] = ROLE_PERMISSIONS.admin,
) {
  return render(
    <OrdersTable data={list(orders)} filters={{}} now={now} bulk={{ permissions, csrf }} />,
  );
}

/** The table's checkbox for an order (the phone list has its own copy). */
function rowBox(orderNumber: string): HTMLInputElement {
  const [box] = screen.getAllByRole('checkbox', { name: `Select order ${orderNumber}` });
  if (!(box instanceof HTMLInputElement)) throw new Error(`no checkbox for ${orderNumber}`);
  return box;
}

function pageBox(): HTMLInputElement {
  const box = screen.getByRole('checkbox', { name: 'Select every order on this page' });
  if (!(box instanceof HTMLInputElement)) throw new Error('no page checkbox');
  return box;
}

function bar() {
  return screen.getByRole('region', { name: 'Bulk actions' });
}

function sentNumbers(mock: { mock: { calls: unknown[][] } }, call = 0): string[] {
  const body = mock.mock.calls[call]?.[0];
  if (!(body instanceof FormData)) throw new Error('no form data sent');
  return body.getAll('orderNumber').map(String);
}

function sentForm(mock: { mock: { calls: unknown[][] } }, call = 0): FormData {
  const body = mock.mock.calls[call]?.[0];
  if (!(body instanceof FormData)) throw new Error('no form data sent');
  return body;
}

function openDialog(name: RegExp | string) {
  return screen.getByRole('dialog', { name });
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.mocked(loadSelectedOrdersAction).mockReset();
  vi.mocked(bulkChangeStatusAction).mockReset();
  vi.mocked(checkCourierBookingAction).mockReset();
  vi.mocked(bulkBookShipmentsAction).mockReset();
  vi.mocked(downloadTextFile).mockReset();
});
afterEach(cleanup);

describe('order selection', () => {
  it('selects a row, highlights it, counts it, and calls nothing', () => {
    renderList();
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull();

    fireEvent.click(rowBox('NZ100001'));
    expect(rowBox('NZ100001').checked).toBe(true);
    // The phone card's checkbox shows the same selection.
    const boxes = screen.getAllByRole('checkbox', { name: 'Select order NZ100001' });
    expect(boxes.every((box) => (box as HTMLInputElement).checked)).toBe(true);
    expect(rowBox('NZ100001').closest('tr')?.className).toContain(
      'has-[[data-order-select]:checked]',
    );
    expect(within(bar()).getByText('1 order selected')).toBeTruthy();
    // Selecting alone never reaches the API.
    expect(loadSelectedOrdersAction).not.toHaveBeenCalled();
    expect(bulkChangeStatusAction).not.toHaveBeenCalled();
    expect(bulkBookShipmentsAction).not.toHaveBeenCalled();
  });

  it('selects the whole page from the header, shows a mixed state, and clears', () => {
    renderList();
    fireEvent.click(rowBox('NZ100002'));
    expect(pageBox().indeterminate).toBe(true);
    expect(pageBox().getAttribute('aria-checked')).toBe('mixed');

    fireEvent.click(within(bar()).getByRole('button', { name: 'Select all 3 on this page' }));
    expect(pageBox().checked).toBe(true);
    expect(pageBox().indeterminate).toBe(false);
    expect(within(bar()).getByText('3 orders selected')).toBeTruthy();

    fireEvent.click(pageBox());
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull();

    fireEvent.click(pageBox());
    fireEvent.click(within(bar()).getByRole('button', { name: 'Clear selection' }));
    expect(rowBox('NZ100001').checked).toBe(false);
    expect(window.sessionStorage.getItem(SELECTION_STORAGE_KEY)).toBeNull();
  });

  it('keeps the selection across pages and resolves the other pages in a tray', async () => {
    const first = renderList();
    fireEvent.click(rowBox('NZ100001'));
    expect(JSON.parse(window.sessionStorage.getItem(SELECTION_STORAGE_KEY) ?? '[]')).toEqual([
      'NZ100001',
    ]);
    first.unmount();

    vi.mocked(loadSelectedOrdersAction).mockResolvedValue({
      ok: true,
      value: { orders: [order('NZ100001', { recipientName: 'Page One Person' })], missing: [] },
    });
    render(
      <OrdersTable
        data={list([order('NZ100026'), order('NZ100027')], 2, 27)}
        filters={{}}
        now={now}
        bulk={{ permissions: ROLE_PERMISSIONS.admin, csrf }}
      />,
    );
    expect(within(bar()).getByText('1 order selected')).toBeTruthy();
    expect(within(bar()).getByText(/0 on this page · 1 on other pages/)).toBeTruthy();
    expect(rowBox('NZ100026').checked).toBe(false);

    fireEvent.click(within(bar()).getByRole('button', { name: /Selected orders on other pages/ }));
    const tray = await screen.findByRole('list', { name: 'Selected orders on other pages' });
    expect(within(tray).getByText('Page One Person')).toBeTruthy();
    expect(sentNumbers(vi.mocked(loadSelectedOrdersAction))).toEqual(['NZ100001']);
    expect(sentForm(vi.mocked(loadSelectedOrdersAction)).get('csrf_token')).toBe(
      'signed-test-token',
    );

    fireEvent.click(within(tray).getByRole('button', { name: /Remove NZ100001/ }));
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull();
  });

  it('lists selected orders the API cannot find and removes them on request', async () => {
    window.sessionStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(['NZ999999']));
    vi.mocked(loadSelectedOrdersAction).mockResolvedValue({
      ok: true,
      value: { orders: [], missing: ['NZ999999'] },
    });
    renderList();
    fireEvent.click(within(bar()).getByRole('button', { name: /Selected orders on other pages/ }));
    expect(await screen.findByText(/1 selected order could not be found/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove it from the selection' }));
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull();
  });

  it('caps the selection at 100 with a clear message', () => {
    const stored = Array.from({ length: 99 }, (_, index) => `NZ2${String(index).padStart(5, '0')}`);
    window.sessionStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(stored));
    renderList();
    fireEvent.click(pageBox());
    expect(within(bar()).getByText('100 orders selected')).toBeTruthy();
    expect(within(bar()).getByRole('alert').textContent).toBe(SELECTION_CAP_MESSAGE);
    expect(rowBox('NZ100001').checked).toBe(true);
    expect(rowBox('NZ100002').checked).toBe(false);
  });
});

describe('bulk action permissions', () => {
  function actions() {
    fireEvent.click(rowBox('NZ100001'));
    return within(screen.getByRole('group', { name: 'Actions for the selected orders' }))
      .queryAllByRole('button')
      .map((button) => button.textContent.trim());
  }

  it('offers every action to an admin', () => {
    renderList(PAGE_ONE, ROLE_PERMISSIONS.admin);
    expect(actions()).toEqual([
      'Change status',
      'Prepare courier booking',
      'Export selected (CSV)',
    ]);
  });

  it('offers no courier booking without shipments.create', () => {
    renderList(PAGE_ONE, ROLE_PERMISSIONS.staff);
    expect(actions()).toEqual(['Change status', 'Export selected (CSV)']);
  });

  it('offers only the export to a read-only account', () => {
    renderList(PAGE_ONE, ['admin_workspace.access', 'orders.read']);
    expect(actions()).toEqual(['Export selected (CSV)']);
  });

  it('offers only cancelling to an account with orders.cancel alone', async () => {
    vi.mocked(loadSelectedOrdersAction).mockResolvedValue({
      ok: true,
      value: { orders: PAGE_ONE, missing: [] },
    });
    renderList(PAGE_ONE, ['admin_workspace.access', 'orders.read', 'orders.cancel']);
    fireEvent.click(rowBox('NZ100001'));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Change status' }));
    const select = await screen.findByLabelText('Change to');
    expect([...(select as HTMLSelectElement).options].map((o) => o.value)).toEqual([
      '',
      'cancelled',
    ]);
  });
});

describe('bulk bar on a phone', () => {
  // jsdom has no layout, so the CSS logic is pinned by class (see BULK_ACTION_CLASS): each
  // action may grow but never shrinks below its label, and the row wraps. That keeps all
  // three labels whole at 320, 360 and 390px; the old `max-sm:flex-1` (flex-basis 0)
  // squeezed "Change status" to 103px at 390px and clipped it.
  it('never lets an action shrink below its label, so no label is clipped', () => {
    renderList(PAGE_ONE, ROLE_PERMISSIONS.admin);
    fireEvent.click(rowBox('NZ100001'));
    const group = screen.getByRole('group', { name: 'Actions for the selected orders' });
    expect(group.className).toContain('flex-wrap');
    const buttons = within(group).getAllByRole('button');
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      for (const token of BULK_ACTION_CLASS.split(' ')) expect(button.className).toContain(token);
      expect(button.className).not.toContain('max-sm:flex-1');
      expect(button.className).toContain('max-sm:min-h-11');
    }
    expect(BULK_ACTION_CLASS).toContain('max-sm:shrink-0');
    expect(BULK_ACTION_CLASS).toContain('max-sm:basis-auto');
  });

  it('uses the solid-on-phone surface so row text cannot show through', () => {
    renderList(PAGE_ONE, ROLE_PERMISSIONS.admin);
    fireEvent.click(rowBox('NZ100001'));
    // .nz-bulk-bar is solid below sm and keeps the glass blur from sm up (globals.css).
    expect(bar().className).toContain('nz-bulk-bar');
    expect(bar().className).toContain('nz-glass');
  });

  it('puts focus back on the button that opened a dialog when Escape closes it', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame'] });
    try {
      renderList();
      fireEvent.click(rowBox('NZ100001'));
      vi.mocked(loadSelectedOrdersAction).mockResolvedValue({
        ok: true,
        value: { orders: PAGE_ONE, missing: [] },
      });
      const trigger = within(bar()).getByRole('button', { name: 'Change status' });
      trigger.focus();
      fireEvent.click(trigger);
      const dialog = openDialog(/Change status of 1 selected order/);
      // A modal dialog moves focus inside itself; make the trigger lose it as it would.
      trigger.blur();
      expect(document.activeElement).not.toBe(trigger);
      // Escape on a native dialog fires `cancel` then closes it, which fires `close`.
      fireEvent(dialog, new Event('cancel', { cancelable: true }));
      (dialog as HTMLDialogElement).close();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('bulk status change', () => {
  async function openStatus(numbers: string[]) {
    for (const number of numbers) fireEvent.click(rowBox(number));
    vi.mocked(loadSelectedOrdersAction).mockResolvedValue({
      ok: true,
      value: { orders: PAGE_ONE, missing: [] },
    });
    fireEvent.click(within(bar()).getByRole('button', { name: 'Change status' }));
    return screen.findByLabelText('Change to');
  }

  it('previews eligibility, confirms the exact count, sends only eligible orders, and reports', async () => {
    renderList();
    const select = await openStatus(['NZ100001', 'NZ100002', 'NZ100003']);
    fireEvent.change(select, { target: { value: 'confirmed' } });

    const dialog = openDialog(/Change status of 3 selected orders/);
    expect(within(dialog).getByText('Will change')).toBeTruthy();
    expect(within(dialog).getByText('Already confirmed')).toBeTruthy();
    expect(within(dialog).getByText('Delivered orders are closed')).toBeTruthy();
    expect(bulkChangeStatusAction).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Review: change 1 order' }));
    const confirm = openDialog('Change 1 order to confirmed?');
    expect(within(confirm).getByRole('list', { name: 'Orders that will change' }).textContent).toBe(
      'NZ100001',
    );
    expect(bulkChangeStatusAction).not.toHaveBeenCalled();

    vi.mocked(bulkChangeStatusAction).mockResolvedValue({
      ok: true,
      value: {
        results: [{ orderNumber: 'NZ100001', ok: true, status: 'confirmed', error: null }],
        succeeded: 1,
        failed: 0,
      },
    });
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Yes, change 1 order' }));
      await Promise.resolve();
    });
    expect(sentNumbers(vi.mocked(bulkChangeStatusAction))).toEqual(['NZ100001']);
    const sent = sentForm(vi.mocked(bulkChangeStatusAction));
    expect(sent.get('status')).toBe('confirmed');
    expect(sent.get('csrf_token')).toBe('signed-test-token');

    const results = await screen.findByRole('list', { name: 'Result for each order' });
    expect(within(results).getByText(/Changed/)).toBeTruthy();
    // The changed order leaves the selection; the two that were not sent stay selected.
    expect(rowBox('NZ100001').checked).toBe(false);
    expect(rowBox('NZ100002').checked).toBe(true);
    expect(rowBox('NZ100003').checked).toBe(true);
    expect(screen.getByText('1 order changed.')).toBeTruthy();
  });

  it('keeps failed orders selected for a retry and shows why each failed', async () => {
    const orders = [
      order('NZ100001', { status: 'pending' }),
      order('NZ100004', { status: 'pending' }),
    ];
    renderList(orders);
    for (const number of ['NZ100001', 'NZ100004']) fireEvent.click(rowBox(number));
    vi.mocked(loadSelectedOrdersAction).mockResolvedValue({
      ok: true,
      value: { orders, missing: [] },
    });
    fireEvent.click(within(bar()).getByRole('button', { name: 'Change status' }));
    fireEvent.change(await screen.findByLabelText('Change to'), { target: { value: 'confirmed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review: change 2 orders' }));

    vi.mocked(bulkChangeStatusAction).mockResolvedValue({
      ok: true,
      value: {
        results: [
          { orderNumber: 'NZ100001', ok: true, status: 'confirmed', error: null },
          {
            orderNumber: 'NZ100004',
            ok: false,
            status: null,
            error: { code: 'invalid_status_transition', message: 'raw api text' },
          },
        ],
        succeeded: 1,
        failed: 1,
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, change 2 orders' }));
      await Promise.resolve();
    });
    const results = await screen.findByRole('list', { name: 'Result for each order' });
    expect(within(results).getByText(/status changed since the preview/)).toBeTruthy();
    expect(rowBox('NZ100001').checked).toBe(false);
    expect(rowBox('NZ100004').checked).toBe(true);
    expect(
      screen.getByText('1 order changed. 1 order not changed and still selected.'),
    ).toBeTruthy();
  });

  it('requires a cancellation reason of at least 5 characters before confirming', async () => {
    renderList();
    const select = await openStatus(['NZ100001', 'NZ100002']);
    fireEvent.change(select, { target: { value: 'cancelled' } });
    const reason = screen.getByLabelText(/Reason for cancelling/);
    expect(reason.hasAttribute('required')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Review: change 2 orders' }));
    expect(screen.getByText('Give a reason of 5 to 300 characters.')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: /to cancelled\?/ })).toBeNull();

    fireEvent.change(reason, { target: { value: 'Duplicate orders' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review: change 2 orders' }));
    const confirm = openDialog('Change 2 orders to cancelled?');
    expect(within(confirm).getByText(/stock returns to inventory/)).toBeTruthy();

    vi.mocked(bulkChangeStatusAction).mockResolvedValue({
      ok: true,
      value: { results: [], succeeded: 0, failed: 0 },
    });
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Yes, change 2 orders' }));
      await Promise.resolve();
    });
    const sent = sentForm(vi.mocked(bulkChangeStatusAction));
    expect(sent.get('status')).toBe('cancelled');
    expect(sent.get('note')).toBe('Duplicate orders');
  });

  it('shows a refusal of the whole request in the confirmation, changing nothing', async () => {
    renderList();
    const select = await openStatus(['NZ100001']);
    fireEvent.change(select, { target: { value: 'confirmed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review: change 1 order' }));
    vi.mocked(bulkChangeStatusAction).mockResolvedValue({
      ok: false,
      message: 'Your account does not have permission to change these orders.',
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, change 1 order' }));
      await Promise.resolve();
    });
    expect(screen.getByRole('alert').textContent).toMatch(/does not have permission/);
    expect(rowBox('NZ100001').checked).toBe(true);
  });
});

describe('export selected', () => {
  it('downloads a formula-safe CSV of the selected orders and reports missing ones', async () => {
    renderList();
    fireEvent.click(rowBox('NZ100001'));
    vi.mocked(loadSelectedOrdersAction).mockResolvedValue({
      ok: true,
      value: {
        orders: [order('NZ100001', { recipientName: '=HYPERLINK("http://evil")' })],
        missing: ['NZ999999'],
      },
    });
    await act(async () => {
      fireEvent.click(within(bar()).getByRole('button', { name: 'Export selected (CSV)' }));
      await Promise.resolve();
    });
    await waitFor(() => expect(downloadTextFile).toHaveBeenCalledTimes(1));
    const [text, fileName] = vi.mocked(downloadTextFile).mock.calls[0] ?? [];
    expect(fileName).toMatch(/^nilzora-selected-orders-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(text).toContain('"\'=HYPERLINK(""http://evil"")"');
    expect(text).not.toContain('8801712345678');
    expect(
      screen.getByText(
        'Exported 1 order to CSV. 1 selected order could not be found and was left out.',
      ),
    ).toBeTruthy();
  });
});

function courierCheck(overrides: Partial<BulkCourierCheckResponse> = {}): BulkCourierCheckResponse {
  const row = (orderNumber: string, bookable: boolean) => ({
    orderNumber,
    bookable,
    blocker: bookable ? null : ('active_shipment' as const),
    orderStatus: 'confirmed',
    codDueMinor: 258_000,
    district: 'Dhaka',
    deliveryZone: 'inside_dhaka' as const,
    shipmentStatus: bookable ? null : ('booked' as const),
  });
  return {
    results: [row('NZ100001', true), row('NZ100002', true), row('NZ100003', false)],
    bookable: 2,
    defaultParcelWeightGrams: 500,
    ...overrides,
  };
}

describe('bulk courier booking', () => {
  async function openCourier(
    availability: unknown,
    check: BulkCourierCheckResponse = courierCheck(),
  ) {
    renderList();
    fireEvent.click(pageBox());
    vi.mocked(checkCourierBookingAction).mockResolvedValue({
      ok: true,
      value: { check, availability } as never,
    });
    fireEvent.click(within(bar()).getByRole('button', { name: 'Prepare courier booking' }));
    return screen.findByRole('table', { name: 'Which selected orders can be booked' });
  }

  const AVAILABLE = {
    available: true,
    mode: 'live',
    couriers: [
      { id: 'steadfast', name: 'Steadfast' },
      { id: 'pathao', name: 'Pathao' },
    ],
  };

  it('shows eligibility, needs a confirmation, and keeps the same keys for a retry', async () => {
    const table = await openCourier(AVAILABLE);
    expect(within(table).getAllByText('Can be booked')).toHaveLength(2);
    expect(within(table).getByText('Already has an active parcel')).toBeTruthy();
    expect(within(table).getAllByText('৳2,580')).toHaveLength(3);
    expect(sentNumbers(vi.mocked(checkCourierBookingAction))).toEqual([
      'NZ100001',
      'NZ100002',
      'NZ100003',
    ]);
    expect(screen.getByLabelText(/Weight per parcel/)).toHaveProperty('value', '0.5');

    fireEvent.click(screen.getByRole('button', { name: 'Book 2 eligible orders with Steadfast' }));
    const confirm = openDialog('Book 2 parcels with Steadfast?');
    expect(within(confirm).getByRole('list', { name: 'Orders to book' }).textContent).toBe(
      'NZ100001NZ100002',
    );
    // Nothing is booked until the confirmation is accepted.
    expect(bulkBookShipmentsAction).not.toHaveBeenCalled();

    vi.mocked(bulkBookShipmentsAction).mockResolvedValueOnce({
      ok: false,
      unconfirmed: true,
      message: 'Nilzora could not confirm the bookings. Send them again.',
    });
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Yes, book 2 parcels' }));
      await Promise.resolve();
    });
    const firstSent = sentForm(vi.mocked(bulkBookShipmentsAction));
    expect(firstSent.get('confirm')).toBe('yes');
    expect(firstSent.get('provider')).toBe('steadfast');
    expect(firstSent.get('weight')).toBe('0.5');
    const firstItems = firstSent.getAll('item').map(String);
    expect(firstItems.map((item) => item.split(':')[0])).toEqual(['NZ100001', 'NZ100002']);
    expect(new Set(firstItems.map((item) => item.split(':')[1])).size).toBe(2);

    vi.mocked(bulkBookShipmentsAction).mockResolvedValueOnce({
      ok: true,
      value: {
        results: [
          {
            orderNumber: 'NZ100001',
            ok: true,
            outcome: 'booked',
            shipmentId: '55555555-5555-4555-8555-555555555555',
            duplicate: true,
            error: null,
          },
          {
            orderNumber: 'NZ100002',
            ok: false,
            outcome: 'uncertain',
            shipmentId: '66666666-6666-4666-8666-666666666666',
            duplicate: false,
            error: null,
          },
        ],
        booked: 1,
        failed: 0,
        uncertain: 1,
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send the same bookings again' }));
      await Promise.resolve();
    });
    // The retry resends exactly the same orders with exactly the same keys.
    expect(sentForm(vi.mocked(bulkBookShipmentsAction), 1).getAll('item').map(String)).toEqual(
      firstItems,
    );

    const results = await screen.findByRole('list', { name: 'Booking result for each order' });
    expect(within(results).getByText('Already booked (no new parcel)')).toBeTruthy();
    expect(within(results).getByText(/check the courier portal/)).toBeTruthy();
    expect(
      within(results)
        .getByRole('link', { name: 'Resolve on the order page for NZ100002' })
        .getAttribute('href'),
    ).toBe('/admin/orders/NZ100002');
    expect(
      within(results)
        .getByRole('link', { name: 'Open shipment for NZ100001' })
        .getAttribute('href'),
    ).toBe('/admin/operations/shipments/55555555-5555-4555-8555-555555555555');
  });

  it('reuses the keys after the dialog is closed and opened again', async () => {
    await openCourier(AVAILABLE);
    fireEvent.click(screen.getByRole('button', { name: 'Book 2 eligible orders with Steadfast' }));
    vi.mocked(bulkBookShipmentsAction).mockResolvedValue({
      ok: false,
      unconfirmed: true,
      message: 'Not confirmed.',
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, book 2 parcels' }));
      await Promise.resolve();
    });
    const first = sentForm(vi.mocked(bulkBookShipmentsAction)).getAll('item').map(String);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(within(bar()).getByRole('button', { name: 'Prepare courier booking' }));
    await screen.findByRole('table', { name: 'Which selected orders can be booked' });
    fireEvent.change(screen.getByLabelText(/Courier/), { target: { value: 'pathao' } });
    fireEvent.click(screen.getByRole('button', { name: 'Book 2 eligible orders with Pathao' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, book 2 parcels' }));
      await Promise.resolve();
    });
    const second = sentForm(vi.mocked(bulkBookShipmentsAction), 1);
    expect(second.get('provider')).toBe('pathao');
    expect(second.getAll('item').map(String)).toEqual(first);
  });

  it('refuses an impossible weight before confirming', async () => {
    await openCourier(AVAILABLE);
    fireEvent.change(screen.getByLabelText(/Weight per parcel/), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: 'Book 2 eligible orders with Steadfast' }));
    expect(screen.getByText(/from 0.001 to 50/)).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: /Book 2 parcels/ })).toBeNull();
  });

  it('offers no booking when the API cannot book, and points to the portal and each order', async () => {
    await openCourier({ available: false, reason: 'off' });
    const dialog = openDialog('Prepare courier booking');
    expect(within(dialog).queryByRole('button', { name: /eligible orders? with/ })).toBeNull();
    expect(within(dialog).getByText('Book these parcels in the courier’s portal')).toBeTruthy();
    expect(within(dialog).getByText(/switched off on this server/)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'NZ100001' }).getAttribute('href')).toBe(
      '/admin/orders/NZ100001',
    );
    // A blocked order is not offered for the portal either.
    expect(within(dialog).queryByRole('link', { name: 'NZ100003' })).toBeNull();
    expect(bulkBookShipmentsAction).not.toHaveBeenCalled();
  });

  it('with couriers off shows each order’s real reason and links only the portal-bookable ones', async () => {
    const row = (
      orderNumber: string,
      blocker: BulkCourierCheckResponse['results'][number]['blocker'],
      orderStatus: string | null,
    ) => ({
      orderNumber,
      bookable: false,
      blocker,
      orderStatus,
      codDueMinor: null,
      district: null,
      deliveryZone: null,
      shipmentStatus: null,
    });
    const table = await openCourier(
      { available: false, reason: 'off' },
      {
        results: [
          row('NZ100001', 'unavailable', 'confirmed'),
          row('NZ100002', 'order_status', 'delivered'),
          row('NZ100003', 'active_shipment', 'shipped'),
          row('NZ100004', 'not_found', null),
          row('NZ100005', 'unavailable', null),
        ],
        bookable: 0,
        defaultParcelWeightGrams: 500,
      },
    );
    expect(
      within(table).getByText('Ready to ship, but not bookable from Nilzora now'),
    ).toBeTruthy();
    expect(within(table).getByText('Not ready to ship (it is delivered)')).toBeTruthy();
    expect(within(table).getByText('Already has an active parcel')).toBeTruthy();
    expect(within(table).getByText('Not found, or not visible to your account')).toBeTruthy();
    // Only a failed check (no order loaded) still says it could not be checked.
    expect(within(table).getAllByText('Could not be checked just now')).toHaveLength(1);
    const dialog = openDialog('Prepare courier booking');
    expect(dialog.textContent).toMatch(/1 order of \d+ can be booked in the courier’s portal/);
    const links = within(dialog)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(links).toEqual(['/admin/orders/NZ100001']);
  });

  it('explains a failed check and lets staff try again', async () => {
    renderList();
    fireEvent.click(rowBox('NZ100001'));
    vi.mocked(checkCourierBookingAction).mockResolvedValueOnce({
      ok: false,
      message: 'Your account does not have the courier permission this needs.',
    });
    fireEvent.click(within(bar()).getByRole('button', { name: 'Prepare courier booking' }));
    expect(await screen.findByText(/courier permission this needs/)).toBeTruthy();
    vi.mocked(checkCourierBookingAction).mockResolvedValueOnce({
      ok: true,
      value: { check: courierCheck(), availability: AVAILABLE } as never,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('table', { name: 'Which selected orders can be booked' }),
    ).toBeTruthy();
  });
});

describe('courier column', () => {
  it('shows the parcel status, courier, test and check-portal flags only when present', () => {
    renderList([
      order('NZ100001', {
        shipment: {
          shipmentId: '44444444-4444-4444-8444-444444444444',
          status: 'in_transit',
          provider: 'steadfast',
          providerName: 'Steadfast',
          trackingCode: 'SF123',
          bookingUncertain: true,
          isMock: true,
        },
      }),
      order('NZ100002'),
    ]);
    const table = screen.getByRole('table', { name: 'Orders' });
    expect(within(table).getByRole('columnheader', { name: 'Courier' })).toBeTruthy();
    expect(within(table).getByText('In transit')).toBeTruthy();
    expect(within(table).getByText('Steadfast')).toBeTruthy();
    expect(within(table).getByText('Test')).toBeTruthy();
    expect(within(table).getByText('Check portal')).toBeTruthy();
    expect(within(table).getByText('Not booked')).toBeTruthy();
  });

  it('leaves the column out when no order on the page has a parcel', () => {
    renderList();
    const table = screen.getByRole('table', { name: 'Orders' });
    expect(within(table).queryByRole('columnheader', { name: 'Courier' })).toBeNull();
  });

  it('renders a read-only list (no checkboxes) without bulk props', () => {
    render(<OrdersTable data={list(PAGE_ONE)} filters={{}} now={now} />);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});
