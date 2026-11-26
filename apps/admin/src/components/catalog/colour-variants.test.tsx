// @vitest-environment jsdom
import type { AdminAttribute, AdminProductDetail, AdminVariant } from '@nilzora/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColourVariants, colourAttributeOf, colourGroups } from './colour-variants';

// The forms post to Server Actions; the grouping is what these tests are about.
vi.mock('@/lib/variant-actions', () => ({
  generateVariantsAction: vi.fn(),
  setValuePictureAction: vi.fn(),
}));

const csrf = { name: '__csrf', token: 'token-1' };
const PRODUCT = '22222222-2222-4222-8222-222222222222';
const SIZE = '33333333-3333-4333-8333-333333333333';
const COLOUR = '44444444-4444-4444-8444-444444444444';
const M = '55555555-5555-4555-8555-555555555551';
const L = '55555555-5555-4555-8555-555555555552';
const NAVY = '66666666-6666-4666-8666-666666666661';
const WHITE = '66666666-6666-4666-8666-666666666662';

const size: AdminAttribute = {
  id: SIZE,
  slug: 'size',
  name: 'Size',
  position: 0,
  isActive: true,
  kind: 'size',
  values: [
    { id: M, slug: 'm', value: 'M', position: 0 },
    { id: L, slug: 'l', value: 'L', position: 1 },
  ],
};

const colour: AdminAttribute = {
  id: COLOUR,
  slug: 'colour',
  name: 'Colour',
  position: 1,
  isActive: true,
  kind: 'color',
  values: [
    { id: NAVY, slug: 'navy', value: 'Navy', position: 0, swatchHex: '#0F172A' },
    { id: WHITE, slug: 'white', value: 'White', position: 1, swatchHex: '#F1F5F9' },
  ],
};

const product = { id: PRODUCT, sku: 'TEE', priceMinor: 120_000 } as AdminProductDetail;

function variant(
  id: string,
  attributeValueIds: string[],
  overrides: Partial<AdminVariant> = {},
): AdminVariant {
  return {
    id,
    sku: `TEE-${id.slice(-2)}`,
    priceMinor: null,
    compareAtPriceMinor: null,
    stockQuantity: 3,
    imageUrl: null,
    position: 0,
    isActive: true,
    label: null,
    attributeValueIds,
    ...overrides,
  };
}

const navyM = variant('77777777-7777-4777-8777-777777777701', [M, NAVY], { position: 0 });
const navyL = variant('77777777-7777-4777-8777-777777777702', [L, NAVY], {
  position: 1,
  stockQuantity: 0,
  imageUrl: 'https://media.example.com/products/tee/navy.webp',
});
const whiteM = variant('77777777-7777-4777-8777-777777777703', [M, WHITE], {
  position: 2,
  isActive: false,
});

afterEach(cleanup);

describe('colourAttributeOf', () => {
  it('finds the colour attribute the variants use', () => {
    expect(colourAttributeOf([navyM, whiteM], [size, colour])).toBe(colour);
  });

  it('answers nothing for a product sold in sizes only', () => {
    expect(colourAttributeOf([variant(navyM.id, [M])], [size])).toBeUndefined();
  });
});

describe('colourGroups', () => {
  it('groups the sizes under their colour, in the attribute’s order', () => {
    const groups = colourGroups([whiteM, navyL, navyM], colour);

    expect(groups.map((group) => group.value.value)).toEqual(['Navy', 'White']);
    expect(groups[0]?.variants.map((item) => item.id)).toEqual([navyM.id, navyL.id]);
    expect(groups[1]?.variants.map((item) => item.id)).toEqual([whiteM.id]);
  });

  it('leaves out a colour the product does not sell', () => {
    expect(colourGroups([navyM], colour).map((group) => group.value.value)).toEqual(['Navy']);
  });
});

describe('ColourVariants', () => {
  it('shows one card per colour with its sizes, stock and picture', () => {
    render(
      <ColourVariants
        product={product}
        variants={[navyM, navyL, whiteM]}
        attributes={[size, colour]}
        csrf={csrf}
        canEdit
      />,
    );

    const navy = screen.getByRole('list', { name: 'Sizes in Navy' });
    expect(within(navy).getByText('M')).toBeDefined();
    expect(within(navy).getByText('L')).toBeDefined();
    expect(within(navy).getByText('0 in stock')).toBeDefined();
    expect(within(navy).getByText('Out of stock')).toBeDefined();

    const white = screen.getByRole('list', { name: 'Sizes in White' });
    expect(within(white).getByText('Hidden')).toBeDefined();
    expect(screen.getByText('1 size')).toBeDefined();
    expect(screen.getByText('2 sizes')).toBeDefined();
  });

  it('offers the sizes a colour is still missing, and nothing when it has them all', () => {
    render(
      <ColourVariants
        product={product}
        variants={[navyM, navyL, whiteM]}
        attributes={[size, colour]}
        csrf={csrf}
        canEdit
      />,
    );

    // Navy sells both sizes already; White is missing L.
    const white = screen.getByText('Sizes still missing in White').closest('fieldset');
    expect(white).not.toBeNull();
    expect(within(white as HTMLElement).getByLabelText('L')).toBeDefined();
    expect(within(white as HTMLElement).queryByLabelText('M')).toBeNull();
    expect(screen.getByText('Every size is already sold in Navy.')).toBeDefined();
  });

  it('offers every colour and size when adding one', () => {
    render(
      <ColourVariants
        product={product}
        variants={[navyM]}
        attributes={[size, colour]}
        csrf={csrf}
        canEdit
      />,
    );

    const picker = screen.getByRole('group', { name: 'Colour' });
    expect(within(picker).getByRole('radio', { name: 'Navy' })).toBeDefined();
    expect(within(picker).getByRole('radio', { name: 'White' })).toBeDefined();
    const sizes = screen.getByRole('group', { name: 'Sizes to sell in this colour' });
    expect(within(sizes).getByRole('checkbox', { name: 'M' })).toBeDefined();
    expect(within(sizes).getByRole('checkbox', { name: 'L' })).toBeDefined();
  });

  it('shows no editing controls to an account that may not change variants', () => {
    render(
      <ColourVariants
        product={product}
        variants={[navyM]}
        attributes={[size, colour]}
        csrf={csrf}
        canEdit={false}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Use on every size' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add the colour' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Sizes in Navy' })).toBeDefined();
  });

  it('draws nothing for a product without colours', () => {
    const { container } = render(
      <ColourVariants
        product={product}
        variants={[variant(navyM.id, [M])]}
        attributes={[size]}
        csrf={csrf}
        canEdit
      />,
    );

    expect(container.textContent).toBe('');
  });
});
