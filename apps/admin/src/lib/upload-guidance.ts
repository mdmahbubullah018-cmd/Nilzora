import {
  AVATAR_MIN_SIZE,
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_MIN_SIZE,
} from '@nilzora/contracts';
import type { UploadKind } from './upload-routes';

/*
 * Upload guidance per upload slot
 * -------------------------------
 * What each upload area tells the admin, and the crop shapes it offers. The numbers come from
 * where the picture is shown, not from one rule for every picture:
 *
 *   - product pictures: the storefront and app galleries are square frames;
 *   - category pictures: the category cards are square (`category-cover.tsx`);
 *   - brand logos: shown contained (never cropped) on light tiles, so a square logo with a
 *     transparent background reads best;
 *   - home hero: the tile is 9:4 on phones, 3:1 on tablets and about 12:5 on desktops, so the
 *     artwork is made at 12:5 with the message kept in the middle; the optional phone artwork
 *     fills the 9:4 phone tile;
 *   - homepage campaign cards: 16:9 frames;
 *   - category page strip: a wide, short band (about 6:1), the subject kept in the middle;
 *   - avatars: round crops of a square.
 *
 * The limits (formats, 5 MB, the smallest side) are the API's own; the API checks them again.
 */

export interface CropShape {
  key: string;
  label: string;
  /** Width / height; null keeps the picture's own shape. */
  aspect: number | null;
}

export interface UploadGuidance {
  /** "1:1", "12:5"… or null when any shape is fine. */
  ratioLabel: string | null;
  /** The recommended size in pixels. */
  recommended: { width: number; height: number } | null;
  /** The smallest accepted shorter side, in pixels. */
  minShortSide: number;
  formats: string;
  maxBytes: number;
  /** One sentence on where the picture appears or what makes it look right. */
  note: string;
  /** Crop shapes offered for this slot, the first being the recommended one. */
  shapes: readonly CropShape[];
}

const FORMATS = 'JPEG, PNG or WebP';
const ORIGINAL: CropShape = { key: 'original', label: 'Original', aspect: null };
const SQUARE: CropShape = { key: 'square', label: '1:1', aspect: 1 };

export type BannerPlacement = 'home_hero' | 'home_secondary' | 'category';

function guidance(
  ratioLabel: string | null,
  recommended: { width: number; height: number } | null,
  note: string,
  shapes: readonly CropShape[],
  minShortSide = PRODUCT_IMAGE_MIN_SIZE,
): UploadGuidance {
  return {
    ratioLabel,
    recommended,
    minShortSide,
    formats: FORMATS,
    maxBytes: PRODUCT_IMAGE_MAX_BYTES,
    note,
    shapes,
  };
}

const BANNER: Record<BannerPlacement, UploadGuidance> = {
  home_hero: guidance(
    '12:5',
    { width: 2400, height: 1000 },
    'Homepage hero. Desktops show it at about 12:5 and tablets at 3:1, so keep words and faces in the middle; phones use the phone picture when there is one.',
    [
      { key: 'hero', label: '12:5', aspect: 12 / 5 },
      { key: 'tablet', label: '3:1', aspect: 3 },
      ORIGINAL,
    ],
  ),
  home_secondary: guidance(
    '16:9',
    { width: 1600, height: 900 },
    'Homepage campaign card. The picture fills a 16:9 frame; any heading and button sit under it, never over it.',
    [{ key: 'wide', label: '16:9', aspect: 16 / 9 }, ORIGINAL],
  ),
  category: guidance(
    '6:1',
    { width: 2400, height: 400 },
    'Category page strip: a wide, short band above the products. Keep the subject in the middle; the edges may be cut on narrow screens.',
    [{ key: 'strip', label: '6:1', aspect: 6 }, ORIGINAL],
  ),
};

const MOBILE_HERO = guidance(
  '9:4',
  { width: 1350, height: 600 },
  'Shown on phones instead of the main picture, in the 9:4 phone hero. Only the homepage hero uses it.',
  [{ key: 'phone', label: '9:4', aspect: 9 / 4 }, ORIGINAL],
);

/**
 * A campaign's own banner (Discounts & campaigns), uploaded to the media library and stored on
 * the campaign. The storefront draws it as the lead banner of the sale band, in a 12:5 frame,
 * and the app draws the same picture in the same 12:5 frame, so 1200 x 500 is the shape both
 * surfaces show and the shape this guidance asks for.
 */
export const CAMPAIGN_BANNER_GUIDANCE: UploadGuidance = guidance(
  '12:5',
  { width: 1200, height: 500 },
  'The storefront and the app both show it in a 12:5 frame, so keep the subject and any words in the middle: a narrow screen crops the edges rather than squashing the picture.',
  [
    { key: 'campaign', label: '12:5', aspect: 12 / 5 },
    { key: 'campaign-wide', label: '16:9', aspect: 16 / 9 },
    ORIGINAL,
  ],
);

/**
 * A shopping zone's picture (Collections). The storefront and the app draw it as a compact
 * collection banner: 3:1 on a desktop, where three fit across, and 3:2 on a phone, where two do.
 * A 3:1 picture fills the wide frame exactly and loses only its edges on a phone, so the subject
 * belongs in the middle.
 */
export const ZONE_BANNER_GUIDANCE: UploadGuidance = guidance(
  '3:1',
  { width: 1200, height: 400 },
  'Shown as a compact collection banner: 3:1 on a desktop and 3:2 on a phone, so keep the subject in the middle and the edges may be cut on a narrow screen.',
  [
    { key: 'zone', label: '3:1', aspect: 3 },
    { key: 'zone-wide', label: '16:9', aspect: 16 / 9 },
    ORIGINAL,
  ],
);

/**
 * The app's own picture for a collection. The phone draws the whole card as artwork with the
 * name, the count and "Shop" inside a fade along the bottom, so the subject wants to sit high
 * and the middle of the picture is the safe area.
 */
export const ZONE_MOBILE_BANNER_GUIDANCE: UploadGuidance = guidance(
  '3:2',
  { width: 1200, height: 800 },
  'The phone fills the whole collection card with this picture and writes the name, the count and "Shop" along its bottom edge, so keep the subject in the upper two thirds.',
  [
    { key: 'zone-mobile', label: '3:2', aspect: 3 / 2 },
    { key: 'zone-mobile-wide', label: '16:9', aspect: 16 / 9 },
    ORIGINAL,
  ],
);

/**
 * A brand's banner picture (Brands): the wide band on the brand's own page, under the identity
 * row, where the logo already says who the brand is. Both platforms draw it in a 12:5 frame, so
 * that is the shape to upload; a 3:2 picture loses only its top and bottom edges.
 */
export const BRAND_BANNER_GUIDANCE: UploadGuidance = guidance(
  '12:5',
  { width: 1600, height: 640 },
  'Shown as the wide band on the brand’s own page, under the logo. Keep the subject in the middle: a narrow screen trims the edges rather than squashing the picture.',
  [
    { key: 'brand', label: '12:5', aspect: 12 / 5 },
    { key: 'brand-wide', label: '16:9', aspect: 16 / 9 },
    ORIGINAL,
  ],
);

const BY_KIND: Record<Exclude<UploadKind, 'banner-image' | 'product-video'>, UploadGuidance> = {
  'product-image': guidance(
    '1:1',
    { width: 1600, height: 1600 },
    'Product galleries are square on the website and in the app. Use a plain, light background.',
    [SQUARE, { key: 'portrait', label: '4:5', aspect: 4 / 5 }, ORIGINAL],
  ),
  'brand-logo': guidance(
    '1:1',
    { width: 800, height: 800 },
    'Shown whole on light tiles, never cropped. A square PNG or WebP with a transparent background reads best.',
    [SQUARE, ORIGINAL],
  ),
  'brand-banner': BRAND_BANNER_GUIDANCE,
  'banner-mobile-image': MOBILE_HERO,
  'category-image': guidance(
    '1:1',
    { width: 800, height: 800 },
    'Category cards are square. Centre the subject so it survives the round corners.',
    [SQUARE, ORIGINAL],
  ),
  'category-banner': guidance(
    '12:5',
    { width: 1200, height: 500 },
    'The wide picture at the top of the category’s page in the app. It is cropped to fill a slim band, so keep the subject in the middle and leave the lower edge plain: the product count is written over it.',
    [{ key: 'category-banner', label: '12:5', aspect: 12 / 5 }, ORIGINAL],
  ),
  'category-create': guidance(
    '1:1',
    { width: 800, height: 800 },
    'Category cards are square. Centre the subject so it survives the round corners.',
    [SQUARE, ORIGINAL],
  ),
  avatar: guidance(
    '1:1',
    { width: 400, height: 400 },
    'Shown as a circle, so keep the face in the middle.',
    [SQUARE],
    AVATAR_MIN_SIZE,
  ),
  media: guidance(null, null, 'Any shape: pick the crop where the picture is used.', [
    ORIGINAL,
    SQUARE,
  ]),
};

/** The guidance for one upload slot; banners depend on where the banner is placed. */
export function uploadGuidance(
  kind: Exclude<UploadKind, 'product-video'>,
  placement?: BannerPlacement,
): UploadGuidance {
  if (kind === 'banner-image') return BANNER[placement ?? 'home_secondary'];
  return BY_KIND[kind];
}

/** "Recommended 1600 × 1600 px (1:1) · JPEG, PNG or WebP · up to 5 MB · at least 400 px". */
export function guidanceLine(value: UploadGuidance): string {
  const parts: string[] = [];
  if (value.recommended) {
    parts.push(
      `Recommended ${String(value.recommended.width)} × ${String(value.recommended.height)} px${value.ratioLabel ? ` (${value.ratioLabel})` : ''}`,
    );
  }
  parts.push(value.formats);
  parts.push(`up to ${String(Math.round(value.maxBytes / (1024 * 1024)))} MB`);
  parts.push(`at least ${String(value.minShortSide)} px on the shorter side`);
  return parts.join(' · ');
}

/**
 * How far a picture's shape is from the slot's recommended shape, as a fraction (0 = exact).
 * Null when the slot has no preferred shape.
 */
export function shapeMismatch(value: UploadGuidance, width: number, height: number): number | null {
  const target = value.shapes[0]?.aspect ?? null;
  if (target === null || width <= 0 || height <= 0) return null;
  return Math.abs(width / height - target) / target;
}
