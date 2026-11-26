import type { OrderDetail } from '@nilzora/contracts';
import {
  receiptDateText,
  receiptMoney,
  receiptMoneyEnglish,
  receiptShareText,
  receiptText,
} from '@nilzora/contracts';
import { createHash } from 'node:crypto';
import {
  A4,
  BRAND,
  dhakaStamp,
  drawBrandMark,
  drawFooters,
  PdfDocument,
  wrapText,
  type PdfImageRef,
  type PdfPage,
} from '../exports/pdf';

/*
 * The customer's receipt as a PDF
 * ------------------------------
 * Built from the order the API already read for this customer, so the file holds exactly the
 * amounts, names and totals the order saved. It reuses the report writer in
 * `../exports/pdf` (a dependency-free PDF 1.4 writer with the official Nilzora mark drawn
 * from paths) rather than adding a second document pipeline.
 *
 * Two copies of the same receipt live in this file:
 *
 *   the document   what a customer keeps — their address, the phone on the order, every amount
 *   the text page  the plain-text receipt, so the file is readable by any tool that can read
 *                  a string (and so "copy receipt" and the PDF cannot drift apart)
 *
 * Bengali (recipient, address, product names) is shaped and drawn by the writer with an embedded
 * Noto Sans Bengali subset; Latin text stays Helvetica. Characters neither font covers (other
 * scripts, emoji) are still drawn as "?".
 */

const PAGE_MARGIN = 44;
const CONTENT_WIDTH = A4.width - PAGE_MARGIN * 2;
const FOOTER_LIMIT = A4.height - PAGE_MARGIN - 30;

const STATE_LABELS: Readonly<Record<OrderDetail['status'], string>> = {
  pending: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  processing: 'Being prepared',
  shipped: 'On its way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const PAYMENT_LABELS: Readonly<Record<OrderDetail['paymentStatus'], string>> = {
  pending: 'Pending — pay on delivery',
  collected: 'Paid in cash on delivery',
  cancelled: 'Not charged — the order was cancelled',
};

/** The official logo, as the document embedded it (null: the drawn mark is used instead). */
const LOGOS = new WeakMap<PdfDocument, PdfImageRef>();

/** Every page starts on the same paper with the same header rule. */
function startPage(document: PdfDocument, title: string, subtitle: string): PdfPage {
  const page = document.addPage();
  page.rect(0, 0, A4.width, 6, { fill: BRAND.navy });
  const headerLogo = LOGOS.get(document) ?? null;
  if (headerLogo !== null) {
    // The supplied lockup (mark and wordmark), at its own proportions.
    const height = 22;
    const width = (headerLogo.width / headerLogo.height) * height;
    page.image(headerLogo, PAGE_MARGIN, PAGE_MARGIN - 10, width, height);
  } else {
    // Without the asset, the Nilzora mark beside the name it belongs to.
    const mark = 13;
    drawBrandMark(page, PAGE_MARGIN, PAGE_MARGIN - 4, mark);
    page.text(PAGE_MARGIN + mark + 6, PAGE_MARGIN + 6, 'NILZORA', {
      size: 15,
      font: 'bold',
      color: BRAND.navy,
    });
  }
  page.text(A4.width - PAGE_MARGIN, PAGE_MARGIN + 6, title, {
    size: 9,
    font: 'bold',
    color: BRAND.primary,
    align: 'right',
  });
  page.text(PAGE_MARGIN, PAGE_MARGIN + 22, subtitle, { size: 8.5, color: BRAND.muted });
  page.line(PAGE_MARGIN, PAGE_MARGIN + 30, A4.width - PAGE_MARGIN, PAGE_MARGIN + 30, BRAND.line);
  return page;
}

/** A label on the left and its value on the right, wrapped to the column width. */
function field(page: PdfPage, y: number, label: string, value: string): number {
  page.text(PAGE_MARGIN, y, label, { size: 7.5, color: BRAND.muted, font: 'bold' });
  const lines = wrapText(value, CONTENT_WIDTH - 90, 9, 'regular', 4);
  lines.forEach((line, index) => {
    page.text(PAGE_MARGIN + 90, y + index * 12, line, { size: 9, color: BRAND.slate });
  });
  return y + Math.max(lines.length, 1) * 12 + 4;
}

function heading(page: PdfPage, y: number, text: string): number {
  page.text(PAGE_MARGIN, y, text, { size: 10, font: 'bold', color: BRAND.navy });
  return y + 14;
}

const ITEM_ROW = 44;
const PICTURE = 32;

/**
 * The items: each line's picture (or a plain tile when it has none), its name and variant, the
 * product code, quantity, unit price and amount. A long order continues on the next page with the
 * column labels repeated, so every page can be read on its own.
 */
function itemList(
  document: PdfDocument,
  order: OrderDetail,
  pictures: ReadonlyMap<number, PdfImageRef>,
  first: PdfPage,
  top: number,
): { page: PdfPage; y: number } {
  const right = A4.width - PAGE_MARGIN;
  const columns = { qty: right - 170, unit: right - 80, amount: right };
  const textLeft = PAGE_MARGIN + PICTURE + 10;
  let page = first;

  const header = (y: number) => {
    page.text(textLeft, y, 'ITEM', { size: 7, font: 'bold', color: BRAND.muted });
    page.text(columns.qty, y, 'QTY', { size: 7, font: 'bold', color: BRAND.muted, align: 'right' });
    page.text(columns.unit, y, 'UNIT PRICE', {
      size: 7,
      font: 'bold',
      color: BRAND.muted,
      align: 'right',
    });
    page.text(columns.amount, y, 'AMOUNT', {
      size: 7,
      font: 'bold',
      color: BRAND.muted,
      align: 'right',
    });
    page.line(PAGE_MARGIN, y + 6, right, y + 6, BRAND.line, 0.5);
    return y + 10;
  };

  let y = header(top);
  for (const item of order.items) {
    if (y + ITEM_ROW > FOOTER_LIMIT) {
      page = startPage(document, 'Order receipt', `Order ${order.orderNumber} (continued)`);
      y = header(PAGE_MARGIN + 50);
    }
    const picture = pictures.get(item.orderItemId);
    const pictureTop = y + (ITEM_ROW - PICTURE) / 2;
    if (picture) {
      page.image(picture, PAGE_MARGIN, pictureTop, PICTURE, PICTURE);
      page.roundedRect(PAGE_MARGIN, pictureTop, PICTURE, PICTURE, 3, {
        stroke: BRAND.line,
        lineWidth: 0.4,
      });
    } else {
      page.roundedRect(PAGE_MARGIN, pictureTop, PICTURE, PICTURE, 3, { fill: BRAND.soft });
    }
    const nameWidth = columns.qty - 40 - textLeft;
    const name = wrapText(item.productName, nameWidth, 9, 'bold', 1)[0] ?? item.productName;
    const middle = y + ITEM_ROW / 2;
    page.text(textLeft, middle - 4, name, {
      size: 9,
      font: 'bold',
      color: BRAND.navy,
      maxWidth: nameWidth,
    });
    const detail = [item.variantLabel, `SKU ${item.sku}`]
      .filter((part) => part !== null && part !== '')
      .join(' · ');
    page.text(textLeft, middle + 8, detail, { size: 7.5, color: BRAND.muted, maxWidth: nameWidth });
    page.text(columns.qty, middle + 2, String(item.quantity), {
      size: 9,
      color: BRAND.slate,
      align: 'right',
    });
    page.text(columns.unit, middle + 2, receiptMoneyEnglish(item.unitPriceMinor), {
      size: 9,
      color: BRAND.slate,
      align: 'right',
    });
    page.text(columns.amount, middle + 2, receiptMoneyEnglish(item.lineTotalMinor), {
      size: 9,
      font: 'bold',
      color: BRAND.navy,
      align: 'right',
    });
    y += ITEM_ROW;
    page.line(PAGE_MARGIN, y, right, y, BRAND.line, 0.3);
  }
  return { page, y };
}

/** The amounts block: every figure the order saved, in the order a customer reads them. */
function moneyBlock(page: PdfPage, order: OrderDetail, y: number): number {
  const money = receiptMoney(order);
  const right = A4.width - PAGE_MARGIN;
  const labelX = right - 200;
  const rows: { label: string; value: string; strong?: boolean }[] = [
    { label: 'Subtotal', value: receiptMoneyEnglish(money.subtotalMinor) },
    {
      label: 'Delivery charge',
      value: money.shippingFeeMinor === 0 ? 'Free' : receiptMoneyEnglish(money.shippingFeeMinor),
    },
  ];
  if (money.discountMinor > 0) {
    rows.push({ label: 'Discount', value: `-${receiptMoneyEnglish(money.discountMinor)}` });
  }
  rows.push({ label: 'Total', value: receiptMoneyEnglish(money.totalMinor), strong: true });
  rows.push({ label: 'Paid', value: receiptMoneyEnglish(money.paidMinor) });
  rows.push({
    label: order.paymentStatus === 'collected' ? 'Due' : 'Due on delivery',
    value: receiptMoneyEnglish(money.dueMinor),
    strong: true,
  });

  let cursor = y;
  for (const row of rows) {
    if (row.strong) {
      page.line(labelX, cursor - 8, right, cursor - 8, BRAND.line);
      cursor += 4;
    }
    page.text(labelX, cursor, row.label, {
      size: row.strong ? 10 : 9,
      font: row.strong ? 'bold' : 'regular',
      color: row.strong ? BRAND.navy : BRAND.muted,
    });
    page.text(right, cursor, row.value, {
      size: row.strong ? 10 : 9,
      font: row.strong ? 'bold' : 'regular',
      color: BRAND.navy,
      align: 'right',
    });
    cursor += row.strong ? 18 : 14;
  }
  return cursor;
}

export interface ReceiptPdfInput {
  order: OrderDetail;
  /** The store's published name, shown beside the mark. */
  storeName?: string;
  /** When the file was produced (the footer stamps it). */
  generatedAt?: Date;
  /** The official logo as a JPEG (see receipt-assets.ts); without it the mark is drawn. */
  logo?: Buffer | null;
  /** Each line's picture as a JPEG, by order line id; a missing one shows a plain tile. */
  pictures?: ReadonlyMap<number, Buffer>;
}

/**
 * The finished receipt PDF. The body is the private receipt (address and phone included);
 * the final page is the same text the app and the website copy, marked clearly as the
 * plain-text form of the same document.
 */
export function renderReceiptPdf(input: ReceiptPdfInput): Buffer {
  const { order } = input;
  const generatedAt = input.generatedAt ?? new Date();
  const document = new PdfDocument();
  const logo = input.logo ? document.addJpeg(input.logo) : null;
  if (logo !== null) LOGOS.set(document, logo);
  const pictures = new Map<number, PdfImageRef>();
  for (const [id, jpeg] of input.pictures ?? new Map<number, Buffer>()) {
    const ref = document.addJpeg(jpeg);
    if (ref !== null) pictures.set(id, ref);
  }

  let page = startPage(document, 'Order receipt', `Order ${order.orderNumber}`);
  let y = PAGE_MARGIN + 46;

  // Reference, date and state: what a receipt is checked against.
  y = field(page, y, 'Order number', order.orderNumber);
  y = field(page, y, 'Placed', receiptDateText(order.placedAt));
  y = field(page, y, 'Order status', STATE_LABELS[order.status]);
  y = field(page, y, 'Payment', `Cash on Delivery — ${PAYMENT_LABELS[order.paymentStatus]}`);
  y = field(page, y, 'Delivering to', order.shippingAddress.recipientName);
  y = field(page, y, 'Phone', order.shippingAddress.phone);
  y = field(
    page,
    y,
    'Address',
    [
      order.shippingAddress.addressLine,
      order.shippingAddress.landmark === null ? null : `near ${order.shippingAddress.landmark}`,
      `${order.shippingAddress.area}, ${order.shippingAddress.district}`,
      order.shippingAddress.postalCode,
      `${order.shippingAddress.division} Division`,
    ]
      .filter((part): part is string => part !== null && part !== '')
      .join(', '),
  );
  if (order.customerNote !== null && order.customerNote !== '') {
    y = field(page, y, 'Delivery note', order.customerNote);
  }

  y = heading(page, y + 8, 'Items');
  const table = itemList(document, order, pictures, page, y + 4);
  page = table.page;
  y = table.y + 10;

  if (y > FOOTER_LIMIT - 110) {
    page = startPage(document, 'Order receipt', `Order ${order.orderNumber} (continued)`);
    y = PAGE_MARGIN + 46;
  }
  y = heading(page, y, 'Amounts');
  y = moneyBlock(page, order, y + 2);

  page.text(PAGE_MARGIN, A4.height - PAGE_MARGIN - 18, 'Thank you for shopping with Nilzora.', {
    size: 9,
    font: 'bold',
    color: BRAND.navy,
  });
  page.text(
    PAGE_MARGIN,
    A4.height - PAGE_MARGIN - 6,
    `Keep this for your records. The order also stays in your Nilzora account, where this receipt can be opened again.`,
    { size: 7.5, color: BRAND.muted, maxWidth: CONTENT_WIDTH },
  );

  // The readable form of the same receipt: what "copy receipt" and the share sheet use.
  const textPage = startPage(document, 'Order receipt', `Order ${order.orderNumber} — text copy`);
  let textY = PAGE_MARGIN + 46;
  for (const line of receiptText(order).split('\n')) {
    if (textY > FOOTER_LIMIT) break;
    if (line !== '') {
      textPage.text(PAGE_MARGIN, textY, line, {
        size: 9,
        color: BRAND.slate,
        maxWidth: CONTENT_WIDTH,
      });
    }
    textY += 12;
  }
  const shareY = Math.min(textY + 16, FOOTER_LIMIT - 40);
  textPage.text(PAGE_MARGIN, shareY, 'Shareable summary (no delivery details)', {
    size: 8,
    font: 'bold',
    color: BRAND.muted,
  });
  let shareLineY = shareY + 12;
  for (const line of receiptShareText(order).split('\n').slice(0, 6)) {
    if (shareLineY > FOOTER_LIMIT) break;
    if (line !== '') {
      textPage.text(PAGE_MARGIN, shareLineY, line, {
        size: 8,
        color: BRAND.muted,
        maxWidth: CONTENT_WIDTH,
      });
    }
    shareLineY += 10;
  }

  drawFooters(
    document,
    generatedAt,
    `Order ${order.orderNumber} · ${dhakaStamp(new Date(order.placedAt))}`,
  );

  return document.toBuffer({
    title: `Nilzora receipt ${order.orderNumber}`,
    createdAt: generatedAt,
  });
}

/**
 * A stable fingerprint of what the file says, for the ETag of the download. Two requests for
 * the same unchanged order answer the same tag, so a repeat download can be cached by the
 * browser without ever serving another customer's receipt (the key includes the order).
 */
export function receiptEtag(order: OrderDetail): string {
  const digest = createHash('sha256')
    .update(`${order.orderNumber}|${order.status}|${order.paymentStatus}|${order.totalMinor}`)
    .digest('hex')
    .slice(0, 32);
  return `"receipt-${digest}"`;
}
