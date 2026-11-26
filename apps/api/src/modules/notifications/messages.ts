import { orderNumberSchema } from '@nilzora/contracts';

/*
 * What the customer's phone shows. The texts are fixed here, never taken from a request,
 * and carry only the order number: no name, address, phone number or amount. The data
 * payload is `{ orderNumber }` plus the notification's own identity, which the sender adds
 * as `tag` on every attempt (fcm.ts). The app reads the order number when the notification
 * is tapped (apps/mobile/src/notifications/notification-links.ts) and ignores the rest.
 */

export interface OrderNotification {
  title: string;
  body: string;
  data: { orderNumber: string };
}

const TEXTS: Record<string, (orderNumber: string) => { title: string; body: string }> = {
  confirmed: (n) => ({ title: 'Order confirmed', body: `Order ${n} has been confirmed.` }),
  processing: (n) => ({ title: 'Order being prepared', body: `Order ${n} is being prepared.` }),
  shipped: (n) => ({ title: 'Order on its way', body: `Order ${n} has been shipped.` }),
  delivered: (n) => ({ title: 'Order delivered', body: `Order ${n} has been delivered.` }),
  cancelled: (n) => ({ title: 'Order cancelled', body: `Order ${n} has been cancelled.` }),
};

/** The notification for an order reaching `status`, or null when that status sends none. */
export function orderStatusNotification(
  orderNumber: string,
  status: string,
): OrderNotification | null {
  const text = Object.hasOwn(TEXTS, status) ? TEXTS[status] : undefined;
  const number = orderNumberSchema.safeParse(orderNumber);
  if (!text || !number.success) return null;
  return { ...text(number.data), data: { orderNumber: number.data } };
}

/*
 * Courier shipment news. The outbox row says only the order and the new shipment status
 * (not whether the shipment is a delivery, an exchange or a return pickup), so these texts
 * are true for every kind; the in-app notification, written by the database, is worded per
 * kind. No courier name, tracking code, address or amount is sent to the phone.
 */
const SHIPMENT_TEXTS: Record<string, (orderNumber: string) => { title: string; body: string }> = {
  booked: (n) => ({ title: 'Courier booked', body: `A courier has been booked for order ${n}.` }),
  picked_up: (n) => ({
    title: 'Parcel picked up',
    body: `The courier has picked up the parcel for order ${n}.`,
  }),
  out_for_delivery: (n) => ({
    title: 'Out for delivery',
    body: `The parcel for order ${n} is out for delivery.`,
  }),
  delivered: (n) => ({
    title: 'Parcel delivered',
    body: `The courier reports the parcel for order ${n} as delivered.`,
  }),
  partially_delivered: (n) => ({
    title: 'Parcel partly delivered',
    body: `Part of the parcel for order ${n} was delivered.`,
  }),
  delivery_failed: (n) => ({
    title: 'Delivery attempt failed',
    body: `The courier could not deliver the parcel for order ${n}. They will contact you or try again.`,
  }),
  return_initiated: (n) => ({
    title: 'Parcel being returned',
    body: `The parcel for order ${n} is being returned to the store.`,
  }),
  returned: (n) => ({
    title: 'Parcel returned',
    body: `The parcel for order ${n} has come back to the store.`,
  }),
  cancelled: (n) => ({
    title: 'Shipment cancelled',
    body: `A courier shipment for order ${n} has been cancelled.`,
  }),
};

/**
 * The notification for a shipment of an order reaching `status`, or null when that status
 * sends none. The data payload stays `{ orderNumber }`, so tapping it opens the order.
 */
export function shipmentStatusNotification(
  orderNumber: string,
  status: string,
): OrderNotification | null {
  const text = Object.hasOwn(SHIPMENT_TEXTS, status) ? SHIPMENT_TEXTS[status] : undefined;
  const number = orderNumberSchema.safeParse(orderNumber);
  if (!text || !number.success) return null;
  return { ...text(number.data), data: { orderNumber: number.data } };
}

/** A public product slug, as the catalogue stores it. Anything else opens nothing. */
const productSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A staff broadcast, as sent: the words staff wrote (already length-checked by the database)
 * and, when it links to a product, the slug the app opens. Anything malformed is not sent.
 */
export function broadcastAnnouncement(
  title: string | null,
  body: string | null,
  slug: string,
  linkPath: string | null = null,
): ProductAnnouncement | null {
  const cleanTitle = (title ?? '').trim();
  const cleanBody = (body ?? '').trim();
  if (cleanTitle === '' || cleanTitle.length > 65 || cleanBody === '' || cleanBody.length > 240) {
    return null;
  }
  const linked = slug !== '' && productSlugPattern.test(slug) && slug.length <= 120;
  if (linked) return { title: cleanTitle, body: cleanBody, data: { productSlug: slug } };
  return { title: cleanTitle, body: cleanBody, data: linkData(linkPath) };
}

/**
 * The part of a notification that says where a tap leads, from a store path staff chose. Only
 * shapes the app knows how to open are sent: a product, a category, or one of a few fixed screens.
 * Anything else sends nothing, so the notification simply opens the app.
 */
const SCREENS: Readonly<Record<string, string>> = {
  '/': 'home',
  '/categories': 'categories',
  '/brands': 'brands',
  '/vouchers': 'vouchers',
  '/wishlist': 'wishlist',
  '/account': 'account',
};

export function linkData(linkPath: string | null): ProductAnnouncement['data'] {
  if (linkPath === null) return {};
  const [path = ''] = linkPath.split(/[?#]/);
  const product = /^\/products\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(path)?.[1];
  if (product !== undefined && product.length <= 120) return { productSlug: product };
  const category = /^\/categories\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(path)?.[1];
  if (category !== undefined && category.length <= 120) return { categorySlug: category };
  const screen = SCREENS[path];
  return screen === undefined ? {} : { screen };
}

export interface ProductAnnouncement {
  title: string;
  body: string;
  /** The only things the app reads: the product, category or screen to open. */
  data: { productSlug?: string; categorySlug?: string; screen?: string };
}

/**
 * The message for a newly published product. The title is fixed and the body carries the
 * product's own name; both come from the announcement row, never from a request.
 */
export function productAnnouncement(
  name: string,
  slug: string,
  words: { title: string | null; body: string | null } = { title: null, body: null },
): ProductAnnouncement | null {
  const clean = name.trim();
  if (clean === '' || clean.length > 120) return null;
  if (!productSlugPattern.test(slug) || slug.length > 120) return null;
  // The store's own template, already filled in when the product was published; the fixed
  // words are only for an announcement written before templates existed.
  const title = words.title?.trim() ?? '';
  const body = words.body?.trim() ?? '';
  return {
    title: title === '' || title.length > 65 ? 'New at Nilzora' : title,
    body: body === '' || body.length > 240 ? `Discover ${clean} — now available.` : body,
    data: { productSlug: slug },
  };
}
