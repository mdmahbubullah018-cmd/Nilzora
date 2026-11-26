import type { ProductVariant } from '@nilzora/contracts';
import {
  initialSelection,
  isValueAvailable,
  optionGroups,
  variantFor,
  withoutStaleChoices,
} from '../features/catalog/variant-selection';

function variant(
  overrides: Partial<ProductVariant> & Pick<ProductVariant, 'id' | 'sku'>,
): ProductVariant {
  return {
    priceMinor: 100_000,
    compareAtPriceMinor: null,
    availability: 'in_stock',
    maxOrderQuantity: 5,
    imageUrl: null,
    options: [{ attribute: 'Colour', attributeSlug: 'colour', value: 'Red', valueSlug: 'red' }],
    ...overrides,
  };
}

const red = variant({
  id: 'ee000000-0000-4000-8000-000000000001',
  sku: 'TEE-RED',
  options: [{ attribute: 'Colour', attributeSlug: 'colour', value: 'Red', valueSlug: 'red' }],
});
const blue = variant({
  id: 'ee000000-0000-4000-8000-000000000002',
  sku: 'TEE-BLUE',
  priceMinor: 120_000,
  options: [{ attribute: 'Colour', attributeSlug: 'colour', value: 'Blue', valueSlug: 'blue' }],
});
const blueSoldOut = variant({
  id: 'ee000000-0000-4000-8000-000000000003',
  sku: 'TEE-BLUE-UK',
  availability: 'out_of_stock',
  maxOrderQuantity: 0,
  options: [
    { attribute: 'Colour', attributeSlug: 'colour', value: 'Blue', valueSlug: 'blue' },
    { attribute: 'Size', attributeSlug: 'size', value: 'UK 12', valueSlug: 'uk-12' },
  ],
});
const blueWithSize = variant({
  id: 'ee000000-0000-4000-8000-000000000004',
  sku: 'TEE-BLUE-M',
  availability: 'low_stock',
  options: [
    { attribute: 'Colour', attributeSlug: 'colour', value: 'Blue', valueSlug: 'blue' },
    { attribute: 'Size', attributeSlug: 'size', value: 'M', valueSlug: 'm' },
  ],
});

describe('optionGroups', () => {
  it('lists each attribute once, in the order the variants mention it, with every value', () => {
    expect(optionGroups([red, blueWithSize])).toEqual([
      {
        slug: 'colour',
        name: 'Colour',
        kind: 'other',
        values: [
          { slug: 'red', value: 'Red', swatchHex: null },
          { slug: 'blue', value: 'Blue', swatchHex: null },
        ],
      },
      {
        slug: 'size',
        name: 'Size',
        kind: 'other',
        values: [{ slug: 'm', value: 'M', swatchHex: null }],
      },
    ]);
  });

  it('has nothing for a product without variants', () => {
    expect(optionGroups([])).toEqual([]);
  });
});

describe('variantFor', () => {
  const groups = optionGroups([red, blueWithSize]);

  it('waits for a complete choice', () => {
    expect(variantFor([red, blueWithSize], groups, {})).toBeUndefined();
    expect(variantFor([red, blueWithSize], groups, { colour: 'blue' })).toBeUndefined();
  });

  it('names the variant once every attribute is chosen', () => {
    expect(variantFor([red, blueWithSize], groups, { colour: 'blue', size: 'm' })).toBe(
      blueWithSize,
    );
  });

  it('names nothing when the combination is not sold', () => {
    expect(variantFor([red, blueWithSize], groups, { colour: 'red', size: 'm' })).toBeUndefined();
  });
});

describe('initialSelection', () => {
  it('chooses the only variant so the customer need not', () => {
    expect(initialSelection([red])).toEqual({ colour: 'red' });
  });

  it('leaves a real choice to the customer', () => {
    expect(initialSelection([red, blue])).toEqual({});
    expect(initialSelection([])).toEqual({});
  });
});

describe('isValueAvailable', () => {
  const groups = optionGroups([red, blueSoldOut, blueWithSize]);

  it('offers a value some variant can still be bought in', () => {
    expect(
      isValueAvailable([red, blueSoldOut], optionGroups([red, blueSoldOut]), {}, 'colour', 'red'),
    ).toBe(true);
  });

  it('refuses a value whose only variant is out of stock', () => {
    const only = [blueSoldOut];
    expect(isValueAvailable(only, optionGroups(only), {}, 'colour', 'blue')).toBe(false);
  });

  it('narrows the values to those that agree with the choices already made', () => {
    // Blue exists, but not in the size chosen.
    expect(isValueAvailable([red, blueWithSize], groups, { size: 'm' }, 'colour', 'blue')).toBe(
      true,
    );
    expect(isValueAvailable([red, blueWithSize], groups, { size: 'uk-12' }, 'colour', 'red')).toBe(
      false,
    );
  });
});

describe('withoutStaleChoices', () => {
  it('keeps only the choices the product still offers', () => {
    const groups = optionGroups([red]);
    expect(withoutStaleChoices(groups, { colour: 'red', size: 'm' })).toEqual({ colour: 'red' });
  });
});
