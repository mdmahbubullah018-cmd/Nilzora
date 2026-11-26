import { cartQuoteSchema, type CartQuote } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import { createCartLineImages } from '../modules/cart/line-images';
import type { SupabaseClients } from '../supabase/clients';

const BASE = 'https://media.example.com';
const PRODUCT = '11111111-1111-4111-8111-111111111111';
const OTHER = '44444444-4444-4444-8444-444444444444';
const VARIANT = '22222222-2222-4222-8222-222222222222';

/** A Supabase client whose table reads and RPCs answer from the given maps. */
function fakeClients(
  tables: Record<string, unknown>,
  rpcs: Record<string, unknown> = {},
): { clients: SupabaseClients; asked: string[] } {
  const asked: string[] = [];
  function builder(table: string): unknown {
    const proxy: object = new Proxy(
      {},
      {
        get(_target, method: string) {
          if (method === 'then') {
            return (resolve: (value: unknown) => void) => {
              asked.push(table);
              const data = tables[table] ?? [];
              const error = data instanceof Error ? { message: data.message } : null;
              return Promise.resolve({ data: error ? null : data, error }).then(resolve);
            };
          }
          return () => proxy;
        },
      },
    );
    return proxy;
  }
  const clients = {
    public: () => ({
      from: builder,
      rpc: (name: string, args: { p_slug: string }) => {
        asked.push(`rpc:${name}:${args.p_slug}`);
        const data = rpcs[name];
        return Promise.resolve({ data: data ?? [], error: null });
      },
    }),
  } as unknown as SupabaseClients;
  return { clients, asked };
}

function imageRow(productId: string, key: string) {
  return {
    product_id: productId,
    id: '33333333-3333-4333-8333-333333333333',
    storage_key: key,
    width: 1200,
    height: 1200,
    alt_text: 'A cotton shirt',
    position: 0,
  };
}

function line(overrides: Record<string, unknown> = {}) {
  return {
    productId: PRODUCT,
    variantId: null,
    variantLabel: null,
    slug: 'cotton-shirt',
    name: 'Cotton shirt',
    sku: 'SHIRT-1',
    unitPriceMinor: 125_000,
    compareAtPriceMinor: null,
    quantity: 2,
    lineTotalMinor: 250_000,
    availableQuantity: 8,
    problem: null,
    ...overrides,
  };
}

function quote(...lines: unknown[]): CartQuote {
  return cartQuoteSchema.parse({
    lines,
    itemCount: 2,
    subtotalMinor: 250_000,
    deliveryZone: null,
    shippingFeeMinor: null,
    totalMinor: null,
    purchasable: true,
  });
}

describe('cart line pictures', () => {
  it('gives a simple product its primary image', async () => {
    const { clients } = fakeClients({
      product_images: [
        imageRow(PRODUCT, `products/${PRODUCT}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`),
      ],
    });
    const withImages = createCartLineImages(clients, { mediaBaseUrl: BASE });

    const filled = await withImages(quote(line()));

    expect(filled.lines[0]?.image).toEqual({
      url: `${BASE}/products/${PRODUCT}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/full.webp`,
      thumbUrl: `${BASE}/products/${PRODUCT}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/thumb.webp`,
      alt: 'A cotton shirt',
    });
  });

  it('prefers the chosen variant’s own picture over the product’s', async () => {
    const variantPhoto = 'https://media.example.com/variants/red/full.webp';
    const { clients } = fakeClients(
      {
        product_images: [
          imageRow(PRODUCT, `products/${PRODUCT}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`),
        ],
      },
      { catalog_product_variants: [{ variant_id: VARIANT, image_url: variantPhoto }] },
    );
    const withImages = createCartLineImages(clients, { mediaBaseUrl: BASE });

    const filled = await withImages(quote(line({ variantId: VARIANT, variantLabel: 'Red' })));

    expect(filled.lines[0]?.image).toEqual({
      url: variantPhoto,
      thumbUrl: variantPhoto,
      alt: null,
    });
  });

  it('falls back to the product’s picture when the chosen variant has none', async () => {
    const { clients } = fakeClients(
      {
        product_images: [
          imageRow(PRODUCT, `products/${PRODUCT}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`),
        ],
      },
      { catalog_product_variants: [{ variant_id: VARIANT, image_url: null }] },
    );
    const withImages = createCartLineImages(clients, { mediaBaseUrl: BASE });

    const filled = await withImages(quote(line({ variantId: VARIANT })));

    expect(filled.lines[0]?.image?.url).toContain('/products/');
  });

  it('ignores another product’s images and lines with no picture at all', async () => {
    const { clients } = fakeClients({
      product_images: [imageRow(OTHER, `products/${OTHER}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`)],
    });
    const withImages = createCartLineImages(clients, { mediaBaseUrl: BASE });

    const filled = await withImages(quote(line()));

    expect(filled.lines[0]?.image).toBeNull();
  });

  it('does not look anything up for a product that is not on sale', async () => {
    const { clients, asked } = fakeClients({});
    const withImages = createCartLineImages(clients, { mediaBaseUrl: BASE });

    const filled = await withImages(
      quote(line({ problem: 'unavailable', name: null, slug: null, sku: null })),
    );

    expect(asked).toEqual([]);
    expect(filled.lines[0]?.image).toBeNull();
  });

  it('leaves the quote alone when no media is configured, with no requests', async () => {
    const { clients, asked } = fakeClients({});
    const withImages = createCartLineImages(clients);

    const original = quote(line());
    const filled = await withImages(original);

    expect(asked).toEqual([]);
    expect(filled).toEqual(original);
    expect(filled.lines[0]?.image).toBeNull();
  });

  it('still prices the cart when the picture lookup fails', async () => {
    const { clients } = fakeClients({ product_images: new Error('media table is down') });
    const withImages = createCartLineImages(clients, { mediaBaseUrl: BASE });

    const original = quote(line());
    const filled = await withImages(original);

    // Prices, stock and problems are untouched; only the picture is missing.
    expect(filled).toEqual(original);
    expect(filled.lines[0]?.lineTotalMinor).toBe(250_000);
  });

  it('does not change the lines’ prices, quantities or problems', async () => {
    const { clients } = fakeClients({
      product_images: [
        imageRow(PRODUCT, `products/${PRODUCT}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`),
      ],
    });
    const withImages = createCartLineImages(clients, { mediaBaseUrl: BASE });
    const original = quote(line({ problem: 'quantity_limit' }));

    const filled = await withImages(original);

    expect({ ...filled, lines: undefined }).toEqual({ ...original, lines: undefined });
    expect({ ...filled.lines[0], image: undefined }).toEqual({
      ...original.lines[0],
      image: undefined,
    });
  });
});
