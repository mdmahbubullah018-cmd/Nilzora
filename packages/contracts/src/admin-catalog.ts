import { z } from 'zod';
import {
  accountRefSchema,
  adminPageQueryShape,
  adminSearchSchema,
  optionalTextSchema,
  pageInfoShape,
} from './admin-common';
import {
  moneyMinorSchema,
  SIZE_CHART_CELL_MAX,
  SIZE_CHART_MAX_COLUMNS,
  SIZE_CHART_MAX_ROWS,
  SIZE_CHART_UNITS,
  sizeChartSchema,
  slugSchema,
} from './catalog';
import { productImageSchema } from './media';
import { orderNumberSchema } from './orders';

/*
 * Admin catalog: every product in any state, categories (including hidden ones) and
 * the stock ledger.
 *
 * A product is created as a draft. Its content (category, address, name and texts)
 * can change only while it is not on sale and not under review, and every content
 * change sends it back for review. Publishing needs approved content: staff submit
 * the draft, an assigner hands the review to a moderator, and the moderator decides.
 * Price, per-order limit and featuring are operational and can change at any time.
 * Stock changes only through recorded adjustments (and orders), never by editing.
 */

export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const MODERATION_STATUSES = [
  'not_submitted',
  'pending',
  'approved',
  'changes_requested',
  'rejected',
] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

/** Outcome of one content review. */
export const MODERATION_TASK_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'changes_requested',
  'withdrawn',
] as const;
export type ModerationTaskStatus = (typeof MODERATION_TASK_STATUSES)[number];

export const INVENTORY_REASONS = [
  'initial_stock',
  'order_placed',
  'order_cancelled',
  'adjustment',
] as const;
export type InventoryReason = (typeof INVENTORY_REASONS)[number];

/** Stock-keeping unit: upper-case letters, digits and hyphens. Lower case is upper-cased. */
export const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/, {
    error: 'Use 2 to 40 letters, digits or hyphens, starting with a letter or digit',
  });

const productNameSchema = z
  .string()
  .trim()
  .min(1, { error: 'Enter the product name' })
  .max(160, { error: 'Keep the name under 160 characters' });

/** At most this many tags per product, each 1 to 30 characters. */
export const PRODUCT_TAG_LIMIT = 15;
export const PRODUCT_TAG_MAX_LENGTH = 30;

/**
 * One merchandising tag: lower-case letters, digits, single spaces and hyphens, e.g.
 * "summer sale" or "eid-2026". Text is trimmed, lower-cased and inner spaces collapsed.
 */
export const productTagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((tag) => tag.replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(1, { error: 'A tag cannot be empty' })
      .max(PRODUCT_TAG_MAX_LENGTH, {
        error: `Keep each tag under ${String(PRODUCT_TAG_MAX_LENGTH)} characters`,
      })
      .regex(/^[a-z0-9]([a-z0-9 -]*[a-z0-9])?$/, {
        error: 'Use lower-case letters, numbers, spaces and hyphens',
      }),
  );

/** A product's tags, de-duplicated in the order given. Staff only: shoppers never see them. */
export const productTagsSchema = z
  .array(productTagSchema)
  .max(PRODUCT_TAG_LIMIT * 4)
  .transform((tags) => [...new Set(tags)])
  .pipe(
    z
      .array(z.string())
      .max(PRODUCT_TAG_LIMIT, { error: `Use at most ${String(PRODUCT_TAG_LIMIT)} tags` }),
  );

const sizeChartCellSchema = z
  .string()
  .trim()
  .max(SIZE_CHART_CELL_MAX, {
    error: `Keep each entry under ${String(SIZE_CHART_CELL_MAX)} characters`,
  });

/** A size chart as staff save it: 1 to 8 named columns and 1 to 30 rows of that width. */
export const sizeChartInputSchema = z
  .strictObject({
    columns: z
      .array(sizeChartCellSchema.min(1, { error: 'Name every column' }))
      .max(SIZE_CHART_MAX_COLUMNS, {
        error: `Use at most ${String(SIZE_CHART_MAX_COLUMNS)} columns`,
      }),
    rows: z
      .array(z.array(sizeChartCellSchema))
      .max(SIZE_CHART_MAX_ROWS, { error: `Use at most ${String(SIZE_CHART_MAX_ROWS)} rows` }),
    /** What the measurement columns are in. */
    unit: z.enum(SIZE_CHART_UNITS).optional(),
    /** A table (the default) or a picture of the chart. */
    mode: z.enum(['table', 'image']).optional(),
    /** The picture's media library key; required for, and only for, a picture chart. */
    imageKey: z
      .string()
      .regex(/^(products|library|seo|brand|categories)\/[A-Za-z0-9/_-]{1,172}$/, {
        error: 'Choose a picture from the media library',
      })
      .optional(),
  })
  .superRefine((chart, ctx) => {
    if (chart.mode === 'image') {
      if (chart.imageKey === undefined) {
        ctx.addIssue({ code: 'custom', path: ['imageKey'], message: 'Choose the chart picture' });
      }
      if (chart.columns.length > 0 || chart.rows.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['rows'],
          message: 'A picture chart has no table',
        });
      }
      return;
    }
    if (chart.imageKey !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['imageKey'], message: 'Only a picture chart has a picture' });
    }
    if (chart.columns.length < 1) {
      ctx.addIssue({ code: 'custom', path: ['columns'], message: 'Add at least one column' });
    }
    if (chart.rows.length < 1) {
      ctx.addIssue({ code: 'custom', path: ['rows'], message: 'Add at least one row' });
    }
    if (!chart.rows.every((row) => row.length === chart.columns.length)) {
      ctx.addIssue({
        code: 'custom',
        path: ['rows'],
        message: 'Give every row one entry per column',
      });
    }
  });

/** A selling price: at least 1 poisha, at most 10,000,000 taka. */
const priceSchema = moneyMinorSchema.min(1).max(1_000_000_000);

const productFields = {
  categoryId: z.uuid({ error: 'Choose a category' }),
  slug: slugSchema,
  name: productNameSchema,
  summary: optionalTextSchema(300),
  description: optionalTextSchema(5000),
  priceMinor: priceSchema,
  /** Former price shown struck through; must be higher than the price. Null removes it. */
  compareAtPriceMinor: priceSchema.nullable().optional(),
  maxOrderQuantity: z.number().int().min(1).max(100).default(10),
  isFeatured: z.boolean().default(false),
  /**
   * Merchandising tags. Optional for older clients: left out on create it means none, on
   * update it keeps the current tags. Changing them on a product on sale needs publish
   * permission, like the price.
   */
  tags: productTagsSchema.optional(),
  /**
   * The size chart; null removes it. Optional for older clients: left out on create it
   * means none, on update it keeps the current chart. It is content: it can change only
   * while the product is not on sale and not under review.
   */
  sizeChart: sizeChartInputSchema.nullable().optional(),
};

function comparePriceAbovePrice(value: {
  priceMinor: number;
  compareAtPriceMinor?: number | null | undefined;
}): boolean {
  return value.compareAtPriceMinor == null || value.compareAtPriceMinor > value.priceMinor;
}

const comparePriceIssue = {
  error: 'The former price must be higher than the price',
  path: ['compareAtPriceMinor'],
};

/** POST /admin/products — creates a draft; `initialStock` is recorded in the stock ledger. */
export const createProductRequestSchema = z
  .strictObject({
    ...productFields,
    sku: skuSchema,
    initialStock: z.number().int().min(0).max(1_000_000).default(0),
  })
  .refine(comparePriceAbovePrice, comparePriceIssue);

/**
 * PUT /admin/products/:productId — replaces every editable field (the SKU never
 * changes; stock moves only through POST /admin/products/:productId/stock).
 */
export const updateProductRequestSchema = z
  .strictObject(productFields)
  .refine(comparePriceAbovePrice, comparePriceIssue);

/** POST /admin/products/:productId/status — publishing requires approved content. */
export const productStatusRequestSchema = z.strictObject({ status: z.enum(PRODUCT_STATUSES) });

/** POST /admin/products/:productId/stock — a signed change with the reason for the ledger. */
export const stockAdjustmentRequestSchema = z.strictObject({
  change: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((value) => value !== 0, { error: 'The change cannot be zero' }),
  note: z
    .string()
    .trim()
    .min(3, { error: 'Give a reason of at least 3 characters' })
    .max(300, { error: 'Keep the reason under 300 characters' }),
});

/** Orders of the admin product list; ties are always broken by product id. */
export const ADMIN_PRODUCT_SORTS = [
  'updated_desc',
  'name_asc',
  'name_desc',
  'price_asc',
  'price_desc',
  'stock_asc',
  'stock_desc',
] as const;
export type AdminProductSort = (typeof ADMIN_PRODUCT_SORTS)[number];

/** GET /admin/products */
export const adminProductListQuerySchema = z.object({
  /** Matches the name, SKU or address (slug). */
  q: adminSearchSchema.optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  moderationStatus: z.enum(MODERATION_STATUSES).optional(),
  categoryId: z.uuid().optional(),
  /** `low`: at or below the low-stock threshold (sold out included); `out`: sold out. */
  stock: z.enum(['low', 'out']).optional(),
  /** Most recently changed first unless asked otherwise. */
  sort: z.enum(ADMIN_PRODUCT_SORTS).default('updated_desc'),
  ...adminPageQueryShape,
});

export const adminCategoryRefSchema = z.object({
  id: z.uuid(),
  slug: slugSchema,
  name: z.string(),
  isActive: z.boolean(),
});

export const adminProductSummarySchema = z.object({
  id: z.uuid(),
  slug: slugSchema,
  sku: z.string(),
  name: z.string(),
  summary: z.string().nullable(),
  status: z.enum(PRODUCT_STATUSES),
  moderationStatus: z.enum(MODERATION_STATUSES),
  priceMinor: moneyMinorSchema,
  compareAtPriceMinor: moneyMinorSchema.nullable(),
  /** The exact stock level (staff only; shoppers see a band). */
  stockQuantity: z.number().int().min(0),
  maxOrderQuantity: z.number().int().min(1),
  isFeatured: z.boolean(),
  category: adminCategoryRefSchema,
  publishedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
  /** The primary image; null when the product has none (or media is not configured). */
  image: productImageSchema.nullable(),
});

/** The product's most recent content review, as its staff see it. */
export const productReviewSchema = z.object({
  taskId: z.uuid(),
  status: z.enum(MODERATION_TASK_STATUSES),
  /** The moderator's explanation (required for rejections and change requests). */
  note: z.string().nullable(),
  submittedAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  assigned: z.boolean(),
});

export const adminProductDetailSchema = adminProductSummarySchema.extend({
  description: z.string().nullable(),
  createdAt: z.iso.datetime(),
  latestReview: productReviewSchema.nullable(),
  /** Every image in order; the first is the primary one. */
  images: z.array(productImageSchema),
  /** Merchandising tags (staff only). Absent from older payloads. */
  tags: z.array(z.string()).optional(),
  /** The size chart shoppers see, or null. Absent from older payloads. */
  sizeChart: sizeChartSchema.nullable().optional(),
});

export const adminProductListResponseSchema = z.object({
  products: z.array(adminProductSummarySchema),
  ...pageInfoShape,
});

export const adminProductResponseSchema = z.object({ product: adminProductDetailSchema });

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * POST /admin/categories/reorder: one group of categories (a parent's subcategories, or the top
 * level when `parentId` is null) in the order it should appear. It must name every category of
 * that group exactly once; the database refuses a stale or partial list.
 */
export const categoryReorderSchema = z.strictObject({
  parentId: z.uuid().nullable(),
  ids: z.array(z.uuid()).min(1).max(500),
});

/** POST /admin/categories and PUT /admin/categories/:categoryId (replaces every field). */
export const categoryInputSchema = z.strictObject({
  slug: slugSchema.max(80),
  name: z
    .string()
    .trim()
    .min(1, { error: 'Enter the category name' })
    .max(80, { error: 'Keep the name under 80 characters' }),
  description: optionalTextSchema(500),
  sortOrder: z.number().int().min(-100_000).max(100_000).default(0),
  /** Hidden categories (false) and their products never appear in the storefront. */
  isActive: z.boolean().default(true),
  /** Parent category for subcategories; null (or omitted) makes it a top-level department. */
  parentId: z.uuid().nullable().optional(),
  /** Show this category in featured slots on the storefront. */
  isFeatured: z.boolean().default(false),
});

export const adminCategorySchema = z.object({
  id: z.uuid(),
  slug: slugSchema,
  name: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  /** Parent category; null for a top-level department. */
  parentId: z.uuid().nullable(),
  isFeatured: z.boolean(),
  /** Public URL of the cover image, or null when the category has none. */
  imageUrl: z.string().nullable(),
  /** The category page banner's full-size URL; null when there is none (or on an older API). */
  bannerUrl: z.string().nullable().optional(),
  /** Products in the category, in any status. */
  productCount: z.number().int().min(0),
});

export const adminCategoryListResponseSchema = z.object({
  categories: z.array(adminCategorySchema),
});
export const adminCategoryResponseSchema = z.object({ category: adminCategorySchema });

// ---------------------------------------------------------------------------
// Stock ledger
// ---------------------------------------------------------------------------

/** GET /admin/inventory-movements — newest first. */
export const inventoryMovementListQuerySchema = z.object({
  productId: z.uuid().optional(),
  reason: z.enum(INVENTORY_REASONS).optional(),
  ...adminPageQueryShape,
});

export const inventoryMovementSchema = z.object({
  id: z.number().int().min(1),
  product: z.object({ id: z.uuid(), name: z.string(), sku: z.string() }),
  /** Units added (positive) or removed (negative). */
  change: z.number().int(),
  stockAfter: z.number().int().min(0),
  reason: z.enum(INVENTORY_REASONS),
  note: z.string().nullable(),
  /** The order behind an order movement, when the caller may see orders. */
  orderNumber: orderNumberSchema.nullable(),
  /**
   * The account behind the change (the customer, for their own orders and cancellations);
   * named only for staff accounts the caller may see. Null for system changes.
   */
  actor: accountRefSchema.nullable(),
  createdAt: z.iso.datetime(),
});

export const inventoryMovementListResponseSchema = z.object({
  movements: z.array(inventoryMovementSchema),
  ...pageInfoShape,
});

export type SizeChartInput = z.input<typeof sizeChartInputSchema>;
export type CreateProductRequest = z.input<typeof createProductRequestSchema>;
export type UpdateProductRequest = z.input<typeof updateProductRequestSchema>;
export type ProductStatusRequest = z.input<typeof productStatusRequestSchema>;
export type StockAdjustmentRequest = z.input<typeof stockAdjustmentRequestSchema>;
export type AdminProductListQuery = z.input<typeof adminProductListQuerySchema>;
export type AdminProductSummary = z.infer<typeof adminProductSummarySchema>;
export type AdminProductDetail = z.infer<typeof adminProductDetailSchema>;
export type ProductReview = z.infer<typeof productReviewSchema>;
export type AdminProductListResponse = z.infer<typeof adminProductListResponseSchema>;
export type AdminProductResponse = z.infer<typeof adminProductResponseSchema>;
export type CategoryInput = z.input<typeof categoryInputSchema>;
export type CategoryReorderInput = z.infer<typeof categoryReorderSchema>;
export type AdminCategory = z.infer<typeof adminCategorySchema>;
export type AdminCategoryListResponse = z.infer<typeof adminCategoryListResponseSchema>;
export type AdminCategoryResponse = z.infer<typeof adminCategoryResponseSchema>;
export type InventoryMovementListQuery = z.input<typeof inventoryMovementListQuerySchema>;
export type InventoryMovement = z.infer<typeof inventoryMovementSchema>;
export type InventoryMovementListResponse = z.infer<typeof inventoryMovementListResponseSchema>;
