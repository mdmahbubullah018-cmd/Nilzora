import { SHIPMENT_STATUS_LABELS, type AdminOrderSummary } from '@nilzora/contracts';
import { ORDER_STATUS, PAYMENT_STATUS } from '@/components/admin-kit/status-badge';
import { DELIVERY_ZONE_LABEL } from './order-query';

/*
 * "Export selected": the selected orders as a CSV file, built in the browser from the
 * rows the API returned for them (POST /admin/orders/bulk/summaries, orders.read).
 *
 * Personal data follows the orders report's own choice (see the contracts' admin-exports):
 * the recipient's name and the delivery zone, never a phone number or a street address.
 *
 * Every cell is quoted, and a cell that a spreadsheet would read as a formula (starting
 * with = + - @, a tab or a carriage return) is prefixed with an apostrophe, so an order
 * field can never run as a formula when the file is opened.
 */

export const SELECTED_ORDERS_COLUMNS = [
  'Order',
  'Placed (Bangladesh time)',
  'Status',
  'Payment',
  'Items',
  'Total (BDT)',
  'Delivery zone',
  'Recipient',
  'Courier',
  'Courier status',
] as const;

const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell: formula-safe, quoted, with inner quotes doubled. */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Poisha as plain taka for a spreadsheet ("2580.00"): no symbol, no grouping. */
export function takaText(minor: number): string {
  if (!Number.isSafeInteger(minor)) return '';
  const sign = minor < 0 ? '-' : '';
  const absolute = Math.abs(minor);
  return `${sign}${String(Math.trunc(absolute / 100))}.${String(absolute % 100).padStart(2, '0')}`;
}

const placedFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dhaka',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "2026-10-24 14:00" on the Bangladesh clock. */
export function placedText(isoDateTime: string): string {
  const value = new Date(isoDateTime);
  if (Number.isNaN(value.getTime())) return '';
  const parts = Object.fromEntries(
    placedFormat.formatToParts(value).map((part) => [part.type, part.value]),
  );
  return `${parts.year ?? ''}-${parts.month ?? ''}-${parts.day ?? ''} ${parts.hour ?? ''}:${parts.minute ?? ''}`;
}

/** The selected orders as CSV text (CRLF line ends, as spreadsheets expect). */
export function selectedOrdersCsv(orders: readonly AdminOrderSummary[]): string {
  const lines = [SELECTED_ORDERS_COLUMNS.map(csvCell).join(',')];
  for (const order of orders) {
    lines.push(
      [
        order.orderNumber,
        placedText(order.placedAt),
        ORDER_STATUS[order.status].label,
        PAYMENT_STATUS[order.paymentStatus].label,
        order.itemCount,
        takaText(order.totalMinor),
        DELIVERY_ZONE_LABEL[order.deliveryZone],
        order.recipientName,
        order.shipment ? order.shipment.providerName || order.shipment.provider : '',
        order.shipment
          ? `${SHIPMENT_STATUS_LABELS[order.shipment.status]}${order.shipment.isMock ? ' (test)' : ''}`
          : '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** "nilzora-selected-orders-2026-10-25.csv" (the Bangladesh calendar day). */
export function selectedOrdersFileName(now: Date): string {
  const day = placedText(now.toISOString()).slice(0, 10) || 'export';
  return `nilzora-selected-orders-${day}.csv`;
}
