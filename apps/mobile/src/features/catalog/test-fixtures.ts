import { act } from '@testing-library/react-native';
import { refreshList } from '@/test-utils/refresh';
import type {
  Banner,
  Category,
  ProductDetail,
  ProductImage,
  ProductListResponse,
  ProductSummary,
} from '@nilzora/contracts';

/*
 * Catalog test data. Not imported by the app, so never bundled. Prices are integer poisha,
 * ids are valid UUIDs (the cart rejects anything else), like the API's answers.
 */

/** A valid UUID (version 4 shape) for test number `n`. */
export function productId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/** A product photo, as the API sends it (full and thumbnail URLs on the media origin). */
export function productImage(n: number, overrides: Partial<ProductImage> = {}): ProductImage {
  return {
    id: `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`,
    url: `https://media.example.com/products/p/${String(n)}/full.webp`,
    thumbUrl: `https://media.example.com/products/p/${String(n)}/thumb.webp`,
    alt: null,
    width: 1200,
    height: 1200,
    position: n - 1,
    ...overrides,
  };
}

export function product(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: productId(1),
    slug: 'cotton-shirt',
    sku: 'SHIRT-001',
    name: 'Cotton shirt',
    summary: 'A soft everyday shirt.',
    priceMinor: 125_000,
    compareAtPriceMinor: null,
    availability: 'in_stock',
    maxOrderQuantity: 10,
    isFeatured: false,
    category: { slug: 'fashion', name: 'Fashion' },
    description: null,
    image: null,
    images: [],
    variants: [],
    campaign: null,
    ...overrides,
  };
}

/** A listing entry. */
export function summary(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return product(overrides);
}

export function page(
  items: ProductSummary[],
  overrides: Partial<ProductListResponse> = {},
): ProductListResponse {
  return {
    items,
    page: 1,
    pageSize: 24,
    total: items.length,
    totalPages: items.length === 0 ? 0 : 1,
    ...overrides,
  };
}

/** A published category; the tree fields default to "top level, no cover". */
export function category(overrides: Partial<Category> = {}): Category {
  return {
    slug: 'fashion',
    name: 'Fashion',
    description: null,
    productCount: 3,
    image: null,
    parentSlug: null,
    depth: 1,
    isFeatured: false,
    ...overrides,
  };
}

export const FASHION: Category = category();

export const GROCERIES: Category = category({
  slug: 'groceries',
  name: 'Groceries',
  productCount: 1,
});

/** A banner, as the API sends it. */
export function banner(overrides: Partial<Banner> = {}): Banner {
  return {
    id: `00000000-0000-4000-a000-${String(1).padStart(12, '0')}`,
    placement: 'home_hero',
    title: 'Eid edit',
    subtitle: null,
    ctaLabel: null,
    ctaHref: null,
    image: null,
    categorySlug: null,
    ...overrides,
  };
}

/**
 * Refreshes the scrolling area with this test id the way the branded pull-to-refresh does
 * (through its "Refresh" accessibility action) and lets the refetches start.
 */
export async function pullToRefresh(testID: string): Promise<void> {
  await refreshList(testID);
  await act(async () => {
    await Promise.resolve();
  });
}
