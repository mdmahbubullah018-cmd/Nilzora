import { z } from 'zod';
import { MAX_CATALOG_OFFSET, productSummarySchema, slugSchema } from './catalog';
import { mediaPictureSchema } from './media';

/*
 * Brands (the maker or label of a product) and promotional banners.
 * Brands live at the top level of the storefront, /<brand-slug>, so a brand slug may
 * never take a path the storefront itself uses (the database enforces the same list).
 */

export const RESERVED_BRAND_SLUGS = [
  'about',
  'account',
  'admin',
  'api',
  'auth',
  'brand',
  'brands',
  'cart',
  'categories',
  'category',
  'checkout',
  'confirm-email',
  'contact',
  'design-system',
  'favicon',
  'forgot-password',
  'help',
  'login',
  'logout',
  'orders',
  'privacy',
  'product',
  'products',
  'register',
  'reset-password',
  'robots',
  'search',
  'shop',
  'sitemap',
  'terms',
  'verify-otp',
  'welcome',
] as const;

const reserved: ReadonlySet<string> = new Set(RESERVED_BRAND_SLUGS);

export const brandSlugSchema = z
  .string()
  .min(2, { error: 'Use at least 2 characters' })
  .max(60, { error: 'Use at most 60 characters' })
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    error: 'Use lower-case letters, numbers and single hyphens',
  })
  .refine((slug) => !reserved.has(slug), { error: 'This address is reserved by the store' });

/** "North Star" -> "north-star": lower-case, URL-safe, hyphen-separated. */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

export const brandSchema = z.object({
  slug: brandSlugSchema,
  name: z.string(),
  description: z.string().nullable(),
  logo: mediaPictureSchema.nullable(),
  banner: mediaPictureSchema.nullable(),
  productCount: z.number().int().min(0),
});

export const brandListResponseSchema = z.object({ brands: z.array(brandSchema) });

/** GET /catalog/brands/:slug — a former slug answers with the current one to redirect to. */
export const brandLookupResponseSchema = z.object({
  brand: brandSchema.nullable(),
  redirectTo: brandSlugSchema.nullable(),
});

export const brandProductsQuerySchema = z
  .object({
    sort: z.enum(['featured', 'newest', 'price_asc', 'price_desc']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(60).default(24),
  })
  .refine((query) => (query.page - 1) * query.pageSize <= MAX_CATALOG_OFFSET, {
    error: 'This page is beyond the end of the listing',
    path: ['page'],
  });

export const brandProductsResponseSchema = z.object({
  items: z.array(productSummarySchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});

export const adminBrandSchema = brandSchema.extend({
  id: z.uuid(),
  isActive: z.boolean(),
});

export const brandInputSchema = z.object({
  slug: brandSlugSchema,
  name: z.string().trim().min(1, { error: 'Enter a name' }).max(80),
  /** Optional: a brand with nothing to say about itself still saves and renders. */
  description: z.string().trim().max(500).nullable().default(null),
  isActive: z.boolean(),
});

export const adminBrandListResponseSchema = z.object({ brands: z.array(adminBrandSchema) });
export const adminBrandResponseSchema = z.object({ brand: adminBrandSchema });
export const setProductBrandRequestSchema = z.object({ brandId: z.uuid().nullable() });
export const productBrandResponseSchema = z.object({ brandId: z.uuid().nullable() });

export const BANNER_PLACEMENTS = ['home_hero', 'home_secondary', 'category'] as const;
export const bannerPlacementSchema = z.enum(BANNER_PLACEMENTS);

/** Storefront-internal links only: a path, never another site. */
export const bannerHrefSchema = z
  .string()
  .trim()
  .max(300)
  .regex(/^\/[A-Za-z0-9/_?=&%.~-]*$/, { error: 'Use a path inside the store, such as /products' })
  .refine((href) => !href.startsWith('//'), { error: 'Use a path inside the store' });

export const bannerSchema = z.object({
  id: z.uuid(),
  placement: bannerPlacementSchema,
  /** The heading; an empty string means the banner has none (its artwork carries the message). */
  title: z.string(),
  /**
   * Describes the picture for screen readers; never shown. Null when the heading serves.
   * Absent from older payloads.
   */
  imageAlt: z.string().nullable().optional(),
  subtitle: z.string().nullable(),
  ctaLabel: z.string().nullable(),
  ctaHref: z.string().nullable(),
  image: mediaPictureSchema.nullable(),
  categorySlug: slugSchema.nullable(),
  /** A picture for small screens; absent or null means the main image serves everywhere. */
  mobileImage: mediaPictureSchema.nullable().optional(),
});

export const bannerListQuerySchema = z.object({
  placement: bannerPlacementSchema,
  category: slugSchema.optional(),
});

export const bannerListResponseSchema = z.object({ banners: z.array(bannerSchema) });

export const adminBannerSchema = bannerSchema.extend({
  categoryId: z.uuid().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  startsAt: z.iso.datetime({ offset: true }).nullable(),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
});

export const bannerInputSchema = z
  .object({
    placement: bannerPlacementSchema,
    categoryId: z.uuid().nullable(),
    /** Optional: '' (or left out) publishes a picture-only banner. */
    title: z.string().trim().max(80).default(''),
    subtitle: z.string().trim().max(200).nullable(),
    ctaLabel: z.string().trim().min(1).max(30).nullable(),
    ctaHref: bannerHrefSchema.nullable(),
    /** What the picture shows, for screen readers. Needed when there is no heading. */
    imageAlt: z.string().trim().min(1).max(160).nullable().default(null),
    sortOrder: z.number().int().min(0).max(1000),
    isActive: z.boolean(),
    startsAt: z.iso.datetime({ offset: true }).nullable(),
    endsAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .refine((input) => input.title !== '' || input.imageAlt !== null, {
    error: 'Add a heading, or describe the picture for people using screen readers',
    path: ['imageAlt'],
  })
  .refine((input) => (input.placement === 'category') === (input.categoryId !== null), {
    error: 'Choose a category for a category banner, and only then',
    path: ['categoryId'],
  })
  .refine((input) => (input.ctaLabel === null) === (input.ctaHref === null), {
    error: 'Give the button both a label and a link, or neither',
    path: ['ctaHref'],
  })
  .refine(
    (input) =>
      input.startsAt === null ||
      input.endsAt === null ||
      new Date(input.endsAt) > new Date(input.startsAt),
    { error: 'The end must be after the start', path: ['endsAt'] },
  );

export const adminBannerListResponseSchema = z.object({ banners: z.array(adminBannerSchema) });
export const adminBannerResponseSchema = z.object({ banner: adminBannerSchema });

export type Brand = z.infer<typeof brandSchema>;
export type BrandListResponse = z.infer<typeof brandListResponseSchema>;
export type BrandLookupResponse = z.infer<typeof brandLookupResponseSchema>;
export type BrandProductsQuery = z.input<typeof brandProductsQuerySchema>;
export type BrandProductsResponse = z.infer<typeof brandProductsResponseSchema>;
export type AdminBrand = z.infer<typeof adminBrandSchema>;
export type BrandInput = z.infer<typeof brandInputSchema>;
export type AdminBrandListResponse = z.infer<typeof adminBrandListResponseSchema>;
export type AdminBrandResponse = z.infer<typeof adminBrandResponseSchema>;
export type SetProductBrandRequest = z.infer<typeof setProductBrandRequestSchema>;
export type BannerPlacement = z.infer<typeof bannerPlacementSchema>;
export type Banner = z.infer<typeof bannerSchema>;
export type BannerListQuery = z.infer<typeof bannerListQuerySchema>;
export type BannerListResponse = z.infer<typeof bannerListResponseSchema>;
export type AdminBanner = z.infer<typeof adminBannerSchema>;
export type BannerInput = z.infer<typeof bannerInputSchema>;
export type AdminBannerListResponse = z.infer<typeof adminBannerListResponseSchema>;
export type AdminBannerResponse = z.infer<typeof adminBannerResponseSchema>;
