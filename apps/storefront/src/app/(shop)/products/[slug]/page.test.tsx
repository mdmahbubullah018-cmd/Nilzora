import type { ProductReviewsResponse } from '@nilzora/contracts';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { notFound } from 'next/navigation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { category, detail, listing, productImage, summary } from '@/testing/catalog-fixtures';
import ProductPage, { generateMetadata } from './page';

const catalog = vi.hoisted(() => ({
  getProduct: vi.fn(),
  getProductReviews: vi.fn(),
  listProducts: vi.fn(),
  listBrandProducts: vi.fn(),
  getCategories: vi.fn(),
}));
vi.mock('@/lib/catalog', () => catalog);
// generateMetadata reads the store profile for the site name; no API runs in a test.
vi.mock('@/lib/session', () => ({
  session: { publicApi: () => ({ publicStoreProfile: () => Promise.resolve({ profile: null }) }) },
}));
vi.mock('@/lib/cart-actions', () => ({ addToCartAction: vi.fn() }));
// The page asks whether the visitor may review the product; a test render has no session.
vi.mock('@/lib/account-read', () => ({
  readAccount: vi.fn().mockResolvedValue({ kind: 'signed_out' }),
}));

const panjabi = detail({
  slug: 'mens-cotton-panjabi',
  sku: 'NZ-DEMO-005',
  name: "Men's Cotton Panjabi",
  summary: 'Comfortable cotton panjabi with subtle embroidery.',
  description: 'Lightweight cotton for warm days.\n\nRegular fit.',
  priceMinor: 185_000,
  compareAtPriceMinor: 225_000,
  availability: 'low_stock',
  maxOrderQuantity: 3,
  category: { slug: 'panjabi', name: 'Panjabi' },
  brand: { slug: 'aarong', name: 'Aarong' },
});
const kurti = summary({ name: "Women's Printed Kurti", category: panjabi.category });

function props(slug: string, searchParams: Record<string, string> = {}) {
  return { params: Promise.resolve({ slug }), searchParams: Promise.resolve(searchParams) };
}

function hidden(container: HTMLElement, name: string): string | undefined {
  return container.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)?.value;
}

function reviewPage(overrides: Partial<ProductReviewsResponse> = {}): ProductReviewsResponse {
  return {
    summary: {
      averageRating: 0,
      reviewCount: 0,
      distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
    },
    reviews: [],
    page: 1,
    pageSize: 6,
    total: 0,
    totalPages: 0,
    ...overrides,
  };
}

function structuredData(container: HTMLElement): Record<string, unknown>[] {
  return [...container.querySelectorAll('script[type="application/ld+json"]')].map(
    (script) => JSON.parse(script.textContent ?? '{}') as Record<string, unknown>,
  );
}

/** Reviews sit in a closed panel until one of the triggers is used. */
function openReviews() {
  const [trigger] = screen.getAllByRole('button', { name: /^Reviews/ });
  if (trigger === undefined) throw new Error('No reviews trigger on the page');
  fireEvent.click(trigger);
}

beforeEach(() => {
  catalog.getProduct.mockResolvedValue({ kind: 'ok', value: panjabi });
  catalog.listProducts.mockResolvedValue({ kind: 'ok', value: listing([panjabi, kurti]) });
  catalog.listBrandProducts.mockResolvedValue({ kind: 'ok', value: listing([]) });
  catalog.getCategories.mockResolvedValue({
    kind: 'ok',
    value: [
      category({ slug: 'fashion', name: 'Fashion' }),
      category({ slug: 'panjabi', name: 'Panjabi', parentSlug: 'fashion', depth: 2 }),
    ],
  });
  // Reviews are optional on the page; the default is "none published yet".
  catalog.getProductReviews.mockResolvedValue({ kind: 'ok', value: reviewPage() });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProductPage', () => {
  it('shows the product with its price, saving, stock and details', async () => {
    const { container } = render(await ProductPage(props('mens-cotton-panjabi')));

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("Men's Cotton Panjabi");
    expect(screen.getByText('Comfortable cotton panjabi with subtle embroidery.')).not.toBeNull();
    expect(screen.getByText('৳1,850')).not.toBeNull();
    expect(container.querySelector('.line-through')?.textContent).toBe('Was ৳2,250');
    expect(screen.getByText('Save 17%')).not.toBeNull();
    expect(screen.getByText('Only a few left')).not.toBeNull();
    // Beside the price, and in the specifications.
    expect(screen.getAllByText('NZ-DEMO-005')).toHaveLength(2);
    expect(screen.getByText('Lightweight cotton for warm days.')).not.toBeNull();
    expect(screen.getByText('Regular fit.')).not.toBeNull();
    expect(screen.getByText('Cash on Delivery')).not.toBeNull();
  });

  it('offers a share of the product’s own public page, beside the wishlist', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://nilzora.com.bd';
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    try {
      render(await ProductPage(props('mens-cotton-panjabi')));

      const button = screen.getByRole('button', { name: "Share Men's Cotton Panjabi" });
      fireEvent.click(button);

      // The canonical public address, built from the store's own origin — never an internal id.
      await screen.findByText('Shared');
      expect(share).toHaveBeenCalledWith({
        title: "Men's Cotton Panjabi",
        text: "Men's Cotton Panjabi — Comfortable cotton panjabi with subtle embroidery.",
        url: 'https://nilzora.com.bd/products/mens-cotton-panjabi',
      });
    } finally {
      Reflect.deleteProperty(navigator, 'share');
      delete process.env.NEXT_PUBLIC_SITE_URL;
    }
  });

  it('links back through the whole category path', async () => {
    render(await ProductPage(props('mens-cotton-panjabi')));

    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Fashion' }).getAttribute('href')).toBe(
      '/categories/fashion',
    );
    expect(within(crumbs).getByRole('link', { name: 'Panjabi' }).getAttribute('href')).toBe(
      '/categories/panjabi',
    );
    expect(within(crumbs).getByText("Men's Cotton Panjabi").getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('lists only the specifications the product really has', async () => {
    const shirt = detail({
      name: 'Oxford Shirt',
      brand: null,
      category: { slug: 'panjabi', name: 'Panjabi' },
      variants: [
        {
          id: '9a000000-0000-4000-8000-000000000001',
          sku: 'OX-S-BLUE',
          priceMinor: 120_000,
          compareAtPriceMinor: null,
          availability: 'in_stock',
          maxOrderQuantity: 5,
          imageUrl: null,
          options: [
            { attribute: 'Size', attributeSlug: 'size', value: 'S', valueSlug: 's' },
            { attribute: 'Colour', attributeSlug: 'colour', value: 'Blue', valueSlug: 'blue' },
          ],
        },
        {
          id: '9a000000-0000-4000-8000-000000000002',
          sku: 'OX-M-BLUE',
          priceMinor: 125_000,
          compareAtPriceMinor: null,
          availability: 'out_of_stock',
          maxOrderQuantity: 0,
          imageUrl: null,
          options: [
            { attribute: 'Size', attributeSlug: 'size', value: 'M', valueSlug: 'm' },
            { attribute: 'Colour', attributeSlug: 'colour', value: 'Blue', valueSlug: 'blue' },
          ],
        },
      ],
    });
    catalog.getProduct.mockResolvedValue({ kind: 'ok', value: shirt });
    render(await ProductPage(props('oxford-shirt')));

    const specs = within(screen.getByRole('region', { name: 'Specifications' }));
    const rows = Object.fromEntries(
      specs
        .getAllByRole('term')
        .map((term) => [term.textContent, term.nextElementSibling?.textContent]),
    );
    expect(rows).toEqual({ Category: 'Fashion›Panjabi', Size: 'S, M', Colour: 'Blue' });
  });

  it('shows the size guide the store wrote, with a link to it beside the purchase', async () => {
    catalog.getProduct.mockResolvedValue({
      kind: 'ok',
      value: {
        ...panjabi,
        sizeChart: {
          columns: ['Size', 'Chest (in)'],
          rows: [
            ['M', '40'],
            ['L', '42'],
          ],
        },
      },
    });
    render(await ProductPage(props('mens-cotton-panjabi')));

    // The guide is a button beside the options; it opens the store's chart in a sheet over the page.
    expect(screen.queryByRole('dialog', { name: 'Size guide' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Size guide' }));
    const guide = within(screen.getByRole('dialog', { name: 'Size guide' }));
    expect(guide.getByRole('rowheader', { name: 'L' })).not.toBeNull();
    expect(guide.getByText('42')).not.toBeNull();
  });

  it('has no size guide when the product has no chart', async () => {
    render(await ProductPage(props('mens-cotton-panjabi')));
    expect(screen.queryByRole('dialog', { name: 'Size guide' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Size guide' })).toBeNull();
  });

  it('adds to the cart with the product id and its order limit, never a price', async () => {
    const { container } = render(await ProductPage(props('mens-cotton-panjabi')));

    const form = screen.getByRole('button', { name: 'Add to cart' }).closest('form');
    expect(form).not.toBeNull();
    expect(hidden(container, 'productId')).toBe(panjabi.id);
    expect(hidden(container, 'limit')).toBe('3');
    expect(
      within(screen.getByRole('group', { name: 'Quantity' })).getByRole('status'),
    ).not.toBeNull();
    const fields = Array.from(form?.querySelectorAll('input, select') ?? [], (field) =>
      field.getAttribute('name'),
    );
    // The address goes along so the cart action can check the product's options in the catalog.
    expect(hidden(container, 'productSlug')).toBe(panjabi.slug);
    expect(fields.sort()).toEqual(['limit', 'productId', 'productSlug', 'quantity']);
  });

  it('disables adding an out-of-stock product and says why', async () => {
    catalog.getProduct.mockResolvedValue({
      kind: 'ok',
      value: { ...panjabi, availability: 'out_of_stock', maxOrderQuantity: 0 },
    });
    render(await ProductPage(props('mens-cotton-panjabi')));

    expect(screen.getByRole('button', { name: 'Add to cart' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/out of stock right now/)).not.toBeNull();
    expect(screen.queryByLabelText('Quantity')).toBeNull();
  });

  it('suggests other products from the category, not this one', async () => {
    render(await ProductPage(props('mens-cotton-panjabi')));

    expect(catalog.listProducts).toHaveBeenCalledWith({
      category: 'panjabi',
      sort: 'featured',
      page: 1,
      pageSize: 5,
    });
    const related = screen.getByRole('region', { name: 'You may also like' });
    expect(within(related).getByRole('link', { name: "Women's Printed Kurti" })).not.toBeNull();
    expect(within(related).queryByRole('link', { name: "Men's Cotton Panjabi" })).toBeNull();
  });

  it('tops the suggestions up from the same brand, never repeating a product', async () => {
    const shawl = summary({ name: 'Nakshi Shawl' });
    catalog.listBrandProducts.mockResolvedValue({
      kind: 'ok',
      value: listing([panjabi, kurti, shawl]),
    });
    render(await ProductPage(props('mens-cotton-panjabi')));

    expect(catalog.listBrandProducts).toHaveBeenCalledWith('aarong', expect.anything());
    const related = within(screen.getByRole('region', { name: 'You may also like' }));
    expect(related.getAllByRole('link', { name: "Women's Printed Kurti" })).toHaveLength(1);
    expect(related.getByRole('link', { name: 'Nakshi Shawl' })).not.toBeNull();
    expect(related.queryByRole('link', { name: "Men's Cotton Panjabi" })).toBeNull();
  });

  it('leaves the suggestions out when they cannot be loaded', async () => {
    catalog.listProducts.mockResolvedValue({ kind: 'unavailable' });
    catalog.listBrandProducts.mockResolvedValue({ kind: 'unavailable' });
    render(await ProductPage(props('mens-cotton-panjabi')));

    expect(screen.getByRole('heading', { level: 1 })).not.toBeNull();
    expect(screen.queryByRole('region', { name: 'You may also like' })).toBeNull();
  });

  it('describes the product in structured data with its real price and stock band', async () => {
    const { container } = render(await ProductPage(props('mens-cotton-panjabi')));

    const product = structuredData(container).find((entry) => entry['@type'] === 'Product');
    expect(product).toMatchObject({
      name: "Men's Cotton Panjabi",
      sku: 'NZ-DEMO-005',
      brand: { '@type': 'Brand', name: 'Aarong' },
      url: 'http://localhost:3000/products/mens-cotton-panjabi',
      offers: {
        '@type': 'Offer',
        priceCurrency: 'BDT',
        price: '1850.00',
        availability: 'https://schema.org/LimitedAvailability',
      },
    });
    // No approved reviews: no rating is claimed.
    expect(product).not.toHaveProperty('aggregateRating');
  });

  it('claims a rating only from approved reviews, and shows their tally and photos', async () => {
    catalog.getProductReviews.mockResolvedValue({
      kind: 'ok',
      value: reviewPage({
        summary: {
          averageRating: 4.5,
          reviewCount: 2,
          distribution: { '1': 0, '2': 0, '3': 0, '4': 1, '5': 1 },
        },
        reviews: [
          {
            id: '7e000000-0000-4000-8000-000000000001',
            rating: 5,
            title: 'Lovely fabric',
            body: 'Soft and well stitched.',
            authorName: 'Ayesha R.',
            verified: true,
            images: [
              {
                id: '7f000000-0000-4000-8000-000000000001',
                url: 'https://media.example.test/reviews/r/full.webp',
                thumbUrl: 'https://media.example.test/reviews/r/thumb.webp',
              },
            ],
            createdAt: '2026-10-20T10:00:00.000Z',
            reply: null,
            helpfulCount: 3,
            notHelpfulCount: 0,
            viewerVote: null,
          },
        ],
        total: 9,
        totalPages: 2,
      }),
    });
    const { container } = render(await ProductPage(props('mens-cotton-panjabi')));

    const product = structuredData(container).find((entry) => entry['@type'] === 'Product');
    expect(product?.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.5,
      reviewCount: 2,
      bestRating: 5,
      worstRating: 1,
    });
    // The page stays compact: the tally is only in the panel until it is opened.
    expect(screen.queryByRole('list', { name: 'Reviews by star rating' })).toBeNull();
    // One floating tab on the page edge plus the quiet rating beside the title, both opening one panel.
    expect(screen.getAllByRole('button', { name: /^Reviews · 4\.5 out of 5/ })).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: '4.5 out of 5 from 2 reviews. Open reviews.' }),
    ).not.toBeNull();
    openReviews();
    expect(screen.getByRole('dialog', { name: 'Ratings & reviews' })).not.toBeNull();
    const tally = within(screen.getByRole('list', { name: 'Reviews by star rating' }));
    expect(tally.getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      '5 stars:1 review',
      '4 stars:1 review',
      '3 stars:0 reviews',
      '2 stars:0 reviews',
      '1 star:0 reviews',
    ]);
    expect(
      screen.getByRole('button', { name: /View photo 1 from ayesha r\.'s review full screen/i }),
    ).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Show more reviews' }).getAttribute('href')).toBe(
      '/products/mens-cotton-panjabi?reviews=2#reviews',
    );
  });

  it('shows more reviews in batches from the address', async () => {
    render(await ProductPage(props('mens-cotton-panjabi', { reviews: '3' })));
    expect(catalog.getProductReviews).toHaveBeenCalledWith('mens-cotton-panjabi', 18);

    vi.clearAllMocks();
    render(await ProductPage(props('mens-cotton-panjabi', { reviews: 'lots' })));
    expect(catalog.getProductReviews).toHaveBeenCalledWith('mens-cotton-panjabi', 6);
  });

  it('sends a signed-out visitor who wants to review back to this product after sign-in', async () => {
    render(await ProductPage(props('mens-cotton-panjabi')));
    openReviews();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      `/login?next=${encodeURIComponent('/products/mens-cotton-panjabi#reviews')}`,
    );
  });

  it('shows a retry notice when the product cannot be loaded', async () => {
    catalog.getProduct.mockResolvedValue({ kind: 'unavailable' });
    render(await ProductPage(props('mens-cotton-panjabi')));

    expect(screen.getByText('We could not load this product')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe(
      '/products/mens-cotton-panjabi',
    );
    expect(screen.queryByRole('button', { name: 'Add to cart' })).toBeNull();
    expect(catalog.listProducts).not.toHaveBeenCalled();
  });

  it('passes not found through', async () => {
    catalog.getProduct.mockImplementation(() => notFound());
    await expect(ProductPage(props('no-such-product'))).rejects.toMatchObject({
      digest: expect.stringContaining('404') as unknown,
    });
  });
});

describe('generateMetadata', () => {
  it('uses the product name, summary, own address and first picture', async () => {
    const image = productImage();
    catalog.getProduct.mockResolvedValue({ kind: 'ok', value: { ...panjabi, images: [image] } });
    await expect(generateMetadata(props('mens-cotton-panjabi'))).resolves.toMatchObject({
      title: "Men's Cotton Panjabi",
      description: 'Comfortable cotton panjabi with subtle embroidery.',
      alternates: { canonical: 'http://localhost:3000/products/mens-cotton-panjabi' },
      openGraph: { images: [{ url: image.url }] },
    });
  });

  it('falls back without a summary or when the product cannot be loaded', async () => {
    catalog.getProduct.mockResolvedValue({ kind: 'ok', value: { ...panjabi, summary: null } });
    await expect(generateMetadata(props('mens-cotton-panjabi'))).resolves.toMatchObject({
      title: "Men's Cotton Panjabi",
      description: "Buy Men's Cotton Panjabi at Nilzora and pay in cash on delivery.",
    });
    catalog.getProduct.mockResolvedValue({ kind: 'unavailable' });
    await expect(generateMetadata(props('mens-cotton-panjabi'))).resolves.toEqual({
      title: 'Product',
    });
  });
});
