'use server';

import {
  MAX_PRODUCT_IMAGES,
  productImageSchema,
  productImageUploadQuerySchema,
  reorderProductImagesRequestSchema,
  updateProductImageRequestSchema,
  type ApiErrorCode,
} from '@nilzora/contracts';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { adminAct, formText, invalid, type ActionState } from '@/components/admin-kit/act';
import { checkImageFile } from '@/components/catalog/image-upload';
import { RESPOND_AS_STATE } from '@/lib/upload-routes';
import type { ProductNotice } from '@/components/catalog/notices';

/*
 * Product image Server Actions. adminAct() refuses a form without this app's Origin and
 * CSRF token before any API call. An upload is checked here by size and by its first bytes
 * (the browser's file type is never trusted); the API decodes the image and the database
 * checks the permission and the product's state, so they decide again. Only the fixed
 * messages below return to the browser.
 */

const MISSING_PRODUCT: ActionState = {
  status: 'error',
  message: 'This product could not be identified. Reload the page and try again.',
};
const ALT_TOO_LONG = 'Keep the description under 160 characters.';

const IMAGE_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  forbidden: 'Your account does not have permission to change product images.',
  not_found: 'This image or product no longer exists. Reload the page to see the current images.',
  product_content_locked:
    'This product is on sale, so its images cannot change. Unpublish it first, then edit and resubmit it.',
  product_under_review:
    'The product is under review, so its images cannot change. Withdraw the review first.',
  image_limit_reached: `A product keeps at most ${MAX_PRODUCT_IMAGES} images. Remove one to add another.`,
  media_unavailable:
    'Image uploads are not set up on this server yet. The store owner needs to add the Cloudflare R2 settings to the API and restart it.',
  unsupported_media_type: 'Upload a JPEG, PNG or WebP picture.',
  payload_too_large: 'This image is larger than 5 MB. Choose a smaller one.',
  rate_limited: 'Too many changes in a short time. Wait a minute, then try again.',
  image_invalid: 'This image could not be used. Choose another picture.',
};

/** Why the API refused an upload (`details.reason` of image_invalid). */
const REJECTION_MESSAGES: Readonly<Record<string, string>> = {
  unsupported_format: 'Upload a JPEG, PNG or WebP picture.',
  corrupt: 'This file could not be read as a picture. Choose another image.',
  animated: 'Animated images are not supported. Choose a still picture.',
  too_small: 'This picture is too small. Use one at least 400 pixels on its shorter side.',
  too_large: 'This picture is too large. Use one at most 8000 pixels on its longer side.',
};

const REORDER_STALE = 'The images changed since this page loaded. Reload the page and try again.';

function productPath(productId: string): Route {
  return `/admin/products/${productId}` as Route;
}

function idFrom(formData: FormData, name: string): string | undefined {
  const parsed = productImageSchema.shape.id.safeParse(formText(formData, name));
  return parsed.success ? parsed.data : undefined;
}

function refresh(productId: string): void {
  revalidatePath(productPath(productId));
  revalidatePath('/admin/products');
}

function backToProduct(productId: string, notice: ProductNotice): never {
  redirect(`${productPath(productId)}?notice=${notice}` as Route);
}

function rejectionMessage(details: unknown): string | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const reason = (details as Record<string, unknown>).reason;
  return typeof reason === 'string' ? REJECTION_MESSAGES[reason] : undefined;
}

/** Adds one image to a product (position last) and returns to the product. */
export async function uploadProductImageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = idFrom(formData, 'productId');
  if (productId === undefined) return MISSING_PRODUCT;

  const alt = formText(formData, 'alt').trim();
  const parsedAlt = productImageUploadQuerySchema.safeParse({ alt: alt === '' ? undefined : alt });
  if (!parsedAlt.success) return invalid(ALT_TOO_LONG, { alt: ALT_TOO_LONG }, { alt });

  const file = await checkImageFile(formData.get('image'));
  if (!file.ok) return invalid(file.message, { image: file.message }, { alt });

  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminUploadProductImage(token, productId, {
        bytes: file.bytes,
        contentType: file.contentType,
        ...(parsedAlt.data.alt ? { alt: parsedAlt.data.alt } : {}),
      }),
    {
      returnTo: productPath(productId),
      label: 'product image upload',
      messages: {
        ...IMAGE_MESSAGES,
        // An upload is not idempotent: a lost answer may hide a stored image.
        service_unavailable:
          'Nilzora could not confirm the upload. Reload the page and check the images before trying again.',
      },
    },
  );
  if (!result.ok) {
    const reason = result.code === 'image_invalid' ? rejectionMessage(result.details) : undefined;
    return { ...result.state, ...(reason ? { message: reason } : {}), values: { alt } };
  }

  refresh(productId);
  // The upload route (which reports real byte progress) wants an answer, not a redirect.
  if (formData.get(RESPOND_AS_STATE) === '1') {
    return { status: 'success', message: 'Image added to the product.' };
  }
  backToProduct(productId, 'image-added');
}

/** Sets or clears one image's description for screen readers. */
export async function updateProductImageAltAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = idFrom(formData, 'productId');
  const imageId = idFrom(formData, 'imageId');
  if (productId === undefined || imageId === undefined) return MISSING_PRODUCT;

  const alt = formText(formData, 'alt').trim();
  const parsed = updateProductImageRequestSchema.safeParse({ alt });
  if (!parsed.success) return invalid(ALT_TOO_LONG, { alt: ALT_TOO_LONG }, { alt });

  const result = await adminAct(
    formData,
    (api, token) => api.adminUpdateProductImage(token, imageId, parsed.data),
    {
      returnTo: productPath(productId),
      label: 'product image description',
      messages: IMAGE_MESSAGES,
    },
  );
  if (!result.ok) return { ...result.state, values: { alt } };

  refresh(productId);
  backToProduct(productId, 'image-saved');
}

/** The order a form was rendered with: product image ids, each once, or undefined. */
function orderFrom(formData: FormData, name: string): string[] | undefined {
  const order = formText(formData, name).split(',');
  if (order.length === 0 || new Set(order).size !== order.length) return undefined;
  return order.every((id) => productImageSchema.shape.id.safeParse(id).success) ? order : undefined;
}

/**
 * Moves one image a place earlier or later, or to the front ("first": the cover, the
 * picture shown in listings). The form carries the order it was rendered with; the API
 * refuses the new order if the product's images have changed since.
 */
export async function moveProductImageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = idFrom(formData, 'productId');
  const imageId = idFrom(formData, 'imageId');
  const direction = formText(formData, 'direction');
  if (productId === undefined || imageId === undefined) return MISSING_PRODUCT;

  const order = formText(formData, 'order').split(',');
  if (new Set(order).size !== order.length) return { status: 'error', message: REORDER_STALE };
  const index = order.indexOf(imageId);
  let moved: string[];
  if (direction === 'first') {
    if (index <= 0) return { status: 'error', message: REORDER_STALE };
    moved = [imageId, ...order.filter((id) => id !== imageId)];
  } else {
    const target = direction === 'earlier' ? index - 1 : direction === 'later' ? index + 1 : -1;
    if (index < 0 || target < 0 || target >= order.length) {
      return { status: 'error', message: REORDER_STALE };
    }
    moved = [...order];
    [moved[index], moved[target]] = [moved[target] as string, moved[index] as string];
  }
  const parsed = reorderProductImagesRequestSchema.safeParse({ imageIds: moved });
  if (!parsed.success) return { status: 'error', message: REORDER_STALE };

  const result = await adminAct(
    formData,
    (api, token) => api.adminReorderProductImages(token, productId, parsed.data),
    {
      returnTo: productPath(productId),
      label: 'product image order',
      messages: { ...IMAGE_MESSAGES, bad_request: REORDER_STALE },
    },
  );
  if (!result.ok) return result.state;

  refresh(productId);
  backToProduct(productId, direction === 'first' ? 'image-cover' : 'image-moved');
}

/**
 * Puts every image in a new order (drag and drop). `order` is the order the page was
 * rendered with and `next` the new one: both must name exactly the same images, each
 * once, or the page is out of date. The API checks the order against the product again.
 */
export async function reorderProductImagesAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = idFrom(formData, 'productId');
  if (productId === undefined) return MISSING_PRODUCT;
  const order = orderFrom(formData, 'order');
  const next = orderFrom(formData, 'next');
  if (
    order === undefined ||
    next === undefined ||
    order.length !== next.length ||
    !next.every((id) => order.includes(id))
  ) {
    return { status: 'error', message: REORDER_STALE };
  }
  if (next.every((id, index) => order[index] === id)) {
    return { status: 'success', message: 'The order is unchanged.' };
  }
  const parsed = reorderProductImagesRequestSchema.safeParse({ imageIds: next });
  if (!parsed.success) return { status: 'error', message: REORDER_STALE };

  const result = await adminAct(
    formData,
    (api, token) => api.adminReorderProductImages(token, productId, parsed.data),
    {
      returnTo: productPath(productId),
      label: 'product image order',
      messages: { ...IMAGE_MESSAGES, bad_request: REORDER_STALE },
    },
  );
  if (!result.ok) return result.state;

  refresh(productId);
  backToProduct(productId, next[0] === order[0] ? 'image-moved' : 'image-cover');
}

/** Removes one image. Its stored files are deleted by the API after the change is saved. */
export async function deleteProductImageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = idFrom(formData, 'productId');
  const imageId = idFrom(formData, 'imageId');
  if (productId === undefined || imageId === undefined) return MISSING_PRODUCT;

  const result = await adminAct(
    formData,
    (api, token) => api.adminDeleteProductImage(token, imageId),
    { returnTo: productPath(productId), label: 'product image removal', messages: IMAGE_MESSAGES },
  );
  if (!result.ok) return result.state;

  refresh(productId);
  backToProduct(productId, 'image-removed');
}
