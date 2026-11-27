'use server';

import { reorderMenuRequestSchema, type ApiErrorCode } from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { adminAct, formText, invalid, type ActionState } from '@/components/admin-kit/act';
import {
  checkHomepage,
  checkMenuItem,
  checkSitePage,
  isMenuName,
  isSitePageSlug,
  moveId,
  rowsFromForm,
} from '@/components/content/content-rules';

/*
 * Static pages, navigation menus and the homepage's sections (settings.manage). The
 * database checks the permission and every rule again; these actions shape the request,
 * check it with the same contract schemas the forms use, and turn refusals into fixed
 * messages.
 */

const PAGES_PATH = '/admin/pages' as Route;
const MENUS_PATH = '/admin/navigation' as Route;
const HOMEPAGE_PATH = '/admin/homepage' as Route;

const PAGE_EXPIRED: ActionState = {
  status: 'error',
  message: 'This page is out of date. Reload it and try again.',
};

const CONTENT_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  not_found: 'That record no longer exists. Reload the page.',
  bad_request: 'Some of the details were refused. Check them and try again.',
  forbidden: 'Changing the storefront needs the “Manage store settings” permission.',
  rate_limited: 'Too many changes in a short time. Wait a moment, then try again.',
};

function idOf(formData: FormData, name: string): string | undefined {
  const parsed = uuidSchema.safeParse(formText(formData, name));
  return parsed.success ? parsed.data : undefined;
}

// ---------------------------------------------------------------------------
// Static pages
// ---------------------------------------------------------------------------

/** Saves one static page (title, text, published state, search metadata). */
export async function saveSitePageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const slug = formText(formData, 'slug');
  if (!isSitePageSlug(slug)) return PAGE_EXPIRED;

  const published = formText(formData, 'isPublished') === 'on';
  const values = {
    title: formText(formData, 'title'),
    // Read raw: the text keeps its own spacing.
    body: formText(formData, 'body'),
    seoTitle: formText(formData, 'seoTitle'),
    seoDescription: formText(formData, 'seoDescription'),
    isPublished: published ? 'on' : '',
  };
  const checked = checkSitePage(values, published);
  if (!checked.ok) return invalid('Check the highlighted fields.', checked.errors, values);

  const path = `/admin/pages/${slug}` as Route;
  const result = await adminAct(
    formData,
    (api, token) => api.adminSaveSitePage(token, slug, checked.value),
    { returnTo: path, label: 'site page save', messages: CONTENT_MESSAGES },
  );
  if (!result.ok) return { ...result.state, values };

  revalidatePath(PAGES_PATH);
  revalidatePath(path);
  return {
    status: 'success',
    message: published
      ? 'Page saved and published. Visitors see it now.'
      : 'Draft saved. Visitors do not see it until it is published.',
  };
}

// ---------------------------------------------------------------------------
// Navigation menus
// ---------------------------------------------------------------------------

/** Adds a link to a menu, or saves one when the form carries its id. */
export async function saveMenuItemAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const editing = formText(formData, 'itemId') !== '';
  const itemId = idOf(formData, 'itemId');
  if (editing && itemId === undefined) return PAGE_EXPIRED;

  const active = formText(formData, 'isActive') === 'on';
  const values = {
    menu: formText(formData, 'menu'),
    label: formText(formData, 'label'),
    href: formText(formData, 'href'),
  };
  const checked = checkMenuItem(values, active);
  if (!checked.ok) return invalid('Check the highlighted fields.', checked.errors, values);

  const result = await adminAct(
    formData,
    (api, token) =>
      itemId === undefined
        ? api.adminCreateMenuItem(token, checked.value)
        : api.adminUpdateMenuItem(token, itemId, checked.value),
    {
      returnTo: MENUS_PATH,
      label: 'menu link save',
      messages: {
        ...CONTENT_MESSAGES,
        bad_request: 'Check the label and the link. A menu holds at most 12 links.',
      },
    },
  );
  if (!result.ok) return { ...result.state, values };

  revalidatePath(MENUS_PATH);
  return { status: 'success', message: itemId === undefined ? 'Link added.' : 'Link saved.' };
}

/** Removes a link from its menu. */
export async function deleteMenuItemAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const itemId = idOf(formData, 'itemId');
  if (itemId === undefined) return PAGE_EXPIRED;
  const result = await adminAct(formData, (api, token) => api.adminDeleteMenuItem(token, itemId), {
    returnTo: MENUS_PATH,
    label: 'menu link delete',
    messages: CONTENT_MESSAGES,
  });
  if (!result.ok) return result.state;
  revalidatePath(MENUS_PATH);
  return { status: 'success', message: 'Link removed.' };
}

/**
 * Moves one link a place earlier or later in its menu. The form carries the order it was
 * rendered with (`order`, every link of the menu); the API refuses it if the menu has
 * changed since.
 */
export async function moveMenuItemAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const itemId = idOf(formData, 'itemId');
  const menu = formText(formData, 'menu');
  const direction = formText(formData, 'direction');
  if (
    itemId === undefined ||
    !isMenuName(menu) ||
    (direction !== 'earlier' && direction !== 'later')
  ) {
    return PAGE_EXPIRED;
  }
  const order = formText(formData, 'order').split(',');
  const moved = moveId(order, itemId, direction);
  const parsed = moved ? reorderMenuRequestSchema.safeParse({ menu, ids: moved }) : undefined;
  if (!moved || !parsed?.success) {
    return {
      status: 'error',
      message: 'The menu changed since this page loaded. Reload it and try again.',
    };
  }

  const result = await adminAct(
    formData,
    (api, token) => api.adminReorderMenu(token, parsed.data),
    {
      returnTo: MENUS_PATH,
      label: 'menu order',
      messages: {
        ...CONTENT_MESSAGES,
        bad_request: 'The menu changed since this page loaded. Reload it and try again.',
      },
    },
  );
  if (!result.ok) return result.state;
  revalidatePath(MENUS_PATH);
  return { status: 'success', message: 'Order saved.' };
}

// ---------------------------------------------------------------------------
// Homepage sections
// ---------------------------------------------------------------------------

/** Saves every homepage section at once: which are on, their order, headings and limits. */
export async function saveHomepageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const rows = rowsFromForm(formData);
  const checked = checkHomepage(rows);
  const values: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (
      typeof value === 'string' &&
      /^(enabled|title|itemLimit|categorySlug|brandSlug|position)_/.test(name)
    ) {
      values[name] = value;
    }
  }
  if (!checked.ok) return invalid('Check the highlighted fields.', checked.errors, values);

  const result = await adminAct(
    formData,
    (api, token) => api.adminSaveHomepage(token, checked.value),
    {
      returnTo: HOMEPAGE_PATH,
      label: 'homepage save',
      messages: {
        ...CONTENT_MESSAGES,
        bad_request: 'The sections were refused. Check the headings, limits and filters.',
      },
    },
  );
  if (!result.ok) return { ...result.state, values };

  revalidatePath(HOMEPAGE_PATH);
  return {
    status: 'success',
    message: 'Homepage saved. The storefront shows the sections in this order.',
  };
}
