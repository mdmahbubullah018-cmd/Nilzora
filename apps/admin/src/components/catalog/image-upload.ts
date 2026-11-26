/*
 * Checks on a picture before its bytes go to the API. They live in @nilzora/contracts so the
 * storefront applies exactly the same rules; this module keeps the admin's import path.
 */
export {
  checkImageFile,
  checkReportedFile,
  IMAGE_MISSING,
  IMAGE_NOT_SUPPORTED,
  IMAGE_TOO_BIG,
  sniffImageType,
  type ImageFileCheck,
} from '@nilzora/contracts';
