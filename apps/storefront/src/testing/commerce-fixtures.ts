import type {
  Address,
  CartLine,
  CartQuote,
  CustomerShipment,
  OrderDetail,
  OrderSummary,
  PlaceOrderResponse,
} from '@nilzora/contracts';
import { ApiError, type SessionRead, type SessionState } from '@nilzora/web-session';
import { expect } from 'vitest';

/* Cart, address and order data shaped like the API's answers, for storefront tests. */

export const LAMP_ID = '0d000000-0000-4000-8000-000000000001';
export const MUG_ID = '0d000000-0000-4000-8000-000000000002';
export const HOME_ID = 'ad000000-0000-4000-8000-000000000001';
export const OFFICE_ID = 'ad000000-0000-4000-8000-000000000002';
export const ORDER_KEY = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

export function cartLine(overrides: Partial<CartLine> = {}): CartLine {
  return {
    productId: LAMP_ID,
    variantId: null,
    variantLabel: null,
    slug: 'brass-table-lamp',
    name: 'Brass table lamp',
    sku: 'NZ-LAMP-01',
    unitPriceMinor: 125_000,
    compareAtPriceMinor: null,
    listPriceMinor: null,
    campaignDiscountMinor: 0,
    campaign: null,
    quantity: 2,
    lineTotalMinor: 250_000,
    availableQuantity: 5,
    problem: null,
    image: null,
    ...overrides,
  };
}

export function cartQuote(overrides: Partial<CartQuote> = {}): CartQuote {
  return {
    lines: [cartLine()],
    itemCount: 2,
    subtotalMinor: 250_000,
    campaignDiscountMinor: 0,
    deliveryZone: null,
    shippingFeeMinor: null,
    totalMinor: null,
    purchasable: true,
    ...overrides,
  };
}

/** A checkout quote: delivered inside Dhaka for ৳60. */
export function checkoutQuote(overrides: Partial<CartQuote> = {}): CartQuote {
  return cartQuote({
    deliveryZone: 'inside_dhaka',
    shippingFeeMinor: 6_000,
    totalMinor: 256_000,
    ...overrides,
  });
}

export function address(overrides: Partial<Address> = {}): Address {
  return {
    id: HOME_ID,
    label: 'Home',
    recipientName: 'Rahima Khatun',
    phone: '+8801712345678',
    division: 'Dhaka',
    district: 'Dhaka',
    area: 'Dhanmondi',
    addressLine: 'House 12, Road 5',
    postalCode: '1205',
    landmark: null,
    isDefault: true,
    deliveryZone: 'inside_dhaka',
    createdAt: '2026-10-20T08:00:00.000Z',
    updatedAt: '2026-10-20T08:00:00.000Z',
    ...overrides,
  };
}

export const officeAddress = (overrides: Partial<Address> = {}): Address =>
  address({
    id: OFFICE_ID,
    label: 'Office',
    recipientName: 'Rahima Khatun',
    division: 'Chattogram',
    district: 'Chattogram',
    area: 'Agrabad',
    addressLine: 'Level 4, Agrabad Tower',
    postalCode: null,
    isDefault: false,
    deliveryZone: 'outside_dhaka',
    ...overrides,
  });

export function orderDetail(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    orderNumber: 'NZ100042',
    status: 'pending',
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    itemCount: 3,
    totalMinor: 316_000,
    placedAt: '2026-10-24T08:05:00.000Z',
    preview: [],
    currency: 'BDT',
    subtotalMinor: 310_000,
    shippingFeeMinor: 6_000,
    discountMinor: 0,
    deliveryZone: 'inside_dhaka',
    shippingAddress: {
      recipientName: 'Rahima Khatun',
      phone: '+8801712345678',
      division: 'Dhaka',
      district: 'Dhaka',
      area: 'Dhanmondi',
      addressLine: 'House 12, Road 5',
      postalCode: '1205',
      landmark: 'Opposite the lake',
    },
    customerNote: null,
    cancelReason: null,
    cancelledAt: null,
    items: [
      {
        orderItemId: 1,
        productId: LAMP_ID,
        variantId: null,
        variantLabel: null,
        productName: 'Brass table lamp',
        productSlug: 'brass-table-lamp',
        sku: 'NZ-LAMP-01',
        unitPriceMinor: 125_000,
        quantity: 2,
        lineTotalMinor: 250_000,
        image: {
          url: 'https://media.example.com/products/p/1/full.webp',
          thumbUrl: 'https://media.example.com/products/p/1/thumb.webp',
          alt: 'A brass table lamp on a wooden side table',
        },
        regularPriceMinor: 125_000,
        catalogPriceMinor: 125_000,
        campaignId: null,
        campaignTitle: null,
        campaignDiscountMinor: 0,
      },
      {
        orderItemId: 2,
        productId: MUG_ID,
        variantId: null,
        variantLabel: null,
        productName: 'Ceramic mug',
        productSlug: 'ceramic-mug',
        sku: 'NZ-MUG-01',
        // A line whose picture is gone: the order still reads, with the placeholder.
        image: null,
        regularPriceMinor: 60_000,
        catalogPriceMinor: 60_000,
        campaignId: null,
        campaignTitle: null,
        campaignDiscountMinor: 0,
        unitPriceMinor: 60_000,
        quantity: 1,
        lineTotalMinor: 60_000,
      },
    ],
    history: [{ fromStatus: null, toStatus: 'pending', at: '2026-10-24T08:05:00.000Z' }],
    canCancel: true,
    ...overrides,
  };
}

export function placedOrder(created = true, overrides: Partial<OrderDetail> = {}) {
  return { order: orderDetail(overrides), created } satisfies PlaceOrderResponse;
}

/** A forward shipment with Steadfast, in transit, as the customer's shipments read returns it. */
export function customerShipment(overrides: Partial<CustomerShipment> = {}): CustomerShipment {
  return {
    id: '5e000000-0000-4000-8000-000000000001',
    kind: 'forward',
    returnRequestId: null,
    providerName: 'Steadfast Courier',
    status: 'in_transit',
    trackingCode: 'SF123456789',
    trackingUrl: 'https://steadfast.com.bd/t/SF123456789',
    isTest: false,
    bookedAt: '2026-10-25T04:00:00.000Z',
    deliveredAt: null,
    events: [
      { status: 'booked', occurredAt: '2026-10-25T04:00:00.000Z' },
      { status: 'picked_up', occurredAt: '2026-10-25T09:30:00.000Z' },
      { status: 'in_transit', occurredAt: '2026-10-26T02:15:00.000Z' },
    ],
    ...overrides,
  };
}

export function orderSummary(overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    orderNumber: 'NZ100042',
    status: 'pending',
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    itemCount: 3,
    totalMinor: 316_000,
    placedAt: '2026-10-24T08:05:00.000Z',
    preview: [
      {
        productName: 'Brass table lamp',
        variantLabel: null,
        quantity: 2,
        image: {
          url: 'https://media.example.com/products/p/1/full.webp',
          thumbUrl: 'https://media.example.com/products/p/1/thumb.webp',
          alt: 'A brass table lamp on a wooden side table',
        },
      },
      { productName: 'Ceramic mug', variantLabel: null, quantity: 1, image: null },
    ],
    ...overrides,
  };
}

export const signedIn: SessionState = {
  status: 'signed_in',
  user: {
    id: '3f8e2a52-7b1c-4d3e-9f0a-1b2c3d4e5f60',
    email: 'rahima@example.com',
    role: 'customer',
    permissions: [],
    profile: {
      fullName: 'Rahima Khatun',
      avatar: null,
      googleAvatar: null,
      phone: '+8801712345678',
      status: 'active',
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-01T08:00:00.000Z',
    },
  },
};

/** An API refusal as the client raises it; `message` stands in for the API's own words. */
export function apiError(status: number, code: string, details?: unknown): ApiError {
  return new ApiError(status, code, `API says: ${code}`, 'req-test-1', { details });
}

/**
 * session.read() as documented: 401 is signed out, an outage is unavailable, and any
 * other error is rethrown for the page to map.
 */
export async function fakeRead<A, T>(
  api: A,
  call: (api: A, accessToken: string) => Promise<T>,
): Promise<SessionRead<T>> {
  try {
    return { kind: 'ok', value: await call(api, 'access-token') };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) return { kind: 'signed_out' };
      if (error.code === 'network_error' || error.code === 'timeout' || error.status >= 500) {
        return { kind: 'unavailable' };
      }
    }
    throw error;
  }
}

/** The digest Next.js gives the error redirect() throws, for `rejects.toMatchObject`. */
export function redirectedTo(path: string) {
  return { digest: expect.stringContaining(`;${path};`) as unknown };
}

/** The digest of the error notFound() throws. */
export const NOT_FOUND = { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' };
