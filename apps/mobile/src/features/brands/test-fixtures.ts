import type { Brand, BrandProductsResponse } from '@nilzora/contracts';

/*
 * Brand test data. Not imported by the app, so never bundled.
 */

export function brand(overrides: Partial<Brand> = {}): Brand {
  return {
    slug: 'aarong',
    name: 'Aarong',
    description: null,
    logo: null,
    banner: null,
    productCount: 4,
    ...overrides,
  };
}

export function brandPage(
  items: BrandProductsResponse['items'],
  overrides: Partial<BrandProductsResponse> = {},
): BrandProductsResponse {
  return {
    items,
    page: 1,
    pageSize: 24,
    total: items.length,
    totalPages: items.length === 0 ? 0 : 1,
    ...overrides,
  };
}
