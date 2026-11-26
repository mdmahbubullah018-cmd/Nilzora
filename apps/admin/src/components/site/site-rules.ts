import {
  saveSeoRequestSchema,
  saveStoreProfileRequestSchema,
  SEO_DESCRIPTION_MAX,
  SEO_OG_DESCRIPTION_MAX,
  SEO_OG_TITLE_MAX,
  SEO_TITLE_MAX,
  type SaveSeoRequest,
  type SaveStoreProfileRequest,
} from '@nilzora/contracts';

/*
 * The SEO and store-profile forms' rules, shared by the forms (which check while staff
 * type) and the Server Actions (which check again before calling the API, which checks a
 * third time). Everything goes through the contract schemas, so the three never drift.
 * Free of server and Next.js imports.
 */

export type FieldErrors = Partial<Record<string, string>>;
export type Checked<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };
export type FormTexts = Partial<Record<string, string>>;

/** An empty field means "not set", which is null in the database. */
function nullable(value: string | undefined): string | null {
  const text = (value ?? '').trim();
  return text === '' ? null : text;
}

type Issue = { path: readonly PropertyKey[]; message: string };

/** The first message of each field, with the form's own wording where the contract's is generic. */
function errorsFrom(issues: readonly Issue[], messages: FieldErrors): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field !== 'string') continue;
    errors[field] ??= messages[field] ?? issue.message;
  }
  return errors;
}

// ---------------------------------------------------------------------------
// SEO
// ---------------------------------------------------------------------------

export const SEO_LIMITS = {
  seoTitle: SEO_TITLE_MAX,
  seoDescription: SEO_DESCRIPTION_MAX,
  ogTitle: SEO_OG_TITLE_MAX,
  ogDescription: SEO_OG_DESCRIPTION_MAX,
  canonicalPath: 160,
} as const;

const SEO_MESSAGES: FieldErrors = {
  seoTitle: `Keep the search title under ${String(SEO_TITLE_MAX)} characters.`,
  seoDescription: `Keep the search description under ${String(SEO_DESCRIPTION_MAX)} characters.`,
  ogTitle: `Keep the share title under ${String(SEO_OG_TITLE_MAX)} characters.`,
  ogDescription: `Keep the share description under ${String(SEO_OG_DESCRIPTION_MAX)} characters.`,
  ogImageKey: 'Choose a picture from the library, or paste its media key.',
  canonicalPath: 'Use a path on this site that starts with a single /, e.g. /products/desk-lamp.',
};

/** The fields of the SEO form as text. */
export const SEO_FIELDS = [
  'seoTitle',
  'seoDescription',
  'ogTitle',
  'ogDescription',
  'ogImageKey',
  'canonicalPath',
] as const;

export function checkSeo(values: FormTexts, noIndex: boolean): Checked<SaveSeoRequest> {
  const parsed = saveSeoRequestSchema.safeParse({
    seoTitle: nullable(values.seoTitle),
    seoDescription: nullable(values.seoDescription),
    ogTitle: nullable(values.ogTitle),
    ogDescription: nullable(values.ogDescription),
    ogImageKey: nullable(values.ogImageKey),
    canonicalPath: nullable(values.canonicalPath),
    noIndex,
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, errors: errorsFrom(parsed.error.issues, SEO_MESSAGES) };
}

/** The editor's address for a product or category (the route takes the singular kind). */
export function seoEditorPath(kind: 'product' | 'category', targetId: string): string {
  return `/admin/seo/${kind}/${targetId}`;
}

/** The storefront path a page lives at, for the search-result preview. */
export function storefrontPath(kind: 'product' | 'category', slug: string): string {
  return `/${kind === 'product' ? 'products' : 'categories'}/${slug}`;
}

// ---------------------------------------------------------------------------
// Store profile
// ---------------------------------------------------------------------------

/** Text fields of the store profile form, with the longest value each takes. */
export const STORE_LIMITS = {
  displayName: 80,
  tagline: 160,
  description: 1000,
  contactEmail: 120,
  contactPhone: 32,
  addressLine: 200,
  addressArea: 120,
  addressDistrict: 120,
  businessHours: 200,
  supportEmail: 120,
  supportPhone: 32,
  socialFacebook: 200,
  socialInstagram: 200,
  socialYoutube: 200,
  socialTiktok: 300,
  socialX: 300,
  whatsappNumber: 16,
  playStoreUrl: 300,
  appStoreUrl: 300,
  defaultSeoTitle: 70,
  defaultSeoDescription: 200,
  logoKey: 180,
  ogImageKey: 180,
} as const;

export type StoreField = keyof typeof STORE_LIMITS;

/** Fields newer payloads carry: absent from an older one, so an empty form value must not clear them. */
export const NEWER_STORE_FIELDS = [
  'whatsappNumber',
  'playStoreUrl',
  'appStoreUrl',
  'socialTiktok',
  'socialX',
] as const;
export type NewerStoreField = (typeof NEWER_STORE_FIELDS)[number];

const EMAIL = 'Enter a valid email address, e.g. hello@yourshop.com.';
const LINK = 'Use a full https:// link, or leave it empty.';

const STORE_MESSAGES: FieldErrors = {
  displayName: 'Enter the store name (up to 80 characters).',
  contactEmail: EMAIL,
  supportEmail: EMAIL,
  socialFacebook: LINK,
  socialInstagram: LINK,
  socialYoutube: LINK,
  logoKey: 'Choose a picture from the library, or paste its media key.',
  ogImageKey: 'Choose a picture from the library, or paste its media key.',
};

const NEWER: readonly string[] = NEWER_STORE_FIELDS;
for (const [field, limit] of Object.entries(STORE_LIMITS)) {
  // The contract's own messages for the app and newer social links say exactly what to type.
  if (!NEWER.includes(field)) STORE_MESSAGES[field] ??= `Keep this under ${String(limit)} characters.`;
}

/**
 * The store profile form as a request. A newer field the loaded payload did not carry
 * (listed in `absent`) and that was left empty is left out, so saving never clears a value
 * the form could not show.
 */
export function checkStoreProfile(
  values: FormTexts,
  absent: readonly string[] = [],
): Checked<SaveStoreProfileRequest> {
  const newer: Partial<Record<NewerStoreField, string | null>> = {};
  for (const field of NEWER_STORE_FIELDS) {
    const text = nullable(values[field]);
    if (text === null && absent.includes(field)) continue;
    newer[field] = text;
  }
  const parsed = saveStoreProfileRequestSchema.safeParse({
    displayName: (values.displayName ?? '').trim(),
    tagline: nullable(values.tagline),
    description: nullable(values.description),
    logoKey: nullable(values.logoKey),
    contactEmail: nullable(values.contactEmail),
    contactPhone: nullable(values.contactPhone),
    addressLine: nullable(values.addressLine),
    addressArea: nullable(values.addressArea),
    addressDistrict: nullable(values.addressDistrict),
    businessHours: nullable(values.businessHours),
    supportEmail: nullable(values.supportEmail),
    supportPhone: nullable(values.supportPhone),
    socialFacebook: nullable(values.socialFacebook),
    socialInstagram: nullable(values.socialInstagram),
    socialYoutube: nullable(values.socialYoutube),
    defaultSeoTitle: nullable(values.defaultSeoTitle),
    defaultSeoDescription: nullable(values.defaultSeoDescription),
    ogImageKey: nullable(values.ogImageKey),
    ...newer,
  });
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, errors: errorsFrom(parsed.error.issues, STORE_MESSAGES) };
}
