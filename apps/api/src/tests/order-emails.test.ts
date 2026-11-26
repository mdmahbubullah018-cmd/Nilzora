import type { OrderDetail } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import { EmailUnavailableError, type EmailMessage, type EmailSender } from '../auth/sender';
import type { ClaimedEmail, EmailOutcome, OrderEmailStore } from '../modules/order-emails/store';
import {
  orderConfirmationEmail,
  outForDeliveryEmail,
  refundUpdateEmail,
  returnUpdateEmail,
} from '../modules/order-emails/templates';
import { createOrderEmailProcessor, MAX_EMAIL_ATTEMPTS } from '../modules/order-emails/worker';

const ORDER: OrderDetail = {
  orderNumber: 'NZ-20261116-ABCD',
  status: 'pending',
  paymentMethod: 'cod',
  paymentStatus: 'pending',
  itemCount: 3,
  totalMinor: 257_000,
  placedAt: '2026-11-16T10:05:00.000Z',
  preview: [],
  currency: 'BDT',
  subtotalMinor: 260_000,
  shippingFeeMinor: 7_000,
  discountMinor: 10_000,
  deliveryZone: 'inside_dhaka',
  shippingAddress: {
    recipientName: 'Rahima <b>Khatun</b>',
    phone: '+8801712345678',
    division: 'Dhaka',
    district: 'Dhaka',
    area: 'Dhanmondi',
    addressLine: 'House 12, Road 5',
    postalCode: '1212',
    landmark: null,
  },
  customerNote: null,
  cancelReason: null,
  cancelledAt: null,
  items: [
    {
      orderItemId: 1,
      productId: '00000000-0000-4000-8000-000000000001',
      variantId: '00000000-0000-4000-8000-000000000002',
      variantLabel: 'Size: M / Colour: Navy',
      productName: 'Cotton Panjabi',
      productSlug: 'cotton-panjabi',
      sku: 'PJ-1',
      unitPriceMinor: 120_000,
      quantity: 2,
      lineTotalMinor: 240_000,
      image: {
        url: 'https://media.example.test/p/1.webp',
        thumbUrl: 'https://media.example.test/p/1-thumb.webp',
        alt: 'Navy panjabi',
      },
      regularPriceMinor: null,
      catalogPriceMinor: null,
      campaignId: null,
      campaignTitle: null,
      campaignDiscountMinor: 0,
    },
    {
      orderItemId: 2,
      productId: '00000000-0000-4000-8000-000000000003',
      variantId: null,
      variantLabel: null,
      productName: 'Attar',
      productSlug: 'attar',
      sku: 'AT-1',
      unitPriceMinor: 20_000,
      quantity: 1,
      lineTotalMinor: 20_000,
      image: null,
      regularPriceMinor: null,
      catalogPriceMinor: null,
      campaignId: null,
      campaignTitle: null,
      campaignDiscountMinor: 0,
    },
  ],
  history: [],
  canCancel: true,
};

const SITE = { siteUrl: 'https://shop.example.test' };

describe('order confirmation email', () => {
  const email = orderConfirmationEmail(ORDER, { name: 'Rahima Khatun' }, SITE);

  it('carries the saved order: number, items, variants, quantities and every total', () => {
    expect(email.subject).toBe('Order NZ-20261116-ABCD received');
    expect(email.text).toContain('Hi Rahima,');
    expect(email.text).toContain('Placed: 16 November 2026, 16:05');
    expect(email.text).toContain(
      'Cotton Panjabi · Size: M / Colour: Navy — 2 × BDT 1,200 = BDT 2,400',
    );
    expect(email.text).toContain('Subtotal: BDT 2,600');
    expect(email.text).toContain('Discount: -BDT 100');
    expect(email.text).toContain('Delivery: BDT 70');
    expect(email.text).toContain('Total payable on delivery: BDT 2,570');
    expect(email.text).toContain('Payment: Cash on Delivery');
  });

  it('links to the signed-in order page, shows https product pictures with alt text, escapes data', () => {
    expect(email.html).toContain(
      'href="https://shop.example.test/account/orders/NZ-20261116-ABCD"',
    );
    expect(email.html).toContain(
      'src="https://media.example.test/p/1-thumb.webp" alt="Navy panjabi"',
    );
    expect(email.html).toContain('Rahima &lt;b&gt;Khatun&lt;/b&gt;');
    expect(email.html).not.toContain('<b>Khatun</b>');
  });

  it('follows the email design family: no boxed card, no shadow, no scripts', () => {
    expect(email.html).not.toMatch(/box-shadow/i);
    expect(email.html).not.toContain('border-radius:18px');
    expect(email.html).toContain('max-width:600px');
    expect(email.html).not.toMatch(/<script|<link/i);
  });

  it('renders no link when the site address is not configured', () => {
    expect(orderConfirmationEmail(ORDER, { name: null }, {}).html).not.toContain('<a ');
  });

  it('never renders a non-https picture', () => {
    const local = {
      ...ORDER,
      items: [
        {
          ...ORDER.items[0]!,
          image: { url: 'http://127.0.0.1/p.webp', thumbUrl: 'http://127.0.0.1/t.webp', alt: null },
        },
      ],
    };
    expect(orderConfirmationEmail(local, { name: null }, {}).html).not.toContain('<img');
  });
});

describe('out for delivery email', () => {
  const shipment = {
    courier: 'Steadfast Courier',
    trackingCode: 'SF123',
    trackingUrl: 'https://steadfast.example/t/SF123',
    codAmountMinor: 257_000,
  };

  it('says what the courier reported and the cash to keep ready, without promising a day', () => {
    const email = outForDeliveryEmail(ORDER, shipment, { name: 'Rahima' }, SITE);
    expect(email.subject).toBe('Order NZ-20261116-ABCD is out for delivery');
    expect(email.text).toContain(
      'Steadfast Courier reports that your order NZ-20261116-ABCD is out for delivery',
    );
    expect(email.text).toContain('Pay the rider in cash: BDT 2,570');
    expect(email.text).toContain('Tracking code: SF123');
    expect(`${email.text}${email.html}`).not.toMatch(/today|tomorrow|within \d+ hours|24 hours/i);
  });

  it('drops a tracking link that is not https, and says when nothing is due', () => {
    const email = outForDeliveryEmail(
      ORDER,
      { ...shipment, trackingUrl: 'javascript:alert(1)', codAmountMinor: 0 },
      { name: null },
      SITE,
    );
    expect(email.html).not.toContain('javascript:');
    expect(email.text).toContain('Nothing is due on delivery.');
  });
});

describe('return and refund emails', () => {
  it('never says a refund was paid while it is only approved', () => {
    const approved = refundUpdateEmail(
      ORDER,
      { status: 'approved', amountMinor: 20_000, method: 'cod_manual' },
      { name: null },
      SITE,
    );
    expect(approved.text).toContain('A refund of BDT 200 was approved. It has not been paid yet');
    expect(approved.text).not.toMatch(/has been paid|was paid/);
    const paid = refundUpdateEmail(
      ORDER,
      { status: 'completed', amountMinor: 20_000, method: 'cod_manual' },
      { name: null },
      SITE,
    );
    expect(paid.subject).toContain('Your refund was paid');
  });

  it('confirms a return request without implying a refund', () => {
    const email = returnUpdateEmail(
      ORDER,
      {
        status: 'requested',
        reason: 'Wrong size',
        decisionNote: null,
        items: [{ productName: 'Attar', variantLabel: null, quantity: 1 }],
      },
      { name: null },
      SITE,
    );
    expect(email.subject).toBe('We received your return request · NZ-20261116-ABCD');
    expect(email.text).toContain('- Attar × 1');
    expect(email.text).not.toMatch(/refunded|refund (was|has been) (paid|issued)/i);
    expect(email.html).toContain('href="https://shop.example.test/account/returns"');
  });
});

function claimed(overrides: Partial<ClaimedEmail> = {}): ClaimedEmail {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    kind: 'order_confirmation',
    userId: '00000000-0000-4000-8000-0000000000bb',
    orderId: '00000000-0000-4000-8000-0000000000cc',
    orderNumber: ORDER.orderNumber,
    shipmentId: null,
    returnRequestId: null,
    refundId: null,
    eventStatus: null,
    attempts: 1,
    ...overrides,
  };
}

function fakeStore(row: ClaimedEmail, overrides: Partial<OrderEmailStore> = {}) {
  const finished: { outcome: EmailOutcome; errorCode?: string | undefined }[] = [];
  const store: OrderEmailStore = {
    claim: () => Promise.resolve([row]),
    finish: (_id, outcome, options) => {
      finished.push({ outcome, errorCode: options?.errorCode });
      return Promise.resolve();
    },
    recipient: () =>
      Promise.resolve({
        email: 'rahima@example.test',
        name: 'Rahima',
        verified: true,
        active: true,
      }),
    order: () => Promise.resolve(ORDER),
    shipment: () =>
      Promise.resolve({
        status: 'out_for_delivery',
        courier: 'Steadfast',
        trackingCode: null,
        trackingUrl: null,
        codAmountMinor: 0,
      }),
    returnRequest: () => Promise.resolve(null),
    refund: () => Promise.resolve({ status: 'approved', amountMinor: 100, method: 'cod_manual' }),
    ...overrides,
  };
  return { store, finished };
}

function capture(fail?: () => Error): { sent: EmailMessage[]; email: EmailSender } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    email: {
      send: (message) => {
        if (fail) return Promise.reject(fail());
        sent.push(message);
        return Promise.resolve();
      },
      verify: () => Promise.resolve(),
    },
  };
}

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

async function runWith(
  row: ClaimedEmail,
  overrides: Partial<OrderEmailStore> = {},
  fail?: () => Error,
) {
  const { store, finished } = fakeStore(row, overrides);
  const { sent, email } = capture(fail);
  await createOrderEmailProcessor({
    store,
    sender: email,
    branding: () => ({}),
    logger,
    random: () => 0.5,
  }).runOnce();
  return { sent, finished };
}

describe('order email worker', () => {
  it('records sent only after the mail server accepted the message', async () => {
    const { sent, finished } = await runWith(claimed());
    expect(sent).toHaveLength(1);
    expect(finished).toEqual([{ outcome: 'sent', errorCode: undefined }]);
  });

  it('skips a cancelled order, an unverified address and an inactive account', async () => {
    expect(
      (
        await runWith(claimed(), {
          order: () => Promise.resolve({ ...ORDER, status: 'cancelled' }),
        })
      ).finished,
    ).toEqual([{ outcome: 'skipped', errorCode: 'order_cancelled' }]);
    expect(
      (
        await runWith(claimed(), {
          recipient: () =>
            Promise.resolve({ email: 'x@example.test', name: null, verified: false, active: true }),
        })
      ).finished,
    ).toEqual([{ outcome: 'skipped', errorCode: 'email_unverified' }]);
    expect(
      (
        await runWith(claimed(), {
          recipient: () =>
            Promise.resolve({ email: 'x@example.test', name: null, verified: true, active: false }),
        })
      ).finished,
    ).toEqual([{ outcome: 'skipped', errorCode: 'account_inactive' }]);
  });

  it('skips an order the customer cannot read (not theirs)', async () => {
    const { sent, finished } = await runWith(claimed(), { order: () => Promise.resolve(null) });
    expect(sent).toHaveLength(0);
    expect(finished).toEqual([{ outcome: 'skipped', errorCode: 'order_not_found' }]);
  });

  it('does not send a stale "out for delivery" once the parcel moved on', async () => {
    const row = claimed({
      kind: 'out_for_delivery',
      shipmentId: '00000000-0000-4000-8000-0000000000dd',
    });
    const { sent, finished } = await runWith(row, {
      shipment: () =>
        Promise.resolve({
          status: 'delivered',
          courier: 'Steadfast',
          trackingCode: null,
          trackingUrl: null,
          codAmountMinor: 0,
        }),
    });
    expect(sent).toHaveLength(0);
    expect(finished).toEqual([{ outcome: 'skipped', errorCode: 'stale_event' }]);
  });

  it('never announces a refund as paid unless the refund is completed', async () => {
    const row = claimed({
      kind: 'refund_update',
      refundId: '00000000-0000-4000-8000-0000000000ee',
      eventStatus: 'completed',
    });
    const { finished } = await runWith(row, {
      refund: () =>
        Promise.resolve({ status: 'cancelled', amountMinor: 100, method: 'cod_manual' }),
    });
    expect(finished).toEqual([{ outcome: 'skipped', errorCode: 'stale_event' }]);
  });

  it('retries a temporary failure with backoff and gives up after the last attempt', async () => {
    const temporary = () =>
      new EmailUnavailableError('down', {
        diagnostic: { code: 'ETIMEDOUT', connectionFailed: true },
      });
    expect((await runWith(claimed(), {}, temporary)).finished).toEqual([
      { outcome: 'retry', errorCode: 'smtp_not_accepted' },
    ]);
    expect(
      (await runWith(claimed({ attempts: MAX_EMAIL_ATTEMPTS }), {}, temporary)).finished,
    ).toEqual([{ outcome: 'failed', errorCode: 'attempts_exhausted' }]);
  });

  it('does not retry a permanent refusal of the address', async () => {
    const rejected = () =>
      new EmailUnavailableError('rejected', {
        diagnostic: { responseCode: 550, command: 'RCPT TO' },
      });
    expect((await runWith(claimed(), {}, rejected)).finished).toEqual([
      { outcome: 'failed', errorCode: 'smtp_rejected' },
    ]);
  });
});
