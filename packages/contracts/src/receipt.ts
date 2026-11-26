import type { OrderDetail } from './orders';

/*
 * The receipt
 * -----------
 * What a receipt says, written once so the website, the Android app and the PDF the API
 * generates cannot disagree. Every value comes from the order the customer placed: the names,
 * variants, unit prices and totals the order saved, never today's catalogue and never the
 * profile's current address.
 *
 * Two audiences are kept apart on purpose:
 *
 *   receiptText()       the customer's own copy — the delivery address, the phone number on
 *                       the order, and every amount.
 *   receiptShareText()  what a customer may send to someone else — the products, the reference
 *                       and the amounts, and none of their own contact details.
 *
 * A receipt's shareable form never contains an email address, a phone number or a full
 * address, so forwarding it cannot leak where the customer lives.
 */

export interface ReceiptLine {
  orderItemId: number;
  /** "2 × Cotton Panjabi · Size: M / Colour: Navy" */
  title: string;
  /** The product code the order saved; a real identifier, never a claim to be a barcode. */
  sku: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

export interface ReceiptMoney {
  /** Everything the lines add up to, before any discount. */
  subtotalMinor: number;
  discountMinor: number;
  shippingFeeMinor: number;
  totalMinor: number;
  /** What the customer has actually paid: only a collected Cash-on-Delivery order. */
  paidMinor: number;
  /** What is still owed on delivery. */
  dueMinor: number;
}

/** One product line, in the words and amounts the order saved. */
export function receiptLine(
  item: OrderDetail['items'][number],
  quantityPrefix = true,
): ReceiptLine {
  const name =
    item.variantLabel === null || item.variantLabel === ''
      ? item.productName
      : `${item.productName} · ${item.variantLabel}`;
  return {
    orderItemId: item.orderItemId,
    title: quantityPrefix ? `${String(item.quantity)} × ${name}` : name,
    sku: item.sku,
    quantity: item.quantity,
    unitPriceMinor: item.unitPriceMinor,
    lineTotalMinor: item.lineTotalMinor,
  };
}

export function receiptLines(order: OrderDetail): ReceiptLine[] {
  return order.items.map((item) => receiptLine(item));
}

/**
 * What has been paid and what is still due. Derived from the order's own payment state, not
 * from a client's idea of it: a cancelled order owes nothing, and only a collected payment
 * counts as paid.
 */
export function receiptMoney(order: OrderDetail): ReceiptMoney {
  const paidMinor = order.paymentStatus === 'collected' ? order.totalMinor : 0;
  const dueMinor = order.paymentStatus === 'cancelled' ? 0 : order.totalMinor - paidMinor;
  return {
    subtotalMinor: order.subtotalMinor,
    discountMinor: order.discountMinor,
    shippingFeeMinor: order.shippingFeeMinor,
    totalMinor: order.totalMinor,
    paidMinor,
    dueMinor,
  };
}

/**
 * The same amount in English only: "BDT 1,25,000.50". Used wherever the receipt leaves the
 * screen — the copied text, the shared text and the PDF — so every document is plain English
 * and prints correctly in fonts that carry no Bengali glyphs (the PDF writer is Latin-only).
 * On-screen amounts use each app's own currency formatter, which shows the taka sign.
 */
export function receiptMoneyEnglish(minor: number): string {
  if (!Number.isSafeInteger(minor)) return '';
  return `${minor < 0 ? '-' : ''}BDT ${takaText(minor)}`;
}

/** The absolute amount in taka with poisha, grouped the Bangladeshi way. */
function takaText(minor: number): string {
  const absolute = Math.abs(minor);
  const taka = String(Math.floor(absolute / 100));
  const poisha = absolute % 100;
  const grouped =
    taka.length <= 3
      ? taka
      : `${taka.slice(0, -3).replace(/\B(?=(\d{2})+$)/g, ',')},${taka.slice(-3)}`;
  return poisha === 0 ? grouped : `${grouped}.${String(poisha).padStart(2, '0')}`;
}

const PAYMENT_METHOD = 'Cash on Delivery';

const PAYMENT_STATE: Readonly<Record<OrderDetail['paymentStatus'], string>> = {
  pending: 'Pending — pay on delivery',
  collected: 'Paid in cash on delivery',
  cancelled: 'Not charged — the order was cancelled',
};

const ORDER_STATE: Readonly<Record<OrderDetail['status'], string>> = {
  pending: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  processing: 'Being prepared',
  shipped: 'On its way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/**
 * The order's date and time (Asia/Dhaka, the store's own calendar), written out in full:
 * "7 November 2026, 16:05". Built without Intl so every platform prints it the same way.
 */
export function receiptDateText(iso: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return '';
  const dhaka = new Date(instant.getTime() + 6 * 60 * 60 * 1000);
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const day = dhaka.getUTCDate();
  const month = months[dhaka.getUTCMonth()] ?? '';
  const hour = String(dhaka.getUTCHours()).padStart(2, '0');
  const minute = String(dhaka.getUTCMinutes()).padStart(2, '0');
  return `${String(day)} ${month} ${String(dhaka.getUTCFullYear())}, ${hour}:${minute}`;
}

/** The file name a saved receipt gets: stable, readable and safe on every platform. */
export function receiptFileName(orderNumber: string): string {
  return `Nilzora-Receipt-${orderNumber}.pdf`;
}

/*
 * The amount lines of the text receipt, in English only: these characters are copied,
 * pasted and printed outside the app, so they carry no currency glyph the plain-text reader
 * or the Latin-only PDF writer could not show.
 */
function moneyLines(order: OrderDetail, indent = ''): string[] {
  const money = receiptMoney(order);
  const lines = [
    `${indent}Subtotal: ${receiptMoneyEnglish(money.subtotalMinor)}`,
    `${indent}Delivery charge: ${
      money.shippingFeeMinor === 0 ? 'Free' : receiptMoneyEnglish(money.shippingFeeMinor)
    }`,
  ];
  if (money.discountMinor > 0) {
    lines.push(`${indent}Discount: -${receiptMoneyEnglish(money.discountMinor)}`);
  }
  lines.push(
    `${indent}Total: ${receiptMoneyEnglish(money.totalMinor)}`,
    `${indent}Paid: ${receiptMoneyEnglish(money.paidMinor)}`,
    `${indent}Due ${order.paymentStatus === 'collected' ? '' : 'on delivery'}: ${receiptMoneyEnglish(money.dueMinor)}`.replace(
      '  ',
      ' ',
    ),
  );
  return lines;
}

/**
 * The customer's own receipt as plain text: what "Copy receipt" puts on the clipboard and what
 * the platform share sheet starts from. Line breaks separate the blocks a reader expects.
 */
export function receiptText(order: OrderDetail): string {
  const lines: string[] = [
    'Nilzora',
    `Order receipt — ${order.orderNumber}`,
    `Placed ${receiptDateText(order.placedAt)}`,
    '',
    `Order status: ${ORDER_STATE[order.status]}`,
    `Payment method: ${PAYMENT_METHOD}`,
    `Payment status: ${PAYMENT_STATE[order.paymentStatus]}`,
    '',
    'Items',
  ];
  for (const line of receiptLines(order)) {
    lines.push(
      line.title,
      `  ${line.sku} · ${receiptMoneyEnglish(line.unitPriceMinor)} each · ${receiptMoneyEnglish(line.lineTotalMinor)}`,
    );
  }
  lines.push('', 'Amounts', ...moneyLines(order));
  const address = order.shippingAddress;
  lines.push(
    '',
    'Delivering to',
    `${address.recipientName}, ${address.phone}`,
    `${address.addressLine}${address.landmark === null ? '' : ` (near ${address.landmark})`}`,
    `${address.area}, ${address.district} ${address.postalCode ?? ''}, ${address.division}`.trim(),
  );
  if (order.customerNote !== null && order.customerNote !== '') {
    lines.push('', `Note for delivery: ${order.customerNote}`);
  }
  lines.push('', 'Thank you for shopping with Nilzora.');
  return lines.join('\n');
}

/**
 * The receipt as it may be shared with someone else: the reference, the date, the products and
 * the amounts — and none of the customer's own contact details or delivery address.
 */
export function receiptShareText(order: OrderDetail): string {
  const lines: string[] = [
    'Nilzora',
    `Order receipt — ${order.orderNumber}`,
    `Placed ${receiptDateText(order.placedAt)}`,
    '',
    'Items',
  ];
  for (const line of receiptLines(order)) {
    lines.push(
      line.title,
      `  ${line.sku} · ${receiptMoneyEnglish(line.unitPriceMinor)} each · ${receiptMoneyEnglish(line.lineTotalMinor)}`,
    );
  }
  lines.push(
    '',
    'Amounts',
    ...moneyLines(order),
    '',
    `Payment method: ${PAYMENT_METHOD} · ${PAYMENT_STATE[order.paymentStatus]}`,
    '',
    'Shared from a Nilzora receipt. The original stays in the Nilzora account that placed the order.',
  );
  return lines.join('\n');
}
