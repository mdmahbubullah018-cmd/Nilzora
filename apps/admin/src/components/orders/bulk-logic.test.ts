import type {
  BulkCourierCheckResult,
  BulkShipmentBookingResult,
  CourierConfigResponse,
} from '@nilzora/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  csvCell,
  placedText,
  SELECTED_ORDERS_COLUMNS,
  selectedOrdersCsv,
  selectedOrdersFileName,
  takaText,
} from './bulk-export';
import {
  addToSelection,
  allowedBulkTargets,
  bookableOrders,
  bookingOutcomeOf,
  BULK_ORDER_LIMIT,
  bulkErrorText,
  classifyStatusChange,
  cleanOrderNumbers,
  courierBlockerText,
  courierBookingAvailability,
  ensureBookingKeys,
  newBookingKey,
  portalBookableOrders,
  readStoredSelection,
  SELECTION_STORAGE_KEY,
  writeStoredSelection,
} from './bulk-logic';
import { orderSummary } from './fixtures';

const numbers = (count: number, start = 100_000) =>
  Array.from({ length: count }, (_, index) => `NZ${String(start + index)}`);

describe('selection rules', () => {
  it('adds without repeats, in order, and refuses past the limit of 100', () => {
    expect(addToSelection(['NZ100001'], ['NZ100002', 'NZ100001'])).toEqual({
      next: ['NZ100001', 'NZ100002'],
      refused: 0,
    });
    const full = numbers(99);
    const { next, refused } = addToSelection(full, ['NZ200000', 'NZ200001', 'NZ200002']);
    expect(next).toHaveLength(BULK_ORDER_LIMIT);
    expect(next.at(-1)).toBe('NZ200000');
    expect(refused).toBe(2);
  });

  it('keeps only real order numbers from storage, capped, and survives broken storage', () => {
    const storage = new Map<string, string>();
    const store = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    };
    storage.set(SELECTION_STORAGE_KEY, JSON.stringify(['NZ100001', 'bad', 7, 'NZ100001']));
    expect(readStoredSelection(store)).toEqual(['NZ100001']);
    storage.set(SELECTION_STORAGE_KEY, JSON.stringify(numbers(150)));
    expect(readStoredSelection(store)).toHaveLength(BULK_ORDER_LIMIT);
    storage.set(SELECTION_STORAGE_KEY, '{not json');
    expect(readStoredSelection(store)).toEqual([]);
    expect(readStoredSelection(null)).toEqual([]);

    writeStoredSelection(store, ['NZ100009']);
    expect(storage.get(SELECTION_STORAGE_KEY)).toBe('["NZ100009"]');
    writeStoredSelection(store, []);
    expect(storage.has(SELECTION_STORAGE_KEY)).toBe(false);
    // A storage that throws (private mode, quota) is ignored, not fatal.
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    };
    expect(readStoredSelection(throwing)).toEqual([]);
    expect(() => writeStoredSelection(throwing, ['NZ100001'])).not.toThrow();
  });

  it('cleans order numbers sent by a form', () => {
    expect(cleanOrderNumbers([' NZ100001 ', 'NZ100001', 'x', null, 'NZ12'])).toEqual(['NZ100001']);
  });
});

describe('bulk status preview', () => {
  const orders = [
    { orderNumber: 'NZ100001', status: 'pending' as const },
    { orderNumber: 'NZ100002', status: 'confirmed' as const },
    { orderNumber: 'NZ100003', status: 'shipped' as const },
    { orderNumber: 'NZ100004', status: 'delivered' as const },
  ];
  const selection = [...orders.map((order) => order.orderNumber), 'NZ100099'];

  it('marks each order eligible only for a transition ORDER_TRANSITIONS allows, with a reason', () => {
    const rows = classifyStatusChange(selection, orders, 'confirmed');
    expect(rows.map((row) => [row.orderNumber, row.eligible, row.reason])).toEqual([
      ['NZ100001', true, null],
      ['NZ100002', false, 'Already confirmed'],
      ['NZ100003', false, 'Shipped orders move to delivered next'],
      ['NZ100004', false, 'Delivered orders are closed'],
      ['NZ100099', false, 'Not found, or not visible to your account'],
    ]);
  });

  it('never offers to cancel a shipped order or to skip a step', () => {
    const cancel = classifyStatusChange(selection, orders, 'cancelled');
    expect(cancel.filter((row) => row.eligible).map((row) => row.orderNumber)).toEqual([
      'NZ100001',
      'NZ100002',
    ]);
    expect(cancel[2]?.reason).toBe('A shipped order can no longer be cancelled');
    const ship = classifyStatusChange(['NZ100001'], orders, 'shipped');
    expect(ship[0]).toMatchObject({
      eligible: false,
      reason: 'Pending orders move to confirmed next',
    });
  });

  it('offers steps with orders.update_status and cancelling only with orders.cancel', () => {
    expect(allowedBulkTargets(['orders.read'])).toEqual([]);
    expect(allowedBulkTargets(['orders.read', 'orders.update_status'])).toEqual([
      'confirmed',
      'processing',
      'shipped',
      'delivered',
    ]);
    expect(allowedBulkTargets(['orders.cancel'])).toEqual(['cancelled']);
  });

  it('uses fixed words for known refusals and the API message otherwise', () => {
    expect(bulkErrorText({ code: 'invalid_status_transition', message: 'raw' })).toMatch(
      /status changed since the preview/,
    );
    expect(bulkErrorText({ code: 'stock_conflict', message: 'Stock is held by a return.' })).toBe(
      'Stock is held by a return.',
    );
    expect(bulkErrorText(null)).toBe('The change was not made.');
  });
});

function config(overrides: Partial<CourierConfigResponse>): CourierConfigResponse {
  const provider = (id: string, ready: boolean) =>
    ({
      provider: id,
      displayName: id === 'steadfast' ? 'Steadfast' : 'Pathao',
      isEnabled: ready,
      capabilities: { book: 'available' },
      readiness: { ready },
    }) as unknown as CourierConfigResponse['providers'][number];
  return {
    mode: 'live',
    bookingEnabled: true,
    providers: [provider('steadfast', true), provider('pathao', false)],
    ...overrides,
  } as CourierConfigResponse;
}

describe('courier booking availability', () => {
  it('is unavailable when couriers are off, unreadable, or live without a ready courier', () => {
    expect(courierBookingAvailability(null)).toEqual({
      available: false,
      reason: 'config_unavailable',
    });
    expect(courierBookingAvailability(config({ mode: 'off' }))).toEqual({
      available: false,
      reason: 'off',
    });
    expect(courierBookingAvailability(config({ bookingEnabled: false }))).toEqual({
      available: false,
      reason: 'live_not_ready',
    });
    const none = config({});
    none.providers = none.providers.map((p) => ({
      ...p,
      readiness: { ...p.readiness, ready: false },
    }));
    expect(courierBookingAvailability(none).available).toBe(false);
  });

  it('offers only ready couriers in live mode, and every courier in test mode', () => {
    expect(courierBookingAvailability(config({}))).toEqual({
      available: true,
      mode: 'live',
      couriers: [{ id: 'steadfast', name: 'Steadfast' }],
    });
    const mock = courierBookingAvailability(config({ mode: 'mock', bookingEnabled: false }));
    expect(mock.available && mock.couriers.map((c) => c.id)).toEqual(['steadfast', 'pathao']);
  });

  it('books at most 50 at a time', () => {
    const results = numbers(55).map((orderNumber) => ({
      orderNumber,
      bookable: true,
      blocker: null,
      orderStatus: 'confirmed',
      codDueMinor: 1000,
      district: 'Dhaka',
      deliveryZone: 'inside_dhaka' as const,
      shipmentStatus: null,
    }));
    const { orderNumbers, overLimit } = bookableOrders({
      results,
      bookable: 55,
      defaultParcelWeightGrams: 500,
    });
    expect(orderNumbers).toHaveLength(50);
    expect(overLimit).toBe(5);
  });

  it('keeps one booking key per order across retries and adds keys only for new orders', () => {
    const make = vi.fn(() => newBookingKey());
    const first = ensureBookingKeys({}, ['NZ100001', 'NZ100002'], make);
    const again = ensureBookingKeys(first, ['NZ100001', 'NZ100002', 'NZ100003'], make);
    expect(again.NZ100001).toBe(first.NZ100001);
    expect(again.NZ100002).toBe(first.NZ100002);
    expect(make).toHaveBeenCalledTimes(3);
    expect(new Set(Object.values(again)).size).toBe(3);
    expect(newBookingKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('names each booking outcome, including duplicates and unclear answers', () => {
    const row = (over: Partial<BulkShipmentBookingResult>): BulkShipmentBookingResult => ({
      orderNumber: 'NZ100001',
      ok: true,
      outcome: 'booked',
      shipmentId: null,
      duplicate: false,
      error: null,
      ...over,
    });
    expect(bookingOutcomeOf(row({}))).toBe('booked');
    expect(bookingOutcomeOf(row({ duplicate: true }))).toBe('duplicate');
    expect(bookingOutcomeOf(row({ ok: false, outcome: 'uncertain' }))).toBe('uncertain');
    expect(bookingOutcomeOf(row({ ok: false, outcome: 'in_progress' }))).toBe('in_progress');
    expect(bookingOutcomeOf(row({ ok: false, outcome: 'failed' }))).toBe('failed');
    expect(bookingOutcomeOf(row({ ok: false, outcome: null }))).toBe('failed');
  });
});

describe('selected orders CSV', () => {
  it('quotes every cell and doubles inner quotes', () => {
    expect(csvCell('Rahim "Bhai", Dhaka')).toBe('"Rahim ""Bhai"", Dhaka"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(3)).toBe('"3"');
  });

  it.each(['=HYPERLINK("http://x")', '+8801712345678', '-2+3', '@SUM(A1)', '\tcmd', '\rx'])(
    'neutralises a cell a spreadsheet would run as a formula: %j',
    (value) => {
      expect(csvCell(value).startsWith(`"'`)).toBe(true);
    },
  );

  it('writes taka without symbols and dates on the Bangladesh clock', () => {
    expect(takaText(258_000)).toBe('2580.00');
    expect(takaText(5)).toBe('0.05');
    expect(placedText('2026-10-24T20:30:00.000Z')).toBe('2026-10-25 02:30');
    expect(selectedOrdersFileName(new Date('2026-10-24T20:30:00.000Z'))).toBe(
      'nilzora-selected-orders-2026-10-25.csv',
    );
  });

  it('lists the chosen columns, never the phone number', () => {
    const csv = selectedOrdersCsv([
      {
        ...orderSummary,
        recipientName: '=cmd|/C calc',
        shipment: {
          shipmentId: '44444444-4444-4444-8444-444444444444',
          status: 'in_transit',
          provider: 'steadfast',
          providerName: 'Steadfast',
          trackingCode: null,
          bookingUncertain: false,
          isMock: true,
        },
      },
    ]);
    const [header, line] = csv.split('\r\n');
    expect(header).toBe(SELECTED_ORDERS_COLUMNS.map((name) => `"${name}"`).join(','));
    expect(line).toBe(
      '"NZ100042","2026-10-24 14:00","Pending","Cash pending","2","2580.00","Inside Dhaka","\'=cmd|/C calc","Steadfast","In transit (test)"',
    );
    expect(csv).not.toContain('8801712345678');
    expect(csv).not.toContain('01712');
  });
});

describe('courier check with couriers unavailable', () => {
  const row = (
    orderNumber: string,
    blocker: BulkCourierCheckResult['blocker'],
    orderStatus: string | null,
  ): BulkCourierCheckResult => ({
    orderNumber,
    bookable: false,
    blocker,
    orderStatus,
    codDueMinor: null,
    district: null,
    deliveryZone: null,
    shipmentStatus: null,
  });

  it('links every order the portal could take, and no order that is blocked for real', () => {
    const results = [
      row('NZ1', 'unavailable', 'confirmed'),
      row('NZ2', 'order_status', 'delivered'),
      row('NZ3', 'active_shipment', 'shipped'),
      row('NZ4', 'not_found', null),
      row('NZ5', 'forbidden', null),
      row('NZ6', 'unavailable', null),
      { ...row('NZ7', null, 'confirmed'), bookable: true },
    ];
    expect(portalBookableOrders({ results })).toEqual(['NZ1', 'NZ7']);
  });

  it('names the real reason, and the courier connection only for an order that is fine', () => {
    expect(courierBlockerText(row('NZ1', 'order_status', 'delivered'), true)).toBe(
      'Not ready to ship (it is delivered)',
    );
    expect(courierBlockerText(row('NZ3', 'active_shipment', 'shipped'), true)).toBe(
      'Already has an active parcel',
    );
    expect(courierBlockerText(row('NZ1', 'unavailable', 'confirmed'), true)).toBe(
      'Ready to ship, but not bookable from Nilzora now',
    );
    expect(courierBlockerText(row('NZ6', 'unavailable', null), true)).toBe(
      'Could not be checked just now',
    );
    expect(courierBlockerText(row('NZ1', 'unavailable', 'confirmed'))).toBe(
      'Could not be checked just now',
    );
  });
});
