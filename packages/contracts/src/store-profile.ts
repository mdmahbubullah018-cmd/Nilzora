import { z } from 'zod';
import { mediaKeySchema, publicMediaUrlSchema } from './seo';

/*
 * The store profile
 * -----------------
 * What a customer may know about the store. Private operational settings (return window,
 * cart inactivity, insight thresholds) live in the settings table and are never part of
 * this shape, so a public read cannot leak them.
 *
 * Every field starts empty on purpose: the store's real contact details are the owner's
 * to enter, and nothing here invents an address, a phone number or a social account.
 */

const nullableText = (max: number) => z.string().trim().max(max).nullable();

/** A Bangladeshi mobile number in E.164 form, e.g. +8801712345678 (for WhatsApp). */
export const whatsappNumberSchema = z
  .string()
  .trim()
  .regex(/^\+8801[3-9][0-9]{8}$/, {
    error: 'Use a Bangladeshi mobile number such as +8801712345678',
  });

/**
 * An https link on exactly one host, without credentials (app store listings).
 *
 * The host is matched literally instead of parsed with `URL`. This package is compiled
 * without DOM or Node globals on purpose — it is shared by every app and must not borrow a
 * platform type — and a pattern says the same thing: `https`, the exact host, an optional
 * path of URL-safe characters, and no `@` or second authority anywhere.
 */
function httpsLinkOn(host: string, message: string) {
  const escapedHost = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return z
    .string()
    .trim()
    .max(300)
    .regex(new RegExp(`^https://${escapedHost}/[A-Za-z0-9/?=&._%~-]*$`, 'i'), { error: message });
}

export const playStoreUrlSchema = httpsLinkOn(
  'play.google.com',
  'Use the Google Play address (https://play.google.com/...)',
);
export const appStoreUrlSchema = httpsLinkOn(
  'apps.apple.com',
  'Use the App Store address (https://apps.apple.com/...)',
);
export const tiktokUrlSchema = z
  .string()
  .trim()
  .regex(/^https:\/\/(www\.)?tiktok\.com\/@[A-Za-z0-9._]{1,40}$/, {
    error: 'Use a TikTok profile address (https://www.tiktok.com/@name)',
  });
export const xUrlSchema = z
  .string()
  .trim()
  .regex(/^https:\/\/(www\.)?(x|twitter)\.com\/[A-Za-z0-9_]{1,30}$/, {
    error: 'Use an X profile address (https://x.com/name)',
  });
const nullableEmail = z.email().max(120).nullable();

export const publicStoreProfileSchema = z.object({
  displayName: z.string(),
  tagline: nullableText(160).default(null),
  description: nullableText(1000).default(null),
  logoKey: mediaKeySchema.nullable().default(null),
  /**
   * The logo key resolved into a public image URL by the API. Null when no logo is set or
   * media is not configured: the storefront then keeps its own bundled brand mark.
   */
  logoUrl: publicMediaUrlSchema,
  contactEmail: nullableEmail.default(null),
  contactPhone: nullableText(32).default(null),
  addressLine: nullableText(200).default(null),
  addressArea: nullableText(120).default(null),
  addressDistrict: nullableText(120).default(null),
  businessHours: nullableText(200).default(null),
  supportEmail: nullableEmail.default(null),
  supportPhone: nullableText(32).default(null),
  social: z
    .object({
      facebook: z.url().nullable().default(null),
      instagram: z.url().nullable().default(null),
      youtube: z.url().nullable().default(null),
      /** Absent from older payloads. */
      tiktok: z.url().nullable().optional(),
      x: z.url().nullable().optional(),
    })
    .default({ facebook: null, instagram: null, youtube: null }),
  defaultSeoTitle: nullableText(70).default(null),
  defaultSeoDescription: nullableText(200).default(null),
  ogImageKey: mediaKeySchema.nullable().default(null),
  /** The default share image's key, resolved into a public URL by the API. */
  ogImageUrl: publicMediaUrlSchema,
  /** WhatsApp number (E.164); absent from older payloads. */
  whatsappNumber: z.string().nullable().optional(),
  /** The Android app's Google Play listing; absent from older payloads. */
  playStoreUrl: z.string().nullable().optional(),
  /** The iPhone app's App Store listing; absent from older payloads. */
  appStoreUrl: z.string().nullable().optional(),
  /**
   * Whether checkout currently offers cash on delivery. The order function refuses a cash
   * order while it is off, so this flag is what the payment step draws — never a guess.
   */
  codAvailable: z.boolean().default(true),
  updatedAt: z.iso.datetime(),
});

export const storeProfileResponseSchema = z.object({ profile: publicStoreProfileSchema });

/** PUT /admin/store-profile — every field optional, so a partial save is a real save. */
export const saveStoreProfileRequestSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(80),
  tagline: nullableText(160).default(null),
  description: nullableText(1000).default(null),
  logoKey: mediaKeySchema.nullable().default(null),
  contactEmail: nullableEmail.default(null),
  contactPhone: nullableText(32).default(null),
  addressLine: nullableText(200).default(null),
  addressArea: nullableText(120).default(null),
  addressDistrict: nullableText(120).default(null),
  businessHours: nullableText(200).default(null),
  supportEmail: nullableEmail.default(null),
  supportPhone: nullableText(32).default(null),
  socialFacebook: z.url().max(200).nullable().default(null),
  socialInstagram: z.url().max(200).nullable().default(null),
  socialYoutube: z.url().max(200).nullable().default(null),
  defaultSeoTitle: nullableText(70).default(null),
  defaultSeoDescription: nullableText(200).default(null),
  ogImageKey: mediaKeySchema.nullable().default(null),
  /*
   * Newer fields: left out, each keeps its saved value (older clients never clear them);
   * null clears it.
   */
  whatsappNumber: whatsappNumberSchema.nullable().optional(),
  playStoreUrl: playStoreUrlSchema.nullable().optional(),
  appStoreUrl: appStoreUrlSchema.nullable().optional(),
  socialTiktok: tiktokUrlSchema.nullable().optional(),
  socialX: xUrlSchema.nullable().optional(),
});

export type PublicStoreProfile = z.infer<typeof publicStoreProfileSchema>;
export type StoreProfileResponse = z.infer<typeof storeProfileResponseSchema>;
export type SaveStoreProfileRequest = z.infer<typeof saveStoreProfileRequestSchema>;
