import type {
  AdminCategory,
  AdminProductDetail,
  InventoryMovement,
  ProductReview,
} from '@nilzora/contracts';

/*
 * Test data for the catalog tests only: shaped like the API's responses, never shown
 * in the app.
 */

export const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
export const CATEGORY_ID = '11111111-1111-4111-8111-111111111111';
export const TASK_ID = '33333333-3333-4333-8333-333333333333';

export function testProduct(overrides: Partial<AdminProductDetail> = {}): AdminProductDetail {
  return {
    id: PRODUCT_ID,
    slug: 'cotton-panjabi',
    sku: 'NZ-PANJABI',
    name: 'Cotton panjabi',
    summary: 'Soft cotton',
    description: null,
    status: 'draft',
    moderationStatus: 'not_submitted',
    priceMinor: 250_000,
    compareAtPriceMinor: 300_000,
    stockQuantity: 12,
    maxOrderQuantity: 10,
    isFeatured: false,
    category: { id: CATEGORY_ID, slug: 'fashion', name: 'Fashion', isActive: true },
    publishedAt: null,
    updatedAt: '2026-10-25T06:00:00.000Z',
    createdAt: '2026-10-20T06:00:00.000Z',
    latestReview: null,
    image: null,
    images: [],
    ...overrides,
  };
}

export function testReview(overrides: Partial<ProductReview> = {}): ProductReview {
  return {
    taskId: TASK_ID,
    status: 'pending',
    note: null,
    submittedAt: '2026-10-24T06:00:00.000Z',
    decidedAt: null,
    assigned: false,
    ...overrides,
  };
}

export const testCategory: AdminCategory = {
  id: CATEGORY_ID,
  slug: 'fashion',
  name: 'Fashion',
  description: 'Clothes',
  sortOrder: 2,
  isActive: true,
  parentId: null,
  isFeatured: false,
  imageUrl: null,
  productCount: 4,
};

export function testMovement(overrides: Partial<InventoryMovement> = {}): InventoryMovement {
  return {
    id: 7,
    product: { id: PRODUCT_ID, name: 'Cotton panjabi', sku: 'NZ-PANJABI' },
    change: -2,
    stockAfter: 10,
    reason: 'order_placed',
    note: null,
    orderNumber: 'NZ100042',
    actor: { id: '00000000-0000-4000-8000-0000000000c1', name: null, email: null },
    createdAt: '2026-10-25T05:00:00.000Z',
    ...overrides,
  };
}

/** One page of a listing with the API's paging fields. */
export function page<K extends string, T>(key: K, items: T[], total = items.length) {
  return { [key]: items, page: 1, pageSize: 25, total, totalPages: Math.ceil(total / 25) } as {
    [P in K]: T[];
  } & { page: number; pageSize: number; total: number; totalPages: number };
}
