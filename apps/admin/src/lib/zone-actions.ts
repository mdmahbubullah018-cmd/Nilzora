'use server';

import { adminSaveShoppingZoneRequestSchema, type ApiErrorCode } from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { adminAct, formText, invalid, type ActionState } from '@/components/admin-kit/act';
import { checkImageFile } from '@/components/catalog/image-upload';

/*
 * Shopping zone changes. Each action checks the form for the person's benefit; the API
 * authorises the change and validates everything again.
 */

/** A zone's own page in this app. */
function zonePath(zoneId: string): Route {
  return `/admin/zones/${zoneId}` as Route;
}

/** A product's own page in this app. */
function productPath(productId: string): Route {
  return `/admin/products/${productId}` as Route;
}

/** A category's own page in this app. */
function categoryPath(categoryId: string): Route {
  return `/admin/categories/${categoryId}` as Route;
}

const PAGE_EXPIRED: ActionState = {
  status: 'error',
  message: 'This page is out of date. Reload it and try again.',
};

const ZONE_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  slug_taken: 'Another zone already uses this address. Choose another.',
  zone_in_use:
    'This zone still holds products or categories. Remove them from it first, then delete it.',
  media_unavailable: 'Image uploads are not configured yet (media storage is off).',
  image_invalid: 'This picture was refused: use a JPEG, PNG or WebP of at least 600 px wide.',
  payload_too_large: 'The picture is too large: keep it under 5 MB.',
  unsupported_media_type: 'Upload a JPEG, PNG or WebP picture.',
};

function idOf(formData: FormData, name: string): string | undefined {
  const parsed = uuidSchema.safeParse(formText(formData, name));
  return parsed.success ? parsed.data : undefined;
}

function optional(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Every id in a repeated field, keeping only well-formed ones. */
function idsOf(formData: FormData, name: string): string[] {
  const ids: string[] = [];
  for (const value of formData.getAll(name)) {
    const parsed = uuidSchema.safeParse(value);
    if (parsed.success) ids.push(parsed.data);
  }
  return [...new Set(ids)];
}

/** The admin app's own pages; the storefront picks the change up on its 60-second cache. */
function zonePaths(zoneId?: string): void {
  revalidatePath('/admin/zones');
  if (zoneId) revalidatePath(`/admin/zones/${zoneId}`);
}

export async function saveZoneAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const editing = formText(formData, 'zoneId') !== '';
  const zoneId = idOf(formData, 'zoneId');
  if (editing && zoneId === undefined) return PAGE_EXPIRED;

  const values = {
    name: formText(formData, 'name'),
    slug: formText(formData, 'slug').trim().toLowerCase(),
    description: formText(formData, 'description'),
    audience: formText(formData, 'audience').trim().toLowerCase(),
    displayOrder: formText(formData, 'displayOrder'),
    seoTitle: formText(formData, 'seoTitle'),
    seoDescription: formText(formData, 'seoDescription'),
  };
  const parsed = adminSaveShoppingZoneRequestSchema.safeParse({
    name: values.name,
    slug: optional(values.slug),
    description: optional(values.description),
    audience: optional(values.audience),
    displayOrder: values.displayOrder.trim() === '' ? 0 : Number(values.displayOrder),
    isActive: formData.get('isActive') === 'on',
    seoTitle: optional(values.seoTitle),
    seoDescription: optional(values.seoDescription),
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
    (api, token) => api.adminSaveZone(token, zoneId ?? null, parsed.data),
    {
      returnTo: zoneId ? zonePath(zoneId) : '/admin/zones',
      label: 'zone save',
      messages: ZONE_MESSAGES,
    },
  );
  if (!result.ok) return { ...result.state, values };
  zonePaths(zoneId);
  if (zoneId === undefined) redirect(`/admin/zones/${result.value.zone.id}`);
  return { status: 'success', message: 'Saved.' };
}

export async function setZoneActiveAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const zoneId = idOf(formData, 'zoneId');
  if (zoneId === undefined) return PAGE_EXPIRED;
  const isActive = formText(formData, 'isActive') === 'true';
  const result = await adminAct(
    formData,
    (api, token) => api.adminSetZoneActive(token, zoneId, isActive),
    { returnTo: '/admin/zones', label: 'zone active toggle', messages: ZONE_MESSAGES },
  );
  if (!result.ok) return result.state;
  zonePaths(zoneId);
  return { status: 'success', message: isActive ? 'Zone shown in the store.' : 'Zone hidden.' };
}

export async function setZoneProductsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const zoneId = idOf(formData, 'zoneId');
  if (zoneId === undefined) return PAGE_EXPIRED;
  const productIds = idsOf(formData, 'productIds');
  const result = await adminAct(
    formData,
    (api, token) => api.adminSetZoneProducts(token, zoneId, productIds),
    { returnTo: zonePath(zoneId), label: 'zone products', messages: ZONE_MESSAGES },
  );
  if (!result.ok) return result.state;
  zonePaths(zoneId);
  return {
    status: 'success',
    message:
      productIds.length === 0
        ? 'No products pinned. Every product now follows its category.'
        : `${String(result.value.kept)} ${result.value.kept === 1 ? 'product' : 'products'} pinned to this zone.`,
  };
}

export async function setZoneCategoriesAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const zoneId = idOf(formData, 'zoneId');
  if (zoneId === undefined) return PAGE_EXPIRED;
  const categoryIds = idsOf(formData, 'categoryIds');
  const result = await adminAct(
    formData,
    (api, token) => api.adminSetZoneCategories(token, zoneId, categoryIds),
    { returnTo: zonePath(zoneId), label: 'zone categories', messages: ZONE_MESSAGES },
  );
  if (!result.ok) return result.state;
  zonePaths(zoneId);
  return {
    status: 'success',
    message:
      categoryIds.length === 0
        ? 'No categories inherited. Only pinned products appear here now.'
        : `${String(result.value.kept)} ${result.value.kept === 1 ? 'category' : 'categories'} feeding this zone.`,
  };
}

export async function uploadZoneBannerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const zoneId = idOf(formData, 'zoneId');
  if (zoneId === undefined) return PAGE_EXPIRED;
  const file = await checkImageFile(formData.get('image'));
  if (!file.ok) return invalid(file.message, { image: file.message });
  const alt = optional(formText(formData, 'bannerAlt'));
  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminUploadZoneBanner(token, zoneId, {
        bytes: file.bytes,
        contentType: file.contentType,
        ...(alt === undefined ? {} : { alt }),
      }),
    { returnTo: zonePath(zoneId), label: 'zone banner upload', messages: ZONE_MESSAGES },
  );
  if (!result.ok) return result.state;
  zonePaths(zoneId);
  return { status: 'success', message: 'Picture updated.' };
}

export async function removeZoneBannerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const zoneId = idOf(formData, 'zoneId');
  if (zoneId === undefined) return PAGE_EXPIRED;
  const result = await adminAct(
    formData,
    (api, token) => api.adminRemoveZoneBanner(token, zoneId),
    {
      returnTo: zonePath(zoneId),
      label: 'zone banner removal',
      messages: ZONE_MESSAGES,
    },
  );
  if (!result.ok) return result.state;
  zonePaths(zoneId);
  return { status: 'success', message: 'Picture removed. The store draws its own tile now.' };
}

/** Replaces or removes the app's own artwork for a zone; the website's picture is untouched. */
export async function uploadZoneMobileBannerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const zoneId = idOf(formData, 'zoneId');
  if (zoneId === undefined) return PAGE_EXPIRED;
  const file = await checkImageFile(formData.get('image'));
  if (!file.ok) return invalid(file.message, { image: file.message });
  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminUploadZoneMobileBanner(token, zoneId, {
        bytes: file.bytes,
        contentType: file.contentType,
      }),
    { returnTo: zonePath(zoneId), label: 'zone app artwork upload', messages: ZONE_MESSAGES },
  );
  if (!result.ok) return result.state;
  zonePaths(zoneId);
  return { status: 'success', message: 'App artwork updated. The website picture is unchanged.' };
}

export async function removeZoneMobileBannerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const zoneId = idOf(formData, 'zoneId');
  if (zoneId === undefined) return PAGE_EXPIRED;
  const result = await adminAct(
    formData,
    (api, token) => api.adminRemoveZoneMobileBanner(token, zoneId),
    {
      returnTo: zonePath(zoneId),
      label: 'zone app artwork removal',
      messages: ZONE_MESSAGES,
    },
  );
  if (!result.ok) return result.state;
  zonePaths(zoneId);
  return {
    status: 'success',
    message:
      'App artwork removed. The app draws its own tile now; the website picture is unchanged.',
  };
}

export async function deleteZoneAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const zoneId = idOf(formData, 'zoneId');
  if (zoneId === undefined) return PAGE_EXPIRED;
  const result = await adminAct(formData, (api, token) => api.adminDeleteZone(token, zoneId), {
    returnTo: zonePath(zoneId),
    label: 'zone delete',
    messages: ZONE_MESSAGES,
  });
  if (!result.ok) return result.state;
  zonePaths(zoneId);
  redirect('/admin/zones');
}

/* -------------------------------------------------------------------------- */
/* Assignment from a product's or a category's own page                       */
/* -------------------------------------------------------------------------- */

const PRODUCT_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  not_found: 'This product no longer exists, or your account cannot see it.',
  ...ZONE_MESSAGES,
};

const CATEGORY_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  not_found: 'This category no longer exists, or your account cannot see it.',
  ...ZONE_MESSAGES,
};

/**
 * Pins a product to the zones chosen on its page, or hands it back to its category. The
 * "follow the category" choice sends an empty list, which is the same thing: the database
 * derives the product's zones from the category again.
 */
export async function setProductZonesAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = idOf(formData, 'productId');
  if (productId === undefined) return PAGE_EXPIRED;
  const inherit = formText(formData, 'mode') !== 'own';
  const zoneIds = inherit ? [] : idsOf(formData, 'zoneIds');
  if (!inherit && zoneIds.length === 0) {
    return {
      status: 'error',
      message: 'Choose at least one zone, or switch to “Follow the category”.',
    };
  }
  const result = await adminAct(
    formData,
    (api, token) => api.adminSetProductZones(token, productId, zoneIds),
    { returnTo: productPath(productId), label: 'product zones', messages: PRODUCT_MESSAGES },
  );
  if (!result.ok) return result.state;
  revalidatePath(productPath(productId));
  revalidatePath('/admin/products');
  return {
    status: 'success',
    message: inherit
      ? 'The product follows its category again.'
      : `Pinned to ${String(result.value.kept)} ${result.value.kept === 1 ? 'zone' : 'zones'}.`,
  };
}

/** Sets the zones a category feeds to the products that have no zones of their own. */
export async function setCategoryZonesAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const categoryId = idOf(formData, 'categoryId');
  if (categoryId === undefined) return PAGE_EXPIRED;
  const zoneIds = idsOf(formData, 'zoneIds');
  const result = await adminAct(
    formData,
    (api, token) => api.adminSetCategoryZones(token, categoryId, zoneIds),
    {
      returnTo: categoryPath(categoryId),
      label: 'category zones',
      messages: CATEGORY_MESSAGES,
    },
  );
  if (!result.ok) return result.state;
  revalidatePath(categoryPath(categoryId));
  revalidatePath('/admin/categories');
  return {
    status: 'success',
    message:
      zoneIds.length === 0
        ? 'The category no longer feeds a collection.'
        : `${String(result.value.kept)} ${result.value.kept === 1 ? 'zone' : 'zones'} receive this category’s products.`,
  };
}
