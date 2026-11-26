import { z } from 'zod';
import { mediaPictureSchema } from './media';

/*
 * Shopping zones
 * --------------
 * A merchandising layer beside the category taxonomy: "Men's", "Women's", "Kids", or any
 * collection an admin invents. Categories remain the product taxonomy; a zone groups what it
 * covers for browsing.
 *
 * Association resolution, applied by the database and never re-decided by a client:
 *   1. A product with explicit zone rows belongs to exactly those zones.
 *   2. A product with no explicit rows inherits the zones of its category.
 *   3. Otherwise it belongs to no zone and stays in general browsing.
 */

/** The banner folder the media service writes a zone's picture under. */
export const ZONE_BANNER_FOLDER = 'zone-banners' as const;

/**
 * The folder the media service writes a zone's app-only artwork under. It is separate from the
 * website's on purpose: a picture uploaded for the app can never become the site's artwork, and
 * replacing one never deletes the other.
 */
export const ZONE_MOBILE_BANNER_FOLDER = 'zone-mobile-banners' as const;

/**
 * Suggested audiences. Deliberately not an enum: a zone may carry any single lower-case word
 * (a custom collection needs no code change), so this is only what the admin form offers.
 */
export const ZONE_AUDIENCE_SUGGESTIONS = ['men', 'women', 'kids', 'unisex'] as const;
export type ZoneAudienceSuggestion = (typeof ZONE_AUDIENCE_SUGGESTIONS)[number];

/** One or two lower-case words: the audience label an admin may type. */
export const zoneAudienceSchema = z
  .string()
  .trim()
  .max(20)
  .regex(/^[a-z][a-z0-9_-]*$/, { error: 'Use a single lower-case word, e.g. men' })
  .nullable();

/** A zone as the storefront and the app see it: active zones only, pictures already resolved. */
export const shoppingZoneSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  audience: z.string().nullable(),
  /**
   * The website's picture, or null when none is set: clients draw their own branded fallback.
   * The app draws its own artwork when it has one, so the two surfaces never share a picture.
   */
  banner: mediaPictureSchema.nullable(),
  bannerAlt: z.string().nullable(),
  /**
   * The app's own artwork, when an admin gave this zone one. It is optional on purpose: an API
   * that has not learned about app artwork yet answers without it, and the app then draws the
   * website's picture rather than losing the whole collection rail.
   */
  mobileBanner: mediaPictureSchema.nullable().default(null),
  /** Products a shopper can see in this zone, resolved by the same rule the filter uses. */
  productCount: z.number().int().min(0),
});

export const shoppingZonesResponseSchema = z.object({ zones: z.array(shoppingZoneSchema) });

export type ShoppingZone = z.infer<typeof shoppingZoneSchema>;
export type ShoppingZonesResponse = z.infer<typeof shoppingZonesResponseSchema>;

/** A zone in the workspace: everything the storefront sees, plus how it is managed. */
export const adminShoppingZoneSchema = shoppingZoneSchema.extend({
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  displayOrder: z.number().int().min(0),
  isActive: z.boolean(),
  /** Products attached to this zone by hand (not those inherited from its categories). */
  explicitProductCount: z.number().int().min(0),
  categoryCount: z.number().int().min(0),
  updatedAt: z.string(),
});

export const adminShoppingZoneListResponseSchema = z.object({
  zones: z.array(adminShoppingZoneSchema),
  counts: z.object({ active: z.number().int().min(0), inactive: z.number().int().min(0) }),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});

/** GET /admin/shopping-zones/:zoneId — the zone and the ids of everything it holds. */
export const adminShoppingZoneResponseSchema = z.object({
  zone: adminShoppingZoneSchema.extend({
    productIds: z.array(z.uuid()),
    categoryIds: z.array(z.uuid()),
  }),
});

export const adminShoppingZoneListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('all'),
  sort: z.enum(['order', 'name', 'products']).default('order'),
  page: z.coerce.number().int().min(1).max(200).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
});

/** POST /admin/shopping-zones and PUT /admin/shopping-zones/:zoneId */
export const adminSaveShoppingZoneRequestSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, { error: 'Give the zone a name' })
    .max(60, { error: 'Keep the name under 60 characters' }),
  /** Blank is allowed: the database makes the address from the name. */
  slug: z.string().trim().max(60).optional(),
  description: z.string().trim().max(300).optional(),
  audience: z.string().trim().max(20).optional(),
  displayOrder: z.coerce.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
  seoTitle: z.string().trim().max(70).optional(),
  seoDescription: z.string().trim().max(160).optional(),
  bannerAlt: z.string().trim().max(160).optional(),
});

/** PUT /admin/shopping-zones/:zoneId/products and .../categories */
export const adminShoppingZoneProductsRequestSchema = z.strictObject({
  productIds: z.array(z.uuid()).max(500),
});
export const adminShoppingZoneCategoriesRequestSchema = z.strictObject({
  categoryIds: z.array(z.uuid()).max(200),
});

/** PUT /admin/shopping-zones/:zoneId/active */
export const adminShoppingZoneActiveRequestSchema = z.strictObject({ isActive: z.boolean() });

/** POST /admin/shopping-zones/:zoneId/banner — alt text for the picture being uploaded. */
export const adminShoppingZoneBannerQuerySchema = z.object({
  alt: z.string().trim().max(160).optional(),
});

export type AdminShoppingZone = z.infer<typeof adminShoppingZoneSchema>;
export type AdminShoppingZoneResponse = z.infer<typeof adminShoppingZoneResponseSchema>;
export type AdminShoppingZoneDetail = AdminShoppingZoneResponse['zone'];
export type AdminShoppingZoneListResponse = z.infer<typeof adminShoppingZoneListResponseSchema>;
export type AdminShoppingZoneListQuery = z.infer<typeof adminShoppingZoneListQuerySchema>;
export type AdminSaveShoppingZoneRequest = z.infer<typeof adminSaveShoppingZoneRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Assignment from the product and category forms                              */
/* -------------------------------------------------------------------------- */

/*
 * The zone editor writes the junctions from the zone's side; these let a product's or a
 * category's own page write the same rows from the other side. Only the direction differs —
 * the tables and the resolution rule are identical, so the two surfaces cannot disagree.
 */

/**
 * GET /admin/products/:productId/zones
 *
 * `mine` are the zones pinned to the product, `inherited` the zones of its category, and
 * `resolved` what the listing rule actually gives it. The form shows all three because an
 * empty `mine` means "follow the category", not "belongs nowhere".
 */
export const adminProductZonesSchema = z.object({
  mine: z.array(z.uuid()),
  inherited: z.array(z.uuid()),
  resolved: z.array(z.uuid()),
});

/** GET /admin/categories/:categoryId/zones — the zones this category feeds. */
export const adminCategoryZonesSchema = z.object({ zoneIds: z.array(z.uuid()) });

/** PUT …/zones — an empty list clears the assignment (a product then follows its category). */
export const adminZoneAssignmentRequestSchema = z.strictObject({
  zoneIds: z.array(z.uuid()).max(50),
});

export const adminZoneAssignmentResponseSchema = z.object({
  kept: z.number().int().min(0),
});

export type AdminProductZones = z.infer<typeof adminProductZonesSchema>;
export type AdminCategoryZones = z.infer<typeof adminCategoryZonesSchema>;
export type AdminZoneAssignmentRequest = z.infer<typeof adminZoneAssignmentRequestSchema>;
