import { z } from 'zod';
import { bannerHrefSchema } from './merchandising';
import { mediaKeySchema, publicMediaUrlSchema } from './seo';

/*
 * Onboarding and promotional campaigns
 * ------------------------------------
 * An admin-managed sequence of slides the app shows once (or again, by policy) at launch.
 * The database decides which campaign a caller may see — enabled, inside its window,
 * matching their audience, and not already finished under its own frequency rule — so the
 * public shape carries no management field at all: no internal names, no activation flag,
 * no audience, no history.
 *
 * The media address is resolved by the API (see the store's presentOnboarding), exactly as
 * for the store logo and share images, so a client never builds a URL and no bucket address
 * is ever placed in a contract.
 */

export const ONBOARDING_KINDS = ['welcome', 'promotion'] as const;
export const onboardingKindSchema = z.enum(ONBOARDING_KINDS);
export type OnboardingKind = z.infer<typeof onboardingKindSchema>;

export const ONBOARDING_AUDIENCES = ['all', 'authenticated', 'guest'] as const;
export const onboardingAudienceSchema = z.enum(ONBOARDING_AUDIENCES);
export type OnboardingAudience = z.infer<typeof onboardingAudienceSchema>;

export const ONBOARDING_FREQUENCIES = [
  'first_launch',
  'every_launch',
  'once_per_campaign',
  'interval',
] as const;
export const onboardingFrequencySchema = z.enum(ONBOARDING_FREQUENCIES);
export type OnboardingFrequency = z.infer<typeof onboardingFrequencySchema>;

/** The only slide durations the app supports; the timer and the Skip rule follow this. */
export const ONBOARDING_SLIDE_SECONDS = [3, 5, 10] as const;
export const onboardingSlideSecondsSchema = z.union([z.literal(3), z.literal(5), z.literal(10)]);
export type OnboardingSlideSeconds = z.infer<typeof onboardingSlideSecondsSchema>;

/** Skip appears once this much of the sequence has been on screen. */
export const ONBOARDING_SKIP_AFTER_SECONDS = 3;

/**
 * The icons a slide may name. They are the app's own semantic names (its icon registry),
 * so an admin chooses from what the app can actually draw instead of typing free text.
 */
export const ONBOARDING_ICONS = [
  'shop',
  'search',
  'wishlist',
  'cart',
  'cash',
  'delivery',
  'success',
  'verified',
  'location',
  'orders',
  'returns',
  'help',
] as const;
export const onboardingIconSchema = z.enum(ONBOARDING_ICONS);
export type OnboardingIcon = z.infer<typeof onboardingIconSchema>;

/** Length limits the database enforces as well, so the form can guide before saving. */
export const ONBOARDING_LIMITS = {
  internalName: 80,
  heading: 80,
  description: 240,
  ctaLabel: 40,
  altText: 160,
  maxSlides: 12,
} as const;

/** One slide as a customer receives it: finished media URL, no management fields. */
export const publicOnboardingSlideSchema = z.object({
  id: z.uuid(),
  heading: z.string(),
  description: z.string(),
  /** Resolved from the slide's media key by the API; null when none is set. */
  imageUrl: publicMediaUrlSchema,
  icon: onboardingIconSchema.nullable().default(null),
  ctaLabel: z.string().nullable().default(null),
  /** A path inside the store, never an external address. */
  ctaPath: bannerHrefSchema.nullable().default(null),
  altText: z.string().nullable().default(null),
  position: z.number().int().min(1),
});

/** The campaign as a customer receives it. */
export const publicOnboardingSchema = z.object({
  id: z.uuid(),
  kind: onboardingKindSchema,
  frequency: onboardingFrequencySchema,
  repeatDays: z.number().int().min(1).max(365).nullable().default(null),
  slideSeconds: onboardingSlideSecondsSchema,
  /** When the campaign stops being eligible, so the app can expire a cached copy. */
  endsAt: z.iso.datetime().nullable().default(null),
  slides: z.array(publicOnboardingSlideSchema).max(ONBOARDING_LIMITS.maxSlides),
});

export const onboardingResponseSchema = z.object({
  campaign: publicOnboardingSchema.nullable(),
});

export type PublicOnboardingSlide = z.infer<typeof publicOnboardingSlideSchema>;
export type PublicOnboarding = z.infer<typeof publicOnboardingSchema>;
export type OnboardingResponse = z.infer<typeof onboardingResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Admin shapes                                                                */
/* -------------------------------------------------------------------------- */

/** One row of the management list. */
export const onboardingCampaignSummarySchema = z.object({
  id: z.uuid(),
  internalName: z.string(),
  kind: onboardingKindSchema,
  audience: onboardingAudienceSchema,
  frequency: onboardingFrequencySchema,
  repeatDays: z.number().int().min(1).max(365).nullable().default(null),
  slideSeconds: onboardingSlideSecondsSchema,
  startsAt: z.iso.datetime().nullable().default(null),
  endsAt: z.iso.datetime().nullable().default(null),
  isActive: z.boolean(),
  slideCount: z.number().int().min(0),
  activeSlideCount: z.number().int().min(0),
  updatedAt: z.iso.datetime(),
});

export const onboardingCampaignListResponseSchema = z.object({
  campaigns: z.array(onboardingCampaignSummarySchema),
});

/** One slide as the editor reads and writes it. */
export const adminOnboardingSlideSchema = z.object({
  id: z.uuid(),
  campaignId: z.uuid(),
  internalName: z.string(),
  heading: z.string(),
  description: z.string(),
  imageKey: mediaKeySchema.nullable().default(null),
  icon: onboardingIconSchema.nullable().default(null),
  ctaLabel: z.string().nullable().default(null),
  ctaPath: z.string().nullable().default(null),
  altText: z.string().nullable().default(null),
  position: z.number().int().min(1),
  isActive: z.boolean(),
});

/** One campaign with every slide, for the editor. */
export const onboardingCampaignSchema = z.object({
  id: z.uuid(),
  internalName: z.string(),
  kind: onboardingKindSchema,
  audience: onboardingAudienceSchema,
  frequency: onboardingFrequencySchema,
  repeatDays: z.number().int().min(1).max(365).nullable().default(null),
  slideSeconds: onboardingSlideSecondsSchema,
  startsAt: z.iso.datetime().nullable().default(null),
  endsAt: z.iso.datetime().nullable().default(null),
  isActive: z.boolean(),
  updatedAt: z.iso.datetime(),
  slides: z.array(adminOnboardingSlideSchema).max(ONBOARDING_LIMITS.maxSlides),
});

export const onboardingCampaignResponseSchema = z.object({ campaign: onboardingCampaignSchema });
export const onboardingSlideResponseSchema = z.object({ slide: adminOnboardingSlideSchema });
export const onboardingPreviewResponseSchema = z.object({ campaign: publicOnboardingSchema });

export type OnboardingCampaignSummary = z.infer<typeof onboardingCampaignSummarySchema>;
export type OnboardingCampaign = z.infer<typeof onboardingCampaignSchema>;
export type AdminOnboardingSlide = z.infer<typeof adminOnboardingSlideSchema>;
export type OnboardingCampaignListResponse = z.infer<typeof onboardingCampaignListResponseSchema>;
export type OnboardingCampaignResponse = z.infer<typeof onboardingCampaignResponseSchema>;
export type OnboardingSlideResponse = z.infer<typeof onboardingSlideResponseSchema>;
export type OnboardingPreviewResponse = z.infer<typeof onboardingPreviewResponseSchema>;

/** Empty means "not set"; the API stores that as null, which the database requires. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null);

/**
 * Create or update a campaign. Every rule the database also enforces is checked here first,
 * so the form reports it against the field instead of surfacing a refusal:
 *   - a repeat interval needs its days, and no other frequency may carry them;
 *   - a promotion needs both ends of its window, and the end is after the start.
 */
export const saveOnboardingCampaignSchema = z
  .strictObject({
    internalName: z.string().trim().min(1).max(ONBOARDING_LIMITS.internalName),
    kind: onboardingKindSchema,
    audience: onboardingAudienceSchema,
    frequency: onboardingFrequencySchema,
    repeatDays: z.number().int().min(1).max(365).nullable().default(null),
    slideSeconds: onboardingSlideSecondsSchema,
    startsAt: z.iso.datetime().nullable().default(null),
    endsAt: z.iso.datetime().nullable().default(null),
    isActive: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.frequency === 'interval' && value.repeatDays === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['repeatDays'],
        message: 'Choose how many days to wait before showing this again',
      });
    }
    if (value.frequency !== 'interval' && value.repeatDays !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['repeatDays'],
        message: 'Only a repeat interval uses a number of days',
      });
    }
    if (value.kind === 'promotion' && (value.startsAt === null || value.endsAt === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['startsAt'],
        message: 'A promotion needs a start and an end',
      });
    }
    if (value.startsAt !== null && value.endsAt !== null && value.endsAt <= value.startsAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'The end must be after the start',
      });
    }
  });

export const saveOnboardingSlideSchema = z
  .strictObject({
    internalName: z.string().trim().min(1).max(ONBOARDING_LIMITS.internalName),
    // Both are optional (empty means none), but a slide needs a heading, a description or a picture.
    heading: z.string().trim().max(ONBOARDING_LIMITS.heading).default(''),
    description: z.string().trim().max(ONBOARDING_LIMITS.description).default(''),
    imageKey: mediaKeySchema.nullable().default(null),
    icon: onboardingIconSchema.nullable().default(null),
    ctaLabel: optionalText(ONBOARDING_LIMITS.ctaLabel),
    ctaPath: bannerHrefSchema.nullable().default(null),
    altText: optionalText(ONBOARDING_LIMITS.altText),
    position: z.number().int().min(1).max(100).optional(),
    isActive: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.heading === '' && value.description === '' && value.imageKey === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['heading'],
        message: 'Add a heading, a description or a picture',
      });
    }
    if ((value.ctaLabel === null) !== (value.ctaPath === null)) {
      ctx.addIssue({
        code: 'custom',
        path: [value.ctaLabel === null ? 'ctaLabel' : 'ctaPath'],
        message: 'An action needs both a label and a place to go',
      });
    }
    if (value.imageKey !== null && value.altText === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['altText'],
        message: 'Describe the image for customers who cannot see it',
      });
    }
  });

export const reorderOnboardingSlidesSchema = z.strictObject({
  slideIds: z.array(z.uuid()).min(1).max(ONBOARDING_LIMITS.maxSlides),
});

export const setOnboardingActiveSchema = z.strictObject({ active: z.boolean() });

export type SaveOnboardingCampaignRequest = z.input<typeof saveOnboardingCampaignSchema>;
export type SaveOnboardingSlideRequest = z.input<typeof saveOnboardingSlideSchema>;
