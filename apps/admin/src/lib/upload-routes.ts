/*
 * The admin's upload routes, shared by the route handler and the forms that post to it.
 * A plain module (not a Server Action file), so it may export constants.
 */

/** Form field the upload route sets so a product upload answers with a state, not a redirect. */
export const RESPOND_AS_STATE = '__respond_as_state';

/**
 * product-image, brand-logo, brand-banner, banner-image, category-image and category-banner attach a picture to an
 * existing record. category-create makes a new category and attaches its picture in the same request, so
 * the picture's transfer shows real progress on the create form. avatar is the signed-in
 * account's own profile picture. media adds a picture to the media library.
 */
export const UPLOAD_KINDS = [
  'product-image',
  'brand-logo',
  'brand-banner',
  'banner-image',
  'banner-mobile-image',
  'category-image',
  'category-banner',
  'category-create',
  'avatar',
  'media',
  'product-video',
] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export function isUploadKind(value: string): value is UploadKind {
  return (UPLOAD_KINDS as readonly string[]).includes(value);
}

export function uploadEndpoint(kind: UploadKind): string {
  return `/api/uploads/${kind}`;
}
