import { z } from 'zod';
import { slugSchema } from './catalog';
import { bannerHrefSchema, bannerPlacementSchema } from './merchandising';

/*
 * Storefront content
 * ------------------
 * What the store's owner manages beyond the catalog: static pages, navigation links and
 * the homepage's sections. Visitors read only published pages, active links and enabled
 * sections; when nothing has been set up the storefront keeps its built-in defaults.
 */

// ---------------------------------------------------------------------------
// Static pages
// ---------------------------------------------------------------------------

export const SITE_PAGE_SLUGS = ['about', 'privacy', 'terms', 'returns', 'shipping', 'faq'] as const;
export type SitePageSlug = (typeof SITE_PAGE_SLUGS)[number];

/**
 * Where each page lives on the storefront. about, privacy and terms are paths no brand may
 * take; the others sit under /help (also reserved), so they never shadow a brand page.
 */
export const SITE_PAGE_PATHS: Readonly<Record<SitePageSlug, string>> = {
  about: '/about',
  privacy: '/privacy',
  terms: '/terms',
  returns: '/help/returns',
  shipping: '/help/shipping',
  faq: '/help/faq',
};

export const SITE_PAGE_BODY_MAX = 20_000;

/**
 * Plain text, never HTML. Blank lines separate paragraphs; a line starting with "# " or
 * "## " is a heading and one starting with "- " a list item.
 *
 * Tabs, newlines and carriage returns are the only characters below U+0020 a body may
 * contain; DEL is refused too. The check walks the string instead of matching a control
 * -character range, because a regular expression for that reads as a mistake to every
 * reviewer and to the linter.
 */
function hasControlCharacter(body: string): boolean {
  for (const character of body) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a || code === 0x0d) continue;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

const pageBodySchema = z
  .string()
  .max(SITE_PAGE_BODY_MAX)
  .refine((body) => !hasControlCharacter(body), { error: 'Remove control characters' });

export const publicSitePageSchema = z.object({
  slug: z.enum(SITE_PAGE_SLUGS),
  title: z.string(),
  body: z.string(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});

export const sitePageResponseSchema = z.object({ page: publicSitePageSchema });

export const adminSitePageSchema = publicSitePageSchema.extend({
  isPublished: z.boolean(),
  /** Null for a page never written. */
  updatedAt: z.iso.datetime().nullable(),
});

export const adminSitePageListResponseSchema = z.object({ pages: z.array(adminSitePageSchema) });
export const adminSitePageResponseSchema = z.object({ page: adminSitePageSchema });

/** PUT /admin/site-pages/:slug */
export const saveSitePageRequestSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(120),
    body: pageBodySchema,
    isPublished: z.boolean(),
    seoTitle: z.string().trim().max(70).nullable().default(null),
    seoDescription: z.string().trim().max(200).nullable().default(null),
  })
  .refine((page) => !page.isPublished || page.body.trim() !== '', {
    error: 'A published page needs text',
    path: ['body'],
  });

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export const MENU_NAMES = ['header', 'footer_shop', 'footer_help'] as const;
export type MenuName = (typeof MENU_NAMES)[number];
export const MENU_MAX_ITEMS = 12;

/** A path inside the store (the banner link rule) or an https address. */
export const menuHrefSchema = z.union([
  bannerHrefSchema,
  z
    .string()
    .trim()
    .max(300)
    .regex(/^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9/_?=&%.~#-]*)?$/, {
      error: 'Use a store path such as /products, or an https address',
    }),
]);

export const navigationLinkSchema = z.object({ label: z.string(), href: z.string() });

export const navigationSchema = z.object({
  menus: z.object({
    header: z.array(navigationLinkSchema),
    footerShop: z.array(navigationLinkSchema),
    footerHelp: z.array(navigationLinkSchema),
  }),
  /** Published static pages, in a fixed order. */
  pages: z.array(z.object({ slug: z.enum(SITE_PAGE_SLUGS), title: z.string() })),
});

export const navigationResponseSchema = z.object({ navigation: navigationSchema });

export const menuItemSchema = z.object({
  id: z.uuid(),
  menu: z.enum(MENU_NAMES),
  label: z.string(),
  href: z.string(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  updatedAt: z.iso.datetime(),
});

export const menuItemListResponseSchema = z.object({ items: z.array(menuItemSchema) });
export const menuItemResponseSchema = z.object({ item: menuItemSchema });

/** POST /admin/navigation and PUT /admin/navigation/:id */
export const saveMenuItemRequestSchema = z.strictObject({
  menu: z.enum(MENU_NAMES),
  label: z.string().trim().min(1).max(40),
  href: menuHrefSchema,
  isActive: z.boolean().default(true),
});

/** PUT /admin/navigation/order — every link of the menu, first shown first. */
export const reorderMenuRequestSchema = z.strictObject({
  menu: z.enum(MENU_NAMES),
  ids: z.array(z.uuid()).max(MENU_MAX_ITEMS),
});

// ---------------------------------------------------------------------------
// Homepage sections
// ---------------------------------------------------------------------------

export const HOMEPAGE_SECTION_KEYS = [
  'hero',
  'categories',
  'featured',
  'new_arrivals',
  'brands',
  'promotions',
  'services',
] as const;
export type HomepageSectionKey = (typeof HOMEPAGE_SECTION_KEYS)[number];

export const HOMEPAGE_ITEM_LIMIT_MAX = 24;

/** featured and new_arrivals may narrow to one category and/or brand. */
export const homepageSectionConfigSchema = z.strictObject({
  categorySlug: slugSchema.optional(),
  brandSlug: slugSchema.optional(),
});

export const homepageSectionSchema = z.object({
  key: z.enum(HOMEPAGE_SECTION_KEYS),
  /** Replaces the section's own heading. */
  title: z.string().nullable(),
  itemLimit: z.number().int().min(1).max(HOMEPAGE_ITEM_LIMIT_MAX).nullable(),
  config: z.object({ categorySlug: z.string().optional(), brandSlug: z.string().optional() }),
});

/** The enabled sections, in order. Empty means "use the built-in homepage". */
export const homepageResponseSchema = z.object({
  homepage: z.object({ sections: z.array(homepageSectionSchema) }),
});

export const adminHomepageSectionSchema = homepageSectionSchema.extend({
  isEnabled: z.boolean(),
  sortOrder: z.number().int(),
  updatedAt: z.iso.datetime(),
});

export const adminHomepageResponseSchema = z.object({
  sections: z.array(adminHomepageSectionSchema),
});

/** PUT /admin/homepage — every section once, in the order to show them. */
export const saveHomepageRequestSchema = z.strictObject({
  sections: z
    .array(
      z.strictObject({
        key: z.enum(HOMEPAGE_SECTION_KEYS),
        isEnabled: z.boolean(),
        title: z.string().trim().min(1).max(60).nullable().default(null),
        itemLimit: z.number().int().min(1).max(HOMEPAGE_ITEM_LIMIT_MAX).nullable().default(null),
        config: homepageSectionConfigSchema.default({}),
      }),
    )
    .length(HOMEPAGE_SECTION_KEYS.length)
    .refine(
      (sections) => new Set(sections.map((section) => section.key)).size === sections.length,
      {
        error: 'List every section exactly once',
      },
    )
    .refine(
      (sections) =>
        sections.every(
          (section) =>
            Object.keys(section.config).length === 0 ||
            section.key === 'featured' ||
            section.key === 'new_arrivals',
        ),
      { error: 'Only the product rows take a category or brand' },
    ),
});

// ---------------------------------------------------------------------------
// Banner order
// ---------------------------------------------------------------------------

/** PUT /admin/banners/order — every banner of one placement (and category), first shown first. */
export const reorderBannersRequestSchema = z
  .strictObject({
    placement: bannerPlacementSchema,
    categoryId: z.uuid().nullable().default(null),
    ids: z.array(z.uuid()).min(1).max(100),
  })
  .refine((input) => (input.placement === 'category') === (input.categoryId !== null), {
    error: 'Category banners need their category; other placements none',
    path: ['categoryId'],
  });

export type PublicSitePage = z.infer<typeof publicSitePageSchema>;
export type SitePageResponse = z.infer<typeof sitePageResponseSchema>;
export type AdminSitePage = z.infer<typeof adminSitePageSchema>;
export type AdminSitePageListResponse = z.infer<typeof adminSitePageListResponseSchema>;
export type AdminSitePageResponse = z.infer<typeof adminSitePageResponseSchema>;
export type SaveSitePageRequest = z.input<typeof saveSitePageRequestSchema>;
export type Navigation = z.infer<typeof navigationSchema>;
export type NavigationResponse = z.infer<typeof navigationResponseSchema>;
export type MenuItem = z.infer<typeof menuItemSchema>;
export type MenuItemListResponse = z.infer<typeof menuItemListResponseSchema>;
export type MenuItemResponse = z.infer<typeof menuItemResponseSchema>;
export type SaveMenuItemRequest = z.input<typeof saveMenuItemRequestSchema>;
export type ReorderMenuRequest = z.input<typeof reorderMenuRequestSchema>;
export type HomepageSection = z.infer<typeof homepageSectionSchema>;
export type HomepageResponse = z.infer<typeof homepageResponseSchema>;
export type AdminHomepageSection = z.infer<typeof adminHomepageSectionSchema>;
export type AdminHomepageResponse = z.infer<typeof adminHomepageResponseSchema>;
export type SaveHomepageRequest = z.input<typeof saveHomepageRequestSchema>;
export type ReorderBannersRequest = z.input<typeof reorderBannersRequestSchema>;
