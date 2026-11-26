import { oneOf } from '@/components/admin-kit/href';

/*
 * Confirmation messages after a catalog change. Server Actions redirect back to the
 * page with `?notice=<key>`, so the page re-reads the saved state with or without
 * JavaScript; only these fixed keys are ever shown.
 */

export const PRODUCT_NOTICES = {
  created: 'Product created as a draft. Submit its content for review when it is ready to sell.',
  content: 'Content saved. Changed content needs a new review before the product can be published.',
  pricing: 'Pricing saved. The storefront shows the new price straight away.',
  ordering: 'Ordering settings saved.',
  saved: 'Changes saved. Changed content needs a new review before the product can be published.',
  stock: 'Stock adjusted and recorded in the stock ledger.',
  submitted:
    'Submitted for review. The content is locked until the review is decided or withdrawn.',
  withdrawn: 'Review withdrawn. The content can be edited again.',
  published: 'Published. The product is now on sale in the storefront.',
  unpublished: 'Unpublished. The product is a draft again and hidden from the storefront.',
  archived: 'Archived. The product is hidden from the storefront.',
  restored: 'Restored as a draft. Publish it again when it should be on sale.',
  'image-added':
    'Image added. Changed images need a new review before the product can be published.',
  'image-saved': 'Image description saved.',
  'image-moved': 'Image order saved. The first image is the one shown in listings.',
  'image-cover': 'Cover image set. It is the picture shown in listings.',
  'image-removed':
    'Image removed. Changed images need a new review before the product can be published.',
} as const;

export type ProductNotice = keyof typeof PRODUCT_NOTICES;

export const CATEGORY_NOTICES = {
  'category-created': 'Category created.',
  'category-saved': 'Category saved.',
  'category-shown': 'Category shown. Its products on sale appear in the storefront again.',
  'category-hidden': 'Category hidden. It and its products no longer appear in the storefront.',
  'category-deleted': 'Category deleted.',
  'category-reordered': 'Category order saved. The storefront shows the new order.',
} as const;

export type CategoryNotice = keyof typeof CATEGORY_NOTICES;

const productKeys = Object.keys(PRODUCT_NOTICES) as ProductNotice[];
const categoryKeys = Object.keys(CATEGORY_NOTICES) as CategoryNotice[];

/** The message for a `?notice=` value, or undefined for anything unknown. */
export function productNotice(value: string | string[] | undefined): string | undefined {
  const key = oneOf(value, productKeys);
  return key ? PRODUCT_NOTICES[key] : undefined;
}

export function categoryNotice(value: string | string[] | undefined): string | undefined {
  const key = oneOf(value, categoryKeys);
  return key ? CATEGORY_NOTICES[key] : undefined;
}
