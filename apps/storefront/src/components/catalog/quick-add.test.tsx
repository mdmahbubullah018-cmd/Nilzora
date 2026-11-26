import type { ProductVariant } from '@nilzora/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { summary } from '@/testing/catalog-fixtures';
import { ProductCard, ProductGrid } from './product-card';
import type { ProductOptions } from './variant-selection';

/*
 * Quick add from a product card. A list entry does not say whether a product has variants, so
 * pressing it asks the options route; these tests stand in for that route (fetch) and for the
 * cart action, and check that nothing ever reaches the action without the exact variant.
 */

const added = vi.hoisted((): { calls: Record<string, string>[]; result: unknown } => ({
  calls: [],
  result: undefined,
}));

vi.mock('@/lib/cart-actions', () => ({
  addToCartAction: (_previous: unknown, formData: FormData) => {
    added.calls.push(
      Object.fromEntries(
        [...formData.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]),
      ),
    );
    return Promise.resolve(
      added.result ?? {
        status: 'success',
        message: 'Added to your cart.',
        values: { count: '1' },
      },
    );
  },
}));

const M = 'ee000000-0000-4000-8000-00000000000a';
const L = 'ee000000-0000-4000-8000-00000000000b';
const RED = 'ee000000-0000-4000-8000-000000000001';
const BLUE = 'ee000000-0000-4000-8000-000000000002';

type Option = [attribute: string, value: string];

function variant(
  id: string,
  options: Option[],
  over: Partial<ProductVariant> = {},
): ProductVariant {
  return {
    id,
    sku: `SKU-${id.slice(-2)}`,
    priceMinor: 65_000,
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

const card = summary({ slug: 'cotton-shirt', name: 'Cotton shirt' });

function optionsFor(variants: ProductVariant[], id = card.id): ProductOptions {
  return {
    id,
    slug: card.slug,
    name: card.name,
    priceMinor: card.priceMinor,
    compareAtPriceMinor: null,
    availability: 'in_stock',
    maxOrderQuantity: 5,
    variants,
  };
}

function answer(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  );
}

const SIZES = [variant(M, [['Size', 'M']]), variant(L, [['Size', 'L']])];

/** A click, then the microtasks it sets off (the options read, the cart action). */
async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
    await Promise.resolve();
  });
}

async function press(name: string | RegExp): Promise<void> {
  await click(screen.getByRole('button', { name }));
}

async function openSheet(): Promise<HTMLElement> {
  await press('Add Cotton shirt to cart');
  return await screen.findByRole('dialog', { name: 'Select options' });
}

beforeEach(() => {
  added.calls = [];
  added.result = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('quick add of a product without variants', () => {
  it('asks the catalog, then adds exactly as one press always did', async () => {
    answer({ product: optionsFor([]) });
    render(<ProductCard product={card} />);

    await press('Add Cotton shirt to cart');

    await waitFor(() => {
      expect(added.calls).toHaveLength(1);
    });
    expect(added.calls[0]).toStrictEqual({
      productId: card.id,
      productSlug: 'cotton-shirt',
      quantity: '1',
      limit: '5',
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/catalog/product-options?slug=cotton-shirt',
      expect.anything(),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText('Added')).toBeDefined();
  });
});

describe('quick add of a product with variants', () => {
  it('opens the options instead of adding, and the card says "Select options"', async () => {
    answer({ product: optionsFor(SIZES) });
    render(<ProductCard product={card} />);

    const sheet = await openSheet();

    expect(added.calls).toHaveLength(0);
    expect(within(sheet).getByRole('button', { name: 'M' })).toBeDefined();
    expect(within(sheet).getByRole('button', { name: 'L' })).toBeDefined();
    expect(sheet.textContent).toContain('Cotton shirt');
    // Nothing is preselected for a product with several variants.
    expect(within(sheet).getByRole('button', { name: 'M' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(screen.getAllByText('Select options').length).toBeGreaterThan(0);
  });

  it('gives the sheet its Close button and the value chips a 44px target', async () => {
    answer({ product: optionsFor(SIZES) });
    render(<ProductCard product={card} />);
    const sheet = await openSheet();
    const close = within(sheet).getByRole('button', { name: 'Close options' });
    expect(close.className).toContain('size-11');
    expect(close.className).toContain('pointer-coarse:size-11');
    for (const name of ['M', 'L']) {
      expect(within(sheet).getByRole('button', { name }).className).toContain('min-w-11');
    }
  });

  it('points at the missing size and adds nothing when none is chosen', async () => {
    answer({ product: optionsFor(SIZES) });
    render(<ProductCard product={card} />);
    const sheet = await openSheet();

    await click(within(sheet).getByRole('button', { name: /^Add to cart/ }));

    expect(added.calls).toHaveLength(0);
    expect(within(sheet).getByRole('alert').textContent).toBe('Select a size');
    expect(sheet.querySelector('[data-invalid="true"]')).not.toBeNull();
    // Still open, in place.
    expect(screen.getByRole('dialog', { name: 'Select options' })).toBeDefined();
  });

  it('adds the exact variant that was chosen, once, and closes', async () => {
    answer({ product: optionsFor(SIZES) });
    render(<ProductCard product={card} />);
    const sheet = await openSheet();

    fireEvent.click(within(sheet).getByRole('button', { name: 'L' }));
    expect(within(sheet).getByRole('button', { name: 'L' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await click(within(sheet).getByRole('button', { name: /^Add to cart/ }));

    await waitFor(() => {
      expect(added.calls).toHaveLength(1);
    });
    expect(added.calls[0]).toStrictEqual({
      productId: card.id,
      productSlug: 'cotton-shirt',
      variantId: L,
      limit: '5',
      quantity: '1',
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Select options' })).toBeNull();
    });
  });

  it('adds the chosen quantity of the chosen variant', async () => {
    answer({ product: optionsFor(SIZES) });
    render(<ProductCard product={card} />);
    const sheet = await openSheet();

    fireEvent.click(within(sheet).getByRole('button', { name: 'M' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Increase quantity' }));
    await click(within(sheet).getByRole('button', { name: /^Add to cart/ }));

    await waitFor(() => {
      expect(added.calls).toHaveLength(1);
    });
    expect(added.calls[0]).toMatchObject({ variantId: M, quantity: '2' });
  });

  it('requires a colour when the product only varies by colour', async () => {
    answer({
      product: optionsFor([variant(RED, [['Colour', 'Red']]), variant(BLUE, [['Colour', 'Blue']])]),
    });
    render(<ProductCard product={card} />);
    const sheet = await openSheet();

    await click(within(sheet).getByRole('button', { name: /^Add to cart/ }));

    expect(within(sheet).getByRole('alert').textContent).toBe('Select a colour');
    expect(added.calls).toHaveLength(0);
  });

  it('blocks a partial choice across several dimensions and adds the exact combination', async () => {
    const redM = variant(RED, [
      ['Size', 'M'],
      ['Colour', 'Red'],
    ]);
    const blueM = variant(BLUE, [
      ['Size', 'M'],
      ['Colour', 'Blue'],
    ]);
    const redL = variant(L, [
      ['Size', 'L'],
      ['Colour', 'Red'],
    ]);
    answer({ product: optionsFor([redM, blueM, redL]) });
    render(<ProductCard product={card} />);
    const sheet = await openSheet();

    fireEvent.click(within(sheet).getByRole('button', { name: 'M' }));
    await click(within(sheet).getByRole('button', { name: /^Add to cart/ }));
    // Only the colour is still missing, and only that group is pointed at.
    expect(within(sheet).getByRole('alert').textContent).toBe('Select a colour');
    expect(sheet.querySelectorAll('[data-invalid="true"]')).toHaveLength(1);
    expect(added.calls).toHaveLength(0);

    fireEvent.click(within(sheet).getByRole('button', { name: 'Blue' }));
    await click(within(sheet).getByRole('button', { name: /^Add to cart/ }));
    await waitFor(() => {
      expect(added.calls).toHaveLength(1);
    });
    expect(added.calls[0]?.variantId).toBe(BLUE);
  });

  it('does not let a sold-out option be selected', async () => {
    answer({
      product: optionsFor([
        variant(M, [['Size', 'M']], { availability: 'out_of_stock', maxOrderQuantity: 0 }),
        variant(L, [['Size', 'L']]),
      ]),
    });
    render(<ProductCard product={card} />);
    const sheet = await openSheet();

    const soldOut = within(sheet).getByRole('button', { name: /^M/ });
    expect(soldOut.getAttribute('aria-disabled')).toBe('true');
    expect(soldOut.textContent).toContain('Sold out');
    fireEvent.click(soldOut);
    expect(soldOut.getAttribute('aria-pressed')).toBe('false');

    await click(within(sheet).getByRole('button', { name: /^Add to cart/ }));
    expect(added.calls).toHaveLength(0);
    expect(within(sheet).getByRole('alert').textContent).toBe('Select a size');
  });

  it('never leaves a combination nobody sells: it is marked and drops the clashing choice', async () => {
    const redM = variant(M, [
      ['Size', 'M'],
      ['Colour', 'Red'],
    ]);
    const blueL = variant(L, [
      ['Size', 'L'],
      ['Colour', 'Blue'],
    ]);
    answer({ product: optionsFor([redM, blueL]) });
    render(<ProductCard product={card} />);
    const sheet = await openSheet();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Red' }));
    const large = within(sheet).getByRole('button', { name: /^L/ });
    expect(large.textContent).toContain('not with this choice');
    // Picking it re-scopes the colour rather than keeping red + L, so nothing unsold is addable.
    fireEvent.click(large);
    expect(within(sheet).getByRole('button', { name: /^Red/ }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    await click(within(sheet).getByRole('button', { name: /^Add to cart/ }));
    expect(added.calls).toHaveLength(0);
    expect(within(sheet).getByRole('alert').textContent).toBe('Select a colour');
  });

  it('opens a single variant with it already chosen, and adds it', async () => {
    answer({ product: optionsFor([variant(M, [['Size', 'M']])]) });
    render(<ProductCard product={card} />);
    const sheet = await openSheet();

    expect(within(sheet).getByRole('button', { name: 'M' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await click(within(sheet).getByRole('button', { name: /^Add to cart/ }));
    await waitFor(() => {
      expect(added.calls).toHaveLength(1);
    });
    expect(added.calls[0]?.variantId).toBe(M);
  });

  it('shows the cart action’s own refusal inside the sheet', async () => {
    answer({ product: optionsFor(SIZES) });
    added.result = { status: 'error', message: 'That option is sold out. Choose another option.' };
    render(<ProductCard product={card} />);
    const sheet = await openSheet();

    fireEvent.click(within(sheet).getByRole('button', { name: 'M' }));
    await click(within(sheet).getByRole('button', { name: /^Add to cart/ }));

    expect(
      await within(sheet).findByText('That option is sold out. Choose another option.'),
    ).toBeDefined();
    expect(screen.getByRole('dialog', { name: 'Select options' })).toBeDefined();
  });
});

describe('quick add when the options cannot be read', () => {
  it.each([
    [
      'the request fails',
      () =>
        vi.stubGlobal(
          'fetch',
          vi.fn(() => Promise.reject(new Error('offline'))),
        ),
    ],
    ['the route answers 503', () => answer({ error: 'unavailable' }, 503)],
    ['the answer is malformed', () => answer({ product: { id: card.id, variants: 'x' } })],
    [
      'the answer is about another product',
      () => answer({ product: optionsFor([], 'someone-else') }),
    ],
  ])('adds nothing and offers a retry and the product page when %s', async (_label, arrange) => {
    arrange();
    render(<ProductCard product={card} />);

    const sheet = await openSheet();

    expect(within(sheet).getByRole('alert').textContent).toContain('was not added');
    expect(within(sheet).getByRole('button', { name: 'Try again' })).toBeDefined();
    expect(
      within(sheet)
        .getByRole('link', { name: 'Select options on the product page' })
        .getAttribute('href'),
    ).toBe('/products/cotton-shirt');
    expect(added.calls).toHaveLength(0);
  });

  it('shows the options once a retry succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    render(<ProductCard product={card} />);
    const sheet = await openSheet();

    answer({ product: optionsFor(SIZES) });
    await click(within(sheet).getByRole('button', { name: 'Try again' }));

    expect(await within(sheet).findByRole('button', { name: 'M' })).toBeDefined();
    expect(added.calls).toHaveLength(0);
  });
});

describe('quick add across a listing', () => {
  it('asks per product: a plain one adds, one with variants opens its own sheet', async () => {
    const plain = summary({ slug: 'plain-mug', name: 'Plain mug' });
    const sized = summary({ slug: 'sized-shirt', name: 'Sized shirt' });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const body = url.includes('plain-mug')
          ? { product: { ...optionsFor([], plain.id), slug: 'plain-mug', name: 'Plain mug' } }
          : {
              product: { ...optionsFor(SIZES, sized.id), slug: 'sized-shirt', name: 'Sized shirt' },
            };
        return Promise.resolve(new Response(JSON.stringify(body)));
      }),
    );
    render(<ProductGrid products={[plain, sized]} />);

    await press('Add Plain mug to cart');
    await waitFor(() => {
      expect(added.calls).toHaveLength(1);
    });
    expect(added.calls[0]).toMatchObject({ productId: plain.id });
    expect(added.calls[0]).not.toHaveProperty('variantId');

    await press('Add Sized shirt to cart');
    const sheet = await screen.findByRole('dialog', { name: 'Select options' });
    expect(sheet.textContent).toContain('Sized shirt');
    expect(added.calls).toHaveLength(1);
  });

  it('keeps a sold-out product unaddable and never asks the catalog', () => {
    answer({ product: optionsFor([]) });
    render(
      <ProductCard product={summary({ maxOrderQuantity: 0, availability: 'out_of_stock' })} />,
    );

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Sold out' }).disabled).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
