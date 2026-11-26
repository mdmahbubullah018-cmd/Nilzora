import { MAX_CART_LINES, type ProductDetail, type ProductVariant } from '@nilzora/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addToCartAction, removeCartLineAction, updateCartLineAction } from './cart-actions';
import type { CartProductRead } from './catalog';

const browser = vi.hoisted(() => ({
  sameOrigin: true,
  cart: undefined as string | undefined,
  mirrored: [] as { productId: string; variantId?: string; quantity: number }[],
  /** What the catalog answers for each product address; an absent one is not found. */
  catalog: new Map<string, unknown>(),
}));

// The catalog is the authority on a product's variants: the action asks it before writing.
vi.mock('@/lib/catalog', () => ({
  readProductForCart: (slug: string): Promise<CartProductRead> =>
    Promise.resolve((browser.catalog.get(slug) ?? { kind: 'missing' }) as CartProductRead),
}));

vi.mock('@/lib/saved-cart', () => ({
  mirrorLine: (
    entry: { productId: string; variantId?: string },
    quantity: number,
  ): Promise<void> => {
    browser.mirrored.push({ ...entry, quantity });
    return Promise.resolve();
  },
}));

vi.mock('@/lib/session', () => ({
  session: {
    isSameOrigin: () => Promise.resolve(browser.sameOrigin),
    cartCookie: {
      get: () => Promise.resolve(browser.cart),
      set: (value: string) => {
        browser.cart = value;
        return Promise.resolve();
      },
      clear: () => {
        browser.cart = undefined;
        return Promise.resolve();
      },
    },
  },
}));

const LAMP = '0d000000-0000-4000-8000-000000000001';
const MUG = '0d000000-0000-4000-8000-000000000002';
const idle = { status: 'idle' } as const;

const RED = 'ee000000-0000-4000-8000-000000000001';
const BLUE = 'ee000000-0000-4000-8000-000000000002';
const MUG_BLUE = 'ee000000-0000-4000-8000-000000000009';
const SLUGS: Record<string, string> = { [LAMP]: 'lamp', [MUG]: 'mug' };

function variant(
  id: string,
  options: [string, string][],
  over: Partial<ProductVariant> = {},
): ProductVariant {
  return {
    id,
    sku: `SKU-${id.slice(-2)}`,
    priceMinor: 125_000,
    compareAtPriceMinor: null,
    availability: 'in_stock',
    maxOrderQuantity: 5,
    imageUrl: null,
    options: options.map(([attribute, value]) => ({
      attribute,
      attributeSlug: attribute.toLowerCase(),
      kind: attribute === 'Size' ? 'size' : attribute === 'Colour' ? 'color' : 'other',
      value,
      valueSlug: value.toLowerCase(),
    })),
    ...over,
  };
}

function catalogProduct(
  id: string,
  slug: string,
  variants: ProductVariant[] = [],
): CartProductRead {
  return { kind: 'ok', value: { id, slug, variants } as unknown as ProductDetail };
}

/** A form as the page posts it: the product's address goes along with its id. */
function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  const slug = fields.productId === undefined ? undefined : SLUGS[fields.productId];
  if (slug !== undefined && !('productSlug' in fields)) data.append('productSlug', slug);
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

beforeEach(() => {
  browser.sameOrigin = true;
  browser.cart = undefined;
  browser.mirrored = [];
  browser.catalog.clear();
  browser.catalog.set('lamp', catalogProduct(LAMP, 'lamp'));
  browser.catalog.set('mug', catalogProduct(MUG, 'mug'));
});

describe('addToCartAction', () => {
  it('adds a product and reports the new unit count', async () => {
    const result = await addToCartAction(idle, form({ productId: LAMP, quantity: '2' }));

    expect(result).toStrictEqual({
      status: 'success',
      message: 'Added to your cart. It now holds 2 items.',
      values: { count: '2' },
    });
    expect(browser.cart).toBe(`${LAMP}:2`);
  });

  it('merges repeats up to the product limit the page gave', async () => {
    browser.cart = `${LAMP}:2`;

    await addToCartAction(idle, form({ productId: LAMP, quantity: '5', limit: '3' }));

    expect(browser.cart).toBe(`${LAMP}:3`);
  });

  it('says so, and changes nothing, when the line is already at its limit', async () => {
    browser.cart = `${LAMP}:3`;

    const result = await addToCartAction(
      idle,
      form({ productId: LAMP, quantity: '1', limit: '3' }),
    );

    expect(result).toStrictEqual({
      status: 'error',
      message: 'Your cart already has the most of this product one order can hold.',
      values: { count: '3' },
    });
    expect(browser.cart).toBe(`${LAMP}:3`);
  });

  it('refuses posts from other origins without touching the cart', async () => {
    browser.sameOrigin = false;
    browser.cart = `${MUG}:1`;

    const result = await addToCartAction(idle, form({ productId: LAMP, quantity: '1' }));

    expect(result.status).toBe('error');
    expect(browser.cart).toBe(`${MUG}:1`);
  });

  it.each([
    ['an invalid product', { productId: 'lamp', quantity: '1' }],
    ['a zero quantity', { productId: LAMP, quantity: '0' }],
  ])('refuses %s', async (_label, fields) => {
    const result = await addToCartAction(idle, form(fields));

    expect(result).toStrictEqual({
      status: 'error',
      message: 'This product could not be added to your cart.',
    });
    expect(browser.cart).toBeUndefined();
  });

  it('refuses a new product when the cart is full', async () => {
    browser.cart = Array.from(
      { length: MAX_CART_LINES },
      (_, index) => `fa000000-0000-4000-8000-${String(index).padStart(12, '0')}:1`,
    ).join(',');
    const before = browser.cart;

    const result = await addToCartAction(idle, form({ productId: LAMP }));

    expect(result.status).toBe('error');
    expect(browser.cart).toBe(before);
  });
});

describe('updateCartLineAction and removeCartLineAction', () => {
  it('changes and removes lines', async () => {
    browser.cart = `${LAMP}:2,${MUG}:1`;

    await updateCartLineAction(idle, form({ productId: MUG, quantity: '4' }));
    expect(browser.cart).toBe(`${LAMP}:2,${MUG}:4`);

    const removed = await removeCartLineAction(idle, form({ productId: LAMP }));
    expect(browser.cart).toBe(`${MUG}:4`);
    expect(removed.values).toStrictEqual({ count: '4' });
  });

  it('treats quantity 0 as removal and refuses malformed quantities', async () => {
    browser.cart = `${LAMP}:2`;

    expect(
      (await updateCartLineAction(idle, form({ productId: LAMP, quantity: 'x' }))).status,
    ).toBe('error');
    expect(browser.cart).toBe(`${LAMP}:2`);

    await updateCartLineAction(idle, form({ productId: LAMP, quantity: '0' }));
    // The last line is gone, so the cookie is removed rather than left empty.
    expect(browser.cart).toBeUndefined();
  });

  it('refuses posts from other origins', async () => {
    browser.sameOrigin = false;
    browser.cart = `${LAMP}:2`;

    await removeCartLineAction(idle, form({ productId: LAMP }));

    expect(browser.cart).toBe(`${LAMP}:2`);
  });
});

describe('variant lines through the cart actions', () => {
  beforeEach(() => {
    browser.catalog.set(
      'lamp',
      catalogProduct(LAMP, 'lamp', [
        variant(RED, [['Colour', 'Red']]),
        variant(BLUE, [['Colour', 'Blue']]),
      ]),
    );
  });

  it('writes the chosen variant into the cookie', async () => {
    const result = await addToCartAction(
      idle,
      form({ productId: LAMP, variantId: RED, quantity: '2' }),
    );

    expect(result.status).toBe('success');
    expect(browser.cart).toBe(`${LAMP}[${RED}]:2`);
  });

  it('keeps two variants of one product as separate lines', async () => {
    browser.cart = `${LAMP}[${RED}]:1`;

    await addToCartAction(idle, form({ productId: LAMP, variantId: BLUE, quantity: '2' }));

    expect(browser.cart).toBe(`${LAMP}[${RED}]:1,${LAMP}[${BLUE}]:2`);
  });

  it('updates and removes only the line named by the form', async () => {
    browser.cart = `${LAMP}[${RED}]:1,${LAMP}[${BLUE}]:2`;

    await updateCartLineAction(idle, form({ productId: LAMP, variantId: BLUE, quantity: '5' }));
    expect(browser.cart).toBe(`${LAMP}[${RED}]:1,${LAMP}[${BLUE}]:5`);

    await removeCartLineAction(idle, form({ productId: LAMP, variantId: RED }));
    expect(browser.cart).toBe(`${LAMP}[${BLUE}]:5`);
  });
});

describe('the server copy of the cart', () => {
  it('mirrors the whole new line, not just the units added', async () => {
    browser.cart = `${LAMP}:2`;
    await addToCartAction(idle, form({ productId: LAMP, quantity: '1', limit: '5' }));
    expect(browser.mirrored).toEqual([{ productId: LAMP, quantity: 3 }]);
  });

  it('mirrors the variant of the line that changed', async () => {
    browser.cart = `${LAMP}[${RED}]:1`;
    await updateCartLineAction(idle, form({ productId: LAMP, variantId: RED, quantity: '4' }));
    expect(browser.mirrored).toEqual([{ productId: LAMP, variantId: RED, quantity: 4 }]);
  });

  it('mirrors a removal as quantity 0, which is how the API removes a line', async () => {
    browser.cart = `${LAMP}:2,${MUG}:1`;
    await removeCartLineAction(idle, form({ productId: LAMP }));
    expect(browser.mirrored).toEqual([{ productId: LAMP, quantity: 0 }]);
  });
});

describe('the variant guard on adding to the cart', () => {
  const SIZE_COLOUR = [
    variant(RED, [
      ['Size', 'M'],
      ['Colour', 'Red'],
    ]),
    variant(BLUE, [
      ['Size', 'L'],
      ['Colour', 'Blue'],
    ]),
  ];

  const untouched = () => {
    expect(browser.cart).toBeUndefined();
    expect(browser.mirrored).toEqual([]);
  };

  it('adds a product without variants in one step, as before', async () => {
    const result = await addToCartAction(idle, form({ productId: MUG, quantity: '1' }));

    expect(result.status).toBe('success');
    expect(browser.cart).toBe(`${MUG}:1`);
  });

  it('refuses a hand-posted form without a variant for a product that has them', async () => {
    browser.catalog.set(
      'lamp',
      catalogProduct(LAMP, 'lamp', [
        variant(RED, [['Colour', 'Red']]),
        variant(BLUE, [['Colour', 'Blue']]),
      ]),
    );

    const result = await addToCartAction(idle, form({ productId: LAMP, quantity: '1' }));

    expect(result).toStrictEqual({ status: 'error', message: 'Choose a colour first.' });
    untouched();
  });

  it('names every attribute the product varies by', async () => {
    browser.catalog.set('lamp', catalogProduct(LAMP, 'lamp', SIZE_COLOUR));

    const result = await addToCartAction(idle, form({ productId: LAMP, quantity: '1' }));

    expect(result.message).toBe('Choose your size and a colour first.');
    untouched();
  });

  it('refuses a single variant too: it must be chosen, never assumed', async () => {
    browser.catalog.set('lamp', catalogProduct(LAMP, 'lamp', [variant(RED, [['Colour', 'Red']])]));

    const result = await addToCartAction(idle, form({ productId: LAMP, quantity: '1' }));

    expect(result.status).toBe('error');
    untouched();

    const chosen = await addToCartAction(
      idle,
      form({ productId: LAMP, variantId: RED, quantity: '1' }),
    );
    expect(chosen.status).toBe('success');
    expect(browser.cart).toBe(`${LAMP}[${RED}]:1`);
  });

  it('adds exactly the variant that was chosen, mirroring it too', async () => {
    browser.catalog.set('lamp', catalogProduct(LAMP, 'lamp', SIZE_COLOUR));

    await addToCartAction(idle, form({ productId: LAMP, variantId: BLUE, quantity: '2' }));

    expect(browser.cart).toBe(`${LAMP}[${BLUE}]:2`);
    expect(browser.mirrored).toEqual([{ productId: LAMP, variantId: BLUE, quantity: 2 }]);
  });

  it('refuses a variant that belongs to another product', async () => {
    browser.catalog.set('lamp', catalogProduct(LAMP, 'lamp', SIZE_COLOUR));
    browser.catalog.set(
      'mug',
      catalogProduct(MUG, 'mug', [variant(MUG_BLUE, [['Colour', 'Blue']])]),
    );

    const result = await addToCartAction(
      idle,
      form({ productId: LAMP, variantId: MUG_BLUE, quantity: '1' }),
    );

    expect(result.message).toBe('That option is not sold for this product. Choose another option.');
    untouched();
  });

  it('refuses a variant that is sold out or cannot be ordered', async () => {
    browser.catalog.set(
      'lamp',
      catalogProduct(LAMP, 'lamp', [
        variant(RED, [['Colour', 'Red']], { availability: 'out_of_stock', maxOrderQuantity: 0 }),
        variant(BLUE, [['Colour', 'Blue']], { maxOrderQuantity: 0 }),
      ]),
    );

    for (const variantId of [RED, BLUE]) {
      const result = await addToCartAction(
        idle,
        form({ productId: LAMP, variantId, quantity: '1' }),
      );
      expect(result.message).toBe('That option is sold out. Choose another option.');
    }
    untouched();
  });

  it('refuses a variant on a product that has none', async () => {
    const result = await addToCartAction(
      idle,
      form({ productId: MUG, variantId: RED, quantity: '1' }),
    );

    expect(result.status).toBe('error');
    untouched();
  });

  it('refuses a form that does not say which product it is about, or names another one', async () => {
    browser.catalog.set('lamp', catalogProduct(LAMP, 'lamp', SIZE_COLOUR));

    // The variant-less mug's address with the lamp's id would otherwise skip the lamp's check.
    const mismatched = await addToCartAction(
      idle,
      form({ productId: LAMP, productSlug: 'mug', quantity: '1' }),
    );
    const anonymous = await addToCartAction(
      idle,
      form({ productId: LAMP, productSlug: '', quantity: '1' }),
    );

    expect(mismatched.status).toBe('error');
    expect(anonymous.status).toBe('error');
    untouched();
  });

  it('adds nothing when the catalog cannot be read, and says why', async () => {
    browser.catalog.set('lamp', { kind: 'unavailable' });

    const result = await addToCartAction(idle, form({ productId: LAMP, quantity: '1' }));

    expect(result.message).toContain('could not check this product’s options');
    untouched();
  });

  it('refuses a product that no longer exists', async () => {
    browser.catalog.delete('lamp');

    const result = await addToCartAction(idle, form({ productId: LAMP, quantity: '1' }));

    expect(result.message).toBe('This product is no longer available.');
    untouched();
  });

  it('applies to "Buy now" too: no variant, no checkout', async () => {
    browser.catalog.set('lamp', catalogProduct(LAMP, 'lamp', SIZE_COLOUR));

    const result = await addToCartAction(
      idle,
      form({ productId: LAMP, quantity: '1', intent: 'buy' }),
    );

    expect(result.status).toBe('error');
    untouched();
  });
});
