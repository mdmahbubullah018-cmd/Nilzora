import type { CheckoutQuote, Address, CartLine, CartQuote, OrderDetail } from '@nilzora/contracts';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { simulateRestart } from '../features/checkout/idempotency';
import { createFakeApiClient, fakeStoreProfile, type FakeApiClient } from './api-fakes';
import { PRODUCT_A, PRODUCT_B } from './cart-fakes';
import {
  createTestQueryClient,
  renderWithProviders,
  type RenderWithProvidersOptions,
} from './render-with-providers';

/*
 * Cart, address and order fixtures for the cart, checkout and address tests. Not imported by
 * the app, so never bundled. Amounts are poisha (5_000_00 = ৳5,000).
 */

export const ADDRESS_HOME_ID = '9b2c1f3e-5a4d-4c8e-8f10-2d3e4f5a6b7c';
export const ADDRESS_OFFICE_ID = 'c4d5e6f7-1a2b-4c3d-9e4f-5a6b7c8d9e0f';

export const ADDRESS_HOME: Address = {
  id: ADDRESS_HOME_ID,
  label: 'Home',
  recipientName: 'Ayesha Rahman',
  phone: '+8801712345678',
  division: 'Dhaka',
  district: 'Dhaka',
  area: 'Dhanmondi',
  addressLine: 'House 12, Road 5, Block C',
  postalCode: '1209',
  landmark: null,
  isDefault: true,
  deliveryZone: 'inside_dhaka',
  createdAt: '2026-01-05T10:00:00.000Z',
  updatedAt: '2026-01-05T10:00:00.000Z',
};

export const ADDRESS_OFFICE: Address = {
  id: ADDRESS_OFFICE_ID,
  label: null,
  recipientName: 'Rahim Uddin',
  phone: '+8801912345678',
  division: 'Chattogram',
  district: 'Cumilla',
  area: 'Kotbari',
  addressLine: 'Hall road, 2nd floor',
  postalCode: null,
  landmark: 'the post office',
  isDefault: false,
  deliveryZone: 'outside_dhaka',
  createdAt: '2026-01-06T10:00:00.000Z',
  updatedAt: '2026-01-06T10:00:00.000Z',
};

export function cartLine(overrides: Partial<CartLine> & { productId: string }): CartLine {
  return {
    variantId: null,
    variantLabel: null,
    slug: 'blue-mug',
    name: 'Blue mug',
    sku: 'MUG-1',
    unitPriceMinor: 50_000,
    compareAtPriceMinor: null,
    listPriceMinor: null,
    campaignDiscountMinor: 0,
    campaign: null,
    quantity: 1,
    lineTotalMinor: 50_000,
    availableQuantity: 10,
    problem: null,
    image: null,
    ...overrides,
  };
}

/** What the API answers for a cart: the totals follow the lines the way the server adds them. */
export function cartQuote(lines: CartLine[], overrides: Partial<CartQuote> = {}): CartQuote {
  const ok = lines.filter((line) => line.problem === null);
  return {
    lines,
    itemCount: ok.reduce((total, line) => total + line.quantity, 0),
    subtotalMinor: ok.reduce((total, line) => total + (line.lineTotalMinor ?? 0), 0),
    campaignDiscountMinor: 0,
    deliveryZone: null,
    shippingFeeMinor: null,
    totalMinor: null,
    purchasable: lines.every((line) => line.problem === null),
    ...overrides,
  };
}

/** A checkout quote: a cart quote with the delivery charge of the address's zone and the total. */
export function checkoutQuote(
  lines: CartLine[],
  delivery: { zone: 'inside_dhaka' | 'outside_dhaka'; feeMinor: number } = {
    zone: 'inside_dhaka',
    feeMinor: 6_000,
  },
  overrides: Partial<CheckoutQuote> = {},
): CheckoutQuote {
  const base = cartQuote(lines);
  return {
    ...base,
    deliveryZone: delivery.zone,
    shippingFeeMinor: delivery.feeMinor,
    totalMinor: base.subtotalMinor + delivery.feeMinor,
    discountMinor: 0,
    coupon: null,
    couponProblem: null,
    ...overrides,
  };
}

export const MUG = cartLine({ productId: PRODUCT_A, quantity: 2, lineTotalMinor: 100_000 });
export const LAMP = cartLine({
  productId: PRODUCT_B,
  slug: 'desk-lamp',
  name: 'Desk lamp',
  sku: 'LAMP-1',
  unitPriceMinor: 120_000,
  quantity: 1,
  lineTotalMinor: 120_000,
});

export function orderDetail(orderNumber = 'NZ100042'): OrderDetail {
  return {
    orderNumber,
    status: 'pending',
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    itemCount: 3,
    totalMinor: 226_000,
    placedAt: '2026-10-25T10:00:00.000Z',
    preview: [],
    currency: 'BDT',
    subtotalMinor: 220_000,
    shippingFeeMinor: 6_000,
    discountMinor: 0,
    deliveryZone: 'inside_dhaka',
    shippingAddress: {
      recipientName: ADDRESS_HOME.recipientName,
      phone: ADDRESS_HOME.phone,
      division: ADDRESS_HOME.division,
      district: ADDRESS_HOME.district,
      area: ADDRESS_HOME.area,
      addressLine: ADDRESS_HOME.addressLine,
      postalCode: ADDRESS_HOME.postalCode,
      landmark: ADDRESS_HOME.landmark,
    },
    customerNote: null,
    cancelReason: null,
    cancelledAt: null,
    items: [
      {
        orderItemId: 1,
        productId: PRODUCT_A,
        variantId: null,
        variantLabel: null,
        productName: 'Blue mug',
        productSlug: 'blue-mug',
        sku: 'MUG-1',
        unitPriceMinor: 50_000,
        regularPriceMinor: null,
        catalogPriceMinor: null,
        campaignId: null,
        campaignTitle: null,
        campaignDiscountMinor: 0,
        image: null,
        quantity: 2,
        lineTotalMinor: 100_000,
      },
    ],
    history: [{ fromStatus: null, toStatus: 'pending', at: '2026-10-25T10:00:00.000Z' }],
    canCancel: true,
  };
}

/**
 * A test QueryClient for screens that save something. The shared test client stops its
 * queries from keeping a timer alive after a test, but a finished mutation still holds a
 * five-minute garbage-collection timer, which would keep Jest from exiting: this client
 * keeps finished mutations without one (the test cleanup clears them).
 */
export function createCommerceQueryClient(): QueryClient {
  const queryClient = createTestQueryClient();
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({
    ...defaults,
    mutations: { ...defaults.mutations, gcTime: Infinity },
  });
  return queryClient;
}

/** renderWithProviders with a createCommerceQueryClient() unless a client is given. */
export function renderCommerce(ui: ReactElement, options: RenderWithProvidersOptions = {}) {
  return renderWithProviders(ui, {
    ...options,
    queryClient: options.queryClient ?? createCommerceQueryClient(),
  });
}

/** What the mug and lamp checkout holds: 2 mugs and 1 lamp. */
export const CHECKOUT_ITEMS = [
  { productId: PRODUCT_A, quantity: 2 },
  { productId: PRODUCT_B, quantity: 1 },
];

/** Delivery charges the fake API applies: ৳60 inside Dhaka, ৳120 outside. */
export const FEE_INSIDE_DHAKA = 6_000;
export const FEE_OUTSIDE_DHAKA = 12_000;

/**
 * A fake API for checkout: it lists `addresses` and prices `lines` for whichever address is
 * asked about (an address in Dhaka pays the inside-Dhaka charge, any other the outside charge).
 * Tests override single methods afterwards.
 */
export function createCheckoutApi(
  options: { addresses?: Address[]; lines?: CartLine[]; codAvailable?: boolean } = {},
): FakeApiClient {
  const { addresses = [ADDRESS_HOME, ADDRESS_OFFICE], lines = [MUG, LAMP] } = options;
  const api = createFakeApiClient();
  api.listAddresses.mockResolvedValue({ addresses });
  if (options.codAvailable !== undefined) {
    // The store's own payment switch, which the checkout reads before it offers a method.
    api.publicStoreProfile.mockResolvedValue({
      profile: fakeStoreProfile({ codAvailable: options.codAvailable }),
    });
  }
  api.quoteCheckout.mockImplementation((_token, body) => {
    const outside =
      addresses.find((a) => a.id === body.addressId)?.deliveryZone === 'outside_dhaka';
    return Promise.resolve({
      quote: outside
        ? checkoutQuote(lines, { zone: 'outside_dhaka', feeMinor: FEE_OUTSIDE_DHAKA })
        : checkoutQuote(lines, { zone: 'inside_dhaka', feeMinor: FEE_INSIDE_DHAKA }),
    });
  });
  api.placeOrder.mockResolvedValue({ order: orderDetail(), created: true });
  return api;
}

/** Forgets every checkout attempt, in memory and on the (mocked) device. */
export async function resetCheckoutAttempts(): Promise<void> {
  simulateRestart();
  await AsyncStorage.clear();
}
