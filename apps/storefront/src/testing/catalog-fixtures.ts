import type {
  Category,
  ProductDetail,
  ProductImage,
  ProductListResponse,
  ProductSummary,
} from '@nilzora/contracts';

/* Catalog data shaped like the API's answers, for storefront tests. */

/** A published category; the new tree fields default to "top level, no cover". */
export function category(overrides: Partial<Category> = {}): Category {
  return {
    slug: 'home-kitchen',
    name: 'Home & Kitchen',
    description: 'For the home.',
    productCount: 4,
    image: null,
    parentSlug: null,
    depth: 1,
    isFeatured: false,
    ...overrides,
  };
}

export const categories: Category[] = [
  category(),
  category({ slug: 'fashion', name: 'Fashion', description: null, productCount: 1 }),
];

let sequence = 0;

let imageSequence = 0;

/** A product picture as the API returns it (the URLs are never fetched in tests). */
export function productImage(overrides: Partial<ProductImage> = {}): ProductImage {
  imageSequence += 1;
  const id = `1e000000-0000-4000-8000-${String(imageSequence).padStart(12, '0')}`;
  return {
    id,
    url: `https://media.example.test/products/p/${id}/full.webp`,
    thumbUrl: `https://media.example.test/products/p/${id}/thumb.webp`,
    alt: null,
    width: 1200,
    height: 1200,
    position: 0,
    ...overrides,
  };
}

export function summary(overrides: Partial<ProductSummary> = {}): ProductSummary {
  sequence += 1;
  const id = `0d000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  return {
    id,
    slug: `product-${sequence}`,
    sku: `NZ-TEST-${sequence}`,
    name: `Test product ${sequence}`,
    summary: null,
    priceMinor: 65_000,
    compareAtPriceMinor: null,
    availability: 'in_stock',
    maxOrderQuantity: 5,
    isFeatured: false,
    category: { slug: 'home-kitchen', name: 'Home & Kitchen' },
    image: null,
    campaign: null,
    ...overrides,
  };
}

export function detail(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return { ...summary(), description: null, images: [], variants: [], ...overrides };
}

export function listing(
  items: ProductSummary[],
  overrides: Partial<ProductListResponse> = {},
): ProductListResponse {
  return {
    items,
    page: 1,
    pageSize: 24,
    total: items.length,
    totalPages: items.length > 0 ? 1 : 0,
    ...overrides,
  };
}
