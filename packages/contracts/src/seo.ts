import { z } from 'zod';

/*
 * SEO
 * ---
 * Catalogue rows carry their own search metadata; nothing is duplicated into a second
 * table. The public reads resolve a page's metadata server-side and only ever answer for
 * content a visitor may see, so an unpublished product can never be described publicly.
 */

/** Longest values the database accepts, so the Admin form can guide before saving. */
export const SEO_TITLE_MAX = 70;
export const SEO_DESCRIPTION_MAX = 200;
export const SEO_OG_TITLE_MAX = 90;
export const SEO_OG_DESCRIPTION_MAX = 300;

/** A same-site path: a canonical override can never point at another domain. */
export const canonicalPathSchema = z
  .string()
  .trim()
  .max(160)
  .regex(/^\/[A-Za-z0-9/_?=&%.-]*$/, { error: 'Use a path that starts with /' })
  // `//host` is a protocol-relative URL, not a path, so a doubled slash is never allowed.
  .refine((path) => !path.includes('//'), { error: 'Use a single slash' });

/** A media key the existing media service produced, never a full URL. */
export const mediaKeySchema = z
  .string()
  .trim()
  .max(180)
  .regex(/^(products|categories|seo|brand|library)\/[A-Za-z0-9/_-]+$/, {
    error: 'Use an existing media key',
  });

/**
 * A URL the API resolved for a stored media key. Only http(s) is allowed: a `javascript:`
 * or `data:` value must never reach a page as an image source, and a relative path would
 * silently point at the storefront instead of the media host.
 */
export const publicMediaUrlSchema = z
  .url({ protocol: /^https?$/, error: 'Use an absolute http(s) URL' })
  .nullable()
  .default(null);

export const SEO_KINDS = ['product', 'category'] as const;
export type SeoKind = (typeof SEO_KINDS)[number];
export const seoKindSchema = z.enum(SEO_KINDS);

/** The metadata one public page resolves to. Never carries an unpublished row. */
export const seoMetadataSchema = z.object({
  kind: seoKindSchema,
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable().default(null),
  ogTitle: z.string(),
  ogDescription: z.string().nullable().default(null),
  ogImageKey: z.string().nullable().default(null),
  /**
   * The key resolved into a public image URL by the API, which is the only process that
   * knows the media address. Null whenever no key is set or media is not configured, so a
   * reader never guesses a host.
   */
  ogImageUrl: publicMediaUrlSchema,
  canonicalPath: z.string(),
  noIndex: z.boolean().default(false),
  /** The store's default metadata, for a page that has none of its own. */
  defaultSeoTitle: z.string().nullable().default(null),
  defaultSeoDescription: z.string().nullable().default(null),
  updatedAt: z.iso.datetime(),
});

export const seoMetadataResponseSchema = z.object({ seo: seoMetadataSchema });

/** One row of the Admin SEO overview. */
export const seoOverviewRowSchema = z.object({
  kind: seoKindSchema,
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  /** Whether the page is actually reachable by a visitor right now. */
  isPublic: z.boolean(),
  seoTitle: z.string().nullable().default(null),
  seoDescription: z.string().nullable().default(null),
  ogTitle: z.string().nullable().default(null),
  ogDescription: z.string().nullable().default(null),
  ogImageKey: z.string().nullable().default(null),
  canonicalPath: z.string().nullable().default(null),
  noIndex: z.boolean().default(false),
  missingTitle: z.boolean(),
  missingDescription: z.boolean(),
  updatedAt: z.iso.datetime(),
});

export const seoOverviewResponseSchema = z.object({
  entries: z.array(seoOverviewRowSchema),
});

export const seoOverviewQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
});

/** PUT /admin/seo/products/:productId and /admin/seo/categories/:categoryId */
export const saveSeoRequestSchema = z.strictObject({
  seoTitle: z.string().trim().max(SEO_TITLE_MAX).nullable().default(null),
  seoDescription: z.string().trim().max(SEO_DESCRIPTION_MAX).nullable().default(null),
  ogTitle: z.string().trim().max(SEO_OG_TITLE_MAX).nullable().default(null),
  ogDescription: z.string().trim().max(SEO_OG_DESCRIPTION_MAX).nullable().default(null),
  ogImageKey: mediaKeySchema.nullable().default(null),
  canonicalPath: canonicalPathSchema.nullable().default(null),
  noIndex: z.boolean().default(false),
});

/** One line of the sitemap: what to list, and when it last changed. */
export const sitemapEntrySchema = z.object({
  kind: seoKindSchema,
  slug: z.string(),
  lastModified: z.iso.datetime(),
});

export const sitemapResponseSchema = z.object({ entries: z.array(sitemapEntrySchema) });

export type SeoMetadataResponse = z.infer<typeof seoMetadataResponseSchema>;

export type SeoMetadata = z.infer<typeof seoMetadataSchema>;
export type SeoOverviewRow = z.infer<typeof seoOverviewRowSchema>;
export type SeoOverviewResponse = z.infer<typeof seoOverviewResponseSchema>;
export type SeoOverviewQuery = z.input<typeof seoOverviewQuerySchema>;
export type SaveSeoRequest = z.infer<typeof saveSeoRequestSchema>;
export type SitemapEntry = z.infer<typeof sitemapEntrySchema>;
export type SitemapResponse = z.infer<typeof sitemapResponseSchema>;
