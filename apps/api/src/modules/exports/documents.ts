import { z } from 'zod';
import { displayValue } from './format';
import {
  BRAND,
  drawBrand,
  drawFooters,
  drawTable,
  MARGIN,
  PdfDocument,
  wrapText,
  type PdfPage,
  type PdfTableColumn,
} from './pdf';

/*
 * Order documents: the invoice (with prices) and the packing slip (without). They are the
 * one place a delivery address and phone number belong, because the parcel needs them.
 * Bengali names and addresses are shaped and drawn with an embedded Noto Sans Bengali subset;
 * characters neither Helvetica nor that font covers show as "?" — see pdf.ts.
 */

export const ORDER_DOCUMENT_KINDS = ['invoice', 'packing_slip'] as const;
export type OrderDocumentKind = (typeof ORDER_DOCUMENT_KINDS)[number];

const text = z.string().nullable();
const money = z.number().int();

/** What admin_order_document returns. */
export const orderDocumentSchema = z.object({
  store: z.object({
    name: z.string(),
    addressLine: text,
    addressArea: text,
    addressDistrict: text,
    phone: text,
    email: text,
  }),
  order: z.object({
    orderNumber: z.string(),
    placedAt: z.string(),
    status: z.string(),
    paymentMethod: z.string(),
    paymentStatus: z.string(),
    itemCount: z.number().int(),
    subtotalMinor: money,
    discountMinor: money,
    shippingFeeMinor: money,
    totalMinor: money,
    customerNote: text,
  }),
  delivery: z.object({
    recipientName: z.string(),
    phone: z.string(),
    addressLine: z.string(),
    area: z.string(),
    district: z.string(),
    division: z.string(),
    postalCode: text,
    landmark: text,
    zone: z.string(),
  }),
  items: z.array(
    z.object({
      name: z.string(),
      variantLabel: text,
      sku: z.string(),
      quantity: z.number().int(),
      unitPriceMinor: money,
      lineTotalMinor: money,
    }),
  ),
});

export type OrderDocument = z.infer<typeof orderDocumentSchema>;

const ZONES: Readonly<Record<string, string>> = {
  inside_dhaka: 'Inside Dhaka',
  outside_dhaka: 'Outside Dhaka',
};

const PAYMENT: Readonly<Record<string, string>> = {
  pending: 'Cash on delivery (to collect)',
  collected: 'Cash on delivery (collected)',
  cancelled: 'Cash on delivery (cancelled)',
};

const title = (kind: OrderDocumentKind) => (kind === 'invoice' ? 'Invoice' : 'Packing slip');
const tk = (minor: number) => displayValue('money', minor);
const words = (value: string) =>
  value.replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());

/** "invoice-NZ100123.pdf": the order number is validated (NZ + digits) by the route. */
export function documentFileName(kind: OrderDocumentKind, orderNumber: string): string {
  const safe = orderNumber.replace(/[^A-Za-z0-9-]/g, '');
  return `${kind === 'invoice' ? 'invoice' : 'packing-slip'}-${safe}.pdf`;
}

function drawLines(
  page: PdfPage,
  x: number,
  y: number,
  lines: readonly (string | null | undefined)[],
  width: number,
): number {
  let at = y;
  for (const line of lines) {
    if (!line) continue;
    for (const part of wrapText(line, width, 9, 'regular', 2)) {
      page.text(x, at, part, { size: 9, color: BRAND.slate });
      at += 12;
    }
  }
  return at;
}

function label(page: PdfPage, x: number, y: number, value: string): void {
  page.text(x, y, value.toUpperCase(), { size: 7.5, font: 'bold', color: BRAND.muted });
}

export function renderOrderDocument(
  data: OrderDocument,
  kind: OrderDocumentKind,
  generatedAt: Date,
): Buffer {
  const document = new PdfDocument();
  const name = title(kind);

  const header = (page: PdfPage, compact: boolean): number => {
    drawBrand(page, MARGIN, MARGIN - 4, compact ? 22 : 26);
    page.text(page.width - MARGIN, MARGIN + (compact ? 10 : 14), name, {
      size: compact ? 12 : 20,
      font: 'bold',
      color: BRAND.navy,
      align: 'right',
    });
    page.text(
      page.width - MARGIN,
      MARGIN + (compact ? 23 : 30),
      `Order ${data.order.orderNumber}`,
      {
        size: 9.5,
        color: BRAND.slate,
        align: 'right',
      },
    );
    page.line(MARGIN, MARGIN + 38, page.width - MARGIN, MARGIN + 38, BRAND.line);
    return MARGIN + 52;
  };

  const page = document.addPage();
  let top = header(page, false);
  const half = (page.width - MARGIN * 2) / 2;
  const right = MARGIN + half + 12;

  label(page, MARGIN, top, 'From');
  page.text(MARGIN, top + 14, data.store.name, {
    size: 10.5,
    font: 'bold',
    color: BRAND.navy,
    maxWidth: half - 12,
  });
  const storeEnd = drawLines(
    page,
    MARGIN,
    top + 27,
    [
      data.store.addressLine,
      [data.store.addressArea, data.store.addressDistrict].filter(Boolean).join(', '),
      data.store.phone ? `Phone: ${data.store.phone}` : null,
      data.store.email ? `Email: ${data.store.email}` : null,
    ],
    half - 12,
  );

  label(page, right, top, 'Order');
  const details: [string, string][] = [
    ['Order number', data.order.orderNumber],
    ['Placed', displayValue('datetime', data.order.placedAt)],
    ['Status', words(data.order.status)],
    ['Items', String(data.order.itemCount)],
  ];
  if (kind === 'invoice') {
    details.push([
      'Payment',
      data.order.paymentMethod === 'cod'
        ? (PAYMENT[data.order.paymentStatus] ?? `Cash on delivery (${data.order.paymentStatus})`)
        : `${data.order.paymentMethod} (${data.order.paymentStatus})`,
    ]);
  }
  let detailY = top + 14;
  for (const [key, value] of details) {
    page.text(right, detailY, key, { size: 9, color: BRAND.muted });
    page.text(right + 78, detailY, value, {
      size: 9,
      font: 'bold',
      color: BRAND.navy,
      maxWidth: page.width - MARGIN - right - 78,
    });
    detailY += 13;
  }

  top = Math.max(storeEnd, detailY) + 12;
  page.line(MARGIN, top, page.width - MARGIN, top, BRAND.line);
  top += 14;
  label(page, MARGIN, top, 'Deliver to');
  page.text(MARGIN, top + 14, data.delivery.recipientName, {
    size: 10.5,
    font: 'bold',
    color: BRAND.navy,
    maxWidth: page.width - MARGIN * 2,
  });
  const delivery = data.delivery;
  top = drawLines(
    page,
    MARGIN,
    top + 27,
    [
      `Phone: ${delivery.phone}`,
      delivery.addressLine,
      [delivery.area, delivery.district, delivery.division].filter(Boolean).join(', ') +
        (delivery.postalCode ? ` ${delivery.postalCode}` : ''),
      delivery.landmark ? `Landmark: ${delivery.landmark}` : null,
      `Delivery zone: ${ZONES[delivery.zone] ?? words(delivery.zone)}`,
    ],
    page.width - MARGIN * 2,
  );
  top += 10;

  const itemName = (item: OrderDocument['items'][number]) =>
    item.variantLabel ? `${item.name} - ${item.variantLabel}` : item.name;
  const columns: PdfTableColumn[] =
    kind === 'invoice'
      ? [
          { header: 'Item', weight: 4.2 },
          { header: 'SKU', weight: 1.7 },
          { header: 'Qty', weight: 0.7, align: 'right' },
          { header: 'Unit price', weight: 1.5, align: 'right' },
          { header: 'Total', weight: 1.5, align: 'right' },
        ]
      : [
          { header: 'Item', weight: 5 },
          { header: 'SKU', weight: 2 },
          { header: 'Qty', weight: 0.8, align: 'right' },
          { header: 'Packed', weight: 1, align: 'center' },
        ];
  const rows = data.items.map((item) =>
    kind === 'invoice'
      ? [
          itemName(item),
          item.sku,
          String(item.quantity),
          tk(item.unitPriceMinor),
          tk(item.lineTotalMinor),
        ]
      : [itemName(item), item.sku, String(item.quantity), '[   ]'],
  );

  const newPage = () => {
    const next = document.addPage();
    return { page: next, top: header(next, true) };
  };
  let end = drawTable({ columns, rows, top, page, newPage, rowHeight: 18, fontSize: 9 });

  const bottom = end.page.height - MARGIN - 30;
  const needed = kind === 'invoice' ? 96 : 40;
  if (end.y + needed > bottom) {
    const next = newPage();
    end = { page: next.page, y: next.top };
  }
  let y = end.y + 18;
  const last = end.page;

  if (kind === 'invoice') {
    const labelX = last.width - MARGIN - 190;
    const valueX = last.width - MARGIN;
    const totals: [string, string, boolean][] = [
      ['Subtotal', tk(data.order.subtotalMinor), false],
      [
        'Discount',
        data.order.discountMinor > 0 ? `- ${tk(data.order.discountMinor)}` : tk(0),
        false,
      ],
      ['Delivery', tk(data.order.shippingFeeMinor), false],
    ];
    for (const [key, value] of totals) {
      last.text(labelX, y, key, { size: 9.5, color: BRAND.slate });
      last.text(valueX, y, value, { size: 9.5, color: BRAND.slate, align: 'right' });
      y += 15;
    }
    last.roundedRect(labelX - 8, y - 6, valueX - labelX + 16, 24, 4, { fill: BRAND.soft });
    last.text(labelX, y + 10, 'Total', { size: 11, font: 'bold', color: BRAND.navy });
    last.text(valueX - 8, y + 10, tk(data.order.totalMinor), {
      size: 11,
      font: 'bold',
      color: BRAND.navy,
      align: 'right',
    });
    y += 36;
    if (data.order.paymentStatus === 'pending') {
      last.text(MARGIN, y, `Collect ${tk(data.order.totalMinor)} in cash on delivery.`, {
        size: 9,
        font: 'bold',
        color: BRAND.primary,
      });
      y += 16;
    }
  }

  if (data.order.customerNote) {
    label(last, MARGIN, y, 'Note from the customer');
    drawLines(last, MARGIN, y + 13, [data.order.customerNote], last.width - MARGIN * 2);
  }

  drawFooters(document, generatedAt, `Thank you for shopping with ${data.store.name}`);
  return document.toBuffer({ title: `${name} ${data.order.orderNumber}`, createdAt: generatedAt });
}
