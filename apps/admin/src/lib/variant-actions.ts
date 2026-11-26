'use server';

import type { ApiErrorCode } from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { revalidatePath } from 'next/cache';
import type { Route } from 'next';
import {
  adminAct,
  formText,
  invalid,
  takaToMinor,
  type ActionState,
} from '@/components/admin-kit/act';
import { slugify } from '@/components/catalog/form-values';

/*
 * Attribute and variant changes. Everything here is shaped for the API to check again:
 * the database function is the authority on SKUs, combinations, prices and permissions,
 * so this module only turns form text into the request body.
 */

const ATTRIBUTES_PATH = '/admin/attributes' as Route;

const ATTRIBUTE_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  name_taken: 'Another attribute already uses that address or value.',
  not_found: 'This attribute no longer exists.',
  forbidden: 'Your account cannot change the catalogue.',
  rate_limited: 'Too many changes in a short time. Wait a moment, then try again.',
};

const VARIANT_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  variant_sku_taken: 'This SKU, or this combination of options, is already used.',
  variant_invalid: 'That variant no longer exists. Reload the page.',
  variant_required:
    'Every variant of this product needs a value for the same attributes as the others: choose one for each.',
  bad_request: 'Check the SKU, the price and the chosen options.',
  stock_below_zero: 'Stock cannot go below zero.',
  not_found: 'That variant no longer exists. Reload the page.',
  forbidden: 'Your account cannot change variants or stock.',
  rate_limited: 'Too many changes in a short time. Wait a moment, then try again.',
};

const PAGE_EXPIRED: ActionState = {
  status: 'error',
  message: 'This page is out of date. Reload it and try again.',
};

function idOf(formData: FormData, name: string): string | null | undefined {
  const text = formText(formData, name).trim();
  if (text === '') return null;
  const parsed = uuidSchema.safeParse(text);
  return parsed.success ? parsed.data : undefined;
}

function wholeNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : undefined;
}

/** What an attribute is; anything unrecognised keeps the safe 'other'. */
function attributeKindOf(formData: FormData): 'color' | 'size' | 'other' {
  const kind = formText(formData, 'kind').trim();
  return kind === 'color' || kind === 'size' ? kind : 'other';
}

const POSITION_MESSAGE = 'Enter a whole number from 0 to 999.';

/** The display position from the form: blank is 0; anything else must be 0 to 999. */
function positionOf(formData: FormData): number | undefined {
  const text = formText(formData, 'position').trim();
  if (text === '') return 0;
  const value = wholeNumber(text);
  return value !== undefined && value <= 999 ? value : undefined;
}

/** A signed whole number for a stock change (never zero). */
function signedNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value !== 0 ? value : undefined;
}

export async function saveAttributeAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const attributeId = idOf(formData, 'attributeId');
  if (attributeId === undefined)
    return invalid('Check the highlighted fields', { attributeId: 'Unknown attribute' });

  const name = formText(formData, 'name').trim();
  // A blank address is made from the name, as for products.
  const slug = formText(formData, 'slug').trim() || slugify(name, 40);
  if (name === '')
    return invalid('Check the highlighted fields', { name: 'Give the attribute a name' });
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return invalid('Check the highlighted fields', {
      slug: 'Use lower-case words joined by hyphens',
    });
  }
  const position = positionOf(formData);
  if (position === undefined) {
    return invalid('Check the highlighted fields', { position: POSITION_MESSAGE });
  }

  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminSaveAttribute(token, {
        attributeId,
        slug,
        name,
        position,
        isActive: formText(formData, 'isActive') === 'on',
        kind: attributeKindOf(formData),
      }),
    { returnTo: ATTRIBUTES_PATH, label: 'attribute save', messages: ATTRIBUTE_MESSAGES },
  );
  revalidatePath(ATTRIBUTES_PATH);
  if (!result.ok) return result.state;
  return { status: 'success', message: 'Attribute saved.' };
}

export async function saveAttributeValueAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const attributeId = idOf(formData, 'attributeId');
  const valueId = idOf(formData, 'valueId');
  if (!attributeId)
    return invalid('Check the highlighted fields', { attributeId: 'Choose an attribute' });
  if (valueId === undefined) return PAGE_EXPIRED;

  const value = formText(formData, 'value').trim();
  const slug = formText(formData, 'valueSlug').trim() || slugify(value, 40);
  if (value === '')
    return invalid('Check the highlighted fields', { value: 'Give the value a name' });
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return invalid('Check the highlighted fields', {
      valueSlug: 'Use lower-case words joined by hyphens',
    });
  }
  const position = positionOf(formData);
  if (position === undefined) {
    return invalid('Check the highlighted fields', { position: POSITION_MESSAGE });
  }

  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminSaveAttributeValue(token, {
        valueId,
        attributeId,
        slug,
        value,
        position,
        ...(formText(formData, 'swatchHex').trim() === ''
          ? {}
          : { swatchHex: formText(formData, 'swatchHex').trim() }),
      }),
    { returnTo: ATTRIBUTES_PATH, label: 'attribute value save', messages: ATTRIBUTE_MESSAGES },
  );
  revalidatePath(ATTRIBUTES_PATH);
  if (!result.ok) return result.state;
  return { status: 'success', message: 'Value saved.' };
}

function variantsPath(productId: string): Route {
  return `/admin/products/${productId}/variants` as Route;
}

/** The variants page and the product page, which summarises variants and their stock. */
function revalidateProduct(productId: string): void {
  revalidatePath(variantsPath(productId));
  revalidatePath(`/admin/products/${productId}` as Route);
}

export async function saveVariantAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = idOf(formData, 'productId');
  const variantId = idOf(formData, 'variantId');
  if (!productId) return invalid('Check the highlighted fields', { productId: 'Unknown product' });
  if (variantId === undefined) return PAGE_EXPIRED;

  const sku = formText(formData, 'sku').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{1,39}$/.test(sku)) {
    return invalid('Check the highlighted fields', {
      sku: 'Use capital letters, digits and hyphens',
    });
  }

  const priceText = formText(formData, 'price').trim();
  const priceMinor = priceText === '' ? null : takaToMinor(priceText);
  if (priceMinor === undefined)
    return invalid('Check the highlighted fields', { price: 'Enter a price in taka' });
  const compareText = formText(formData, 'compareAtPrice').trim();
  const compareAtPriceMinor = compareText === '' ? null : takaToMinor(compareText);
  if (compareAtPriceMinor === undefined) {
    return invalid('Check the highlighted fields', { compareAtPrice: 'Enter a price in taka' });
  }
  if (compareAtPriceMinor !== null && priceMinor === null) {
    return invalid('Check the highlighted fields', {
      compareAtPrice: 'Give the variant its own price to show a former price',
    });
  }
  if (compareAtPriceMinor !== null && priceMinor !== null && compareAtPriceMinor <= priceMinor) {
    return invalid('Check the highlighted fields', {
      compareAtPrice: 'The former price must be higher',
    });
  }

  const attributeValueIds = formData
    .getAll('attributeValueIds')
    .filter((value): value is string => typeof value === 'string')
    .map((value) => uuidSchema.safeParse(value))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);
  if (attributeValueIds.length === 0) {
    return invalid('Check the highlighted fields', {
      attributeValueIds: 'Choose one value per attribute',
    });
  }

  const position = wholeNumber(formText(formData, 'position')) ?? 0;
  const imageUrl = formText(formData, 'imageUrl').trim();

  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminSaveVariant(token, productId, {
        variantId,
        sku,
        priceMinor,
        compareAtPriceMinor,
        imageUrl: imageUrl === '' ? null : imageUrl,
        position,
        isActive: formText(formData, 'isActive') === 'on',
        attributeValueIds,
      }),
    { returnTo: variantsPath(productId), label: 'variant save', messages: VARIANT_MESSAGES },
  );
  revalidateProduct(productId);
  if (!result.ok) return result.state;
  return { status: 'success', message: 'Variant saved.' };
}

/** Puts a variant on sale or hides it from the storefront. */
export async function setVariantActiveAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = idOf(formData, 'productId');
  const variantId = idOf(formData, 'variantId');
  if (!productId || !variantId) return PAGE_EXPIRED;
  const isActive = formText(formData, 'isActive') === 'on';

  const result = await adminAct(
    formData,
    (api, token) => api.adminSetVariantActive(token, productId, variantId, isActive),
    { returnTo: variantsPath(productId), label: 'variant state', messages: VARIANT_MESSAGES },
  );
  if (!result.ok) return result.state;
  revalidateProduct(productId);
  return {
    status: 'success',
    message: isActive ? 'The variant is on sale.' : 'The variant is hidden.',
  };
}

const STOCK_CHANGE = 'Enter a whole number of units to add (e.g. 5) or remove (e.g. -2), not 0.';
const STOCK_AMOUNT = 'Enter a whole number of units, e.g. 5.';
const STOCK_NOTE = 'Give a reason of 3 to 300 characters, e.g. “Received from supplier”.';

/** How the number in the stock form is read; every mode writes the inventory ledger. */
const STOCK_MODES = ['add', 'remove', 'set', 'correction'] as const;
type StockMode = (typeof STOCK_MODES)[number];

function stockModeOf(formData: FormData): StockMode {
  const mode = formText(formData, 'mode').trim();
  return (STOCK_MODES as readonly string[]).includes(mode) ? (mode as StockMode) : 'correction';
}

/**
 * One stock form for the four actions an admin needs: add units, remove units, set an
 * exact count, or correct a count (a signed number with a required reason). The database
 * writes the ledger entry either way, so nothing rewrites history.
 */
export async function adjustVariantStockAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = idOf(formData, 'productId');
  const variantId = idOf(formData, 'variantId');
  if (!productId || !variantId) return PAGE_EXPIRED;
  const mode = stockModeOf(formData);
  const values = {
    change: formText(formData, 'change'),
    note: formText(formData, 'note'),
    mode,
  };
  const amount = wholeNumber(values.change);
  const note = values.note.trim();
  const errors: Record<string, string> = {};
  if (mode === 'correction') {
    const signed = signedNumber(values.change);
    if (signed === undefined || Math.abs(signed) > 1_000_000) errors.change = STOCK_CHANGE;
  } else if (amount === undefined || amount > 1_000_000) {
    errors.change = STOCK_AMOUNT;
  }
  if (note.length < 3 || note.length > 300) errors.note = STOCK_NOTE;
  const change = mode === 'correction' ? signedNumber(values.change) : amount;
  if (change === undefined || Object.keys(errors).length > 0) {
    return invalid('Check the highlighted fields', errors, values);
  }

  const signedChange =
    mode === 'remove' || (mode === 'correction' && change < 0) ? -Math.abs(change) : change;

  const result = await adminAct(
    formData,
    (api, token) =>
      mode === 'set'
        ? api.adminSetVariantStock(token, productId, variantId, { stock: amount ?? 0, note })
        : api.adminAdjustVariantStock(token, productId, variantId, {
            change: signedChange,
            note,
          }),
    {
      returnTo: variantsPath(productId),
      label: 'variant stock',
      messages: {
        ...VARIANT_MESSAGES,
        // Not idempotent: a lost answer may hide a saved change.
        service_unavailable:
          'Nilzora could not confirm the change. Reload the page and check the stock before trying again.',
      },
    },
  );
  if (!result.ok) return { ...result.state, values };
  revalidateProduct(productId);
  revalidatePath('/admin/inventory');
  const done: Record<StockMode, string> = {
    add: 'Stock added and recorded in the ledger.',
    remove: 'Stock removed and recorded in the ledger.',
    set: 'Stock set and recorded in the ledger.',
    correction: 'Stock corrected and recorded in the ledger.',
  };
  return { status: 'success', message: done[mode] };
}

/**
 * Adds or removes the same number of units for every variant of one value — every size of
 * one colour, say. Each variant is one ledger entry through the same API call, so the
 * database validates the permission and the resulting count for each.
 */
export async function bulkVariantStockAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = idOf(formData, 'productId');
  if (!productId) return PAGE_EXPIRED;
  const valueId = idOf(formData, 'valueId');
  if (!valueId) {
    return invalid('Choose the value whose variants change', {
      valueId: 'Choose a value, such as one colour',
    });
  }
  const mode = formText(formData, 'mode').trim() === 'remove' ? 'remove' : 'add';
  const values = { change: formText(formData, 'change'), note: formText(formData, 'note'), mode };
  const amount = wholeNumber(values.change);
  const note = values.note.trim();
  const errors: Record<string, string> = {};
  if (amount === undefined || amount < 1 || amount > 1_000_000) errors.change = STOCK_AMOUNT;
  if (note.length < 3 || note.length > 300) errors.note = STOCK_NOTE;
  if (amount === undefined || Object.keys(errors).length > 0) {
    return invalid('Check the highlighted fields', errors, values);
  }

  const result = await adminAct(
    formData,
    async (api, token) => {
      const { variants } = await api.adminProductVariants(token, productId);
      const targets = variants.filter((variant) => variant.attributeValueIds.includes(valueId));
      if (targets.length === 0) return { updated: 0, failed: [] as string[] };
      const change = mode === 'remove' ? -amount : amount;
      const failed: string[] = [];
      for (const variant of targets) {
        try {
          await api.adminAdjustVariantStock(token, productId, variant.id, { change, note });
        } catch {
          failed.push(variant.sku);
        }
      }
      return { updated: targets.length - failed.length, failed };
    },
    {
      returnTo: variantsPath(productId),
      label: 'bulk variant stock',
      messages: {
        ...VARIANT_MESSAGES,
        service_unavailable:
          'Nilzora could not confirm the change. Reload the page and check the stock before trying again.',
      },
    },
  );
  if (!result.ok) return { ...result.state, values };
  revalidateProduct(productId);
  revalidatePath('/admin/inventory');
  const { updated, failed } = result.value;
  if (failed.length > 0) {
    return {
      status: 'error',
      message: `${String(updated)} updated. Not updated (their stock would go below zero): ${failed.join(', ')}.`,
    };
  }
  if (updated === 0) {
    return { status: 'error', message: 'No variant uses that value.' };
  }
  return {
    status: 'success',
    message: `${mode === 'remove' ? 'Removed from' : 'Added to'} ${String(updated)} variant${updated === 1 ? '' : 's'}. Every change is in the ledger.`,
  };
}

/** Deletes a variant (products.publish); past orders keep their own snapshot. */
export async function deleteVariantAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = idOf(formData, 'productId');
  const variantId = idOf(formData, 'variantId');
  if (!productId || !variantId) return PAGE_EXPIRED;

  const result = await adminAct(
    formData,
    (api, token) => api.adminDeleteVariant(token, productId, variantId),
    {
      returnTo: variantsPath(productId),
      label: 'variant delete',
      messages: {
        ...VARIANT_MESSAGES,
        forbidden: 'Deleting a variant needs the “Publish products” permission.',
      },
    },
  );
  if (!result.ok) return result.state;
  revalidateProduct(productId);
  return { status: 'success', message: 'Variant deleted.' };
}

/** The most variants one generation creates, so a slip of the mouse cannot flood a product. */
const MAX_GENERATED_VARIANTS = 60;

/**
 * Creates every combination of the chosen attribute values that the product does not sell
 * yet. The attributes and the existing variants are read again here (never trusted from
 * the form); each combination is saved through the same API call as a single variant, so
 * the database checks SKU uniqueness and value validity for every one. New variants
 * inherit the product's price and start with no stock: set either per variant afterwards.
 */
export async function generateVariantsAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = idOf(formData, 'productId');
  if (!productId) return PAGE_EXPIRED;
  const prefix = formText(formData, 'skuPrefix')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  if (!/^[A-Z0-9][A-Z0-9-]*$/.test(prefix)) {
    return invalid('Check the highlighted fields', {
      skuPrefix: 'Start the SKU with a letter or digit',
    });
  }
  const chosen = new Set(
    formData
      .getAll('generateValueIds')
      .filter((value): value is string => typeof value === 'string')
      .filter((value) => uuidSchema.safeParse(value).success),
  );
  if (chosen.size === 0) {
    return invalid('Choose at least one value for each attribute you want to vary by', {
      generateValueIds: 'Choose values',
    });
  }

  const result = await adminAct(
    formData,
    async (api, token) => {
      const [{ attributes }, { variants }] = await Promise.all([
        api.adminListAttributes(token),
        api.adminProductVariants(token, productId),
      ]);
      // A product's variants all name the same attributes (the database refuses anything
      // else): once it has some, new ones use exactly those, each with a chosen value.
      const owner = new Map(
        attributes.flatMap((attribute) =>
          attribute.values.map((value) => [value.id, attribute.id] as const),
        ),
      );
      const used = new Set(
        variants.flatMap((variant) =>
          variant.attributeValueIds.map((valueId) => owner.get(valueId) ?? valueId),
        ),
      );
      const candidates =
        used.size > 0
          ? attributes.filter((attribute) => used.has(attribute.id))
          : attributes.filter((attribute) => attribute.isActive);
      const missing =
        used.size > 0
          ? candidates
              .filter((attribute) => !attribute.values.some((value) => chosen.has(value.id)))
              .map((attribute) => attribute.name)
          : [];
      if (missing.length > 0) {
        return { tooMany: false as const, missing, created: 0, skipped: 0, failed: [] as string[] };
      }
      // One group per attribute that has at least one chosen value, in attribute order.
      const groups = candidates
        .map((attribute) => attribute.values.filter((value) => chosen.has(value.id)))
        .filter((values) => values.length > 0);
      // The page may send the exact combinations the administrator ticked, instead of every
      // crossing of the chosen values. Each is a list of value ids, one per attribute; anything
      // that does not match the product's attributes exactly is ignored rather than guessed at.
      const picked = formData
        .getAll('generateCombination')
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.split(',').filter((id) => uuidSchema.safeParse(id).success))
        .filter((ids) => ids.length === groups.length && ids.every((id) => chosen.has(id)));
      let combos: { ids: string[]; slugs: string[] }[] = [{ ids: [], slugs: [] }];
      if (picked.length > 0) {
        const slugOf = new Map(
          candidates.flatMap((attribute) =>
            attribute.values.map((value) => [value.id, value.slug] as const),
          ),
        );
        combos = picked.map((ids) => ({
          ids,
          slugs: ids.map((id) => slugOf.get(id) ?? ''),
        }));
        if (combos.length > MAX_GENERATED_VARIANTS) return { tooMany: true as const };
      } else {
        for (const values of groups) {
          combos = combos.flatMap((combo) =>
            values.map((value) => ({
              ids: [...combo.ids, value.id],
              slugs: [...combo.slugs, value.slug],
            })),
          );
          if (combos.length > MAX_GENERATED_VARIANTS) return { tooMany: true as const };
        }
      }
      const existing = new Set(
        variants.map((variant) => [...variant.attributeValueIds].sort().join(',')),
      );
      const fresh = combos.filter((combo) => !existing.has([...combo.ids].sort().join(',')));
      let created = 0;
      const failed: string[] = [];
      let position = variants.reduce((max, variant) => Math.max(max, variant.position + 1), 0);
      for (const combo of fresh) {
        const sku = `${prefix}-${combo.slugs.join('-').toUpperCase()}`
          .replace(/[^A-Z0-9-]+/g, '-')
          .slice(0, 40)
          .replace(/-+$/, '');
        try {
          await api.adminSaveVariant(token, productId, {
            variantId: null,
            sku,
            priceMinor: null,
            compareAtPriceMinor: null,
            imageUrl: null,
            position,
            isActive: true,
            attributeValueIds: combo.ids,
          });
          created += 1;
          position += 1;
        } catch {
          failed.push(sku);
        }
      }
      return {
        tooMany: false as const,
        missing: [] as string[],
        created,
        skipped: combos.length - fresh.length,
        failed,
      };
    },
    { returnTo: variantsPath(productId), label: 'variant generation', messages: VARIANT_MESSAGES },
  );
  revalidateProduct(productId);
  if (!result.ok) return result.state;
  const outcome = result.value;
  if (outcome.tooMany) {
    return {
      status: 'error',
      message: `That makes more than ${String(MAX_GENERATED_VARIANTS)} combinations. Choose fewer values.`,
    };
  }
  if (outcome.missing.length > 0) {
    return invalid(
      `This product's variants also use ${outcome.missing.join(' and ')}: choose at least one value for each.`,
      { generateValueIds: 'Choose a value for every attribute this product uses' },
    );
  }
  const parts = [
    `${String(outcome.created)} variant${outcome.created === 1 ? '' : 's'} created`,
    outcome.skipped > 0 ? `${String(outcome.skipped)} already existed` : null,
  ].filter(Boolean);
  if (outcome.failed.length > 0) {
    return {
      status: 'error',
      message: `${parts.join(', ')}. Not created (the SKU may already be in use): ${outcome.failed.join(', ')}.`,
    };
  }
  return {
    status: 'success',
    message: `${parts.join(', ')}. New variants use the product price and have no stock yet.`,
  };
}

/**
 * One picture for every size of a colour. A colour variant is the combination of a colour
 * and a size, so the picture a shopper sees when choosing "Navy" is really the picture of
 * each navy variant; setting it once here saves the same upload per size, and the API still
 * checks every write (SKU, combination, permission) exactly as it does for a single edit.
 */
export async function setValuePictureAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = idOf(formData, 'productId');
  const valueId = idOf(formData, 'attributeValueId');
  if (!productId || !valueId) return PAGE_EXPIRED;
  const imageUrl = formText(formData, 'imageUrl').trim();
  if (imageUrl !== '' && !/^(https:\/\/|http:\/\/|\/)/i.test(imageUrl)) {
    return invalid('Check the highlighted fields', {
      imageUrl: 'Pick a picture from the library, or paste its address',
    });
  }

  const result = await adminAct(
    formData,
    async (api, token) => {
      const { variants } = await api.adminProductVariants(token, productId);
      const matches = variants.filter((variant) => variant.attributeValueIds.includes(valueId));
      let updated = 0;
      for (const variant of matches) {
        await api.adminSaveVariant(token, productId, {
          variantId: variant.id,
          sku: variant.sku,
          priceMinor: variant.priceMinor,
          compareAtPriceMinor: variant.compareAtPriceMinor,
          imageUrl: imageUrl === '' ? null : imageUrl,
          position: variant.position,
          isActive: variant.isActive,
          attributeValueIds: variant.attributeValueIds,
        });
        updated += 1;
      }
      return updated;
    },
    {
      returnTo: variantsPath(productId),
      label: 'variant picture for a value',
      messages: VARIANT_MESSAGES,
    },
  );
  revalidateProduct(productId);
  if (!result.ok) return result.state;
  const count = result.value;
  if (count === 0) {
    return { status: 'error', message: 'No variant uses that colour yet.' };
  }
  return {
    status: 'success',
    message:
      imageUrl === ''
        ? `The picture was cleared on ${String(count)} variant${count === 1 ? '' : 's'}.`
        : `The picture is now shown on all ${String(count)} variants of that colour.`,
  };
}
