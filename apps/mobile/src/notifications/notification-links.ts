import { orderNumberSchema } from '@nilzora/contracts';

/*
 * Where a tapped notification leads. The payload is data from outside the app (a server
 * today, anything that can deliver a notification tomorrow), so it is never trusted: only
 * a well-formed order number opens a screen, and only the app's own order screen. Anything
 * else - another key, another shape, a path, a URL - is ignored.
 *
 * The sender also puts its `tag` (the notification's identity, which Android uses to replace
 * a repeated delivery instead of showing it twice) in the same data. It is not read here.
 */

/** The order number in a notification's data, or null unless it is exactly one. */
export function orderNumberFromData(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const value = (data as Record<string, unknown>).orderNumber;
  const parsed = orderNumberSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** A product slug is only a route parameter when it looks like one the catalogue could issue. */
const productSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The product slug in a product announcement's data, or null. Same rule as above: the payload
 * comes from outside the app, so a path, a URL or anything unexpected opens nothing.
 */
export function productSlugFromData(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const value = (data as Record<string, unknown>).productSlug;
  if (typeof value !== 'string' || value.length > 120) return null;
  return productSlugPattern.test(value) ? value : null;
}

/** The category slug in a broadcast's data, or null. Same rule: a slug, never a path or a URL. */
export function categorySlugFromData(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const value = (data as Record<string, unknown>).categorySlug;
  if (typeof value !== 'string' || value.length > 120) return null;
  return productSlugPattern.test(value) ? value : null;
}

/** The fixed screens a broadcast may open, by the name the server sends. */
const SCREEN_ROUTES = {
  home: '/',
  categories: '/categories',
  brands: '/brands',
  vouchers: '/vouchers',
  wishlist: '/wishlist',
  account: '/account',
} as const;
export type NotificationScreen = (typeof SCREEN_ROUTES)[keyof typeof SCREEN_ROUTES];

/** The screen named in a broadcast's data, or null unless it is exactly one of the fixed set. */
export function screenFromData(data: unknown): NotificationScreen | null {
  if (typeof data !== 'object' || data === null) return null;
  const value = (data as Record<string, unknown>).screen;
  if (typeof value !== 'string') return null;
  return Object.hasOwn(SCREEN_ROUTES, value)
    ? SCREEN_ROUTES[value as keyof typeof SCREEN_ROUTES]
    : null;
}

/** A return request id as the API issues it (a UUID). */
const returnIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A screen the inbox can open: a fixed path, or a dynamic route with its one parameter. */
export type NotificationTarget =
  | '/orders'
  | '/returns'
  | { pathname: '/order/[orderNumber]'; params: { orderNumber: string } }
  | { pathname: '/returns/[returnId]'; params: { returnId: string } };

/**
 * Where an inbox row leads in the app. A row's `actionPath` is a website path
 * (`/account/orders/<orderNumber>`, `/account/returns/<id>`), the same for order, shipment,
 * return and refund updates; the app has its own screens for them. Only those shapes, with a
 * well-formed order number or return id, open anything. Anything else opens nothing.
 */
export function notificationTarget(actionPath: string | null): NotificationTarget | null {
  if (actionPath === null) return null;
  const [path = ''] = actionPath.split(/[?#]/);
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'account' || parts.length > 3) return null;
  const [, section, id] = parts;
  if (section === 'orders') {
    if (id === undefined) return '/orders';
    const parsed = orderNumberSchema.safeParse(id);
    return parsed.success
      ? { pathname: '/order/[orderNumber]', params: { orderNumber: parsed.data } }
      : null;
  }
  if (section === 'returns') {
    if (id === undefined) return '/returns';
    return returnIdPattern.test(id)
      ? { pathname: '/returns/[returnId]', params: { returnId: id } }
      : null;
  }
  return null;
}
