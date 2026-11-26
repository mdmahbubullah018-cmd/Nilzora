import type { ProductVariant } from '@nilzora/contracts';

/*
 * Choosing a product's options.
 *
 * The API sends every active variant with its price, stock band and order limit already
 * resolved, so the app never calculates money or stock: it only works out which variant a
 * set of choices names, and which values can still be bought next to the current choices.
 */

export interface VariantOptionGroup {
  slug: string;
  name: string;
  /** A colour draws swatches, a size draws chips; absent behaves as 'other'. */
  kind: 'color' | 'size' | 'other';
  values: { slug: string; value: string; swatchHex?: string | null }[];
}

/** The product's attributes in the order its variants list them, each with every value. */
export function optionGroups(variants: readonly ProductVariant[]): VariantOptionGroup[] {
  const groups = new Map<string, VariantOptionGroup>();
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

/** The choices of a product's only variant, so it does not have to be picked by hand. */
export function initialSelection(variants: readonly ProductVariant[]): Record<string, string> {
  const only = variants.length === 1 ? variants[0] : undefined;
  if (!only) return {};
  return Object.fromEntries(only.options.map((option) => [option.attributeSlug, option.valueSlug]));
}

/** The variant named by a complete set of choices, or undefined while it is incomplete. */
export function variantFor(
  variants: readonly ProductVariant[],
  groups: readonly VariantOptionGroup[],
  selected: Record<string, string | undefined>,
): ProductVariant | undefined {
  if (groups.length === 0) return undefined;
  if (groups.some((group) => selected[group.slug] === undefined)) return undefined;
  return variants.find((variant) =>
    groups.every((group) => valueOf(variant, group.slug) === selected[group.slug]),
  );
}

/**
 * Whether a value can be bought next to the choices already made: some variant with it is
 * in stock and agrees with every other choice that has been made.
 */
export function isValueAvailable(
  variants: readonly ProductVariant[],
  groups: readonly VariantOptionGroup[],
  selected: Record<string, string | undefined>,
  groupSlug: string,
  valueSlug: string,
): boolean {
  return variants.some(
    (variant) =>
      valueOf(variant, groupSlug) === valueSlug &&
      variant.availability !== 'out_of_stock' &&
      groups.every(
        (group) =>
          group.slug === groupSlug ||
          selected[group.slug] === undefined ||
          valueOf(variant, group.slug) === selected[group.slug],
      ),
  );
}

/**
 * Whether a value is sold at all next to the choices already made, in stock or not. A value
 * that is not is missing from the combination, which is different from being sold out.
 */
export function isValueOffered(
  variants: readonly ProductVariant[],
  groups: readonly VariantOptionGroup[],
  selected: Record<string, string | undefined>,
  groupSlug: string,
  valueSlug: string,
): boolean {
  return variants.some(
    (variant) =>
      valueOf(variant, groupSlug) === valueSlug &&
      groups.every(
        (group) =>
          group.slug === groupSlug ||
          selected[group.slug] === undefined ||
          valueOf(variant, group.slug) === selected[group.slug],
      ),
  );
}

/**
 * The choices after picking `valueSlug` for `groupSlug`: every other choice that no variant
 * sells together with the new value is dropped, so the customer is never left holding a
 * combination that does not exist.
 */
export function withChoice(
  variants: readonly ProductVariant[],
  selected: Record<string, string>,
  groupSlug: string,
  valueSlug: string,
): Record<string, string> {
  const next: Record<string, string> = { [groupSlug]: valueSlug };
  for (const [other, otherValue] of Object.entries(selected)) {
    if (other === groupSlug) continue;
    const together = variants.some(
      (variant) =>
        valueOf(variant, groupSlug) === valueSlug && valueOf(variant, other) === otherValue,
    );
    if (together) next[other] = otherValue;
  }
  return next;
}

/** True once every attribute has a choice (whether or not a variant has those values). */
export function isSelectionComplete(
  groups: readonly VariantOptionGroup[],
  selected: Record<string, string | undefined>,
): boolean {
  return groups.length > 0 && groups.every((group) => selected[group.slug] !== undefined);
}

/** The display values of the current choices, in attribute order, e.g. ["M", "Navy"]. */
export function chosenValues(
  groups: readonly VariantOptionGroup[],
  selected: Record<string, string | undefined>,
): string[] {
  return groups
    .map((group) => group.values.find((value) => value.slug === selected[group.slug])?.value)
    .filter((value): value is string => value !== undefined);
}

/** Drops a choice no longer offered, e.g. after the choices around it changed. */
export function withoutStaleChoices(
  groups: readonly VariantOptionGroup[],
  selected: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const group of groups) {
    const value = selected[group.slug];
    if (value !== undefined && group.values.some((candidate) => candidate.slug === value)) {
      next[group.slug] = value;
    }
  }
  return next;
}

/** The word for what a group asks for, in a sentence: "size", "colour". */
export function requirementName(group: VariantOptionGroup): string {
  return group.kind === 'size'
    ? 'size'
    : group.kind === 'color'
      ? 'colour'
      : group.name.toLowerCase();
}
