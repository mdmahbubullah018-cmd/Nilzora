import type { ProductVariant } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import {
  attributeGroups,
  choosePrompt,
  initialSelection,
  variantFor,
  variantOrderable,
} from './variant-selection';

function variant(id: string, options: [string, string, 'size' | 'color'][], over = {}) {
  return {
    id,
    sku: id,
    priceMinor: 1000,
    compareAtPriceMinor: null,
    availability: 'in_stock',
    maxOrderQuantity: 3,
    imageUrl: null,
    options: options.map(([attribute, value, kind]) => ({
      attribute,
      attributeSlug: attribute.toLowerCase(),
      kind,
      value,
      valueSlug: value.toLowerCase(),
    })),
    ...over,
  } as ProductVariant;
}

const variants = [
  variant('a', [
    ['Size', 'M', 'size'],
    ['Colour', 'Red', 'color'],
  ]),
  variant('b', [
    ['Size', 'L', 'size'],
    ['Colour', 'Blue', 'color'],
  ]),
];

describe('variant selection helpers', () => {
  it('names what is still missing, by the real attribute', () => {
    const groups = attributeGroups(variants);

    expect(choosePrompt(groups, {})).toBe(
      'Choose your size and a colour before adding this to your cart.',
    );
    expect(choosePrompt(groups, { size: 'm' })).toBe(
      'Choose a colour before adding this to your cart.',
    );
  });

  it('only names a complete choice as a variant that exists', () => {
    const groups = attributeGroups(variants);

    expect(variantFor(variants, groups, { size: 'm' })).toBeUndefined();
    expect(variantFor(variants, groups, { size: 'm', colour: 'blue' })).toBeUndefined();
    expect(variantFor(variants, groups, { size: 'l', colour: 'blue' })?.id).toBe('b');
  });

  it('chooses for the customer only when there is a single variant', () => {
    expect(initialSelection(variants)).toEqual({});
    expect(initialSelection([variants[0] as ProductVariant])).toEqual({
      size: 'm',
      colour: 'red',
    });
  });

  it('orders only variants that are in stock with room in an order', () => {
    expect(variantOrderable(variants[0] as ProductVariant)).toBe(true);
    expect(variantOrderable(variant('c', [], { availability: 'out_of_stock' }))).toBe(false);
    expect(variantOrderable(variant('d', [], { maxOrderQuantity: 0 }))).toBe(false);
  });
});
