'use server';

import {
  adminCategoryRefSchema,
  categoryInputSchema,
  categoryReorderSchema,
  PRODUCT_STATUSES,
  stockAdjustmentRequestSchema,
  updateProductRequestSchema,
  type AdminCategory,
  type AdminProductDetail,
  type CategoryInput,
  type ProductStatus,
  type UpdateProductRequest,
} from '@nilzora/contracts';
import {
  ApiError,
  FORM_EXPIRED,
  type FormState,
  type SessionAct,
  type SessionCall,
} from '@nilzora/web-session';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  apiFieldErrors,
  fieldChecked,
  fieldErrorsFrom,
  fieldText,
  slugify,
  wholeNumber,
  type FieldErrors,
  type FormValues,
} from '@/components/catalog/form-values';
import type { CategoryNotice, ProductNotice } from '@/components/catalog/notices';
import {
  checkCreateProduct,
  checkSection,
  withDerivedSlug,
  CREATE_FIELDS,
  OPTIONAL_SECTION_FIELDS,
  PRODUCT_FIELD_MESSAGES,
  PRODUCT_RENAMES,
  PRODUCT_SECTIONS,
  SECTION_FIELDS,
  type ProductSection,
} from '@/components/catalog/product-validation';
import { RESPOND_AS_STATE } from '@/lib/upload-routes';
import { session } from './session';
import { signInPath } from './workspace-access';

/*
 * Catalog Server Actions. Server Actions are public POST endpoints: each one checks the
 * Origin and CSRF token (session.act) before any API call, reads only the fields it
 * expects, validates them with the shared contract (so mistakes come back as field
 * messages) and lets the API authorise and validate again. Only fixed messages return
 * to the browser. Successes redirect back with `?notice=`, so the page re-reads the
 * saved state with or without JavaScript. redirect() throws, so it is never called
 * inside try/catch.
 */

const CHECK_FIELDS = 'Check the highlighted fields.';
const UNAVAILABLE = 'Nilzora could not be reached. Please try again in a moment.';
const PAGE_EXPIRED = 'This page is out of date. Reload it and try again.';
const PRODUCT_GONE = 'This product no longer exists. Reload the page to see the current list.';
const OPERATIONS_FORBIDDEN =
  'Your account cannot change this. On a product that is on sale, the price, former price, order limit and featuring need the “Publish products” permission.';
const CATEGORY_GONE = 'This category no longer exists. Reload the page to see the current list.';

/** Messages for the API's refusals; anything unknown gets the action's own fallback. */
const MESSAGES: Partial<Record<string, string>> = {
  forbidden: 'Your account does not have permission to do this. Ask an admin if you need it.',
  account_suspended: 'This account is suspended, so it cannot change the catalog.',
  rate_limited: 'Too many changes in a short time. Wait a minute, then try again.',
  bad_request: 'Choose an existing category and values within the allowed ranges.',
  product_content_locked:
    'This product is on sale, so its content cannot change. Unpublish it first, then edit and resubmit it.',
  product_under_review:
    'The content is under review, so it cannot change. Withdraw the review first if you need to edit it.',
  product_not_approved:
    'Only products with approved content can be published. Submit the content for review first.',
  review_closed: 'This review is already closed. Reload the page to see its outcome.',
};

/** Field-level refusals: the field to mark and its message. */
const FIELD_REFUSALS: Partial<Record<string, { field: string; message: string }>> = {
  slug_taken: { field: 'slug', message: 'Another item already uses this address. Choose another.' },
  sku_taken: { field: 'sku', message: 'Another product already uses this SKU. Choose another.' },
  stock_below_zero: {
    field: 'quantity',
    message: 'That would leave less than zero units. Remove at most the units in stock.',
  },
};

const CATEGORY_FIELD_MESSAGES: FieldErrors = {
  name: 'Enter the category name in 80 characters or fewer.',
  slug: 'Use lower-case letters, digits and single hyphens, e.g. home-kitchen.',
  description: 'Keep the description under 500 characters.',
  sortOrder: 'Enter a whole number; lower numbers are listed first.',
};

const STOCK_FIELD_MESSAGES: FieldErrors = {
  quantity: 'Enter a whole number of units from 1 to 10,00,000.',
  note: 'Give a reason of 3 to 300 characters, e.g. “Received from supplier”.',
};

function logFailure(action: string, error: unknown): void {
  if (error instanceof ApiError) {
    console.error(`[nilzora] ${action} failed`, {
      code: error.code,
      status: error.status,
      requestId: error.requestId,
    });
  } else {
    console.error(`[nilzora] ${action} failed unexpectedly`);
  }
}

interface FailureOptions {
  values?: FormValues;
  /** Message for refusals without one of their own. */
  fallback: string;
  /** The form's fields, for the API's validation issues. */
  fields?: readonly string[];
  messages?: FieldErrors;
  renames?: Readonly<Record<string, string>>;
  /** Messages that replace the shared ones for this action. */
  overrides?: Partial<Record<string, string>>;
  /** For changes that are not idempotent: what to do when the outcome is unknown. */
  unavailable?: string;
}

/** Maps a failed call to a fixed message; nothing from the API's text is shown. */
function failureState(action: string, error: unknown, options: FailureOptions): FormState {
  const { values, fallback } = options;
  if (
    !(error instanceof ApiError) ||
    error.status === 0 ||
    error.status >= 500 ||
    error.code === 'invalid_response'
  ) {
    logFailure(action, error);
    return { status: 'error', message: options.unavailable ?? UNAVAILABLE, values };
  }
  if (error.code === 'validation_failed') {
    const fieldErrors = apiFieldErrors(
      error.details,
      options.fields ?? [],
      options.messages ?? {},
      options.renames,
    );
    if (Object.keys(fieldErrors).length > 0) {
      return { status: 'error', message: CHECK_FIELDS, fieldErrors, values };
    }
  }
  if (error.code === 'not_found') {
    return { status: 'error', message: options.overrides?.not_found ?? PRODUCT_GONE, values };
  }
  const refusal = FIELD_REFUSALS[error.code];
  if (refusal && (options.fields ?? []).includes(refusal.field)) {
    return {
      status: 'error',
      message: CHECK_FIELDS,
      fieldErrors: { [refusal.field]: refusal.message },
      values,
    };
  }
  const message = options.overrides?.[error.code] ?? MESSAGES[error.code];
  if (message === undefined) logFailure(action, error);
  return { status: 'error', message: message ?? fallback, values };
}

/** Runs an authenticated call, keeping a thrown error as a value for mapping. */
async function attempt<T>(
  formData: FormData,
  call: SessionCall<T>,
): Promise<{ result: SessionAct<T> } | { error: unknown }> {
  return session.act(formData, call).then(
    (result) => ({ result }),
    (error: unknown) => ({ error }),
  );
}

/** A record id from a hidden field, or undefined when it is not a uuid. */
function idFrom(formData: FormData, name: string): string | undefined {
  const parsed = adminCategoryRefSchema.shape.id.safeParse(fieldText(formData, name));
  return parsed.success ? parsed.data : undefined;
}

function productPath(productId: string): Route {
  return `/admin/products/${productId}` as Route;
}

/** The product's pages and the lists and summaries that show it. */
function revalidateProduct(productId: string): void {
  revalidatePath('/admin/products');
  revalidatePath(productPath(productId));
  revalidatePath('/admin/inventory');
  revalidatePath('/admin');
}

function revalidateCategories(): void {
  revalidatePath('/admin/categories');
  revalidatePath('/admin/products');
}

/**
 * The product list to return to after a change made from it: only the list's own path
 * with plain query parameters, never another page or site (the value comes from the form).
 */
function listReturnPath(value: string): string | undefined {
  return /^\/admin\/products(\?[A-Za-z0-9_.~%=&+-]*)?$/.test(value) && !value.includes('notice=')
    ? value
    : undefined;
}

function backToProduct(productId: string, notice: ProductNotice): never {
  redirect(`${productPath(productId)}?notice=${notice}` as Route);
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/**
 * The fields a form sent, as text. Optional fields (tags, size chart) are read only when
 * the form carries them, so a form without them never clears what the product has.
 */
function valuesOf(
  formData: FormData,
  fields: readonly string[],
  optional: readonly string[] = [],
): FormValues {
  const values: FormValues = {};
  for (const field of fields) {
    values[field] =
      field === 'isFeatured'
        ? fieldChecked(formData, field)
          ? 'on'
          : ''
        : fieldText(formData, field);
  }
  for (const field of optional) {
    if (formData.has(field)) values[field] = fieldText(formData, field);
  }
  return values;
}

function invalid(errors: FieldErrors, values: FormValues): FormState {
  return { status: 'error', message: CHECK_FIELDS, fieldErrors: errors, values };
}

/** Optional create-form fields: only read when the form shows them. */
const CREATE_OPTIONAL = [...OPTIONAL_SECTION_FIELDS.content, ...OPTIONAL_SECTION_FIELDS.ordering];

/** Creates a draft product (with its opening stock) and opens it. */
export async function createProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = valuesOf(formData, CREATE_FIELDS, CREATE_OPTIONAL);
  const checked = checkCreateProduct(values);
  if (!checked.ok) return invalid(checked.errors, values);
  const body = checked.value;

  const outcome = await attempt(formData, (api, token) => api.adminCreateProduct(token, body));
  if ('error' in outcome) {
    return failureState('product create', outcome.error, {
      values,
      fallback: 'The product could not be created. Please try again.',
      fields: [...CREATE_FIELDS, ...CREATE_OPTIONAL],
      messages: PRODUCT_FIELD_MESSAGES,
      renames: PRODUCT_RENAMES,
      // Creating twice would make two drafts: check the list before retrying.
      unavailable:
        'Nilzora could not confirm the product was created. Check the product list before trying again.',
    });
  }
  const { result } = outcome;
  if (result.kind === 'untrusted') return { ...FORM_EXPIRED, values };
  if (result.kind === 'signed_out') redirect(signInPath('/admin/products/new'));
  if (result.kind === 'unavailable') return { status: 'error', message: UNAVAILABLE, values };

  const { id } = result.value.product;
  revalidateProduct(id);
  backToProduct(id, 'created');
}

/**
 * Every editable field as the product has it now, as the full replacement PUT expects.
 * Tags and the size chart are left out: the API keeps them unless a form sends them.
 */
function replacementOf(product: AdminProductDetail): UpdateProductRequest {
  return {
    categoryId: product.category.id,
    slug: product.slug,
    name: product.name,
    summary: product.summary,
    description: product.description,
    priceMinor: product.priceMinor,
    compareAtPriceMinor: product.compareAtPriceMinor,
    maxOrderQuantity: product.maxOrderQuantity,
    isFeatured: product.isFeatured,
  };
}

/**
 * The sections a form saves: one or more `section` fields naming known sections, each
 * once. Anything else means a tampered or outdated form.
 */
function sectionsFrom(formData: FormData): ProductSection[] | undefined {
  const named = formData.getAll('section').map((value) => (typeof value === 'string' ? value : ''));
  if (named.length === 0) return undefined;
  const sections = PRODUCT_SECTIONS.filter((section) => named.includes(section));
  if (sections.length !== new Set(named).size || sections.length !== named.length) return undefined;
  return sections;
}

/**
 * Saves the sections of a product a form shows (content, pricing, ordering; one, some or
 * all of them). The API replaces every field, so the rest is read from the API, never
 * from the form; the database refuses content changes while the product is on sale or
 * under review, and price, limit, featuring and tags changes on a product on sale
 * without products.publish.
 */
export async function updateProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const productId = idFrom(formData, 'productId');
  const sections = sectionsFrom(formData);
  if (productId === undefined || sections === undefined) {
    return { status: 'error', message: PAGE_EXPIRED };
  }
  const fields = sections.flatMap((section) => [
    ...SECTION_FIELDS[section],
    ...OPTIONAL_SECTION_FIELDS[section],
  ]);
  const values = valuesOf(
    formData,
    sections.flatMap((section) => SECTION_FIELDS[section]),
    sections.flatMap((section) => OPTIONAL_SECTION_FIELDS[section]),
  );
  const errors: FieldErrors = {};
  let changes: Partial<UpdateProductRequest> = {};
  for (const section of sections) {
    const checked = checkSection(section, values);
    if (checked.ok) changes = { ...changes, ...checked.value };
    else Object.assign(errors, checked.errors);
  }
  if (Object.keys(errors).length > 0) return invalid(errors, values);

  const outcome = await attempt(formData, async (api, token) => {
    const { product } = await api.adminGetProduct(token, productId);
    const parsed = updateProductRequestSchema.safeParse({ ...replacementOf(product), ...changes });
    if (!parsed.success) return { errors: parsed.error.issues };
    await api.adminUpdateProduct(token, productId, parsed.data);
    return { errors: null };
  });
  if ('error' in outcome) {
    return failureState('product update', outcome.error, {
      values,
      fallback: 'The changes could not be saved. Please try again.',
      fields,
      messages: PRODUCT_FIELD_MESSAGES,
      renames: PRODUCT_RENAMES,
      // On a product on sale these fields also need products.publish (checked by the database).
      ...(sections.length === 1 && sections[0] === 'content'
        ? {}
        : { overrides: { forbidden: OPERATIONS_FORBIDDEN } }),
    });
  }
  const { result } = outcome;
  if (result.kind === 'untrusted') return { ...FORM_EXPIRED, values };
  if (result.kind === 'signed_out') redirect(signInPath(productPath(productId)));
  if (result.kind === 'unavailable') return { status: 'error', message: UNAVAILABLE, values };
  if (result.value.errors) {
    const found = fieldErrorsFrom(result.value.errors, PRODUCT_FIELD_MESSAGES, PRODUCT_RENAMES);
    // A problem outside these sections (e.g. the saved price is now below a new former price).
    const own = Object.fromEntries(
      Object.entries(found).filter(([field]) => fields.includes(field)),
    );
    if (Object.keys(own).length === 0) {
      return {
        status: 'error',
        message: 'These values do not fit the product’s other settings. Check its pricing.',
        values,
      };
    }
    return invalid(own, values);
  }

  revalidateProduct(productId);
  backToProduct(productId, sections.length === 1 && sections[0] ? sections[0] : 'saved');
}

/** Adds or removes stock with a reason; the change is recorded in the stock ledger. */
export async function adjustStockAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const productId = idFrom(formData, 'productId');
  if (productId === undefined) return { status: 'error', message: PAGE_EXPIRED };
  const values: FormValues = {
    direction: fieldText(formData, 'direction') === 'remove' ? 'remove' : 'add',
    quantity: fieldText(formData, 'quantity'),
    note: fieldText(formData, 'note'),
  };

  const errors: FieldErrors = {};
  const quantity = wholeNumber(values.quantity ?? '');
  if (quantity === undefined || quantity < 1) errors.quantity = STOCK_FIELD_MESSAGES.quantity;
  const parsed = stockAdjustmentRequestSchema.safeParse({
    change: (values.direction === 'remove' ? -1 : 1) * (quantity ?? 0),
    note: values.note,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] === 'note' ? 'note' : 'quantity';
      errors[field] ??= STOCK_FIELD_MESSAGES[field];
    }
  }
  if (!parsed.success || Object.keys(errors).length > 0) return invalid(errors, values);

  const outcome = await attempt(formData, (api, token) =>
    api.adminAdjustStock(token, productId, parsed.data),
  );
  if ('error' in outcome) {
    return failureState('stock adjustment', outcome.error, {
      values,
      fallback: 'The stock could not be adjusted. Please try again.',
      fields: ['quantity', 'note'],
      messages: STOCK_FIELD_MESSAGES,
      renames: { change: 'quantity' },
      // Not idempotent: a lost answer may hide a saved change.
      unavailable:
        'Nilzora could not confirm the change. Reload the page and check the stock and its recent movements before trying again.',
    });
  }
  const { result } = outcome;
  if (result.kind === 'untrusted') return { ...FORM_EXPIRED, values };
  if (result.kind === 'signed_out') redirect(signInPath(productPath(productId)));
  if (result.kind === 'unavailable') return { status: 'error', message: UNAVAILABLE, values };

  revalidateProduct(productId);
  backToProduct(productId, 'stock');
}

/** Sends a draft's content for review; an assigner then hands it to a moderator. */
export async function submitForReviewAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const productId = idFrom(formData, 'productId');
  if (productId === undefined) return { status: 'error', message: PAGE_EXPIRED };

  const outcome = await attempt(formData, (api, token) => api.adminSubmitProduct(token, productId));
  if ('error' in outcome) {
    return failureState('review submission', outcome.error, {
      fallback: 'The product could not be submitted. Please try again.',
      overrides: {
        product_content_locked:
          'Only draft products can be submitted. Unpublish or restore the product first.',
        product_under_review: 'This product is already under review or approved.',
      },
    });
  }
  const { result } = outcome;
  if (result.kind === 'untrusted') return FORM_EXPIRED;
  if (result.kind === 'signed_out') redirect(signInPath(productPath(productId)));
  if (result.kind === 'unavailable') return { status: 'error', message: UNAVAILABLE };

  revalidateProduct(productId);
  revalidatePath('/admin/moderation');
  backToProduct(productId, 'submitted');
}

/**
 * Withdraws the product's pending review. The review is the product's latest one as
 * the API reports it now; a task id in the form is never trusted.
 */
export async function withdrawReviewAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const productId = idFrom(formData, 'productId');
  if (productId === undefined) return { status: 'error', message: PAGE_EXPIRED };

  const outcome = await attempt(formData, async (api, token) => {
    const { product } = await api.adminGetProduct(token, productId);
    const review = product.latestReview;
    if (review?.status !== 'pending') return false;
    await api.adminWithdrawModeration(token, review.taskId);
    return true;
  });
  if ('error' in outcome) {
    return failureState('review withdrawal', outcome.error, {
      fallback: 'The review could not be withdrawn. Please try again.',
    });
  }
  const { result } = outcome;
  if (result.kind === 'untrusted') return FORM_EXPIRED;
  if (result.kind === 'signed_out') redirect(signInPath(productPath(productId)));
  if (result.kind === 'unavailable') return { status: 'error', message: UNAVAILABLE };
  if (!result.value) {
    return {
      status: 'error',
      message: 'There is no review in progress to withdraw. Reload the page to see its outcome.',
    };
  }

  revalidateProduct(productId);
  revalidatePath('/admin/moderation');
  backToProduct(productId, 'withdrawn');
}

const STATUS_NOTICES: Record<ProductStatus, ProductNotice> = {
  active: 'published',
  draft: 'unpublished',
  archived: 'archived',
};

/** Publishes, unpublishes, archives or restores a product (products.publish). */
export async function setProductStatusAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const productId = idFrom(formData, 'productId');
  const status = PRODUCT_STATUSES.find((value) => value === fieldText(formData, 'status'));
  if (productId === undefined || status === undefined) {
    return { status: 'error', message: PAGE_EXPIRED };
  }

  const outcome = await attempt(formData, async (api, token) => {
    const before = (await api.adminGetProduct(token, productId)).product.status;
    await api.adminSetProductStatus(token, productId, { status });
    return before;
  });
  if ('error' in outcome) {
    return failureState('product status change', outcome.error, {
      fallback: 'The product’s status could not be changed. Please try again.',
    });
  }
  const { result } = outcome;
  if (result.kind === 'untrusted') return FORM_EXPIRED;
  if (result.kind === 'signed_out') redirect(signInPath(productPath(productId)));
  if (result.kind === 'unavailable') return { status: 'error', message: UNAVAILABLE };

  revalidateProduct(productId);
  const notice: ProductNotice =
    status === 'draft' && result.value === 'archived' ? 'restored' : STATUS_NOTICES[status];
  const list = listReturnPath(fieldText(formData, 'returnTo'));
  if (list) {
    redirect(`${list}${list.includes('?') ? '&' : '?'}notice=${notice}` as Route);
  }
  backToProduct(productId, notice);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const CATEGORY_FIELDS = [
  'name',
  'slug',
  'description',
  'sortOrder',
  'isActive',
  'parentId',
  'isFeatured',
] as const;

function backToCategories(notice: CategoryNotice): never {
  redirect(`/admin/categories?notice=${notice}` as Route);
}

/** Every field of a category as it is now, as the full replacement PUT expects. */
function categoryReplacement(category: AdminCategory): CategoryInput {
  return {
    slug: category.slug,
    name: category.name,
    description: category.description,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    // The PUT replaces the placement too: left out, a subcategory would become a
    // top-level department and lose its featuring whenever it is shown or hidden.
    parentId: category.parentId,
    isFeatured: category.isFeatured,
  };
}

/**
 * Creates a category, or saves one when the form carries its categoryId. Visibility of
 * an existing category changes only through setCategoryActiveAction (with confirmation).
 */
export async function saveCategoryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const editing = fieldText(formData, 'categoryId') !== '';
  const categoryId = idFrom(formData, 'categoryId');
  if (editing && categoryId === undefined) return { status: 'error', message: PAGE_EXPIRED };

  const values = valuesOf(formData, CATEGORY_FIELDS);
  values.isActive = fieldChecked(formData, 'isActive') ? 'on' : '';
  values.isFeatured = fieldChecked(formData, 'isFeatured') ? 'on' : '';
  const errors: FieldErrors = {};
  const sortOrder =
    values.sortOrder === '' ? 0 : wholeNumber(values.sortOrder ?? '', { signed: true });
  if (sortOrder === undefined) errors.sortOrder = CATEGORY_FIELD_MESSAGES.sortOrder;

  const parentId = (values.parentId ?? '').trim();
  if (parentId !== '' && parentId === categoryId) {
    errors.parentId = 'A category cannot be its own parent';
  }

  const input = {
    slug: values.slug || slugify(values.name ?? '', 80),
    name: values.name,
    description: values.description,
    sortOrder: sortOrder ?? 0,
    isActive: values.isActive === 'on',
    parentId: parentId === '' ? null : parentId,
    isFeatured: values.isFeatured === 'on',
  };
  const parsed = categoryInputSchema.safeParse(input);
  if (!parsed.success || Object.keys(errors).length > 0) {
    const contractErrors = parsed.success
      ? {}
      : fieldErrorsFrom(parsed.error.issues, CATEGORY_FIELD_MESSAGES);
    return invalid(withDerivedSlug({ ...contractErrors, ...errors }, values), values);
  }
  const body = parsed.data;

  const outcome = await attempt(formData, async (api, token) => {
    if (categoryId === undefined) return (await api.adminCreateCategory(token, body)).category;
    const { categories } = await api.adminListCategories(token);
    const current = categories.find((category) => category.id === categoryId);
    if (!current) return null;
    // The visibility stays as it is: hiding a category is confirmed separately.
    return (
      await api.adminUpdateCategory(token, categoryId, { ...body, isActive: current.isActive })
    ).category;
  });
  const failure = {
    values,
    fallback: 'The category could not be saved. Please try again.',
    fields: CATEGORY_FIELDS,
    messages: CATEGORY_FIELD_MESSAGES,
    overrides: { not_found: CATEGORY_GONE },
  };
  if ('error' in outcome) return failureState('category save', outcome.error, failure);
  const { result } = outcome;
  if (result.kind === 'untrusted') return { ...FORM_EXPIRED, values };
  if (result.kind === 'signed_out') {
    redirect(
      signInPath(
        categoryId === undefined ? '/admin/categories/new' : `/admin/categories/${categoryId}`,
      ),
    );
  }
  if (result.kind === 'unavailable') return { status: 'error', message: UNAVAILABLE, values };
  if (result.value === null) return { status: 'error', message: CATEGORY_GONE, values };

  revalidateCategories();
  // The upload route (which reports real byte progress) wants an answer, not a redirect.
  if (formData.get(RESPOND_AS_STATE) === '1') {
    return {
      status: 'success',
      message: categoryId === undefined ? 'Category created.' : 'Category saved.',
      values: { categoryId: result.value.id },
    };
  }
  backToCategories(categoryId === undefined ? 'category-created' : 'category-saved');
}

/** Shows or hides a category in the storefront (with its products). */
const REORDER_STALE =
  'The categories changed since this page loaded. Reload it, then move the category again.';

/**
 * Moves one category a step earlier or later within its group (its siblings under the same
 * parent). The page sends the order it is showing; the new order is that list with one swap, and
 * the database refuses it unless it is exactly the group as it stands, so a stale page can never
 * scramble the order.
 */
export async function moveCategoryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const categoryId = idFrom(formData, 'categoryId');
  const direction = fieldText(formData, 'direction');
  const parentField = fieldText(formData, 'parentId');
  const parentId = parentField === '' ? null : idFrom(formData, 'parentId');
  if (
    categoryId === undefined ||
    (parentField !== '' && parentId === undefined) ||
    (direction !== 'earlier' && direction !== 'later')
  ) {
    return { status: 'error', message: PAGE_EXPIRED };
  }

  const order = fieldText(formData, 'order')
    .split(',')
    .filter((id) => id !== '');
  const index = order.indexOf(categoryId);
  const target = direction === 'earlier' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= order.length) {
    return { status: 'error', message: REORDER_STALE };
  }
  const moved = [...order];
  [moved[index], moved[target]] = [moved[target] as string, moved[index] as string];
  const parsed = categoryReorderSchema.safeParse({ parentId: parentId ?? null, ids: moved });
  if (!parsed.success) return { status: 'error', message: REORDER_STALE };

  const outcome = await attempt(formData, async (api, token) => {
    await api.adminReorderCategories(token, parsed.data);
    return true;
  });
  if ('error' in outcome) {
    return failureState('category reorder', outcome.error, {
      fallback: REORDER_STALE,
      overrides: { not_found: CATEGORY_GONE },
    });
  }
  const { result } = outcome;
  if (result.kind === 'untrusted') return FORM_EXPIRED;
  if (result.kind === 'signed_out') redirect(signInPath('/admin/categories'));
  if (result.kind === 'unavailable') return { status: 'error', message: UNAVAILABLE };

  revalidateCategories();
  backToCategories('category-reordered');
}

export async function setCategoryActiveAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const categoryId = idFrom(formData, 'categoryId');
  const active = fieldText(formData, 'active');
  if (categoryId === undefined || (active !== 'true' && active !== 'false')) {
    return { status: 'error', message: PAGE_EXPIRED };
  }
  const isActive = active === 'true';

  const outcome = await attempt(formData, async (api, token) => {
    const { categories } = await api.adminListCategories(token);
    const current = categories.find((category) => category.id === categoryId);
    if (!current) return null;
    if (current.isActive === isActive) return current;
    return (
      await api.adminUpdateCategory(token, categoryId, {
        ...categoryReplacement(current),
        isActive,
      })
    ).category;
  });
  if ('error' in outcome) {
    return failureState('category visibility change', outcome.error, {
      fallback: 'The category could not be changed. Please try again.',
      overrides: { not_found: CATEGORY_GONE },
    });
  }
  const { result } = outcome;
  if (result.kind === 'untrusted') return FORM_EXPIRED;
  if (result.kind === 'signed_out') redirect(signInPath('/admin/categories'));
  if (result.kind === 'unavailable') return { status: 'error', message: UNAVAILABLE };
  if (result.value === null) return { status: 'error', message: CATEGORY_GONE };

  revalidateCategories();
  backToCategories(isActive ? 'category-shown' : 'category-hidden');
}
