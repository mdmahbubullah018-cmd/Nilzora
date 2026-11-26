import { z } from 'zod';
import { productVideoSchema } from './product-videos';
import { productCampaignSchema } from './discounts';
import { productImageSchema, mediaPictureSchema } from './media';
import { CURRENCY, moneyMinorSchema } from './money';

/*
 * Catalog contract
 * ----------------
 * Money is always an integer number of poisha (1 BDT = 100 poisha), never a float.
 * Prices come from the API only; clients display them and never send them back.
 */

export { CURRENCY, moneyMinorSchema };

/** URL-safe identifier of a category or product: lower-case words joined by hyphens. */
export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, { error: 'Not a valid catalog address' });

export const CATALOG_SORTS = [
  'featured',
  'newest',
  'price_asc',
  'price_desc',
  'relevance',
] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];
export const catalogSortSchema = z.enum(CATALOG_SORTS);

/** Stock as shown to shoppers. Exact stock levels are not part of the contract. */
export const AVAILABILITIES = ['in_stock', 'low_stock', 'out_of_stock'] as const;
export type Availability = (typeof AVAILABILITIES)[number];

/** At or below this many units, a product is shown as low on stock. */
export const LOW_STOCK_THRESHOLD = 5;

export const categorySchema = z.object({
  slug: slugSchema,
  name: z.string(),
  description: z.string().nullable(),
  productCount: z.number().int().min(0),
  /**
   * Cover picture, as the URLs of its stored WebP variants; null when the category has no
   * cover (or media is not configured). Defaults keep an older API payload parseable.
   */
  image: mediaPictureSchema.nullable().default(null),
  /**
   * Wide banner for the category's own page, uploaded in the admin; null when there is none.
   * Absent from older payloads.
   */
  banner: mediaPictureSchema.nullable().optional(),
  /** Parent category of a subcategory; null for a top-level department. */
  parentSlug: slugSchema.nullable().default(null),
  /** 1 for a top-level department, 2 or 3 for a descendant. */
  depth: z.number().int().min(1).max(3).default(1),
  /** The store may show this category in featured slots. */
  isFeatured: z.boolean().default(false),
  /**
   * Products on sale in this category and every published subcategory below it: what the
   * category's own listing shows with `includeSubcategories`. Absent from older payloads.
   */
  totalProductCount: z.number().int().min(0).optional(),
});

export const productSummarySchema = z.object({
  id: z.uuid(),
  slug: slugSchema,
  sku: z.string(),
  name: z.string(),
  summary: z.string().nullable(),
  priceMinor: moneyMinorSchema,
  /** Former price, shown struck through; always higher than priceMinor when present. */
  compareAtPriceMinor: moneyMinorSchema.nullable(),
  availability: z.enum(AVAILABILITIES),
  /** Most units one order may hold right now (the per-order limit, capped by stock). */
  maxOrderQuantity: z.number().int().min(0),
  isFeatured: z.boolean(),
  category: z.object({ slug: slugSchema, name: z.string() }),
  /** The primary image; null when the product has none (or media is not configured). */
  image: productImageSchema.nullable(),
  /** The product's brand when it has an active one. Absent from older payloads. */
  brand: z.object({ slug: z.string(), name: z.string() }).nullable().optional(),
  /**
   * The campaign that priced this product right now. When present, `priceMinor` is the
   * campaign's price and `compareAtPriceMinor` is the list price it discounted; the
   * product's own sale price is not in force. Absent from older payloads.
   */
  campaign: productCampaignSchema.nullable().default(null),
  /**
   * The distinct colour options this product is actually sold in, in attribute order. Only
   * colours with a configured swatch are listed, because a card preview has no room for a
   * name and inventing one would be wrong. Absent from older payloads, and present only when
   * the product has at least two colours â€” a single colour is not worth a row on a card.
   */
  colors: z
    .array(
      z.object({
        valueSlug: z.string(),
        value: z.string(),
        swatchHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      }),
    )
    .optional(),
  /**
   * Units sold: delivered orders only, less approved returns. Absent when the figure is not
   * available (an older API); 0 when nothing has been sold yet. Never an estimate.
   */
  soldCount: z.number().int().min(0).optional(),
});

/** Limits of a product's size chart. */
export const SIZE_CHART_MAX_COLUMNS = 8;
export const SIZE_CHART_MAX_ROWS = 30;
export const SIZE_CHART_CELL_MAX = 40;

/**
 * A product's size chart as shoppers see it: column headings and rows of the same width,
 * e.g. columns ["Size", "Chest (cm)"] and rows [["M", "96"], ["L", "102"]].
 */
export const SIZE_CHART_UNITS = ['cm', 'in', 'mm'] as const;
export type SizeChartUnit = (typeof SIZE_CHART_UNITS)[number];

export const sizeChartSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  /** What the measurement columns are in, shown beside the table (cm, in or mm). */
  unit: z.enum(SIZE_CHART_UNITS).optional(),
  /** A table (the default) or one uploaded picture of the chart. */
  mode: z.enum(['table', 'image']).optional(),
  /** The picture's media library key, for a picture chart (staff screens). */
  imageKey: z.string().optional(),
  /** The picture's address, resolved by the API for a picture chart. */
  imageUrl: z.string().optional(),
});

/** One attribute value of a variant, e.g. Size = M. */
export const productVariantOptionSchema = z.object({
  attribute: z.string(),
  attributeSlug: z.string(),
  /** A colour renders as a swatch, a size as a chip. Absent on older payloads. */
  kind: z.enum(['color', 'size', 'other']).optional(),
  value: z.string(),
  valueSlug: z.string(),
  /** The #RRGGBB of a colour value, when one is set. */
  swatchHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
});

/**
 * A sellable combination of a product's options. Its price is already resolved
 * against the product, so clients never have to know which one sets it.
 */
export const productVariantSchema = z.object({
  id: z.uuid(),
  sku: z.string(),
  priceMinor: moneyMinorSchema,
  compareAtPriceMinor: moneyMinorSchema.nullable(),
  availability: z.enum(AVAILABILITIES),
  maxOrderQuantity: z.number().int().min(0),
  /** The option values, in the product's attribute order. */
  options: z.array(productVariantOptionSchema),
  /** A picture for this combination; null falls back to the product's images. */
  imageUrl: z.string().nullable().default(null),
});

export const productDetailSchema = productSummarySchema.extend({
  description: z.string().nullable(),
  /** The product's brand, when it has one that is active. */
  brand: z.object({ slug: z.string(), name: z.string() }).nullable().optional(),
  /** Every image in order; the first is the primary one. */
  images: z.array(productImageSchema),
  /**
   * The product's options, in display order. Empty for a product that sells as a
   * single item; a product with variants must be bought as one of them.
   */
  variants: z.array(productVariantSchema).default([]),
  /** The product's size chart, when it has one. Absent from older payloads. */
  sizeChart: sizeChartSchema.nullable().optional(),
  /** Short product videos, in order. Absent from older payloads. */
  videos: z.array(productVideoSchema).optional(),
});

/** The deepest a listing can page: the database refuses offsets beyond this. */
export const MAX_CATALOG_OFFSET = 10_000;

/** The highest price a product can have, in poisha: the bound a price filter may name. */
export const MAX_PRICE_MINOR = 1_000_000_000;

const priceBoundSchema = z.coerce.number().int().min(0).max(MAX_PRICE_MINOR);

/** A yes/no option: true or false from code, "true"/"false" (or 1/0) from an address. */
const flagSchema = z.union([z.boolean(), z.stringbool()]);

/**
 * One or more slugs for a facet filter: `?size=m&size=l` arrives as an array, `?size=m,l` as a
 * string. Both become the same de-duplicated list, and anything that is not a slug is dropped
 * rather than refusing the whole listing (a mistyped link shows more, never an error page).
 */
export const slugListSchema = z
  .union([slugSchema, z.array(z.string())])
  .transform((value) =>
    (Array.isArray(value) ? value : value.split(','))
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '' && slugSchema.safeParse(entry).success),
  )
  .transform((entries) => [...new Set(entries)]);

/** The narrowing options of a listing, beyond the category and search text. */
export interface ListingFilters {
  includeSubcategories?: boolean | undefined;
  brand?: string | undefined;
  minPriceMinor?: number | undefined;
  maxPriceMinor?: number | undefined;
  inStock?: boolean | undefined;
  size?: readonly string[] | undefined;
  color?: readonly string[] | undefined;
}

/** True when a listing asks for any of the narrowing options. */
export function hasListingFilters(query: ListingFilters): boolean {
  return (
    query.includeSubcategories === true ||
    query.brand !== undefined ||
    query.minPriceMinor !== undefined ||
    query.maxPriceMinor !== undefined ||
    (query.size?.length ?? 0) > 0 ||
    (query.color?.length ?? 0) > 0 ||
    query.inStock === true
  );
}

/**
 * The narrowing options of a listing, shared by the listing itself and by the facets read, so
 * the two can never disagree about what a filter means.
 */
const catalogFilterShape = {
  category: slugSchema.optional(),
  /**
   * A shopping zone's slug. The database decides membership (explicit rows, else the
   * product's category), so a product never appears twice and never leaks in from another
   * collection. An unknown or inactive zone answers 404 rather than an empty list.
   */
  zone: slugSchema.optional(),
  /** Free-text search over product names and descriptions. */
  q: z.string().trim().min(1).max(100).optional(),
  /**
   * Defaults to relevance for a plain search, featured otherwise. Ranking by relevance is
   * only available without the narrowing options below; a filtered search defaults to newest.
   */
  sort: catalogSortSchema.optional(),
  /** With `category`: its subcategories' products too (the whole published branch). */
  includeSubcategories: flagSchema.optional(),
  /** Only this brand's products. A slug that is not an active brand matches nothing. */
  brand: slugSchema.optional(),
  /** Lowest and highest selling price, in poisha, both inclusive. */
  minPriceMinor: priceBoundSchema.optional(),
  maxPriceMinor: priceBoundSchema.optional(),
  /** Only products that can be ordered right now. */
  inStock: flagSchema.optional(),
  /**
   * Size and colour values, by their slug in the variant system (product_attribute_values).
   * Repeated (`?size=m&size=l`) or comma-separated (`?size=m,l`), both accepted; a value that
   * no variant carries matches nothing, so a retired size never quietly widens the list.
   */
  size: slugListSchema.optional(),
  color: slugListSchema.optional(),
} as const;

/** GET /catalog/products. Unknown query parameters (tracking tags) are ignored. */
export const productListQuerySchema = z
  .object({
    ...catalogFilterShape,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(60).default(24),
  })
  .refine((query) => (query.page - 1) * query.pageSize <= MAX_CATALOG_OFFSET, {
    error: 'This page is beyond the end of the listing',
    path: ['page'],
  })
  .refine(
    (query) =>
      query.minPriceMinor === undefined ||
      query.maxPriceMinor === undefined ||
      query.minPriceMinor <= query.maxPriceMinor,
    { error: 'The lowest price must not be above the highest', path: ['minPriceMinor'] },
  )
  .refine(
    (query) =>
      query.sort !== 'relevance' || (!hasListingFilters(query) && query.zone === undefined),
    {
      error: 'Results narrowed by filters cannot be ranked by relevance',
      path: ['sort'],
    },
  );

export const productListResponseSchema = z.object({
  items: z.array(productSummarySchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});

export const categoryListResponseSchema = z.object({ categories: z.array(categorySchema) });
export const productResponseSchema = z.object({ product: productDetailSchema });

/* -------------------------------------------------------------------------- */
/* Facets: the size and colour values a listing can offer                     */
/* -------------------------------------------------------------------------- */

/**
 * One value on offer, from the variant system: its slug (what a filter and a link carry), the
 * words the shopper sees, and how many products in the current context offer it.
 */
export const sizeFacetSchema = z.object({
  slug: slugSchema,
  value: z.string().min(1).max(40),
  productCount: z.number().int().min(0),
});

export const colorFacetSchema = sizeFacetSchema.extend({
  /** The swatch Admin configured for the value; null when none was set. */
  swatchHex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullable(),
});

export const productFacetsSchema = z.object({
  sizes: z.array(sizeFacetSchema),
  colors: z.array(colorFacetSchema),
});

export const productFacetsResponseSchema = z.object({ facets: productFacetsSchema });

/**
 * The filters the facets are computed for: the same filters as the listing, minus paging (a
 * facet is about the whole context, never one page of it).
 */
export const productFacetsQuerySchema = z.object(catalogFilterShape);


export type SizeFacet = z.infer<typeof sizeFacetSchema>;
export type ColorFacet = z.infer<typeof colorFacetSchema>;
export type ProductFacets = z.infer<typeof productFacetsSchema>;
export type ProductFacetsResponse = z.infer<typeof productFacetsResponseSchema>;
export type ProductFacetsQuery = z.input<typeof productFacetsQuerySchema>;

export type ProductVariant = z.infer<typeof productVariantSchema>;
export type ProductVariantOption = z.infer<typeof productVariantOptionSchema>;

export type Category = z.infer<typeof categorySchema>;
export type ProductSummary = z.infer<typeof productSummarySchema>;
export type ProductDetail = z.infer<typeof productDetailSchema>;
export type SizeChart = z.infer<typeof sizeChartSchema>;
export type ProductListQuery = z.input<typeof productListQuerySchema>;
export type ProductListResponse = z.infer<typeof productListResponseSchema>;
export type CategoryListResponse = z.infer<typeof categoryListResponseSchema>;
export type ProductResponse = z.infer<typeof productResponseSchema>;
