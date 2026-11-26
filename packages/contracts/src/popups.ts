import { z } from 'zod';
import { bannerHrefSchema } from './merchandising';
import { publicMediaUrlSchema } from './seo';

/*
 * Promotional popups
 * ------------------
 * One admin-managed promotional popup, shown over the storefront and inside the native app a
 * few seconds after a customer opens it. It is deliberately one surface, not a marketing suite:
 * there are no codes, no coupons and no vouchers anywhere in this file.
 *
 * Two display modes, one popup frame:
 *
 *   template  a campaign picture with optional title, subtitle, description and a button
 *             beside it — the picture alone is a complete popup.
 *   artwork   one complete piece of artwork uploaded by an admin (a still or an animated GIF),
 *             shown as supplied. Nothing is drawn over it; a destination link makes the whole
 *             picture clickable.
 *
 * The media address is resolved by the API (never stored, never built by a client) exactly as
 * for banners and the onboarding slides, so no bucket address reaches a client and a stored key
 * can never be turned into a URL for somewhere else.
 *
 * The frequency rule is enforced by the client, which is the only party that knows what one
 * device has already shown: the same arrangement the onboarding campaigns use. What the API
 * decides is eligibility — active, published, inside its window — and that there is only ever
 * one of them.
 */

export const POPUP_DISPLAY_MODES = ['template', 'artwork'] as const;
export const popupDisplayModeSchema = z.enum(POPUP_DISPLAY_MODES);
export type PopupDisplayMode = z.infer<typeof popupDisplayModeSchema>;

/**
 * How long after the page or app opens the popup may appear. Two options only: a popup that
 * interrupts immediately is the behaviour this feature exists to avoid.
 */
export const POPUP_DELAY_SECONDS = [0, 3, 5, 10, 15, 30, 60] as const;
export const POPUP_MAX_DELAY_SECONDS = 120;
export const popupDelaySchema = z.number().int().min(0).max(POPUP_MAX_DELAY_SECONDS);
export type PopupDelay = z.infer<typeof popupDelaySchema>;

export const POPUP_FREQUENCIES = [
  'once_ever',
  'once_per_session',
  'once_per_day',
  'every_visit',
] as const;

/** Which surface shows a popup, who sees it, and how popups rank when several are live. */
export const POPUP_PLATFORMS = ['website', 'app', 'both'] as const;
export const popupPlatformSchema = z.enum(POPUP_PLATFORMS);
export type PopupPlatform = z.infer<typeof popupPlatformSchema>;
export const POPUP_PLATFORM_LABELS: Readonly<Record<PopupPlatform, string>> = {
  website: 'Website only',
  app: 'App only',
  both: 'Website and app',
};
export const POPUP_AUDIENCES = ['all', 'logged_in', 'guests'] as const;
export const popupAudienceSchema = z.enum(POPUP_AUDIENCES);
export type PopupAudience = z.infer<typeof popupAudienceSchema>;
export const POPUP_AUDIENCE_LABELS: Readonly<Record<PopupAudience, string>> = {
  all: 'Everyone',
  logged_in: 'Signed-in customers',
  guests: 'Guests (not signed in)',
};
export const popupFrequencySchema = z.enum(POPUP_FREQUENCIES);
export type PopupFrequency = z.infer<typeof popupFrequencySchema>;

/** What each frequency means, in the words the Admin form shows beside the choice. */
export const POPUP_FREQUENCY_LABELS: Readonly<Record<PopupFrequency, string>> = {
  once_ever: 'Once ever',
  once_per_session: 'Once per session',
  once_per_day: 'Once per day',
  every_visit: 'Every visit',
};

export const POPUP_FREQUENCY_HINTS: Readonly<Record<PopupFrequency, string>> = {
  once_ever: 'Shown one time on a device, then never again.',
  once_per_session: 'Shown once, then not again until the browser or app is opened afresh.',
  once_per_day: 'Shown at most once on a device in 24 hours.',
  every_visit: 'Shown on every visit that passes the delay. Use it sparingly.',
};

/**
 * The uploaded types a popup accepts. GIF is here for one reason only: a complete piece of
 * popup artwork is often animated, and re-encoding it as WebP would silently freeze it.
 */
export const POPUP_ARTWORK_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;
export type PopupArtworkContentType = (typeof POPUP_ARTWORK_CONTENT_TYPES)[number];

/** Byte ceiling for one piece of popup artwork: the shared 5 MB picture limit. */
export const POPUP_ARTWORK_MAX_BYTES = 5 * 1024 * 1024;

/** Smallest and largest source dimensions accepted, in pixels. */
export const POPUP_ARTWORK_MIN_SIZE = 320;
export const POPUP_ARTWORK_MAX_SIZE = 4000;

/** Length limits the database enforces as well, so a form can guide before saving. */
export const POPUP_LIMITS = {
  internalName: 80,
  title: 80,
  subtitle: 200,
  description: 400,
  buttonLabel: 30,
  altText: 160,
} as const;

/**
 * What the Admin upload screen recommends beside the field. Guidance, never a rule: the frame
 * adapts to whatever proportion is uploaded without stretching it.
 */
export const POPUP_RECOMMENDED_SIZES = [
  { device: 'Desktop', width: 1200, height: 860 },
  { device: 'Tablet', width: 900, height: 900 },
  { device: 'Mobile', width: 750, height: 1000 },
] as const;

/**
 * A stored key of popup artwork that went through the picture pipeline: two WebP variants are
 * written beside it (`<key>/full.webp`, `<key>/thumb.webp`).
 */
export const POPUP_STILL_KEY = /^popups\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

/**
 * A stored key of artwork kept exactly as it was uploaded, so an animated GIF keeps animating.
 * The extension is the sniffed one, which is why it is part of the key and not decoration.
 */
export const POPUP_ANIMATED_KEY = /^popups\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(gif|png|webp|jpg)$/;

export const popupStillKeySchema = z.string().regex(POPUP_STILL_KEY);
export const popupAnimatedKeySchema = z.string().regex(POPUP_ANIMATED_KEY);

/** How the stored artwork was kept, which is what decides how its address is built. */
export const POPUP_MEDIA_KINDS = ['still', 'animated'] as const;
export const popupMediaKindSchema = z.enum(POPUP_MEDIA_KINDS);
export type PopupMediaKind = z.infer<typeof popupMediaKindSchema>;

/**
 * The popup as a customer receives it: a finished media address and the copy to draw, with no
 * management field at all — no internal name, no activation flag, no schedule, no audit data.
 */
export const publicPopupSchema = z.object({
  id: z.uuid(),
  displayMode: popupDisplayModeSchema,
  /**
   * Resolved by the API from the stored key. Always present: a popup is its artwork, and a
   * popup whose address cannot be resolved is answered as "nothing to show" rather than as a
   * popup with a missing picture.
   */
  imageUrl: z.url({ protocol: /^https?$/, error: 'Use an absolute http(s) URL' }),
  /** The stored pixel size, so the frame reserves the right space before the file arrives. */
  imageWidth: z.number().int().min(1),
  imageHeight: z.number().int().min(1),
  /** True for an animated GIF, so a client can avoid a still-only optimisation. */
  isAnimated: z.boolean(),
  /** What the artwork shows, for screen readers. */
  imageAlt: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  subtitle: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  buttonLabel: z.string().nullable().default(null),
  /** A path inside the store, never an external address. */
  buttonHref: bannerHrefSchema.nullable().default(null),
  delaySeconds: popupDelaySchema,
  frequency: popupFrequencySchema,
  /** Who may see it; the client applies this to its own signed-in state. */
  audience: popupAudienceSchema.default('all'),
  priority: z.number().int().default(0),
  /** When the popup stops being eligible, so a cached copy can be dropped. */
  endsAt: z.iso.datetime().nullable().default(null),
});

/**
 * `popups` is every popup live on the asked platform, best first; `popup` is the first of them,
 * kept so an older client that reads one popup keeps working.
 */
export const popupResponseSchema = z.object({
  popup: publicPopupSchema.nullable(),
  popups: z.array(publicPopupSchema).default([]),
});

export type PublicPopup = z.infer<typeof publicPopupSchema>;
export type PopupResponse = z.infer<typeof popupResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Admin shapes                                                                */
/* -------------------------------------------------------------------------- */

/** One row of the management list. */
export const adminPopupSummarySchema = z.object({
  id: z.uuid(),
  internalName: z.string(),
  displayMode: popupDisplayModeSchema,
  title: z.string().nullable().default(null),
  /** Resolved by the API; null when the upload is gone or media is not configured. */
  imageUrl: publicMediaUrlSchema,
  thumbUrl: publicMediaUrlSchema,
  isActive: z.boolean(),
  delaySeconds: popupDelaySchema,
  frequency: popupFrequencySchema,
  platform: popupPlatformSchema.default('both'),
  audience: popupAudienceSchema.default('all'),
  priority: z.number().int().default(0),
  startsAt: z.iso.datetime().nullable().default(null),
  endsAt: z.iso.datetime().nullable().default(null),
  updatedAt: z.iso.datetime(),
});

export const adminPopupListResponseSchema = z.object({ popups: z.array(adminPopupSummarySchema) });

/** The popup as the editor reads it: every field, plus the stored picture's facts. */
export const adminPopupSchema = adminPopupSummarySchema.extend({
  subtitle: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  buttonLabel: z.string().nullable().default(null),
  buttonHref: z.string().nullable().default(null),
  imageAlt: z.string().nullable().default(null),
  // A draft is created before its artwork is uploaded, so all of these are null until then.
  imageWidth: z.number().int().min(1).nullable().default(null),
  imageHeight: z.number().int().min(1).nullable().default(null),
  imageBytes: z.number().int().min(0).nullable().default(null),
  imageKind: popupMediaKindSchema.nullable().default(null),
  /** The uploaded file's format, for the facts shown beside the preview. */
  imageFormat: z.string().nullable().default(null),
});

export const adminPopupResponseSchema = z.object({ popup: adminPopupSchema });

export type AdminPopupSummary = z.infer<typeof adminPopupSummarySchema>;
export type AdminPopup = z.infer<typeof adminPopupSchema>;
export type AdminPopupListResponse = z.infer<typeof adminPopupListResponseSchema>;
export type AdminPopupResponse = z.infer<typeof adminPopupResponseSchema>;

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
 * Create or update a popup. Every rule the database also enforces is checked here first, so the
 * form reports it against the field instead of surfacing a refusal:
 *   - a button needs both its label and its destination;
 *   - complete artwork carries no text of its own: only the picture and, optionally, a link;
 *   - the end of the schedule is after its start.
 */
export const savePopupSchema = z
  .strictObject({
    internalName: z.string().trim().min(1).max(POPUP_LIMITS.internalName),
    displayMode: popupDisplayModeSchema,
    title: optionalText(POPUP_LIMITS.title),
    subtitle: optionalText(POPUP_LIMITS.subtitle),
    description: optionalText(POPUP_LIMITS.description),
    buttonLabel: optionalText(POPUP_LIMITS.buttonLabel),
    buttonHref: bannerHrefSchema.nullable().default(null),
    imageAlt: optionalText(POPUP_LIMITS.altText),
    delaySeconds: popupDelaySchema.default(10),
    frequency: popupFrequencySchema.default('once_per_session'),
    platform: popupPlatformSchema.default('both'),
    audience: popupAudienceSchema.default('all'),
    priority: z.number().int().min(0).max(1000).default(0),
    isActive: z.boolean().default(false),
    startsAt: z.iso.datetime().nullable().default(null),
    endsAt: z.iso.datetime().nullable().default(null),
  })
  .superRefine((value, ctx) => {
    // A label with nowhere to go would be a dead control, in either mode.
    if (value.buttonLabel !== null && value.buttonHref === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['buttonHref'],
        message: 'A button needs a place to go',
      });
    }
    // A designed template draws a button, so it needs both halves. Complete artwork is the
    // link itself, so a destination without a label is exactly right there.
    if (
      value.displayMode === 'template' &&
      value.buttonLabel === null &&
      value.buttonHref !== null
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['buttonLabel'],
        message: 'Add the button label, or clear the link',
      });
    }
    if (
      value.displayMode === 'artwork' &&
      (value.title !== null ||
        value.subtitle !== null ||
        value.description !== null ||
        value.buttonLabel !== null)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['displayMode'],
        message:
          'Complete artwork carries its own words. Keep only the picture and, if you want one, the link.',
      });
    }
    if (
      value.startsAt !== null &&
      value.endsAt !== null &&
      new Date(value.endsAt) <= new Date(value.startsAt)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'The end must be after the start',
      });
    }
  });

export const setPopupActiveSchema = z.strictObject({ active: z.boolean() });

export type SavePopupRequest = z.input<typeof savePopupSchema>;
export type SetPopupActiveRequest = z.infer<typeof setPopupActiveSchema>;

/** File-format facts an Admin sees beside a preview, from the sniffed type. */
export const POPUP_FORMAT_LABELS: Readonly<Record<PopupArtworkContentType, string>> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'image/gif': 'GIF',
};
