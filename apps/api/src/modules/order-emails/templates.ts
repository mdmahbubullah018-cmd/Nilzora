import {
  receiptDateText,
  receiptMoney,
  receiptMoneyEnglish,
  type OrderDetail,
} from '@nilzora/contracts';
import {
  BRAND,
  FONT,
  button,
  escapeHtml,
  eyebrow,
  greeting,
  keyValueRows,
  layout,
  notice,
  paragraph,
  rule,
  safeImageUrl,
  safeUrl,
  type EmailBranding,
  type RenderedEmail,
} from '../../email/design';

/*
 * Order emails
 * ------------
 * One function per customer email the order outbox carries. Every value comes from the
 * database as it is when the email is sent: the order the customer placed (names, variants,
 * prices and totals it saved), the shipment the courier reported, the return or refund staff
 * decided. Nothing here promises a delivery day, a refund that has not been paid, or anything
 * the data does not say.
 *
 * Links go to the customer's own account pages, which need them to be signed in: the email
 * carries no receipt file and no signed link, so forwarding it gives nobody access.
 */

export interface Recipient {
  name: string | null;
}

export interface ShipmentFacts {
  /** The courier's display name, e.g. "Steadfast". */
  courier: string;
  trackingCode: string | null;
  /** Only an https tracking page the courier gave us. */
  trackingUrl: string | null;
  /** What the rider collects, as the shipment was booked. */
  codAmountMinor: number;
}

export interface ReturnFacts {
  status: 'requested' | 'approved' | 'rejected' | 'received' | 'completed' | 'cancelled';
  reason: string;
  decisionNote: string | null;
  items: readonly { productName: string; variantLabel: string | null; quantity: number }[];
}

export interface RefundFacts {
  status: 'approved' | 'completed' | 'rejected';
  amountMinor: number;
  method: 'cod_manual' | 'bank_transfer';
}

const money = receiptMoneyEnglish;

function orderUrl(branding: EmailBranding, orderNumber: string): string | undefined {
  return safeUrl(branding.siteUrl, `account/orders/${encodeURIComponent(orderNumber)}`);
}

function returnsUrl(branding: EmailBranding): string | undefined {
  return safeUrl(branding.siteUrl, 'account/returns');
}

function itemName(item: { productName: string; variantLabel: string | null }): string {
  return item.variantLabel ? `${item.productName} · ${item.variantLabel}` : item.productName;
}

/** The ordered products: picture (when there is a public one), name, variant, quantity, price. */
function itemRows(order: OrderDetail): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${order.items
  .map((item) => {
    const image = safeImageUrl(item.image?.thumbUrl ?? item.image?.url);
    const alt = item.image?.alt ?? item.productName;
    const picture = image
      ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(alt)}" width="56" height="56" style="display:block;width:56px;height:56px;border-radius:8px;object-fit:cover;border:1px solid ${BRAND.rule};" />`
      : `<div style="width:56px;height:56px;border-radius:8px;background:${BRAND.soft};"></div>`;
    return `<tr>
<td width="68" valign="top" style="padding:10px 12px 10px 0;width:68px;">${picture}</td>
<td valign="top" style="padding:10px 0;font-family:${FONT};">
<p style="margin:0 0 2px 0;font-size:14px;line-height:20px;font-weight:600;color:${BRAND.navy};">${escapeHtml(item.productName)}</p>
${item.variantLabel ? `<p style="margin:0 0 2px 0;font-size:13px;line-height:18px;color:${BRAND.small};">${escapeHtml(item.variantLabel)}</p>` : ''}
<p style="margin:0;font-size:13px;line-height:18px;color:${BRAND.small};">Qty ${String(item.quantity)} × ${escapeHtml(money(item.unitPriceMinor))}</p>
</td>
<td valign="top" align="right" style="padding:10px 0 10px 12px;font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;color:${BRAND.navy};white-space:nowrap;">${escapeHtml(money(item.lineTotalMinor))}</td>
</tr>`;
  })
  .join('\n')}
</table>`;
}

function itemText(order: OrderDetail): string[] {
  return order.items.map(
    (item) =>
      `- ${itemName(item)} — ${String(item.quantity)} × ${money(item.unitPriceMinor)} = ${money(item.lineTotalMinor)}`,
  );
}

function addressLines(order: OrderDetail): string[] {
  const a = order.shippingAddress;
  return [
    a.recipientName,
    a.addressLine,
    ...(a.landmark ? [`Near ${a.landmark}`] : []),
    [a.area, a.district, a.division].filter(Boolean).join(', ') +
      (a.postalCode ? ` ${a.postalCode}` : ''),
    a.phone,
  ];
}

function totalsRows(order: OrderDetail): { label: string; value: string; strong?: boolean }[] {
  const m = receiptMoney(order);
  return [
    { label: 'Subtotal', value: escapeHtml(money(m.subtotalMinor)) },
    ...(m.discountMinor > 0
      ? [{ label: 'Discount', value: escapeHtml(`-${money(m.discountMinor)}`) }]
      : []),
    {
      label: 'Delivery',
      value: escapeHtml(m.shippingFeeMinor === 0 ? 'Free' : money(m.shippingFeeMinor)),
    },
    { label: 'Total payable on delivery', value: escapeHtml(money(m.dueMinor)), strong: true },
  ];
}

const ORDER_STATE: Readonly<Record<OrderDetail['status'], string>> = {
  pending: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  processing: 'Being prepared',
  shipped: 'On its way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/** Sent once, right after the order is placed. */
export function orderConfirmationEmail(
  order: OrderDetail,
  recipient: Recipient,
  branding: EmailBranding,
): RenderedEmail {
  const hello = greeting(recipient.name);
  const link = orderUrl(branding, order.orderNumber);
  const placed = receiptDateText(order.placedAt);
  const m = receiptMoney(order);

  const facts = keyValueRows([
    { label: 'Order number', value: escapeHtml(order.orderNumber) },
    { label: 'Placed', value: escapeHtml(placed) },
    { label: 'Status', value: escapeHtml(ORDER_STATE[order.status]) },
    { label: 'Payment', value: 'Cash on Delivery' },
  ]);

  const body = `${paragraph(escapeHtml(hello))}
${paragraph(`Thank you for your order. We have received it and will let you know as it moves along. You pay <strong style="color:${BRAND.navy};">${escapeHtml(money(m.dueMinor))}</strong> in cash when it is delivered.`, '0 0 20px 0')}
${button('View your order', link)}
${facts}
${rule()}
${eyebrow('Your items')}
${itemRows(order)}
${rule('12px 0 16px 0')}
${keyValueRows(totalsRows(order))}
${rule()}
${eyebrow('Delivering to')}
<p style="margin:0 0 20px 0;font-family:${FONT};font-size:14px;line-height:21px;color:${BRAND.body};">${addressLines(order).map(escapeHtml).join('<br />')}</p>
${notice('Cash on Delivery', 'Please keep the exact amount ready if you can. Check the parcel before paying the rider. Your receipt is in your account under My orders.')}`;

  const text = [
    hello,
    '',
    `Thank you for your order. We have received it and will let you know as it moves along.`,
    '',
    `Order number: ${order.orderNumber}`,
    `Placed: ${placed}`,
    `Status: ${ORDER_STATE[order.status]}`,
    'Payment: Cash on Delivery',
    '',
    'Items:',
    ...itemText(order),
    '',
    `Subtotal: ${money(m.subtotalMinor)}`,
    ...(m.discountMinor > 0 ? [`Discount: -${money(m.discountMinor)}`] : []),
    `Delivery: ${m.shippingFeeMinor === 0 ? 'Free' : money(m.shippingFeeMinor)}`,
    `Total payable on delivery: ${money(m.dueMinor)}`,
    '',
    'Delivering to:',
    ...addressLines(order),
    ...(link ? ['', `View your order: ${link}`] : []),
  ].join('\n');

  return {
    subject: `Order ${order.orderNumber} received`,
    text,
    html: layout(branding, {
      heading: 'Thanks — your order is in',
      preheader: `Order ${order.orderNumber}: ${String(order.itemCount)} item${order.itemCount === 1 ? '' : 's'}, ${money(m.dueMinor)} to pay on delivery.`,
      body,
      reason: 'You received this because you placed an order with this Nilzora account.',
    }),
  };
}

/**
 * Sent once per shipment when the courier reports it out for delivery. It says exactly that:
 * no delivery day or hour is promised, because the courier does not give one.
 */
export function outForDeliveryEmail(
  order: OrderDetail,
  shipment: ShipmentFacts,
  recipient: Recipient,
  branding: EmailBranding,
): RenderedEmail {
  const hello = greeting(recipient.name);
  const link = orderUrl(branding, order.orderNumber);
  const tracking = safeImageUrl(shipment.trackingUrl); // https only, same rule as images
  const collect = shipment.codAmountMinor;

  const facts = keyValueRows([
    { label: 'Order number', value: escapeHtml(order.orderNumber) },
    { label: 'Courier', value: escapeHtml(shipment.courier) },
    ...(shipment.trackingCode
      ? [{ label: 'Tracking code', value: escapeHtml(shipment.trackingCode) }]
      : []),
    {
      label: collect > 0 ? 'Pay the rider (cash)' : 'To pay on delivery',
      value: escapeHtml(collect > 0 ? money(collect) : 'Nothing'),
      strong: true,
    },
  ]);

  const body = `${paragraph(escapeHtml(hello))}
${paragraph(`${escapeHtml(shipment.courier)} reports that your order <strong style="color:${BRAND.navy};">${escapeHtml(order.orderNumber)}</strong> is out for delivery. The rider may call the phone number on your order.`, '0 0 20px 0')}
${button('View your order', link)}
${facts}
${
  tracking
    ? `<p style="margin:14px 0 0 0;font-family:${FONT};font-size:13px;line-height:20px;"><a href="${escapeHtml(tracking)}" style="color:${BRAND.primary};text-decoration:underline;">Track with ${escapeHtml(shipment.courier)}</a></p>`
    : ''
}
${rule()}
${eyebrow('In this parcel')}
${itemRows(order)}
${rule('12px 0 16px 0')}
${notice(
  'Before you pay',
  collect > 0
    ? `Keep ${escapeHtml(money(collect))} ready in cash, and check the parcel before you pay the rider.`
    : 'Nothing is due on delivery. Check the parcel when it arrives.',
)}`;

  const text = [
    hello,
    '',
    `${shipment.courier} reports that your order ${order.orderNumber} is out for delivery. The rider may call the phone number on your order.`,
    '',
    `Courier: ${shipment.courier}`,
    ...(shipment.trackingCode ? [`Tracking code: ${shipment.trackingCode}`] : []),
    collect > 0 ? `Pay the rider in cash: ${money(collect)}` : 'Nothing is due on delivery.',
    ...(tracking ? [`Track: ${tracking}`] : []),
    '',
    'In this parcel:',
    ...itemText(order),
    ...(link ? ['', `View your order: ${link}`] : []),
  ].join('\n');

  return {
    subject: `Order ${order.orderNumber} is out for delivery`,
    text,
    html: layout(branding, {
      heading: 'Your order is out for delivery',
      preheader:
        collect > 0
          ? `Keep ${money(collect)} ready for the rider.`
          : 'Your parcel is with the rider.',
      body,
      reason: 'You received this because the courier updated an order on your Nilzora account.',
    }),
  };
}

const RETURN_COPY: Readonly<
  Record<ReturnFacts['status'], { subject: string; heading: string; lead: string }>
> = {
  requested: {
    subject: 'We received your return request',
    heading: 'Return request received',
    lead: 'We have your return request and will review it. Nothing needs to be sent back until it is approved.',
  },
  approved: {
    subject: 'Your return was approved',
    heading: 'Your return was approved',
    lead: 'Your return request was approved. The next step is getting the items back to us; you can follow it in your account.',
  },
  rejected: {
    subject: 'Your return request was not approved',
    heading: 'Return not approved',
    lead: 'We reviewed your return request and could not approve it.',
  },
  received: {
    subject: 'We received your returned items',
    heading: 'Returned items received',
    lead: 'The items you sent back have arrived and are being checked.',
  },
  completed: {
    subject: 'Your return is complete',
    heading: 'Return complete',
    lead: 'Your return has been completed.',
  },
  cancelled: {
    subject: 'Your return request was cancelled',
    heading: 'Return request cancelled',
    lead: 'This return request was cancelled. If you still want to return something, you can make a new request from your order while the return window is open.',
  },
};

/** A return request was made or moved. Refund money is never mentioned as paid here. */
export function returnUpdateEmail(
  order: OrderDetail,
  ret: ReturnFacts,
  recipient: Recipient,
  branding: EmailBranding,
): RenderedEmail {
  const copy = RETURN_COPY[ret.status];
  const hello = greeting(recipient.name);
  const link = returnsUrl(branding);
  const refundNote =
    ret.status === 'approved' || ret.status === 'received' || ret.status === 'completed'
      ? 'Any refund is handled separately: we email you when it is approved, and again when it is paid.'
      : null;
  const items = ret.items.map(
    (item) =>
      `<li style="margin:0 0 4px 0;">${escapeHtml(itemName(item))} × ${String(item.quantity)}</li>`,
  );

  const body = `${paragraph(escapeHtml(hello))}
${paragraph(escapeHtml(copy.lead), '0 0 20px 0')}
${button('View your returns', link)}
${keyValueRows([
  { label: 'Order number', value: escapeHtml(order.orderNumber) },
  { label: 'Reason given', value: escapeHtml(ret.reason) },
])}
${
  items.length > 0
    ? `${rule('16px 0')}${eyebrow('Items')}<ul style="margin:0 0 8px 18px;padding:0;font-family:${FONT};font-size:14px;line-height:21px;color:${BRAND.body};">${items.join('')}</ul>`
    : ''
}
${ret.decisionNote && (ret.status === 'rejected' || ret.status === 'approved') ? `${rule('16px 0')}${notice('Note from our team', escapeHtml(ret.decisionNote))}` : ''}
${refundNote ? `${rule('16px 0')}${notice('About refunds', escapeHtml(refundNote))}` : ''}`;

  const text = [
    hello,
    '',
    copy.lead,
    '',
    `Order number: ${order.orderNumber}`,
    `Reason given: ${ret.reason}`,
    ...(ret.items.length > 0
      ? ['', 'Items:', ...ret.items.map((i) => `- ${itemName(i)} × ${String(i.quantity)}`)]
      : []),
    ...(ret.decisionNote && (ret.status === 'rejected' || ret.status === 'approved')
      ? ['', `Note from our team: ${ret.decisionNote}`]
      : []),
    ...(refundNote ? ['', refundNote] : []),
    ...(link ? ['', `View your returns: ${link}`] : []),
  ].join('\n');

  return {
    subject: `${copy.subject} · ${order.orderNumber}`,
    text,
    html: layout(branding, {
      heading: copy.heading,
      preheader: `${copy.heading} for order ${order.orderNumber}.`,
      body,
      reason: 'You received this because of a return request on your Nilzora account.',
    }),
  };
}

const REFUND_COPY: Readonly<
  Record<RefundFacts['status'], { subject: string; heading: string; lead: (a: string) => string }>
> = {
  approved: {
    subject: 'Your refund was approved',
    heading: 'Refund approved',
    lead: (amount) =>
      `A refund of ${amount} was approved. It has not been paid yet; we will email you again once it is.`,
  },
  completed: {
    subject: 'Your refund was paid',
    heading: 'Refund paid',
    lead: (amount) => `Your refund of ${amount} has been paid out.`,
  },
  rejected: {
    subject: 'Your refund was not approved',
    heading: 'Refund not approved',
    lead: () => 'We reviewed the refund for this order and could not approve it.',
  },
};

const REFUND_METHOD: Readonly<Record<RefundFacts['method'], string>> = {
  cod_manual: 'Cash',
  bank_transfer: 'Bank transfer',
};

/** A refund decision. "Paid" is only said for a completed refund, which records its proof. */
export function refundUpdateEmail(
  order: OrderDetail,
  refund: RefundFacts,
  recipient: Recipient,
  branding: EmailBranding,
): RenderedEmail {
  const copy = REFUND_COPY[refund.status];
  const hello = greeting(recipient.name);
  const link = returnsUrl(branding);
  const amount = money(refund.amountMinor);
  const lead = copy.lead(amount);

  const body = `${paragraph(escapeHtml(hello))}
${paragraph(escapeHtml(lead), '0 0 20px 0')}
${button('View your returns', link)}
${keyValueRows([
  { label: 'Order number', value: escapeHtml(order.orderNumber) },
  ...(refund.status === 'rejected'
    ? []
    : [
        { label: 'Method', value: escapeHtml(REFUND_METHOD[refund.method]) },
        { label: 'Amount', value: escapeHtml(amount), strong: true },
      ]),
])}`;

  const text = [
    hello,
    '',
    lead,
    '',
    `Order number: ${order.orderNumber}`,
    ...(refund.status === 'rejected'
      ? []
      : [`Method: ${REFUND_METHOD[refund.method]}`, `Amount: ${amount}`]),
    ...(link ? ['', `View your returns: ${link}`] : []),
  ].join('\n');

  return {
    subject: `${copy.subject} · ${order.orderNumber}`,
    text,
    html: layout(branding, {
      heading: copy.heading,
      preheader: lead,
      body,
      reason: 'You received this because of a refund on your Nilzora account.',
    }),
  };
}
