import type {
  Address,
  CartQuote,
  OrderDetail,
  ProductDetail,
  ProductListResponse,
} from '@nilzora/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './client';

const LAMP = '0d000000-0000-4000-8000-000000000001';
const ADDRESS_ID = 'ad000000-0000-4000-8000-0000000000a1';

const product: ProductDetail = {
  id: LAMP,
  slug: 'desk-lamp',
  sku: 'DESK-LAMP',
  name: 'Desk Lamp',
  summary: null,
  description: 'A warm reading light.',
  priceMinor: 10_000,
  compareAtPriceMinor: null,
  availability: 'in_stock',
  maxOrderQuantity: 3,
  isFeatured: true,
  category: { slug: 'home-kitchen', name: 'Home & Kitchen' },
  image: null,
  brand: null,
  images: [],
  variants: [],
  campaign: null,
};

const { description: _description, images: _images, variants: _variants, ...summary } = product;
const productPage: ProductListResponse = {
  items: [summary],
  page: 2,
  pageSize: 12,
  total: 13,
  totalPages: 2,
};

const quote: CartQuote = {
  lines: [
    {
      productId: LAMP,
      variantId: null,
      variantLabel: null,
      slug: 'desk-lamp',
      name: 'Desk Lamp',
      sku: 'DESK-LAMP',
      unitPriceMinor: 10_000,
      compareAtPriceMinor: null,
      listPriceMinor: null,
      campaignDiscountMinor: 0,
      campaign: null,
      quantity: 2,
      lineTotalMinor: 20_000,
      availableQuantity: 3,
      problem: null,
      image: null,
    },
  ],
  itemCount: 2,
  subtotalMinor: 20_000,
  campaignDiscountMinor: 0,
  deliveryZone: 'inside_dhaka',
  shippingFeeMinor: 7_000,
  totalMinor: 27_000,
  purchasable: true,
};

const address: Address = {
  id: ADDRESS_ID,
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
  createdAt: '2026-10-24T08:00:00.000Z',
  updatedAt: '2026-10-24T08:00:00.000Z',
};

const order: OrderDetail = {
  orderNumber: 'NZ100042',
  status: 'pending',
  paymentMethod: 'cod',
  paymentStatus: 'pending',
  itemCount: 2,
  totalMinor: 27_000,
  placedAt: '2026-10-24T08:05:00.000Z',
  preview: [],
  currency: 'BDT',
  subtotalMinor: 20_000,
  shippingFeeMinor: 7_000,
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
    landmark: null,
  },
  customerNote: null,
  cancelReason: null,
  cancelledAt: null,
  items: [
    {
      orderItemId: 1,
      productId: LAMP,
      variantId: null,
      variantLabel: null,
      productName: 'Desk Lamp',
      productSlug: 'desk-lamp',
      sku: 'DESK-LAMP',
      unitPriceMinor: 10_000,
      quantity: 2,
      lineTotalMinor: 20_000,
      regularPriceMinor: 10_000,
      catalogPriceMinor: 10_000,
      campaignId: null,
      campaignTitle: null,
      campaignDiscountMinor: 0,
      image: null,
    },
  ],
  history: [{ fromStatus: null, toStatus: 'pending', at: '2026-10-24T08:05:00.000Z' }],
  canCancel: true,
};

const placeBody = {
  idempotencyKey: 'e1000000-0000-4000-8000-000000000001',
  addressId: ADDRESS_ID,
  items: [{ productId: LAMP, quantity: 2 }],
  expectedTotalMinor: 27_000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(response: Response) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  const client = createApiClient({ baseUrl: 'http://localhost:4000', fetch: fetchMock });
  const sent = () => {
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    return {
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : init?.body,
    };
  };
  return { client, sent, fetchMock };
}

describe('catalog calls', () => {
  it('lists categories without credentials', async () => {
    const categories = {
      categories: [
        {
          slug: 'home-kitchen',
          name: 'Home',
          description: null,
          productCount: 4,
          // Defaults the category contract fills in when a payload omits them.
          image: null,
          parentSlug: null,
          depth: 1,
          isFeatured: false,
        },
      ],
    };
    const { client, sent } = setup(jsonResponse(categories));

    await expect(client.listCategories()).resolves.toStrictEqual(categories);
    expect(sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/catalog/categories',
      method: 'GET',
    });
    expect(sent().headers.has('Authorization')).toBe(false);
  });

  it('sends only the given product filters, safely encoded', async () => {
    const { client, sent } = setup(jsonResponse(productPage));

    await expect(
      client.listProducts({ q: "rice & oil'#x", page: 2, pageSize: 12, sort: undefined }),
    ).resolves.toStrictEqual(productPage);
    const url = new URL(sent().url as string);
    expect(url.pathname).toBe('/api/v1/catalog/products');
    expect([...url.searchParams]).toEqual([
      ['q', "rice & oil'#x"],
      ['page', '2'],
      ['pageSize', '12'],
    ]);
    expect(url.hash).toBe('');
  });

  it('sends the narrowing filters, with yes/no options only when they are on', async () => {
    const { client, sent } = setup(jsonResponse(productPage));

    await client.listProducts({
      category: 'home',
      includeSubcategories: true,
      brand: 'acme',
      minPriceMinor: 0,
      maxPriceMinor: 250_000,
      inStock: false,
    });
    const url = new URL(sent().url as string);
    expect([...url.searchParams]).toEqual([
      ['category', 'home'],
      ['includeSubcategories', 'true'],
      ['brand', 'acme'],
      ['minPriceMinor', '0'],
      ['maxPriceMinor', '250000'],
    ]);
  });

  it('lists products without a query string when no filter is given', async () => {
    const { client, sent } = setup(jsonResponse(productPage));

    await client.listProducts();
    expect(sent().url).toBe('http://localhost:4000/api/v1/catalog/products');
  });

  it.each(['', '   ', '\t\n '])(
    'leaves out a blank search (%j) instead of sending q=',
    async (q) => {
      const { client, sent } = setup(jsonResponse(productPage));

      await client.listProducts({ q, category: ' ', page: 2 });
      expect(sent().url).toBe('http://localhost:4000/api/v1/catalog/products?page=2');
    },
  );

  it('leaves out blank paging values too', async () => {
    const { client, sent } = setup(jsonResponse({ ...productPage, page: 1 }));

    await client.listProducts({ q: '', page: ' ', pageSize: '' });
    expect(sent().url).toBe('http://localhost:4000/api/v1/catalog/products');
  });

  it('encodes the product slug as one path segment', async () => {
    const { client, sent } = setup(jsonResponse({ product }));

    await expect(client.getProduct('desk-lamp')).resolves.toStrictEqual({ product });
    expect(sent().url).toBe('http://localhost:4000/api/v1/catalog/products/desk-lamp');

    const hostile = setup(jsonResponse({ product }));
    await hostile.client.getProduct('../../me?x=1#y');
    expect(hostile.sent().url).toBe(
      'http://localhost:4000/api/v1/catalog/products/..%2F..%2Fme%3Fx%3D1%23y',
    );
  });

  it.each(['..', '.', ''])('refuses the path segment %j without sending anything', async (slug) => {
    const { client, fetchMock } = setup(jsonResponse({ product }));

    await expect(client.getProduct(slug)).rejects.toMatchObject({
      status: 0,
      code: 'invalid_request',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('quotes a cart with product ids and quantities only', async () => {
    const { client, sent } = setup(jsonResponse({ quote }));

    await expect(client.quoteCart([{ productId: LAMP, quantity: 2 }])).resolves.toStrictEqual({
      quote,
    });
    expect(sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/cart/quote',
      method: 'POST',
      body: { items: [{ productId: LAMP, quantity: 2 }] },
    });
    expect(sent().headers.has('Authorization')).toBe(false);
  });
});

describe('customer calls', () => {
  it('quotes a checkout as the signed-in customer', async () => {
    const { client, sent } = setup(jsonResponse({ quote }));

    await client.quoteCheckout('access-token-1', {
      items: [{ productId: LAMP, quantity: 2 }],
      addressId: ADDRESS_ID,
    });
    expect(sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/checkout/quote',
      method: 'POST',
      body: { items: [{ productId: LAMP, quantity: 2 }], addressId: ADDRESS_ID },
    });
    expect(sent().headers.get('Authorization')).toBe('Bearer access-token-1');
  });

  it('lists, creates, replaces and deletes addresses', async () => {
    const list = setup(jsonResponse({ addresses: [address] }));
    await expect(list.client.listAddresses('access-token-1')).resolves.toStrictEqual({
      addresses: [address],
    });
    expect(list.sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/me/addresses',
      method: 'GET',
    });
    expect(list.sent().headers.get('Authorization')).toBe('Bearer access-token-1');

    const input = {
      recipientName: 'Rahima Khatun',
      phone: '01712345678',
      division: 'Dhaka' as const,
      district: 'Dhaka',
      area: 'Dhanmondi',
      addressLine: 'House 12, Road 5',
    };
    const created = setup(jsonResponse({ address }, 201));
    await expect(created.client.createAddress('access-token-1', input)).resolves.toStrictEqual({
      address,
    });
    expect(created.sent()).toMatchObject({ method: 'POST', body: input });

    const updated = setup(jsonResponse({ address }));
    await updated.client.updateAddress('access-token-1', ADDRESS_ID, input);
    expect(updated.sent()).toMatchObject({
      url: `http://localhost:4000/api/v1/me/addresses/${ADDRESS_ID}`,
      method: 'PUT',
      body: input,
    });

    const removed = setup(new Response(null, { status: 204 }));
    await expect(removed.client.deleteAddress('access-token-1', 'a/b')).resolves.toBeUndefined();
    expect(removed.sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/me/addresses/a%2Fb',
      method: 'DELETE',
    });
    expect(removed.sent().headers.get('Authorization')).toBe('Bearer access-token-1');
  });

  it('places an order and returns the validated order', async () => {
    const { client, sent } = setup(jsonResponse({ order, created: true }, 201));

    await expect(client.placeOrder('access-token-1', placeBody)).resolves.toStrictEqual({
      order,
      created: true,
    });
    expect(sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/orders',
      method: 'POST',
      body: placeBody,
    });
    expect(sent().headers.get('Authorization')).toBe('Bearer access-token-1');
  });

  it('exposes refusal details, such as the lines without enough stock', async () => {
    const problems = [{ productId: LAMP, problem: 'insufficient_stock' }];
    const { client } = setup(
      jsonResponse(
        {
          error: {
            code: 'insufficient_stock',
            message: 'Some products do not have enough stock',
            requestId: 'req-9',
            details: { problems },
          },
        },
        409,
      ),
    );

    const error = await client.placeOrder('access-token-1', placeBody).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'insufficient_stock',
      requestId: 'req-9',
      details: { problems },
    });
  });

  it('pages through orders with a query string', async () => {
    const page = { orders: [], page: 3, pageSize: 5, total: 11, totalPages: 3 };
    const { client, sent } = setup(jsonResponse(page));

    await expect(client.listOrders('access-token-1', { page: 3, pageSize: 5 })).resolves.toEqual(
      page,
    );
    expect(sent().url).toBe('http://localhost:4000/api/v1/orders?page=3&pageSize=5');
    expect(sent().headers.get('Authorization')).toBe('Bearer access-token-1');
  });

  it('reads and cancels one order by its encoded number', async () => {
    const read = setup(jsonResponse({ order }));
    await expect(read.client.getOrder('access-token-1', 'NZ100042')).resolves.toStrictEqual({
      order,
    });
    expect(read.sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/orders/NZ100042',
      method: 'GET',
    });

    const cancelled = { ...order, status: 'cancelled', canCancel: false };
    const cancel = setup(jsonResponse({ order: cancelled }));
    await cancel.client.cancelOrder('access-token-1', 'NZ1/../x');
    expect(cancel.sent()).toMatchObject({
      url: 'http://localhost:4000/api/v1/orders/NZ1%2F..%2Fx/cancel',
      method: 'POST',
      body: {},
    });

    const withReason = setup(jsonResponse({ order: cancelled }));
    await withReason.client.cancelOrder('access-token-1', 'NZ100042', { reason: 'Changed mind' });
    expect(withReason.sent().body).toStrictEqual({ reason: 'Changed mind' });
  });

  it('rejects an order response that breaks the contract', async () => {
    const { client } = setup(jsonResponse({ order: { ...order, totalMinor: -1 } }));

    await expect(client.getOrder('access-token-1', 'NZ100042')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});
