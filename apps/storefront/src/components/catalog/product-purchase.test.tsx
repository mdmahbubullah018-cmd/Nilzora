import type { ProductDetail, ProductVariant } from '@nilzora/contracts';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProductPurchase } from './product-purchase';

const PRODUCT_ID = '0d000000-0000-4000-8000-000000000001';
const RED = 'ee000000-0000-4000-8000-000000000001';
const BLUE = 'ee000000-0000-4000-8000-000000000002';

const noop = () => Promise.resolve({ status: 'idle' } as const);

function variant(
  overrides: Partial<ProductVariant> & Pick<ProductVariant, 'id' | 'sku'>,
): ProductVariant {
  return {
    priceMinor: 125_000,
    compareAtPriceMinor: null,
    availability: 'in_stock',
    maxOrderQuantity: 10,
    imageUrl: null,
    ...overrides,
    options: overrides.options ?? [
      { attribute: 'Colour', attributeSlug: 'colour', value: 'Red', valueSlug: 'red' },
    ],
  };
}

const red = variant({
  id: RED,
  sku: 'SHIRT-RED',
  priceMinor: 125_000,
  options: [{ attribute: 'Colour', attributeSlug: 'colour', value: 'Red', valueSlug: 'red' }],
});

const blue = variant({
  id: BLUE,
  sku: 'SHIRT-BLUE',
  priceMinor: 140_000,
  compareAtPriceMinor: 160_000,
  options: [{ attribute: 'Colour', attributeSlug: 'colour', value: 'Blue', valueSlug: 'blue' }],
});

function product(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: PRODUCT_ID,
    slug: 'cotton-shirt',
    sku: 'SHIRT-001',
    name: 'Cotton shirt',
    summary: null,
    description: null,
    priceMinor: 125_000,
    compareAtPriceMinor: null,
    availability: 'in_stock',
    maxOrderQuantity: 10,
    isFeatured: false,
    category: { slug: 'fashion', name: 'Fashion' },
    image: null,
    campaign: null,
    images: [],
    variants: [red, blue],
    ...overrides,
  };
}

function hiddenVariant(container: HTMLElement): string | undefined {
  return container.querySelector<HTMLInputElement>('input[type="hidden"][name="variantId"]')?.value;
}

describe('ProductPurchase with variants', () => {
  it('lists the product attributes and their values', () => {
    render(<ProductPurchase product={product()} action={noop} />);

    expect(screen.getByRole('group', { name: 'Colour' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Red' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Blue' })).toBeDefined();
  });

  it('keeps every value chip at least 44px wide and tall, even a one-letter size', () => {
    render(<ProductPurchase product={product()} action={noop} />);
    for (const name of ['Red', 'Blue']) {
      const chip = screen.getByRole('button', { name });
      expect(chip.className).toContain('min-h-11');
      expect(chip.className).toContain('min-w-11');
    }
  });

  it('asks for a choice before anything can be added', () => {
    const { container } = render(<ProductPurchase product={product()} action={noop} />);

    expect(screen.getByText('Choose a colour before adding this to your cart.')).toBeDefined();
    expect(screen.getByRole('group', { name: 'Colour' }).getAttribute('aria-describedby')).toBe(
      'option-colour-required',
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Add to cart/ }).disabled).toBe(
      true,
    );
    // "Buy now" waits on the same choice instead of vanishing, so nothing moves on the page.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Buy now' }).disabled).toBe(true);
    expect(hiddenVariant(container)).toBeUndefined();
  });

  it('shows the chosen variant price, former price, SKU and availability', () => {
    const { container } = render(<ProductPurchase product={product()} action={noop} />);

    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));

    // 1,400.00 taka, struck through against the former 1,600.00.
    expect(screen.getByText('৳1,400')).toBeDefined();
    expect(screen.getByText('৳1,600')).toBeDefined();
    expect(screen.getByText('SHIRT-BLUE')).toBeDefined();
    expect(hiddenVariant(container)).toBe(BLUE);
    expect(screen.getByRole('button', { name: /Add to cart/ })).toBeDefined();
  });

  it('sends the chosen variant with the add form', () => {
    const { container } = render(<ProductPurchase product={product()} action={noop} />);

    fireEvent.click(screen.getByRole('button', { name: 'Red' }));

    expect(hiddenVariant(container)).toBe(RED);
    const name = container.querySelector<HTMLInputElement>('input[name="productId"]');
    expect(name?.value).toBe(PRODUCT_ID);
  });

  it('sends the product address with the form, so the cart action can check the options', () => {
    const { container } = render(<ProductPurchase product={product()} action={noop} />);

    fireEvent.click(screen.getByRole('button', { name: 'Red' }));

    expect(container.querySelector<HTMLInputElement>('input[name="productSlug"]')?.value).toBe(
      'cotton-shirt',
    );
  });

  it('marks a value whose variant is out of stock, and disables ordering it', () => {
    const soldOut = variant({
      id: BLUE,
      sku: 'SHIRT-BLUE',
      availability: 'out_of_stock',
      maxOrderQuantity: 0,
      options: [{ attribute: 'Colour', attributeSlug: 'colour', value: 'Blue', valueSlug: 'blue' }],
    });
    render(<ProductPurchase product={product({ variants: [red, soldOut] })} action={noop} />);

    const value = screen.getByRole('button', { name: /Blue/ });
    expect(value.getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Red' }));
    expect(screen.queryByText('SHIRT-BLUE')).toBeNull();
  });

  it('shows the out-of-stock message when the chosen variant cannot be sold', () => {
    const soldOut = variant({
      id: RED,
      sku: 'SHIRT-RED',
      availability: 'out_of_stock',
      maxOrderQuantity: 0,
    });
    render(<ProductPurchase product={product({ variants: [soldOut] })} action={noop} />);

    // One variant is chosen for the customer, and it cannot be bought.
    expect(screen.getByText(/This product is out of stock right now/)).toBeDefined();
  });

  it('chooses a single variant for the customer', () => {
    const { container } = render(
      <ProductPurchase product={product({ variants: [red] })} action={noop} />,
    );

    expect(hiddenVariant(container)).toBe(RED);
    expect(screen.getByText('SHIRT-RED')).toBeDefined();
  });

  it('tells values missing from a combination apart from sold-out ones, and drops a clash', () => {
    const size = (value: string) => ({
      attribute: 'Size',
      attributeSlug: 'size',
      value,
      valueSlug: value.toLowerCase(),
    });
    const colour = (value: string) => ({
      attribute: 'Colour',
      attributeSlug: 'colour',
      value,
      valueSlug: value.toLowerCase(),
    });
    const redM = variant({ id: RED, sku: 'SHIRT-RED-M', options: [colour('Red'), size('M')] });
    const blueL = variant({
      id: BLUE,
      sku: 'SHIRT-BLUE-L',
      priceMinor: 150_000,
      options: [colour('Blue'), size('L')],
    });
    const { container } = render(
      <ProductPurchase product={product({ variants: [redM, blueL] })} action={noop} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Red' }));
    // Large is only sold in blue: it is not out of stock, it is not sold with this choice.
    const large = screen.getByRole('button', { name: /^L/ });
    expect(large.textContent).toContain('not with this choice');
    expect(large.getAttribute('aria-disabled')).toBe('true');

    // Picking it anyway keeps L and drops the red that is not sold with it.
    fireEvent.click(large);
    expect(screen.getByRole('button', { name: 'L' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /^Red/ }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    expect(hiddenVariant(container)).toBe(BLUE);
    expect(screen.getByText('৳1,500')).toBeDefined();
  });

  it('draws colour values as swatches with their name and never selects a sold-out one', () => {
    const colour = (value: string, swatchHex: string | null) => ({
      attribute: 'Colour',
      attributeSlug: 'colour',
      kind: 'color' as const,
      value,
      valueSlug: value.toLowerCase(),
      swatchHex,
    });
    const black = variant({
      id: RED,
      sku: 'SHIRT-BLACK',
      options: [colour('Black', '#0F172A')],
    });
    const white = variant({
      id: BLUE,
      sku: 'SHIRT-WHITE',
      availability: 'out_of_stock',
      maxOrderQuantity: 0,
      options: [colour('White', '#F1F5F9')],
    });
    const { container } = render(
      <ProductPurchase product={product({ variants: [black, white] })} action={noop} />,
    );

    const blackSwatch = screen.getByRole('button', { name: 'Black' });
    const whiteSwatch = screen.getByRole('button', { name: 'White, Sold out' });
    // The colour is never the only cue: each swatch carries its own accessible name.
    expect(blackSwatch.getAttribute('aria-label')).toBe('Black');
    expect(blackSwatch.getAttribute('style')).toContain('rgb(15, 23, 42)');
    expect(whiteSwatch.getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(whiteSwatch);
    expect(hiddenVariant(container)).toBeUndefined();
    expect(whiteSwatch.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Black' }));
    expect(hiddenVariant(container)).toBe(RED);
    expect(screen.getByRole('button', { name: 'Black' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('opens the size chart in a sheet from the button next to the options, and only when there is one', () => {
    const chart = {
      columns: ['Size', 'Chest (cm)'],
      rows: [
        ['M', '96'],
        ['L', '102'],
      ],
    };
    const { rerender } = render(
      <ProductPurchase product={product()} action={noop} sizeChart={chart} />,
    );
    // A button that opens a panel, never a link that jumps to another part of the page.
    expect(screen.queryByRole('link', { name: 'Size guide' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Size guide' }));
    const sheet = screen.getByRole('dialog', { name: 'Size guide' });
    expect(within(sheet).getByRole('columnheader', { name: 'Chest (cm)' })).toBeDefined();
    expect(within(sheet).getByRole('rowheader', { name: 'L' })).toBeDefined();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<ProductPurchase product={product()} action={noop} />);
    expect(screen.queryByRole('button', { name: 'Size guide' })).toBeNull();
  });

  it('keeps a simple product without options exactly as it was', () => {
    const { container } = render(
      <ProductPurchase product={product({ variants: [] })} action={noop} />,
    );

    expect(screen.queryByRole('group', { name: 'Colour' })).toBeNull();
    expect(hiddenVariant(container)).toBeUndefined();
    expect(screen.getByText('SHIRT-001')).toBeDefined();
    expect(within(container).getByRole('button', { name: /Add to cart/ })).toBeDefined();
  });
});
