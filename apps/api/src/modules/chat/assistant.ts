import { receiptMoneyEnglish, type OrderStatus } from '@nilzora/contracts';

/*
 * The support assistant's words
 * -----------------------------
 * This module decides what an automatic answer says. It is pure on purpose: every sentence it
 * can produce is built from a fact that was looked up and passed in, so there is no way for it
 * to invent a price, a stock level, a delivery promise or an opening time that the store did
 * not actually publish.
 *
 * Questions are recognised by WHOLE WORDS and whole phrases, never by substrings, so "coupon
 * code" is not about cash on delivery, "display" is not about paying and "place an order" is not
 * about a parcel. Anything that does not clearly match - or whose fact is missing - gets the one
 * fixed fallback sentence instead of a guess.
 */

export type AssistantIntent =
  | 'handoff'
  | 'cancel'
  | 'delivery_cost'
  | 'order_status'
  | 'hours'
  | 'returns'
  | 'payment'
  | 'product'
  | 'greeting'
  | 'fallback';

export type AssistantPaymentStatus = 'pending' | 'collected' | 'cancelled';

/** A courier shipment the customer may be told about: real, accepted by the courier, no costs. */
export interface AssistantShipmentFact {
  providerName: string | null;
  trackingCode: string | null;
}

/** One of the customer's own orders. */
export interface AssistantOrderFact {
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: AssistantPaymentStatus | null;
  deliveredAt: string | null;
  /** True only for a delivered order still inside the return window (the server's own rule). */
  returnEligible: boolean;
  shipment: AssistantShipmentFact | null;
}

/** One sellable option (a size / colour combination) of the product, with its own stock. */
export interface AssistantVariantFact {
  options: string[];
  stock: number;
}

/** The product this thread is about, exactly as the catalogue stores it. */
export interface AssistantProductFact {
  /** Null unless the product is active: the name of an unlisted product is never repeated. */
  name: string | null;
  status: string;
  stock: number;
  variants: AssistantVariantFact[];
}

export type AssistantZone = 'inside_dhaka' | 'outside_dhaka';

/** Everything the assistant is allowed to know. A null field means "not published". */
export interface AssistantFacts {
  storeName: string;
  businessHours: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  /** How long a customer has to ask for a return, from the store's own settings. */
  returnWindowDays: number | null;
  /** Whether cash on delivery is offered right now. */
  codEnabled: boolean | null;
  /** Delivery charge per zone in poisha; null when the store has not set that zone. */
  deliveryCharges: { insideDhaka: number | null; outsideDhaka: number | null };
  /** The zone of the customer's own default saved address, if they have one. */
  defaultZone: AssistantZone | null;
  /**
   * The customer's own order: the one their message named, or else the one the thread was
   * opened about. Never another customer's order.
   */
  order: AssistantOrderFact | null;
  /** The customer's newest orders, newest first, for a question that names no order. */
  recentOrders: AssistantOrderFact[];
  /** The product the conversation is about, when it is about one. */
  product: AssistantProductFact | null;
  /** True while no teammate has replied yet: only then does the assistant greet. */
  firstContact: boolean;
}

export interface AssistantReply {
  intent: AssistantIntent;
  body: string;
}

/**
 * What the store says when it cannot answer from its own data.
 *
 * This is fixed wording on purpose, and it is the same sentence for every reason it is used -
 * an unclear question, a failed lookup, a fact the store has never published. It promises a
 * person, not an answer, so it can never be wrong about the facts. It also never claims that a
 * teammate has already read the conversation.
 */
export const ASSISTANT_FALLBACK =
  'Our support team will review your message and get back to you as soon as possible.';

/** The intents, in the order they are tried: a request for a person outranks everything. */

const HANDOFF_WORDS = [
  'human',
  'humans',
  'representative',
  'supervisor',
  'manager',
  'complaint',
  'complaints',
  'complain',
  'complaining',
  'escalate',
  'refund',
  'refunds',
];
const HANDOFF_PHRASES = [
  'real person',
  'an agent',
  'talk to someone',
  'speak to someone',
  'talk to a person',
  'speak to a person',
  'call me',
  'change my order',
  'change the address',
];

/** Cancelling: the word `cancel` together with something that can be cancelled. */
const CANCEL_WORDS = ['cancel', 'cancellation'];
const CANCEL_SUBJECTS = ['order', 'orders', 'it', 'purchase', 'parcel', 'package'];

/** What delivery costs: a cost word beside a delivery word, or "how much" about delivery. */
const DELIVERY_WORDS = ['delivery', 'shipping', 'courier'];
const COST_WORDS = ['charge', 'charges', 'fee', 'fees', 'cost', 'costs', 'price', 'prices', 'rate'];

const RETURN_WORDS = ['return', 'returns', 'returning', 'exchange', 'exchanges'];
const RETURN_PHRASES = ['send it back', 'send back', 'money back'];

const PAYMENT_WORDS = [
  'pay',
  'paying',
  'paid',
  'payment',
  'payments',
  'cod',
  'card',
  'cards',
  'bkash',
  'bikash',
  'nagad',
  'rocket',
  'upay',
  'visa',
  'mastercard',
  'advance',
  'prepaid',
  'prepay',
];
const PAYMENT_PHRASES = ['cash on delivery', 'online payment', 'mobile banking'];
/** Methods the store does not offer; naming one gets the truth about what it does offer. */
const OTHER_METHOD_WORDS = [
  'bkash',
  'bikash',
  'nagad',
  'rocket',
  'upay',
  'card',
  'cards',
  'visa',
  'mastercard',
  'online',
  'advance',
  'prepaid',
  'prepay',
];
const OTHER_METHOD_PHRASES = ['mobile banking'];
const PAID_WORDS = ['paid'];
const PAID_PHRASES = [
  'payment status',
  'payment received',
  'payment been received',
  'received my payment',
];

/** A question about where a parcel is: a parcel word beside a "where / status" word. */
const ORDER_SUBJECTS = [
  'order',
  'orders',
  'parcel',
  'parcels',
  'package',
  'packages',
  'delivery',
  'shipment',
  'shipments',
  'courier',
  'consignment',
];
const ORDER_CUES = [
  'where',
  'track',
  'tracking',
  'tracked',
  'status',
  'arrive',
  'arrived',
  'arrives',
  'arriving',
  'reach',
  'reached',
  'reaches',
  'dispatch',
  'dispatched',
  'shipped',
  'received',
  'receive',
  'late',
  'delayed',
  'delay',
  'update',
  'stuck',
];
const ORDER_PHRASES = [
  'my order',
  'my orders',
  'my parcel',
  'my package',
  'my delivery',
  'my shipment',
  'order status',
  'tracking number',
  'tracking code',
];
/** Starting an order is not a question about one. */
const ORDER_VETOES = [
  'place an order',
  'place a order',
  'place my order',
  'placing an order',
  'placing a order',
  'make an order',
];
const TRACKING_WORDS = [
  'track',
  'tracking',
  'tracked',
  'courier',
  'consignment',
  'reach',
  'reached',
  'reaches',
  'shipment',
];

const AVAILABILITY_WORDS = ['available', 'availability', 'stock', 'restock', 'restocked'];
const AVAILABILITY_PHRASES = [
  'in stock',
  'out of stock',
  'sold out',
  'do you have',
  'is there',
  'are there',
];
const VARIANT_WORDS = [
  'size',
  'sizes',
  'colour',
  'colours',
  'color',
  'colors',
  'variant',
  'variants',
  'option',
  'options',
  'shade',
  'shades',
];

const HOURS_PHRASES = [
  'opening hour',
  'opening hours',
  'opening time',
  'opening times',
  'closing time',
  'business hour',
  'business hours',
  'working hours',
  'store hours',
  'office hours',
  'what time do you open',
  'what time do you close',
  'what time are you open',
  'when are you open',
  'when are you closed',
  'when do you open',
  'when do you close',
  'are you open',
  'are you closed',
  'still open',
  'open now',
  'open today',
];

const GREETING_CORE = [
  'hello',
  'hi',
  'hey',
  'hii',
  'hlw',
  'salam',
  'salaam',
  'assalamu',
  'assalamualaikum',
  'walaikum',
];
const GREETING_FILLER = [
  'alaikum',
  'as',
  'good',
  'morning',
  'afternoon',
  'evening',
  'there',
  'team',
  'support',
  'sir',
  'madam',
  'dear',
  'please',
  'nilzora',
];

const STATUS_SENTENCE: Record<OrderStatus, string> = {
  pending: 'is waiting to be confirmed',
  confirmed: 'is confirmed and being prepared',
  processing: 'is being packed',
  shipped: 'has left our warehouse and is on its way',
  delivered: 'was delivered',
  cancelled: 'was cancelled',
};

/** Lower-cases and reduces a message to words: apostrophes vanish ("what's" -> "whats"). */
function normalise(body: string): string {
  return body
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The whole-word view of a message: its words, and its text padded for phrase tests. */
interface Words {
  list: string[];
  set: Set<string>;
  padded: string;
}

function wordsOf(body: string): Words {
  const text = normalise(body);
  const list = text === '' ? [] : text.split(' ');
  return { list, set: new Set(list), padded: ` ${text} ` };
}

function hasWord(words: Words, candidates: readonly string[]): boolean {
  return candidates.some((word) => words.set.has(word));
}

function hasPhrase(words: Words, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => words.padded.includes(` ${phrase} `));
}

/** A Nilzora order number as the store writes it: NZ followed by digits. */
export function orderNumberIn(body: string): string | null {
  const match = /\bNZ\d{3,}\b/i.exec(body);
  return match === null ? null : match[0].toUpperCase();
}

function contactLine(facts: AssistantFacts): string | null {
  if (facts.supportPhone !== null && facts.supportPhone !== '') {
    return `You can also reach us on ${facts.supportPhone}.`;
  }
  if (facts.supportEmail !== null && facts.supportEmail !== '') {
    return `You can also email ${facts.supportEmail}.`;
  }
  return null;
}

function presentHours(facts: AssistantFacts): string | null {
  // Quoted, never interpreted: the store's own words are the only source of its hours.
  if (facts.businessHours !== null && facts.businessHours.trim() !== '') {
    return `Our hours are ${facts.businessHours.trim()}.`;
  }
  return null;
}

/** Joins sentences, dropping the ones there is nothing to say. */
function paragraph(parts: (string | null)[]): string {
  return parts.filter((part): part is string => part !== null && part !== '').join(' ');
}

const FALLBACK_REPLY: AssistantReply = { intent: 'fallback', body: ASSISTANT_FALLBACK };

/** Which order a question is about, and how sure we are it is the one the customer means. */
type Target =
  | { kind: 'missing' }
  | { kind: 'none' }
  | { kind: 'named' | 'linked'; order: AssistantOrderFact }
  | { kind: 'latest'; order: AssistantOrderFact; others: boolean };

function targetOrder(named: string | null, facts: AssistantFacts): Target {
  if (named !== null) {
    // A number was named: only the customer's own order with exactly that number counts. Any
    // other order - linked, recent, or somebody else's - is never offered in its place.
    return facts.order !== null && facts.order.orderNumber.toUpperCase() === named
      ? { kind: 'named', order: facts.order }
      : { kind: 'missing' };
  }
  if (facts.order !== null) return { kind: 'linked', order: facts.order };
  const latest = facts.recentOrders[0];
  if (latest !== undefined) {
    return { kind: 'latest', order: latest, others: facts.recentOrders.length > 1 };
  }
  return { kind: 'none' };
}

/** "Order NZ1042" or, when the customer named no order, "Your most recent order (NZ1042)". */
function subjectOf(target: {
  kind: 'named' | 'linked' | 'latest';
  order: AssistantOrderFact;
}): string {
  return target.kind === 'latest'
    ? `Your most recent order (${target.order.orderNumber})`
    : `Order ${target.order.orderNumber}`;
}

function otherOrderHint(target: Target): string | null {
  return target.kind === 'latest' ? 'If you meant a different order, send its number.' : null;
}

/** Said whenever a number was named that is not one of the customer's own orders. */
function notFoundReply(): AssistantReply {
  // Deliberately the same words for "no such order" and "somebody else's order".
  return {
    intent: 'fallback',
    body: paragraph(["I can't find that order on your account.", ASSISTANT_FALLBACK]),
  };
}

const ASK_FOR_NUMBER = 'Send your order number (it starts with NZ) and I can look up its status.';

function orderStatusReply(
  words: Words,
  named: string | null,
  facts: AssistantFacts,
): AssistantReply {
  const target = targetOrder(named, facts);
  if (target.kind === 'missing') return notFoundReply();
  if (target.kind === 'none') return { intent: 'order_status', body: ASK_FOR_NUMBER };

  const { order } = target;
  const tracking = hasWord(words, TRACKING_WORDS);
  let trackingSentence: string | null = null;
  if (tracking && order.status !== 'delivered' && order.status !== 'cancelled') {
    const code = order.shipment?.trackingCode ?? null;
    if (code !== null && code !== '') {
      const courier = order.shipment?.providerName ?? null;
      trackingSentence = `It is with ${courier === null || courier === '' ? 'the courier' : courier} - tracking code ${code}.`;
    } else {
      trackingSentence = 'There is no courier tracking code on this order yet.';
    }
  }
  return {
    intent: 'order_status',
    body: paragraph([
      `${subjectOf(target)} ${STATUS_SENTENCE[order.status]}.`,
      trackingSentence,
      otherOrderHint(target),
      // The assistant reports the status and nothing further: no delivery date it cannot
      // know, and no promise about the courier.
      'A teammate can help with anything else about it.',
    ]),
  };
}

function cancelReply(named: string | null, facts: AssistantFacts): AssistantReply {
  const target = targetOrder(named, facts);
  if (target.kind === 'missing') return notFoundReply();
  if (target.kind === 'none') {
    return {
      intent: 'cancel',
      body: 'Send your order number (it starts with NZ) and I can check whether it can still be cancelled.',
    };
  }
  const { order } = target;
  const subject = subjectOf(target);
  if (order.status === 'pending') {
    // cancel_my_order accepts pending orders only, so this is exactly when it works.
    return {
      intent: 'cancel',
      body: paragraph([
        `${subject} is still waiting to be confirmed, so you can cancel it yourself.`,
        'Open it from your orders in your account and use the cancel option on the order page.',
        otherOrderHint(target),
      ]),
    };
  }
  if (order.status === 'cancelled') {
    return {
      intent: 'cancel',
      body: paragraph([`${subject} is already cancelled.`, otherOrderHint(target)]),
    };
  }
  return {
    intent: 'handoff',
    body: paragraph([
      `${subject} ${STATUS_SENTENCE[order.status]}, so it can no longer be cancelled from your account.`,
      otherOrderHint(target),
      ASSISTANT_FALLBACK,
    ]),
  };
}

function returnsReply(named: string | null, facts: AssistantFacts): AssistantReply {
  const days = facts.returnWindowDays;
  if (days === null || days <= 0) return FALLBACK_REPLY;
  const target = targetOrder(named, facts);
  if (target.kind === 'missing') return notFoundReply();

  const rule = `Returns can be requested for delivered orders within ${String(days)} days of delivery.`;
  const how = 'Open the order in your account and choose Request a return.';
  if (target.kind === 'none') {
    return { intent: 'returns', body: paragraph([rule, how]) };
  }
  const { order } = target;
  const subject = subjectOf(target);
  if (order.status === 'delivered' && order.returnEligible) {
    return {
      intent: 'returns',
      body: paragraph([
        `${subject} was delivered and is still inside the ${String(days)}-day return window.`,
        how,
        otherOrderHint(target),
      ]),
    };
  }
  if (order.status === 'delivered') {
    return {
      intent: 'returns',
      body: paragraph([
        `${subject} was delivered more than ${String(days)} days ago, so its return window has closed.`,
        otherOrderHint(target),
        ASSISTANT_FALLBACK,
      ]),
    };
  }
  if (order.status === 'cancelled') {
    return {
      intent: 'returns',
      body: paragraph([
        `${subject} was cancelled, so there is nothing to return.`,
        otherOrderHint(target),
      ]),
    };
  }
  return {
    intent: 'returns',
    body: paragraph([
      `${subject} has not been delivered yet, so it cannot be returned yet.`,
      rule,
      otherOrderHint(target),
    ]),
  };
}

function money(minor: number): string {
  return minor === 0 ? 'BDT 0 (free)' : receiptMoneyEnglish(minor);
}

function deliveryCostReply(facts: AssistantFacts): AssistantReply {
  const { insideDhaka, outsideDhaka } = facts.deliveryCharges;
  // Either amount missing means the store has not published its delivery charges.
  if (insideDhaka === null || outsideDhaka === null) return FALLBACK_REPLY;
  let zoneSentence: string | null = null;
  if (facts.defaultZone === 'inside_dhaka') {
    zoneSentence = `Your default saved address is inside Dhaka, so ${money(insideDhaka)} applies there.`;
  } else if (facts.defaultZone === 'outside_dhaka') {
    zoneSentence = `Your default saved address is outside Dhaka, so ${money(outsideDhaka)} applies there.`;
  }
  return {
    intent: 'delivery_cost',
    body: paragraph([
      `Delivery is ${money(insideDhaka)} inside Dhaka and ${money(outsideDhaka)} outside Dhaka.`,
      zoneSentence,
      'The charge on an order depends on its delivery address.',
    ]),
  };
}

function paymentReply(words: Words, named: string | null, facts: AssistantFacts): AssistantReply {
  // "Has my payment been received?" is about one order, so it is answered from that order.
  if (hasWord(words, PAID_WORDS) || hasPhrase(words, PAID_PHRASES)) {
    const target = targetOrder(named, facts);
    if (target.kind === 'missing') return notFoundReply();
    if (target.kind !== 'none' && target.order.paymentStatus !== null) {
      const { order } = target;
      const subject = subjectOf(target);
      const ref = subject.charAt(0).toLowerCase() + subject.slice(1);
      const line =
        order.paymentStatus === 'collected'
          ? `The payment for ${ref} has been received.`
          : order.paymentStatus === 'cancelled'
            ? `${subject} was cancelled, so nothing is due.`
            : `The payment for ${ref} is still pending. It is cash on delivery, so you pay when the parcel reaches you.`;
      return { intent: 'payment', body: paragraph([line, otherOrderHint(target)]) };
    }
  }

  const otherMethod = hasWord(words, OTHER_METHOD_WORDS) || hasPhrase(words, OTHER_METHOD_PHRASES);
  if (facts.codEnabled === true) {
    if (otherMethod) {
      return {
        intent: 'payment',
        body: 'Cash on delivery is the only payment method at the moment: you pay when the parcel reaches you. bKash, Nagad, cards and other online payments are not available.',
      };
    }
    return {
      intent: 'payment',
      body: paragraph([
        'Cash on delivery is available, so you pay when the parcel reaches you.',
        'It is currently our only payment method.',
      ]),
    };
  }
  if (facts.codEnabled === false && !otherMethod) {
    return {
      intent: 'payment',
      body: paragraph([
        'Cash on delivery is not being offered at the moment.',
        'A teammate will confirm the payment options available for your order.',
      ]),
    };
  }
  return FALLBACK_REPLY;
}

function productReply(words: Words, facts: AssistantFacts): AssistantReply {
  const { product } = facts;
  if (product === null) return FALLBACK_REPLY;
  // An unlisted product is not named, and not described.
  if (product.status !== 'active' || product.name === null || product.name === '') {
    return { intent: 'product', body: 'That product is not on sale right now.' };
  }
  const { name, variants } = product;

  const mentioned = [
    ...new Set(
      variants
        .flatMap((variant) => variant.options)
        .filter((option) => {
          const text = normalise(option);
          return text !== '' && hasPhrase(words, [text]);
        }),
    ),
  ];
  const asksAboutOption = hasWord(words, VARIANT_WORDS) || mentioned.length > 0;

  if (mentioned.length > 0) {
    // Only an option that really exists is answered, and only from its own stock.
    const matching = variants.filter((variant) =>
      mentioned.every((value) => variant.options.includes(value)),
    );
    if (matching.length === 0) return FALLBACK_REPLY;
    const inStock = matching.reduce((sum, variant) => sum + Math.max(variant.stock, 0), 0) > 0;
    const label = (matching[0]?.options ?? [])
      .filter((value) => mentioned.includes(value))
      .join(', ');
    return {
      intent: 'product',
      body: inStock
        ? `${name} in ${label} is in stock.`
        : `${name} in ${label} is out of stock at the moment.`,
    };
  }
  // Size, colour and option questions are never answered from the product-level total.
  if (asksAboutOption) return FALLBACK_REPLY;

  if (variants.length > 0) {
    if (!variants.some((variant) => variant.stock > 0)) {
      return { intent: 'product', body: `${name} is out of stock at the moment.` };
    }
    return {
      intent: 'product',
      body: `${name} is in stock in some options. Tell me the size or colour you want and I can check it.`,
    };
  }
  return {
    intent: 'product',
    body: product.stock <= 0 ? `${name} is out of stock at the moment.` : `${name} is in stock.`,
  };
}

function isPlainGreeting(words: Words): boolean {
  return (
    words.list.length > 0 &&
    hasWord(words, GREETING_CORE) &&
    words.list.every((word) => GREETING_CORE.includes(word) || GREETING_FILLER.includes(word))
  );
}

/**
 * Decides whether this message gets an automatic answer, and what it says.
 *
 * Order matters: a request for a person outranks everything, then cancelling, delivery cost,
 * returns and payment (so "cash on delivery" is a payment question, not a parcel one), then a
 * question about a specific order, then stock and hours. A fact the store has not published is
 * never guessed - it becomes the fixed fallback. Every answer is built from a fact passed in.
 */
export function resolveAssistantReply(input: {
  body: string;
  facts: AssistantFacts;
}): AssistantReply | null {
  const words = wordsOf(input.body);
  if (words.list.length === 0) return null;
  const { facts } = input;
  const named = orderNumberIn(input.body);

  if (hasWord(words, HANDOFF_WORDS) || hasPhrase(words, HANDOFF_PHRASES)) {
    return {
      intent: 'handoff',
      body: paragraph([
        `I have passed this to a ${facts.storeName} teammate, who will reply here.`,
        contactLine(facts),
      ]),
    };
  }

  if (hasWord(words, CANCEL_WORDS) && (named !== null || hasWord(words, CANCEL_SUBJECTS))) {
    return cancelReply(named, facts);
  }

  if (
    (hasWord(words, DELIVERY_WORDS) && hasWord(words, COST_WORDS)) ||
    (hasPhrase(words, ['how much']) && hasWord(words, DELIVERY_WORDS))
  ) {
    return deliveryCostReply(facts);
  }

  if (hasWord(words, RETURN_WORDS) || hasPhrase(words, RETURN_PHRASES)) {
    return returnsReply(named, facts);
  }

  if (hasWord(words, PAYMENT_WORDS) || hasPhrase(words, PAYMENT_PHRASES)) {
    return paymentReply(words, named, facts);
  }

  const startsAnOrder = named === null && hasPhrase(words, ORDER_VETOES);
  if (
    !startsAnOrder &&
    (named !== null ||
      hasPhrase(words, ORDER_PHRASES) ||
      (hasWord(words, ORDER_SUBJECTS) && hasWord(words, ORDER_CUES)))
  ) {
    return orderStatusReply(words, named, facts);
  }

  if (
    hasWord(words, AVAILABILITY_WORDS) ||
    hasPhrase(words, AVAILABILITY_PHRASES) ||
    hasWord(words, VARIANT_WORDS)
  ) {
    return productReply(words, facts);
  }

  if (hasPhrase(words, HOURS_PHRASES)) {
    const hours = presentHours(facts);
    if (hours === null) return FALLBACK_REPLY;
    return { intent: 'hours', body: paragraph([hours, contactLine(facts)]) };
  }

  if (facts.firstContact && isPlainGreeting(words)) {
    return {
      intent: 'greeting',
      body: paragraph([
        `Hello, and thanks for writing to ${facts.storeName}.`,
        presentHours(facts),
        ASSISTANT_FALLBACK,
      ]),
    };
  }

  // Nothing above could be answered from a fact the store actually holds. The customer is told
  // exactly what happens next instead of being left with silence.
  return FALLBACK_REPLY;
}
