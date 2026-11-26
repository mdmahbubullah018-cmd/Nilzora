import type { ProductVariant } from '@nilzora/contracts';

/*
 * Pure helpers for choosing a product's options. They run in the browser (the product page and
 * the quick-add sheet) and on the server (the cart action's guard), so this module has no
 * 'use client' and no React: nothing here calculates money or stock, it only works out which
 * variant a set of choices names.
 */

export interface AttributeGroup {
  slug: string;
  name: string;
  /** A colour draws swatches, a size draws chips; absent behaves as 'other'. */
  kind: 'color' | 'size' | 'other';
  values: { slug: string; value: string; swatchHex?: string | null }[];
}

export type Selection = Record<string, string>;

/** The product's attributes in the order its variants list them, each with every value. */
export function attributeGroups(variants: readonly ProductVariant[]): AttributeGroup[] {
  const groups = new Map<string, AttributeGroup>();
  for (const variant of variants) {
    for (const option of variant.options) {
      const group = groups.get(option.attributeSlug) ?? {
        slug: option.attributeSlug,
        name: option.attribute,
        kind: option.kind ?? 'other',
        values: [],
      };
      if (!group.values.some((value) => value.slug === option.valueSlug)) {
        group.values.push({
          slug: option.valueSlug,
          value: option.value,
          swatchHex: option.swatchHex ?? null,
        });
      }
      groups.set(option.attributeSlug, group);
    }
  }
  return [...groups.values()];
}

export function valueOf(variant: ProductVariant, attributeSlug: string): string | undefined {
  return variant.options.find((option) => option.attributeSlug === attributeSlug)?.valueSlug;
}

/** Whether some variant has `value` for `group` and agrees with every other choice made. */
export function offered(
  variants: readonly ProductVariant[],
  groups: readonly AttributeGroup[],
  selected: Selection,
  group: string,
  value: string,
  { inStock }: { inStock: boolean },
): boolean {
  return variants.some(
    (variant) =>
      valueOf(variant, group) === value &&
      (!inStock || variant.availability !== 'out_of_stock') &&
      groups.every(
        (other) =>
          other.slug === group ||
          selected[other.slug] === undefined ||
          valueOf(variant, other.slug) === selected[other.slug],
      ),
  );
}

/**
 * The choices after picking `value` for `group`: any other choice no variant sells together
 * with the new value is dropped, so the customer is never left holding a combination that
 * does not exist.
 */
export function choose(
  variants: readonly ProductVariant[],
  selected: Selection,
  group: string,
  value: string,
): Selection {
  const next: Selection = { [group]: value };
  for (const [other, otherValue] of Object.entries(selected)) {
    if (other === group) continue;
    const together = variants.some(
      (variant) => valueOf(variant, group) === value && valueOf(variant, other) === otherValue,
    );
    if (together) next[other] = otherValue;
  }
  return next;
}

/** The variant named by a complete set of choices, or undefined while it is incomplete. */
export function variantFor(
  variants: readonly ProductVariant[],
  groups: readonly AttributeGroup[],
  selected: Selection,
): ProductVariant | undefined {
  if (groups.length === 0) return undefined;
  if (groups.some((group) => selected[group.slug] === undefined)) return undefined;
  return variants.find((variant) =>
    groups.every((group) => valueOf(variant, group.slug) === selected[group.slug]),
  );
}

/** A product with a single variant is already chosen for the customer. */
export function initialSelection(variants: readonly ProductVariant[]): Selection {
  return variants.length === 1
    ? Object.fromEntries(
        (variants[0]?.options ?? []).map((option) => [option.attributeSlug, option.valueSlug]),
      )
    : {};
}

/** The word for what a group asks for, in a sentence: "size", "colour". */
export function requirementName(group: AttributeGroup): string {
  if (group.kind === 'size') return 'size';
  if (group.kind === 'color') return 'colour';
  return group.name.toLowerCase();
}

/** The groups still waiting for an answer. */
export function missingGroups(
  groups: readonly AttributeGroup[],
  selected: Selection,
): AttributeGroup[] {
  return groups.filter((group) => selected[group.slug] === undefined);
}

/** "Choose a size before adding this to your cart." for what is still missing. */
export function choosePrompt(groups: readonly AttributeGroup[], selected: Selection): string {
  const names = missingGroups(groups, selected).map(requirementName);
  return names.length === 0
    ? 'Choose your options before adding this to your cart.'
    : `Choose ${names.length === 1 ? 'a' : 'your'} ${names.join(' and a ')} before adding this to your cart.`;
}

/** Whether a variant can be put in a cart right now. */
export function variantOrderable(variant: ProductVariant): boolean {
  return variant.availability !== 'out_of_stock' && variant.maxOrderQuantity >= 1;
}

/** What the quick-add sheet needs of a product to offer its options (the options route's answer). */
export interface ProductOptions {
  id: string;
  slug: string;
  name: string;
  priceMinor: number;
  compareAtPriceMinor: number | null;
  availability: 'in_stock' | 'low_stock' | 'out_of_stock';
  maxOrderQuantity: number;
  variants: ProductVariant[];
}
