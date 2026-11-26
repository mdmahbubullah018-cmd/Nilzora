import type { CartLine } from '@nilzora/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { CartLineRow } from '../features/cart/cart-line-row';
import { ItemsSection } from '../features/checkout/items-section';
import { cartLine, cartQuote } from '../test-utils/checkout-fakes';
import { resetRouterMock } from '../test-utils/expo-router-mock';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

beforeEach(resetRouterMock);

const HIDDEN = { includeHiddenElements: true } as const;
const photos = () => screen.queryAllByTestId('product-photo', HIDDEN);

function photoUri(): string | undefined {
  const props = photos()[0]?.props as { source?: { uri?: string } } | undefined;
  return props?.source?.uri;
}

/** fireEvent inside an awaited act, so React finishes the state update before the next line. */
async function fire(...args: Parameters<typeof fireEvent>): Promise<void> {
  await act(async () => {
    await fireEvent(...args);
  });
}

const IMAGE = {
  url: 'https://media.example.com/products/mug/full.webp',
  thumbUrl: 'https://media.example.com/products/mug/thumb.webp',
  alt: null,
};

const LINE: CartLine = cartLine({ productId: '11111111-1111-4111-8111-111111111111' });

function row(line: CartLine) {
  return (
    <CartLineRow
      line={line}
      quantity={line.quantity}
      selected
      onSelectedChange={() => {}}
      onQuantityChange={() => {}}
      onRemove={() => {}}
    />
  );
}

describe('CartLineRow: the product picture', () => {
  it('shows the line’s own thumbnail', async () => {
    await render(row({ ...LINE, image: IMAGE }));

    expect(photos()).toHaveLength(1);
    expect(photoUri()).toBe(IMAGE.thumbUrl);
    // The tile behind the photo is decorative; the name next to it carries the meaning.
    expect(screen.getByText('Blue mug')).toBeOnTheScreen();
  });

  it('shows the branded tile for a line without a picture', async () => {
    await render(row({ ...LINE, image: null }));

    expect(photos()).toHaveLength(0);
    expect(screen.getByText('Blue mug')).toBeOnTheScreen();
  });

  it('falls back to the tile when the picture fails to load, never a broken image', async () => {
    await render(row({ ...LINE, image: IMAGE }));
    expect(photos()).toHaveLength(1);

    await fire(photos()[0] as never, 'error');

    expect(photos()).toHaveLength(0);
  });

  it('swaps to the new picture when the line’s variant changes', async () => {
    const variantPhoto = {
      url: 'https://media.example.com/variants/red/full.webp',
      thumbUrl: 'https://media.example.com/variants/red/thumb.webp',
      alt: null,
    };
    const view = await render(row({ ...LINE, image: IMAGE }));
    expect(photoUri()).toBe(IMAGE.thumbUrl);

    await act(async () => {
      await view.rerender(row({ ...LINE, image: variantPhoto }));
    });

    expect(photoUri()).toBe(variantPhoto.thumbUrl);
    expect(photos()).toHaveLength(1);
  });

  it('names the chosen variant under the product name', async () => {
    await render(row({ ...LINE, variantLabel: 'Colour: Navy / Size: M', image: IMAGE }));

    expect(screen.getByText('Colour: Navy / Size: M')).toBeOnTheScreen();
  });
});

describe('Checkout ItemsSection: the order summary', () => {
  it('shows each line’s picture, name, variant and quantity', async () => {
    const quote = cartQuote([
      cartLine({
        productId: '11111111-1111-4111-8111-111111111111',
        name: 'Cotton shirt',
        variantId: '22222222-2222-4222-8222-222222222222',
        variantLabel: 'Colour: Navy / Size: M',
        image: IMAGE,
      }),
      cartLine({
        productId: '33333333-3333-4333-8333-333333333333',
        name: 'Brass lamp',
        image: null,
      }),
    ]);
    await render(<ItemsSection quote={quote} />);

    // One photo for the line that has one; the other keeps the branded tile.
    expect(photos()).toHaveLength(1);
    expect(photoUri()).toBe(IMAGE.thumbUrl);
    expect(screen.getByText('Cotton shirt')).toBeOnTheScreen();
    expect(screen.getByText('Colour: Navy / Size: M')).toBeOnTheScreen();
    expect(screen.getByText('Brass lamp')).toBeOnTheScreen();
  });
});
