'use server';

import {
  bannerInputSchema,
  BANNER_PLACEMENTS,
  brandInputSchema,
  reorderBannersRequestSchema,
  slugify,
  type ApiErrorCode,
  type BannerPlacement,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { revalidatePath } from 'next/cache';
import { adminAct, formText, invalid, type ActionState } from '@/components/admin-kit/act';
import { checkImageFile } from '@/components/catalog/image-upload';

/*
 * Brand and banner changes. Each action checks the form for the person's benefit, then
 * the API decides: it authorises the change and validates everything again.
 */

const PAGE_EXPIRED: ActionState = {
  status: 'error',
  message: 'This page is out of date. Reload it and try again.',
};

const IMAGE_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  media_unavailable: 'Image uploads are not configured yet (media storage is off).',
  image_invalid: 'This picture was refused: use a JPEG, PNG or WebP of at least 400 px.',
  payload_too_large: 'The picture is too large: keep it under 5 MB.',
  unsupported_media_type: 'Upload a JPEG, PNG or WebP picture.',
};

const BRAND_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  slug_taken: 'Another brand uses (or recently used) this address. Choose another.',
  name_taken: 'Another brand already uses this name.',
  ...IMAGE_MESSAGES,
};

function idOf(formData: FormData, name: string): string | undefined {
  const parsed = uuidSchema.safeParse(formText(formData, name));
  return parsed.success ? parsed.data : undefined;
}

function nullable(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

/** "2026-11-01T09:00" from a datetime-local field, read as Bangladesh time (UTC+6). */
function bdTime(text: string): string | null | undefined {
  if (text.trim() === '') return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(text.trim());
  return match ? new Date(`${match[1]}T${match[2]}:00+06:00`).toISOString() : undefined;
}

// ---------------------------------------------------------------------------- brands

export async function saveBrandAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const editing = formText(formData, 'brandId') !== '';
  const brandId = idOf(formData, 'brandId');
  if (editing && brandId === undefined) return PAGE_EXPIRED;

  const values = {
    name: formText(formData, 'name'),
    slug: formText(formData, 'slug').trim().toLowerCase(),
    description: formText(formData, 'description'),
  };
  const parsed = brandInputSchema.safeParse({
    name: values.name,
    slug: values.slug || slugify(values.name),
    description: nullable(values.description),
    isActive: formData.get('isActive') === 'on',
  });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? '');
      errors[field] ??= issue.message;
    }
    return invalid('Check the highlighted fields.', errors, values);
  }

  const result = await adminAct(
    formData,
    (api, token) =>
      brandId === undefined
        ? api.adminCreateBrand(token, parsed.data)
        : api.adminUpdateBrand(token, brandId, parsed.data),
    { returnTo: '/admin/brands', label: 'brand save', messages: BRAND_MESSAGES },
  );
  if (!result.ok) return { ...result.state, values };
  revalidatePath('/admin/brands');
  return {
    status: 'success',
    message: brandId === undefined ? 'Brand added.' : 'Saved.',
  };
}

export async function uploadBrandLogoAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const brandId = idOf(formData, 'brandId');
  if (brandId === undefined) return PAGE_EXPIRED;
  const file = await checkImageFile(formData.get('image'));
  if (!file.ok) return invalid(file.message, { image: file.message });
  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminUploadBrandLogo(token, brandId, {
        bytes: file.bytes,
        contentType: file.contentType,
      }),
    { returnTo: '/admin/brands', label: 'brand logo upload', messages: BRAND_MESSAGES },
  );
  if (!result.ok) return result.state;
  revalidatePath('/admin/brands');
  return { status: 'success', message: 'Logo updated.' };
}

export async function removeBrandLogoAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const brandId = idOf(formData, 'brandId');
  if (brandId === undefined) return PAGE_EXPIRED;
  const result = await adminAct(
    formData,
    (api, token) => api.adminRemoveBrandLogo(token, brandId),
    {
      returnTo: '/admin/brands',
      label: 'brand logo removal',
      messages: BRAND_MESSAGES,
    },
  );
  if (!result.ok) return result.state;
  revalidatePath('/admin/brands');
  return { status: 'success', message: 'Logo removed.' };
}

export async function uploadBrandBannerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const brandId = idOf(formData, 'brandId');
  if (brandId === undefined) return PAGE_EXPIRED;
  const file = await checkImageFile(formData.get('image'));
  if (!file.ok) return invalid(file.message, { image: file.message });
  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminUploadBrandBanner(token, brandId, {
        bytes: file.bytes,
        contentType: file.contentType,
      }),
    { returnTo: '/admin/brands', label: 'brand banner upload', messages: BRAND_MESSAGES },
  );
  if (!result.ok) return result.state;
  revalidatePath('/admin/brands');
  return { status: 'success', message: 'Brand banner updated.' };
}

export async function removeBrandBannerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const brandId = idOf(formData, 'brandId');
  if (brandId === undefined) return PAGE_EXPIRED;
  const result = await adminAct(
    formData,
    (api, token) => api.adminRemoveBrandBanner(token, brandId),
    {
      returnTo: '/admin/brands',
      label: 'brand banner removal',
      messages: BRAND_MESSAGES,
    },
  );
  if (!result.ok) return result.state;
  revalidatePath('/admin/brands');
  return { status: 'success', message: 'Brand banner removed.' };
}

/**
 * Deletes a brand (products.read and products.publish, checked by the API). The API
 * refuses while products still use it (409 brand_in_use), so nothing is unlinked silently.
 */
export async function deleteBrandAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const brandId = idOf(formData, 'brandId');
  if (brandId === undefined) return PAGE_EXPIRED;
  const result = await adminAct(formData, (api, token) => api.adminDeleteBrand(token, brandId), {
    returnTo: '/admin/brands',
    label: 'brand delete',
    messages: {
      brand_in_use:
        'Products still use this brand. Move them to another brand (or to no brand) from their pages first, then delete it.',
      not_found: 'This brand no longer exists. Reload the page to see the current list.',
      forbidden: 'Deleting a brand needs the “Publish products” permission.',
    },
  });
  if (!result.ok) return result.state;
  revalidatePath('/admin/brands');
  return { status: 'success', message: 'Brand deleted.' };
}

/** Assigns a product to a brand, or clears it with an empty choice. */
export async function setProductBrandAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = idOf(formData, 'productId');
  if (productId === undefined) return PAGE_EXPIRED;
  const chosen = formText(formData, 'brandId');
  const brandId = chosen === '' ? null : idOf(formData, 'brandId');
  if (brandId === undefined) return invalid('Choose a brand from the list.', {});
  const result = await adminAct(
    formData,
    (api, token) => api.adminSetProductBrand(token, productId, brandId),
    {
      returnTo: `/admin/products/${productId}` as never,
      label: 'product brand change',
      messages: {
        forbidden: 'Changing a product’s brand needs the “Publish products” permission.',
      },
    },
  );
  if (!result.ok) return result.state;
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath('/admin/brands');
  return { status: 'success', message: brandId === null ? 'Brand cleared.' : 'Brand saved.' };
}

// ---------------------------------------------------------------------------- banners

const PLACEMENTS: readonly string[] = BANNER_PLACEMENTS;

export async function saveBannerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const editing = formText(formData, 'bannerId') !== '';
  const bannerId = idOf(formData, 'bannerId');
  if (editing && bannerId === undefined) return PAGE_EXPIRED;

  const values = {
    placement: formText(formData, 'placement'),
    categoryId: formText(formData, 'categoryId'),
    title: formText(formData, 'title'),
    subtitle: formText(formData, 'subtitle'),
    ctaLabel: formText(formData, 'ctaLabel'),
    ctaHref: formText(formData, 'ctaHref'),
    imageAlt: formText(formData, 'imageAlt'),
    sortOrder: formText(formData, 'sortOrder'),
    startsAt: formText(formData, 'startsAt'),
    endsAt: formText(formData, 'endsAt'),
  };
  const errors: Record<string, string> = {};
  if (!PLACEMENTS.includes(values.placement)) errors.placement = 'Choose where the banner shows.';
  // Half a button would be a dead control in the store: both parts, or neither.
  if ((values.ctaLabel.trim() === '') !== (values.ctaHref.trim() === '')) {
    if (values.ctaLabel.trim() === '') errors.ctaLabel = 'Add the button label, or clear the link.';
    else errors.ctaHref = 'Add the button link, or clear the label.';
  }
  const startsAt = bdTime(values.startsAt);
  const endsAt = bdTime(values.endsAt);
  if (startsAt === undefined) errors.startsAt = 'Enter a valid date and time.';
  if (endsAt === undefined) errors.endsAt = 'Enter a valid date and time.';
  const sortOrder = values.sortOrder.trim() === '' ? 0 : Number(values.sortOrder);
  const placement = values.placement as BannerPlacement;

  const parsed = bannerInputSchema.safeParse({
    placement,
    categoryId: placement === 'category' ? nullable(values.categoryId) : null,
    title: values.title,
    subtitle: nullable(values.subtitle),
    ctaLabel: nullable(values.ctaLabel),
    ctaHref: nullable(values.ctaHref),
    imageAlt: nullable(values.imageAlt),
    sortOrder: Number.isInteger(sortOrder) ? sortOrder : -1,
    isActive: formData.get('isActive') === 'on',
    startsAt: startsAt ?? null,
    endsAt: endsAt ?? null,
  });
  if (!parsed.success || Object.keys(errors).length > 0) {
    for (const issue of parsed.success ? [] : parsed.error.issues) {
      const field = String(issue.path[0] ?? '');
      errors[field] ??= issue.message;
    }
    return invalid('Check the highlighted fields.', errors, values);
  }

  const result = await adminAct(
    formData,
    (api, token) =>
      bannerId === undefined
        ? api.adminCreateBanner(token, parsed.data)
        : api.adminUpdateBanner(token, bannerId, parsed.data),
    { returnTo: '/admin/banners', label: 'banner save', messages: IMAGE_MESSAGES },
  );
  if (!result.ok) return { ...result.state, values };
  revalidatePath('/admin/banners');
  return {
    status: 'success',
    message: bannerId === undefined ? 'Banner created. Add its picture below.' : 'Saved.',
  };
}

export async function uploadBannerImageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const bannerId = idOf(formData, 'bannerId');
  if (bannerId === undefined) return PAGE_EXPIRED;
  const file = await checkImageFile(formData.get('image'));
  if (!file.ok) return invalid(file.message, { image: file.message });
  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminUploadBannerImage(token, bannerId, {
        bytes: file.bytes,
        contentType: file.contentType,
      }),
    { returnTo: '/admin/banners', label: 'banner image upload', messages: IMAGE_MESSAGES },
  );
  if (!result.ok) return result.state;
  revalidatePath('/admin/banners');
  return { status: 'success', message: 'Picture updated.' };
}

/** Sets or replaces a banner's picture for small screens; the main picture is untouched. */
export async function uploadBannerMobileImageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const bannerId = idOf(formData, 'bannerId');
  if (bannerId === undefined) return PAGE_EXPIRED;
  const file = await checkImageFile(formData.get('image'));
  if (!file.ok) return invalid(file.message, { image: file.message });
  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminUploadBannerMobileImage(token, bannerId, {
        bytes: file.bytes,
        contentType: file.contentType,
      }),
    { returnTo: '/admin/banners', label: 'banner mobile image upload', messages: IMAGE_MESSAGES },
  );
  if (!result.ok) return result.state;
  revalidatePath('/admin/banners');
  return { status: 'success', message: 'Small-screen picture updated.' };
}

/** Removes a banner's small-screen picture: small screens then show the main one. */
export async function removeBannerMobileImageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const bannerId = idOf(formData, 'bannerId');
  if (bannerId === undefined) return PAGE_EXPIRED;
  const result = await adminAct(
    formData,
    (api, token) => api.adminRemoveBannerMobileImage(token, bannerId),
    { returnTo: '/admin/banners', label: 'banner mobile image removal', messages: IMAGE_MESSAGES },
  );
  if (!result.ok) return result.state;
  revalidatePath('/admin/banners');
  return { status: 'success', message: 'Small-screen picture removed.' };
}

const REORDER_STALE: ActionState = {
  status: 'error',
  message: 'The banners changed since this page loaded. Reload it and try again.',
};

/**
 * Moves one banner a place earlier or later among the banners of its placement (and
 * category). The form carries the order it was rendered with; the API refuses the new
 * order if the banners have changed since.
 */
export async function reorderBannersAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const bannerId = idOf(formData, 'bannerId');
  const direction = formText(formData, 'direction');
  if (bannerId === undefined || (direction !== 'earlier' && direction !== 'later')) {
    return PAGE_EXPIRED;
  }
  const order = formText(formData, 'order').split(',');
  const index = order.indexOf(bannerId);
  const target = direction === 'earlier' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= order.length) return REORDER_STALE;
  const ids = [...order];
  [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];

  const categoryId = formText(formData, 'categoryId');
  const parsed = reorderBannersRequestSchema.safeParse({
    placement: formText(formData, 'placement'),
    categoryId: categoryId === '' ? null : categoryId,
    ids,
  });
  if (!parsed.success) return REORDER_STALE;

  const result = await adminAct(
    formData,
    (api, token) => api.adminReorderBanners(token, parsed.data),
    {
      returnTo: '/admin/banners',
      label: 'banner order',
      messages: { bad_request: REORDER_STALE.message ?? '' },
    },
  );
  if (!result.ok) return result.state;
  revalidatePath('/admin/banners');
  return { status: 'success', message: 'Order saved.' };
}

export async function deleteBannerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const bannerId = idOf(formData, 'bannerId');
  if (bannerId === undefined) return PAGE_EXPIRED;
  const result = await adminAct(formData, (api, token) => api.adminDeleteBanner(token, bannerId), {
    returnTo: '/admin/banners',
    label: 'banner delete',
  });
  if (!result.ok) return result.state;
  revalidatePath('/admin/banners');
  return { status: 'success', message: 'Banner deleted.' };
}
