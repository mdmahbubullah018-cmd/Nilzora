import { describe, expect, it, vi } from 'vitest';
import { CHAT_QUICK_QUESTIONS } from '@nilzora/contracts';
import {
  ASSISTANT_FALLBACK,
  orderNumberIn,
  resolveAssistantReply,
  type AssistantFacts,
  type AssistantOrderFact,
} from '../modules/chat/assistant';
import { createChatAssistant, type AssistantQueryRunner } from '../modules/chat/assistant-service';
import type { ChatNotifier } from '../realtime/notifier';
import { captureLogs } from './helpers';

/*
 * The support assistant. Its value is that it cannot make things up: every sentence comes
 * from a fact passed in, and everything it does not know is handed to a person. These tests
 * pin that down, and pin the cases where it must stay silent.
 *
 * The two database calls are faked here - they are the granted functions the API calls - so
 * the shape of each answer is what the SQL really returns.
 */

const logger = captureLogs('silent').logger;

function order(overrides: Partial<AssistantOrderFact> = {}): AssistantOrderFact {
  return {
    orderNumber: 'NZ1042',
    status: 'shipped',
    paymentStatus: 'pending',
    deliveredAt: null,
    returnEligible: false,
    shipment: null,
    ...overrides,
  };
}

function facts(overrides: Partial<AssistantFacts> = {}): AssistantFacts {
  return {
    storeName: 'Nilzora',
    businessHours: null,
    supportEmail: null,
    supportPhone: null,
    returnWindowDays: null,
    codEnabled: null,
    deliveryCharges: { insideDhaka: null, outsideDhaka: null },
    defaultZone: null,
    product: null,
    order: null,
    recentOrders: [],
    firstContact: false,
    ...overrides,
  };
}

function reply(body: string, overrides: Partial<AssistantFacts> = {}) {
  return resolveAssistantReply({ body, facts: facts(overrides) });
}

function expectFallback(body: string, overrides: Partial<AssistantFacts> = {}) {
  const result = reply(body, overrides);
  expect(result?.intent, body).toBe('fallback');
  expect(result?.body, body).toBe(ASSISTANT_FALLBACK);
}

const CHARGES = { insideDhaka: 6000, outsideDhaka: 12000 };

describe('order status', () => {
  it('reports the status of the order the customer named', () => {
    const result = reply('Where is my order NZ1042?', { order: order() });

    expect(result?.intent).toBe('order_status');
    expect(result?.body).toContain('Order NZ1042');
    expect(result?.body).toContain('on its way');
  });

  it('never answers about a different order when the named one is not the customer’s', () => {
    // The facts function returns no order for a number the customer does not own, even though
    // the customer has other orders and the thread is linked to one.
    const result = reply('Where is my order NZ9999?', {
      order: null,
      recentOrders: [order({ orderNumber: 'NZ1042' })],
    });

    expect(result?.intent).toBe('fallback');
    expect(result?.body).toContain("can't find that order on your account");
    expect(result?.body).toContain(ASSISTANT_FALLBACK);
    // It does not say whether such an order exists, nor mention another one.
    expect(result?.body).not.toContain('NZ1042');
    expect(result?.body).not.toContain('NZ9999');
  });

  it('refuses a named order whose number does not match the one returned', () => {
    const result = reply('status of NZ5000 please', { order: order({ orderNumber: 'NZ1042' }) });
    expect(result?.body).toContain("can't find that order");
    expect(result?.body).not.toContain('on its way');
  });

  it('uses the customer’s own latest order when none is named', () => {
    const result = reply('Where is my order, please?', {
      recentOrders: [order({ orderNumber: 'NZ2000', status: 'confirmed' }), order()],
    });

    expect(result?.intent).toBe('order_status');
    expect(result?.body).toContain('Your most recent order (NZ2000) is confirmed');
    expect(result?.body).toContain('send its number');
    expect(result?.body).not.toContain('NZ1042');
  });

  it('prefers the order the thread is about over the latest one', () => {
    const result = reply('Where is my order?', {
      order: order({ orderNumber: 'NZ7777', status: 'processing' }),
      recentOrders: [order({ orderNumber: 'NZ8888' })],
    });
    expect(result?.body).toContain('Order NZ7777 is being packed');
    expect(result?.body).not.toContain('NZ8888');
  });

  it('asks for the number instead of guessing when there is no order to speak of', () => {
    const result = reply('My parcel has not arrived');

    expect(result?.intent).toBe('order_status');
    expect(result?.body).toContain('order number');
    // No status, no date, no promise - and it does not claim to know where anything is.
    expect(result?.body).not.toMatch(/delivered|shipped|tomorrow|days|exactly/i);
  });

  it('gives a tracking code only for a tracking question, and only from a real shipment', () => {
    const shipped = order({ shipment: { providerName: 'Pathao', trackingCode: 'PT-123' } });

    const track = reply('Can you tell me where my delivery has reached?', { order: shipped });
    expect(track?.body).toContain('Pathao');
    expect(track?.body).toContain('PT-123');

    // "Where is my order?" is a status question: no tracking details volunteered.
    const where = reply('Where is my order?', { order: shipped });
    expect(where?.body).toContain('on its way');
    expect(where?.body).not.toContain('PT-123');

    // No code available: it says so rather than inventing one.
    const none = reply('Track my parcel', { order: order() });
    expect(none?.body).toContain('no courier tracking code');
    expect(none?.body).not.toContain('PT-');
  });

  it('does not talk about tracking once an order is delivered or cancelled', () => {
    const delivered = reply('Track my parcel', {
      order: order({
        status: 'delivered',
        shipment: { providerName: 'Pathao', trackingCode: 'PT-1' },
      }),
    });
    expect(delivered?.body).toContain('was delivered');
    expect(delivered?.body).not.toContain('PT-1');
  });

  it.each(['How do I place an order?', 'where can I place an order', 'I want to reorder shoes'])(
    'does not treat "%s" as a question about a parcel',
    (body) => {
      expectFallback(body, { order: order(), recentOrders: [order()] });
    },
  );
});

describe('delivery charges', () => {
  it('quotes both zones from the store’s own charges', () => {
    const result = reply('What are the delivery charges for my area?', {
      deliveryCharges: CHARGES,
    });

    expect(result?.intent).toBe('delivery_cost');
    expect(result?.body).toContain('BDT 60 inside Dhaka');
    expect(result?.body).toContain('BDT 120 outside Dhaka');
  });

  it('names the zone of the customer’s default address when known', () => {
    const inside = reply('delivery charge?', {
      deliveryCharges: CHARGES,
      defaultZone: 'inside_dhaka',
    });
    expect(inside?.body).toContain('default saved address is inside Dhaka, so BDT 60 applies');
    const outside = reply('delivery charge?', {
      deliveryCharges: CHARGES,
      defaultZone: 'outside_dhaka',
    });
    expect(outside?.body).toContain('outside Dhaka, so BDT 120 applies');
    expect(reply('delivery charge?', { deliveryCharges: CHARGES })?.body).not.toContain(
      'default saved address',
    );
  });

  it.each([
    'charges for delivery',
    'How much is delivery?',
    'what is the shipping cost',
    'delivery fee please',
  ])('matches "%s" as a delivery cost question', (body) => {
    expect(reply(body, { deliveryCharges: CHARGES })?.intent).toBe('delivery_cost');
  });

  it('falls back when either amount is not set', () => {
    expectFallback('What are the delivery charges?');
    expectFallback('What are the delivery charges?', {
      deliveryCharges: { insideDhaka: 6000, outsideDhaka: null },
    });
    expectFallback('What are the delivery charges?', {
      deliveryCharges: { insideDhaka: null, outsideDhaka: 12000 },
    });
  });

  it('says so when delivery is free in a zone', () => {
    const result = reply('delivery cost?', {
      deliveryCharges: { insideDhaka: 0, outsideDhaka: 12000 },
    });
    expect(result?.body).toContain('BDT 0 (free) inside Dhaka');
  });

  it('formats larger amounts the Bangladeshi way', () => {
    const result = reply('delivery cost?', {
      deliveryCharges: { insideDhaka: 6050, outsideDhaka: 125000 },
    });
    expect(result?.body).toContain('BDT 60.50');
    expect(result?.body).toContain('BDT 1,250');
  });
});

describe('returns', () => {
  it('says a delivered order inside the window can be returned from the app', () => {
    const result = reply('How do I return an item?', {
      returnWindowDays: 7,
      order: order({ status: 'delivered', returnEligible: true }),
    });
    expect(result?.intent).toBe('returns');
    expect(result?.body).toContain('inside the 7-day return window');
    expect(result?.body).toContain('Request a return');
    // The app does the work: no teammate is claimed to be needed.
    expect(result?.body).not.toMatch(/teammate will arrange/i);
  });

  it('says when the window has closed, and hands over', () => {
    const result = reply('Can I return NZ1042?', {
      returnWindowDays: 7,
      order: order({ status: 'delivered', returnEligible: false }),
    });
    expect(result?.body).toContain('return window has closed');
    expect(result?.body).toContain(ASSISTANT_FALLBACK);
  });

  it('says an undelivered order cannot be returned yet, with the real rule', () => {
    const result = reply('Can I return my order?', { returnWindowDays: 10, order: order() });
    expect(result?.body).toContain('has not been delivered yet');
    expect(result?.body).toContain('within 10 days of delivery');
  });

  it('explains the rule in general when no order is known', () => {
    const result = reply('How do I return or exchange an item?', { returnWindowDays: 7 });
    expect(result?.intent).toBe('returns');
    expect(result?.body).toContain('within 7 days of delivery');
    expect(result?.body).toContain('delivered orders');
  });

  it('never answers a return question about an order that is not the customer’s', () => {
    const result = reply('I want to return NZ9999', { returnWindowDays: 7 });
    expect(result?.body).toContain("can't find that order");
  });

  it('hands over without a published window', () => {
    expectFallback('How do I return an item?');
  });
});

describe('payment', () => {
  it('answers about cash on delivery from the store setting, not from assumption', () => {
    const on = reply('Can I pay cash on delivery?', { codEnabled: true });
    expect(on?.intent).toBe('payment');
    expect(on?.body).toContain('Cash on delivery is available');

    const off = reply('Can I pay cash on delivery?', { codEnabled: false });
    expect(off?.intent).toBe('payment');
    expect(off?.body).toContain('not being offered');

    expectFallback('Can I pay cash on delivery?');
  });

  it('matches whole words only: a coupon code or a display is not a payment question', () => {
    expectFallback('Where do I enter my coupon code?', { codEnabled: true });
    expectFallback('The display of the phone is cracked', { codEnabled: true });
  });

  it('tells the truth about methods the store does not offer', () => {
    const on = reply('Can I pay with bKash?', { codEnabled: true });
    expect(on?.intent).toBe('payment');
    expect(on?.body).toContain('only payment method');
    expect(on?.body).toContain('not available');

    // With cash on delivery off, nothing can be said about alternatives.
    expectFallback('Do you take Nagad?', { codEnabled: false });
    expectFallback('Do you take a card?', { codEnabled: null });
  });

  it('answers a "have I paid" question from the order’s own payment status', () => {
    const pending = reply('Is NZ1042 paid yet?', {
      codEnabled: true,
      order: order({ paymentStatus: 'pending' }),
    });
    expect(pending?.body).toContain('still pending');
    const collected = reply('Is NZ1042 paid?', {
      order: order({ paymentStatus: 'collected' }),
    });
    expect(collected?.body).toContain('has been received');
  });
});

describe('products', () => {
  const panjabi = { name: 'Cotton panjabi', status: 'active', stock: 4, variants: [] };

  it('answers availability from the catalogue for the product in the thread', () => {
    const inStock = reply('Is the cotton panjabi available?', { product: panjabi });
    expect(inStock?.intent).toBe('product');
    expect(inStock?.body).toBe('Cotton panjabi is in stock.');

    const soldOut = reply('Is it in stock?', { product: { ...panjabi, stock: 0 } });
    expect(soldOut?.body).toContain('out of stock');

    // No product in the thread: nothing to check.
    expectFallback('Is it available?');
  });

  it('never gives a product-level "in stock" to a size or colour question', () => {
    expectFallback('Do you have this in size M?', { product: panjabi });
    expectFallback('Is it available in red colour?', { product: panjabi });
  });

  it('answers a size question from the real option only', () => {
    const product = {
      name: 'Cotton panjabi',
      status: 'active',
      stock: 5,
      variants: [
        { options: ['M', 'Navy'], stock: 0 },
        { options: ['L', 'Navy'], stock: 5 },
      ],
    };
    const outM = reply('Is size M available?', { product });
    expect(outM?.body).toBe('Cotton panjabi in M is out of stock at the moment.');
    const inL = reply('do you have the large one in navy? size L', { product });
    expect(inL?.body).toBe('Cotton panjabi in L, Navy is in stock.');
    // A value that does not exist for this product is not guessed at.
    expectFallback('Is size XXL available?', { product });
    // Generic availability does not claim every option is available.
    const generic = reply('Is it available?', { product });
    expect(generic?.body).toContain('in stock in some options');
  });

  it('does not name a product that is not active', () => {
    const result = reply('Is it in stock?', {
      product: { name: null, status: 'archived', stock: 9, variants: [] },
    });
    expect(result?.body).toBe('That product is not on sale right now.');
    const leaked = reply('Is it in stock?', {
      product: { name: 'Secret Draft', status: 'draft', stock: 9, variants: [] },
    });
    expect(leaked?.body).not.toContain('Secret Draft');
  });

  it('does not treat "help choosing a product" as a stock question', () => {
    expectFallback('I need help choosing a product. Could you advise me?', { product: panjabi });
    expectFallback('Which item is best for gifts?', { product: panjabi });
  });
});

describe('cancelling', () => {
  it('tells the customer they can cancel a pending order themselves', () => {
    const result = reply('Can I cancel my order?', { order: order({ status: 'pending' }) });
    expect(result?.intent).toBe('cancel');
    expect(result?.body).toContain('you can cancel it yourself');
    // It must never say the order has been cancelled.
    expect(result?.body).not.toMatch(/has been cancelled|cancelled your/i);
  });

  it('uses the latest order when none is linked', () => {
    const result = reply('Can I cancel my order?', {
      recentOrders: [order({ status: 'pending', orderNumber: 'NZ3000' })],
    });
    expect(result?.body).toContain('Your most recent order (NZ3000)');
    expect(result?.body).toContain('cancel it yourself');
  });

  it('hands any later state to a teammate', () => {
    const result = reply('Please cancel NZ1042', { order: order({ status: 'confirmed' }) });
    expect(result?.intent).toBe('handoff');
    expect(result?.body).toContain('can no longer be cancelled from your account');
    expect(result?.body).toContain(ASSISTANT_FALLBACK);
    expect(reply('cancel my order', { order: order({ status: 'cancelled' }) })?.body).toContain(
      'already cancelled',
    );
  });

  it('never discusses an order that is not the customer’s', () => {
    const result = reply('Cancel NZ9999', { recentOrders: [order({ status: 'pending' })] });
    expect(result?.body).toContain("can't find that order");
    expect(result?.body).not.toContain('cancel it yourself');
  });

  it('asks for the number when there is no order at all', () => {
    expect(reply('Can I cancel my order?')?.body).toContain('Send your order number');
  });
});

describe('hours, handoff and greeting', () => {
  it('quotes the store hours and never invents them', () => {
    const quoted = reply('What time do you close?', { businessHours: 'Sat-Thu, 10:00-20:00' });
    expect(quoted?.intent).toBe('hours');
    expect(quoted?.body).toContain('Sat-Thu, 10:00-20:00');
  });

  it('uses the fallback, not "store hours", when no hours are published', () => {
    const missing = reply('Are you open now?');
    expect(missing?.intent).toBe('fallback');
    expect(missing?.body).toBe(ASSISTANT_FALLBACK);
    expect(missing?.body).not.toContain('store hours');
  });

  it('does not take "what time will my order arrive" for opening hours', () => {
    expect(reply('what time will my order arrive?', { businessHours: '10-8' })?.intent).toBe(
      'order_status',
    );
  });

  it('hands a request for a person over and offers the published contact', () => {
    const result = reply('I want to talk to a human about this', {
      supportPhone: '+8801700000000',
    });

    expect(result?.intent).toBe('handoff');
    expect(result?.body).toContain('teammate');
    expect(result?.body).toContain('+8801700000000');
  });

  it('greets a plain hello at the first contact only, without inventing hours', () => {
    const first = reply('Hello', { firstContact: true });
    expect(first?.intent).toBe('greeting');
    expect(first?.body).toContain('Nilzora');
    expect(first?.body).not.toContain('store hours');
    expect(first?.body).toContain(ASSISTANT_FALLBACK);

    const withHours = reply('Hi there', { firstContact: true, businessHours: '10-8' });
    expect(withHours?.body).toContain('Our hours are 10-8.');

    // Not a first message: the fixed sentence, exactly.
    expectFallback('Hello');
    // A first message that is a real question is never greeted.
    expectFallback('asdkjhasd', { firstContact: true });
  });

  it('stays quiet when a message carries nothing to answer', () => {
    expect(reply('   ', { firstContact: true })).toBeNull();
    expect(reply('?!', { firstContact: true })).toBeNull();
  });

  it('uses the fixed wording for anything it cannot ground', () => {
    for (const body of [
      'How much is the red saree?',
      'Do you have any offers on sarees?',
      'How do I change my address?',
      'How long does delivery take?',
      'Do you deliver to Sylhet?',
      'asdkjhasd',
    ]) {
      expectFallback(body, { deliveryCharges: CHARGES, codEnabled: true });
    }
  });

  it('keeps the fallback sentence exactly as the brief words it', () => {
    expect(ASSISTANT_FALLBACK).toBe(
      'Our support team will review your message and get back to you as soon as possible.',
    );
  });
});

/*
 * Every quick message the two clients offer, held to the answer it must produce. The list is the
 * shared one, so this test fails the moment a chip is added or reworded without a grounded answer
 * behind it - which is the whole point of the audit.
 */
describe('quick messages', () => {
  const full = (): AssistantFacts =>
    facts({
      order: order({
        status: 'shipped',
        shipment: { providerName: 'Pathao', trackingCode: 'PT-123' },
      }),
      recentOrders: [order()],
      returnWindowDays: 7,
      codEnabled: true,
      deliveryCharges: CHARGES,
      defaultZone: 'inside_dhaka',
      product: { name: 'Cotton panjabi', status: 'active', stock: 3, variants: [] },
    });

  it.each([
    ['Where is my order?', 'order_status'],
    ['Track my delivery', 'order_status'],
    ['Product help', 'fallback'],
    ['Delivery charges', 'delivery_cost'],
    ['Return or exchange', 'returns'],
    ['Payment', 'payment'],
    ['Cancel an order', 'handoff'],
  ] as const)('answers the "%s" quick message with %s', (label, intent) => {
    const question = CHAT_QUICK_QUESTIONS.find((entry) => entry.label === label)?.question;
    expect(question, `no quick message labelled "${label}"`).toBeDefined();
    const result = resolveAssistantReply({ body: question ?? '', facts: full() });
    expect(result?.intent).toBe(intent);
    if (intent === 'fallback') expect(result?.body).toBe(ASSISTANT_FALLBACK);
  });

  it('answers "Track my delivery" with the tracking code but "Where is my order?" without', () => {
    const track = CHAT_QUICK_QUESTIONS.find((entry) => entry.label === 'Track my delivery');
    const where = CHAT_QUICK_QUESTIONS.find((entry) => entry.label === 'Where is my order?');
    expect(resolveAssistantReply({ body: track?.question ?? '', facts: full() })?.body).toContain(
      'PT-123',
    );
    expect(
      resolveAssistantReply({ body: where?.question ?? '', facts: full() })?.body,
    ).not.toContain('PT-123');
  });

  it('turns "Cancel an order" into a self-service answer for a pending order', () => {
    const cancel = CHAT_QUICK_QUESTIONS.find((entry) => entry.label === 'Cancel an order');
    const result = resolveAssistantReply({
      body: cancel?.question ?? '',
      facts: facts({ order: order({ status: 'pending' }) }),
    });
    expect(result?.intent).toBe('cancel');
  });

  it('offers a chip for every option the brief names', () => {
    // The list is short on purpose; this states which intents it exercises, so a missing topic
    // shows up as a failing expectation rather than as a silently absent chip.
    const labels = CHAT_QUICK_QUESTIONS.map((entry) => entry.label);
    expect(labels).toEqual([
      'Where is my order?',
      'Track my delivery',
      'Product help',
      'Delivery charges',
      'Return or exchange',
      'Payment',
      'Cancel an order',
    ]);
  });
});

describe('orderNumberIn', () => {
  it('finds a Nilzora order number in a sentence', () => {
    expect(orderNumberIn('hi, my order nz20481 has not arrived')).toBe('NZ20481');
    expect(orderNumberIn('no number here')).toBeNull();
  });
});

interface Recorded {
  fn: 'facts' | 'reply';
  params: readonly unknown[];
}

type FactsRow = Record<string, unknown>;

const baseFacts: FactsRow = {
  kind: 'customer_support',
  status: 'open',
  assigneeId: null,
  automationPaused: false,
  storeName: 'Nilzora',
  businessHours: null,
  supportEmail: null,
  supportPhone: null,
  customerMessages: 1,
  humanReplies: 0,
  answered: false,
  order: null,
  recentOrders: [],
  returnWindowDays: null,
  codEnabled: null,
  deliveryCharges: { insideDhaka: null, outsideDhaka: null },
  defaultZone: null,
  product: null,
};

const storedReply = {
  id: '00000000-0000-4000-8000-0000000000a9',
  seq: 12,
  kind: 'automated',
  body: 'Send your order number (it starts with NZ) and I can look up its status.',
  metadata: { assistant: 'order_status' },
  createdAt: '2026-11-05T10:00:30.000Z',
};

describe('createChatAssistant', () => {
  function build(
    overrides: {
      facts?: FactsRow | null;
      reply?: typeof storedReply | null;
      factsError?: boolean;
      replyError?: boolean;
    } = {},
  ) {
    const calls: Recorded[] = [];
    const queries: AssistantQueryRunner = {
      rows<T>(sql: string, params: readonly unknown[]): Promise<T[]> {
        const fn = sql.includes('chat_assistant_facts') ? 'facts' : 'reply';
        calls.push({ fn, params });
        if (fn === 'facts' && overrides.factsError === true) {
          return Promise.reject(new Error('facts failed'));
        }
        if (fn === 'reply' && overrides.replyError === true) {
          return Promise.reject(new Error('database is down'));
        }
        const value =
          fn === 'facts'
            ? overrides.facts === undefined
              ? { ...baseFacts }
              : overrides.facts
            : overrides.reply === undefined
              ? storedReply
              : overrides.reply;
        return Promise.resolve([{ value }] as T[]);
      },
    };
    const message = vi.fn<ChatNotifier['message']>();
    const notify: ChatNotifier = {
      message,
      read: vi.fn(),
      updated: vi.fn(),
      assigned: vi.fn(),
      queue: vi.fn(),
    };
    return { calls, message, assistant: createChatAssistant({ queries, logger, notify }) };
  }

  const request = {
    conversationId: '00000000-0000-4000-8000-0000000000c1',
    customerId: '00000000-0000-4000-8000-0000000000b1',
    body: 'my parcel has not arrived',
  };

  it('stores one automated answer and broadcasts it', async () => {
    const { assistant, calls, message } = build();

    await assistant.respond(request);

    expect(calls.map((call) => call.fn)).toEqual(['facts', 'reply']);
    expect(String(calls[1]?.params[2])).toContain('order number');
    expect(message).toHaveBeenCalledTimes(1);
    const [, sent] = message.mock.calls[0] ?? [];
    expect(sent?.kind).toBe('automated');
    expect(sent?.senderRole).toBe('system');
    expect(sent?.seq).toBe(12);
  });

  it.each([
    ['a teammate is assigned', { assigneeId: '00000000-0000-4000-8000-0000000000ff' }],
    ['a teammate has replied', { humanReplies: 1 }],
    ['automation is paused', { automationPaused: true }],
    ['this message was already answered', { answered: true }],
    ['the thread is resolved', { status: 'resolved' }],
    ['the thread is internal', { kind: 'internal_group' }],
    ['the thread is not this customer’s', null],
  ])('stays silent when %s', async (_label, overrides) => {
    const { assistant, calls, message } = build({
      facts: overrides === null ? null : { ...baseFacts, ...overrides },
    });

    await assistant.respond(request);

    expect(calls.some((call) => call.fn === 'reply')).toBe(false);
    expect(message).not.toHaveBeenCalled();
  });

  it('names the order only when the facts function matched it', async () => {
    const { assistant, calls, message } = build({
      facts: {
        ...baseFacts,
        order: {
          orderNumber: 'NZ1042',
          status: 'delivered',
          paymentStatus: 'collected',
          deliveredAt: '2026-11-01T10:00:00.000Z',
          returnEligible: true,
          shipment: null,
        },
        customerMessages: 2,
      },
    });

    await assistant.respond({ ...request, body: 'where is my order NZ1042?' });

    // The order number went into the lookup, and the answer is about that order.
    expect(calls[0]?.params).toEqual([request.conversationId, request.customerId, 'NZ1042']);
    expect(String(calls[1]?.params[2])).toContain('NZ1042');
    expect(message).toHaveBeenCalledTimes(1);
  });

  it('does not answer about the linked order when the customer named another number', async () => {
    const { assistant, calls } = build({
      facts: {
        ...baseFacts,
        // The SQL returns no order for a number the customer does not own.
        order: null,
        recentOrders: [{ orderNumber: 'NZ1042', status: 'shipped' }],
      },
    });

    await assistant.respond({ ...request, body: 'where is my order NZ9999?' });

    const sent = String(calls[1]?.params[2]);
    expect(sent).toContain("can't find that order");
    expect(sent).not.toContain('NZ1042');
    expect(calls[1]?.params[3]).toBe(JSON.stringify({ assistant: 'fallback' }));
  });

  it('quotes delivery charges the database returned, and maps the rest of the new facts', async () => {
    const { assistant, calls } = build({
      facts: {
        ...baseFacts,
        deliveryCharges: { insideDhaka: 6000, outsideDhaka: '12000' },
        defaultZone: 'outside_dhaka',
      },
    });

    await assistant.respond({ ...request, body: 'What are the delivery charges for my area?' });

    const sent = String(calls[1]?.params[2]);
    expect(sent).toContain('BDT 60 inside Dhaka');
    expect(sent).toContain('BDT 120 outside Dhaka');
    expect(sent).toContain('outside Dhaka, so BDT 120 applies');
    expect(calls[1]?.params[3]).toBe(JSON.stringify({ assistant: 'delivery_cost' }));
  });

  it('falls back on delivery charges when the store has set none', async () => {
    const { assistant, calls } = build();
    await assistant.respond({ ...request, body: 'What are the delivery charges for my area?' });
    expect(calls[1]?.params[2]).toBe(ASSISTANT_FALLBACK);
  });

  it('copes with a facts function that predates the newer fields', async () => {
    const legacy: FactsRow = { ...baseFacts };
    delete legacy.recentOrders;
    delete legacy.deliveryCharges;
    delete legacy.defaultZone;
    const { assistant, calls } = build({ facts: legacy });

    await assistant.respond({ ...request, body: 'How much is delivery?' });

    expect(calls[1]?.params[2]).toBe(ASSISTANT_FALLBACK);
  });

  it('says nothing when the reply function refuses', async () => {
    const { assistant, message } = build({ reply: null });

    await assistant.respond(request);

    expect(message).not.toHaveBeenCalled();
  });

  it('sends the fixed fallback once when the facts lookup fails', async () => {
    const { assistant, calls, message } = build({ factsError: true });

    await assistant.respond(request);

    // One failed lookup, then exactly one attempt to store the fixed sentence. The reply
    // function re-checks every gate under its lock, so a refused thread stores nothing.
    expect(calls.map((call) => call.fn)).toEqual(['facts', 'reply']);
    expect(calls[1]?.params[2]).toBe(ASSISTANT_FALLBACK);
    expect(calls[1]?.params[3]).toBe(JSON.stringify({ assistant: 'fallback' }));
    expect(message).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the failed lookup’s fallback is refused by the reply gates', async () => {
    const { assistant, message } = build({ factsError: true, reply: null });

    await assistant.respond(request);

    expect(message).not.toHaveBeenCalled();
  });

  it('never fails the message that was already sent', async () => {
    const { assistant } = build({ factsError: true, replyError: true });

    await expect(assistant.respond(request)).resolves.toBeUndefined();
    const failedReply = build({ replyError: true });
    await expect(failedReply.assistant.respond(request)).resolves.toBeUndefined();
    expect(failedReply.message).not.toHaveBeenCalled();
  });
});
