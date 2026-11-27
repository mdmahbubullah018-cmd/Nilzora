import type { ProductDetail, ProductImage, ProductVariant } from '@nilzora/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProductGallery } from './product-gallery';
import { ProductPurchase } from './product-purchase';
import { VariantImageProvider } from './variant-image-context';

/*
 * Choosing an option changes the big picture
 *
 * The gallery and the option buttons describe one choice. When a combination carries its own
 * picture the page shows it, labelled with the options; "Pictures" (or any thumbnail) hands
 * the product's own pictures back. Without a picture on the variant, nothing changes.
 */

const PRODUCT_ID = '0d000000-0000-4000-8000-000000000001';
const RED = 'ee000000-0000-4000-8000-000000000001';
const BLUE = 'ee000000-0000-4000-8000-000000000002';
const BLUE_PICTURE = 'https://media.nilzora.test/variants/shirt-blue/full.webp';

const noop = () => Promise.resolve({ status: 'idle' } as const);

function picture(position: number, name: string): ProductImage {
  return {
    id: `0f000000-0000-4000-8000-00000000000${position}`,
    url: `https://media.nilzora.test/products/shirt/${name}/full.webp`,
    thumbUrl: `https://media.nilzora.test/products/shirt/${name}/thumb.webp`,
    alt: `Cotton shirt ${position + 1}`,
    width: 1200,
    height: 1200,
    position,
  };
}

function variant(
  overrides: Partial<ProductVariant> & Pick<ProductVariant, 'id' | 'sku'>,
): ProductVariant {
  return {
    priceMinor: 125_000,
    compareAtPriceMinor: null,
    availability: 'in_stock',
    maxOrderQuantity: 10,
    imageUrl: null,
    options: [{ attribute: 'Colour', attributeSlug: 'colour', value: 'Red', valueSlug: 'red' }],
    ...overrides,
  };
}

const red = variant({ id: RED, sku: 'SHIRT-RED' });
const blue = variant({
  id: BLUE,
  sku: 'SHIRT-BLUE',
  imageUrl: BLUE_PICTURE,
  options: [{ attribute: 'Colour', attributeSlug: 'colour', value: 'Blue', valueSlug: 'blue' }],
});

function product(variants: ProductVariant[]): ProductDetail {
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
    images: [picture(0, 'front'), picture(1, 'back')],
    variants,
  };
}

function renderPage(
  overrides: { variants?: ProductVariant[]; initial?: { url: string; label: string } } = {},
) {
  const detail = product(overrides.variants ?? [red, blue]);
  return render(
    <VariantImageProvider initial={overrides.initial ?? null}>
      <ProductGallery images={detail.images} productName={detail.name} />
      <ProductPurchase product={detail} action={noop} />
    </VariantImageProvider>,
  );
}

/** The large picture's own source. */
function mainPicture(): string | null | undefined {
  return screen.getAllByRole('img')[0]?.getAttribute('src');
}

describe('the chosen variant picture', () => {
  it('replaces the product picture with the combination that has one', () => {
    renderPage();

    expect(mainPicture()).toBe('https://media.nilzora.test/products/shirt/front/full.webp');

    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));

    expect(mainPicture()).toBe(BLUE_PICTURE);
    // The picture is labelled with the options it belongs to, and can be dismissed.
    expect(screen.getByRole('button', { name: 'Show the pictures of Cotton shirt' })).toBeDefined();
  });

  it('hands the product pictures back when asked', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show the pictures of Cotton shirt' }));

    expect(mainPicture()).toBe('https://media.nilzora.test/products/shirt/front/full.webp');
    expect(screen.queryByRole('button', { name: 'Show the pictures of Cotton shirt' })).toBeNull();
  });

  it('returns to a product picture when a thumbnail is chosen', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show picture 2 of 2' }));

    expect(mainPicture()).toBe('https://media.nilzora.test/products/shirt/back/full.webp');
  });

  it('leaves the product picture alone when the combination has none', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Red' }));

    expect(mainPicture()).toBe('https://media.nilzora.test/products/shirt/front/full.webp');
  });

  it('starts on the variant picture when the product has only one combination', () => {
    renderPage({
      variants: [
        variant({
          id: BLUE,
          sku: 'SHIRT-BLUE',
          imageUrl: BLUE_PICTURE,
          options: [{ attribute: 'Size', attributeSlug: 'size', value: 'Medium', valueSlug: 'm' }],
        }),
      ],
      initial: { url: BLUE_PICTURE, label: 'Medium' },
    });

    expect(mainPicture()).toBe(BLUE_PICTURE);
  });
});
