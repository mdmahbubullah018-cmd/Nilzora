import { z } from 'zod';
import { adminPageQueryShape, optionalTextSchema, pageInfoShape } from './admin-common';
import { mediaPictureSchema } from './media';
import { moneyMinorSchema } from './money';

/*
 * Discount campaigns
 * ------------------
 * A campaign is promotional pricing that is resolved at read time and never copied
 * into a product. One campaign governs a product at a time; discounts never stack.
 * Precedence, highest first: product-targeted, category-targeted (a target covers its
 * subcategories), brand-targeted, storewide, and finally the product's own sale price.
 * Inside one level the higher `priority` wins, then the earlier start, then the older
 * campaign, then its id, so the answer is always the same.
 *
 * Every amount is poisha (integer minor units). A `discountValue` is percentage points
 * for a percent campaign and poisha for a fixed one.
 */

export const CAMPAIGN_SCOPES = ['products', 'categories', 'brands', 'storewide'] as const;
export type CampaignScope = (typeof CAMPAIGN_SCOPES)[number];
export const campaignScopeSchema = z.enum(CAMPAIGN_SCOPES);

export const CAMPAIGN_DISCOUNT_KINDS = ['percent', 'fixed'] as const;
export type CampaignDiscountKind = (typeof CAMPAIGN_DISCOUNT_KINDS)[number];
export const campaignDiscountKindSchema = z.enum(CAMPAIGN_DISCOUNT_KINDS);

/** The stored lifecycle state. */
export const CAMPAIGN_STATUSES = [
  'draft',
  'scheduled',
  'active',
  'paused',
  'ended',
  'archived',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const campaignStatusSchema = z.enum(CAMPAIGN_STATUSES);

/**
 * What a campaign is doing *now*: `scheduled` and `active` are live states whose
 * effect still depends on the clock, and `expired` means the window has closed even
 * though nobody ended it.
 */
export const CAMPAIGN_STATES = [
  'draft',
  'scheduled',
  'active',
  'paused',
  'expired',
  'ended',
  'archived',
] as const;
export type CampaignState = (typeof CAMPAIGN_STATES)[number];
export const campaignStateSchema = z.enum(CAMPAIGN_STATES);

/** Whether a coupon code may be used on a cart that holds this campaign's products. */
export const CAMPAIGN_COUPON_POLICIES = ['stackable', 'blocked'] as const;
export type CampaignCouponPolicy = (typeof CAMPAIGN_COUPON_POLICIES)[number];
export const campaignCouponPolicySchema = z.enum(CAMPAIGN_COUPON_POLICIES);

/** A campaign target as the admin screens name it. */
export const campaignTargetSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
});
export type CampaignTarget = z.infer<typeof campaignTargetSchema>;

/** One campaign in the admin list. */
export const adminCampaignSchema = z.object({
  id: z.uuid(),
  /** Internal name, never shown to customers. */
  name: z.string(),
  /** The words a shopper reads. */
  customerTitle: z.string(),
  internalNotes: z.string().nullable(),
  scope: campaignScopeSchema,
  discountKind: campaignDiscountKindSchema,
  /** Percentage points when `discountKind` is percent, poisha when fixed. */
  discountValue: z.number().int().min(1),
  /** Cap on a percentage discount, in poisha; null when there is none. */
  maxDiscountMinor: moneyMinorSchema.nullable(),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  status: campaignStatusSchema,
  state: campaignStateSchema,
  /** Breaks ties inside one scope level; higher wins. */
  priority: z.number().int(),
  /** Whether the storefront shows the campaign's banner and price label. */
  isVisible: z.boolean(),
  bannerImageKey: z.string().nullable(),
  banner: mediaPictureSchema.nullable().default(null),
  couponPolicy: campaignCouponPolicySchema,
  /** Optimistic concurrency token: send back the version you read. */
  version: z.number().int().min(1),
  /** Published products the campaign currently reaches. */
  productCount: z.number().int().min(0),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
});
export type AdminCampaign = z.infer<typeof adminCampaignSchema>;

/** One campaign with its targets resolved to names. */
export const adminCampaignDetailSchema = adminCampaignSchema.extend({
  categories: z.array(campaignTargetSchema),
  brands: z.array(campaignTargetSchema),
  products: z.array(campaignTargetSchema),
});
export type AdminCampaignDetail = z.infer<typeof adminCampaignDetailSchema>;

/** GET /admin/discounts/campaigns */
export const adminCampaignListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  state: z.enum(['all', ...CAMPAIGN_STATES]).default('all'),
  scope: z.enum(['all', ...CAMPAIGN_SCOPES]).default('all'),
  ...adminPageQueryShape,
});
export type AdminCampaignListQuery = z.input<typeof adminCampaignListQuerySchema>;

export const adminCampaignListResponseSchema = z.object({
  campaigns: z.array(adminCampaignSchema),
  ...pageInfoShape,
});
export type AdminCampaignListResponse = z.infer<typeof adminCampaignListResponseSchema>;

/** GET /admin/discounts/campaigns/:campaignId */
export const adminCampaignResponseSchema = z.object({ campaign: adminCampaignDetailSchema });
export type AdminCampaignResponse = z.infer<typeof adminCampaignResponseSchema>;

/**
 * POST /admin/discounts/campaigns and PUT /admin/discounts/campaigns/:campaignId.
 *
 * The rules mirror the database's own checks. `categoryIds`, `brandIds` and
 * `productIds` are all accepted so a form can send what it has; only the set the
 * scope uses is stored, and the others must be empty.
 */
export const campaignSaveRequestSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    /**
     * What the shopper reads. Optional: a campaign can be presented by its offer, its picture
     * and its card alone, so an empty title is stored as '' rather than refused.
     */
    customerTitle: z.string().trim().max(120),
    internalNotes: optionalTextSchema(500),
    scope: campaignScopeSchema,
    discountKind: campaignDiscountKindSchema,
    discountValue: z.number().int().min(1).max(1_000_000_000),
    maxDiscountMinor: moneyMinorSchema.nullable().default(null),
    startsAt: z.iso.datetime().nullable().default(null),
    endsAt: z.iso.datetime().nullable().default(null),
    priority: z.number().int().min(-100).max(100).default(0),
    isVisible: z.boolean().default(true),
    bannerImageKey: optionalTextSchema(400),
    couponPolicy: campaignCouponPolicySchema.default('stackable'),
    categoryIds: z.array(z.uuid()).max(50).default([]),
    brandIds: z.array(z.uuid()).max(50).default([]),
    productIds: z.array(z.uuid()).max(200).default([]),
    /** Null when creating; the version read from the campaign when editing. */
    expectedVersion: z.number().int().min(1).nullable().default(null),
  })
  .refine((campaign) => campaign.discountKind !== 'percent' || campaign.discountValue <= 100, {
    error: 'A percentage cannot exceed 100',
    path: ['discountValue'],
  })
  .refine((campaign) => campaign.discountKind !== 'fixed' || campaign.maxDiscountMinor === null, {
    error: 'A fixed discount needs no cap',
    path: ['maxDiscountMinor'],
  })
  .refine(
    (campaign) => !campaign.startsAt || !campaign.endsAt || campaign.endsAt > campaign.startsAt,
    { error: 'The end must be after the start', path: ['endsAt'] },
  )
  .refine((campaign) => campaign.scope !== 'storewide' || campaign.productIds.length === 0, {
    error: 'A storewide campaign takes no products',
    path: ['productIds'],
  })
  .refine(
    (campaign) =>
      campaign.scope !== 'categories' ||
      (campaign.categoryIds.length >= 1 &&
        campaign.brandIds.length === 0 &&
        campaign.productIds.length === 0),
    { error: 'Choose the categories this campaign covers', path: ['categoryIds'] },
  )
  .refine(
    (campaign) =>
      campaign.scope !== 'brands' ||
      (campaign.brandIds.length >= 1 &&
        campaign.categoryIds.length === 0 &&
        campaign.productIds.length === 0),
    { error: 'Choose the brands this campaign covers', path: ['brandIds'] },
  )
  .refine(
    (campaign) =>
      campaign.scope !== 'products' ||
      (campaign.productIds.length >= 1 &&
        campaign.categoryIds.length === 0 &&
        campaign.brandIds.length === 0),
    { error: 'Choose the products this campaign covers', path: ['productIds'] },
  );
export type CampaignSaveRequest = z.input<typeof campaignSaveRequestSchema>;

/** PATCH /admin/discounts/campaigns/:campaignId/status */
export const campaignStatusRequestSchema = z.strictObject({
  status: campaignStatusSchema,
  expectedVersion: z.number().int().min(1).nullable().default(null),
});
export type CampaignStatusRequest = z.input<typeof campaignStatusRequestSchema>;

/** One row of the pricing preview: what a campaign would do to a real product. */
export const campaignPreviewRowSchema = z.object({
  productId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  sku: z.string(),
  categoryName: z.string(),
  status: z.string(),
  /** The list price the campaign discounts. */
  regularPriceMinor: moneyMinorSchema,
  /** The product's own sale price today. */
  productPriceMinor: moneyMinorSchema,
  /** What the shopper would pay with this campaign. */
  campaignPriceMinor: moneyMinorSchema,
  campaignDiscountMinor: moneyMinorSchema,
  /** True when the campaign price replaces a product-level discount. */
  overridesProductDiscount: z.boolean(),
  /** The campaign that governs the product now, when this one would not win. */
  governedBy: z.string().nullable(),
  /** Whether this campaign would actually set the price. */
  wins: z.boolean(),
});
export type CampaignPreviewRow = z.infer<typeof campaignPreviewRowSchema>;

export const campaignPreviewResponseSchema = z.object({
  products: z.array(campaignPreviewRowSchema),
  ...pageInfoShape,
  /** Targeted products that are published, which is how many shoppers see. */
  activeTotal: z.number().int().min(0),
});
export type CampaignPreviewResponse = z.infer<typeof campaignPreviewResponseSchema>;

/** POST /admin/discounts/preview — the preview for a configuration that is not saved yet. */
export const campaignPreviewRequestSchema = z.strictObject({
  scope: campaignScopeSchema,
  discountKind: campaignDiscountKindSchema,
  discountValue: z.number().int().min(1).max(1_000_000_000),
  maxDiscountMinor: moneyMinorSchema.nullable().default(null),
  priority: z.number().int().min(-100).max(100).default(0),
  categoryIds: z.array(z.uuid()).max(50).default([]),
  brandIds: z.array(z.uuid()).max(50).default([]),
  productIds: z.array(z.uuid()).max(200).default([]),
  page: z.number().int().min(1).max(1000).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});
export type CampaignPreviewRequest = z.input<typeof campaignPreviewRequestSchema>;

/** GET /admin/discounts/campaigns/:campaignId/products */
export const adminCampaignProductsQuerySchema = z.object({ ...adminPageQueryShape });
export type AdminCampaignProductsQuery = z.input<typeof adminCampaignProductsQuerySchema>;

/** GET /admin/discounts/campaigns/:campaignId/history */
export const campaignHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type CampaignHistoryQuery = z.input<typeof campaignHistoryQuerySchema>;

/** A live campaign that shares products with the one being prepared. */
export const campaignConflictSchema = z.object({
  campaignId: z.uuid(),
  name: z.string(),
  customerTitle: z.string(),
  scope: campaignScopeSchema,
  discountKind: campaignDiscountKindSchema,
  discountValue: z.number().int().min(1),
  priority: z.number().int(),
  status: campaignStatusSchema,
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  /** Published products both campaigns reach. */
  sharedProducts: z.number().int().min(0),
});
export type CampaignConflict = z.infer<typeof campaignConflictSchema>;

export const campaignConflictListResponseSchema = z.object({
  conflicts: z.array(campaignConflictSchema),
});
export type CampaignConflictListResponse = z.infer<typeof campaignConflictListResponseSchema>;

/** One audit entry of a campaign's own history. */
export const campaignHistoryEntrySchema = z.object({
  id: z.number().int().positive(),
  action: z.string(),
  actorId: z.uuid().nullable(),
  actorName: z.string().nullable(),
  actorEmail: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});
export type CampaignHistoryEntry = z.infer<typeof campaignHistoryEntrySchema>;

export const campaignHistoryResponseSchema = z.object({
  entries: z.array(campaignHistoryEntrySchema),
  total: z.number().int().min(0),
});
export type CampaignHistoryResponse = z.infer<typeof campaignHistoryResponseSchema>;

/** The live campaign reaching one category, as the category screen shows it. */
export const categoryCampaignSchema = z.object({
  categoryId: z.uuid(),
  campaignId: z.uuid(),
  customerTitle: z.string(),
  scope: campaignScopeSchema,
  discountKind: campaignDiscountKindSchema,
  discountValue: z.number().int().min(1),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  status: campaignStatusSchema,
  /** Published products of this category and its subcategories that the campaign reaches. */
  productCount: z.number().int().min(0),
});
export type CategoryCampaign = z.infer<typeof categoryCampaignSchema>;

export const categoryCampaignListResponseSchema = z.object({
  campaigns: z.array(categoryCampaignSchema),
});
export type CategoryCampaignListResponse = z.infer<typeof categoryCampaignListResponseSchema>;

/**
 * A campaign as customers see it: enough to draw a banner, nothing internal. `discount
 * summary` is left to the client, which knows how to say "20% off" or "৳300 off".
 */
export const campaignSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  scope: campaignScopeSchema,
  discountKind: campaignDiscountKindSchema,
  discountValue: z.number().int().min(1),
  maxDiscountMinor: moneyMinorSchema.nullable(),
  endsAt: z.iso.datetime().nullable(),
  banner: mediaPictureSchema.nullable(),
  /** Published products it reaches (in the asked-for category, when one was given). */
  productCount: z.number().int().min(0),
});
export type CampaignSummary = z.infer<typeof campaignSummarySchema>;

/** GET /catalog/campaigns */
export const campaignListResponseSchema = z.object({
  campaigns: z.array(campaignSummarySchema),
});
export type CampaignListResponse = z.infer<typeof campaignListResponseSchema>;

/**
 * The campaign that priced a product, shown beside the price. Present only while the
 * campaign is live, so a label can never outlive the price it explains.
 */
export const productCampaignSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  endsAt: z.iso.datetime().nullable(),
  discountKind: campaignDiscountKindSchema,
  discountValue: z.number().int().min(1),
});
export type ProductCampaign = z.infer<typeof productCampaignSchema>;

/**
 * The campaign on one priced line of a cart (quote_cart / quote_cart_with_coupon).
 *
 * Its own shape, not an extension of productCampaignSchema: the database builds it as
 * `{ id, title, endsAt, couponPolicy }` with `endsAt` serialised by PostgreSQL
 * ("2026-11-20T17:22:00+00:00"), and the line already carries the discount itself in
 * `campaignDiscountMinor`. Requiring the product label's `discountKind`/`discountValue`
 * here made every cart holding a campaign product fail validation (a 503 on the cart and
 * checkout quotes) the moment those fields were added to the product label.
 */
export const appliedCampaignSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
  couponPolicy: campaignCouponPolicySchema,
});
export type AppliedCampaign = z.infer<typeof appliedCampaignSchema>;
