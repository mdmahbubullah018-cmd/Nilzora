import { act, fireEvent, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { ProductCard } from '../features/catalog/product-card';
import { ProductGallery } from '../features/catalog/product-gallery';
import { productImage, summary } from '../features/catalog/test-fixtures';
import { resetRouterMock } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';
import { theme } from '../theme';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

beforeEach(() => {
  resetRouterMock();
});

/** fireEvent inside an awaited act, so React finishes the state update before the next line. */
async function fire(...args: Parameters<typeof fireEvent>): Promise<void> {
  await act(async () => {
    await fireEvent(...args);
  });
}

const HIDDEN = { includeHiddenElements: true } as const;
const photos = () => screen.queryAllByTestId('product-photo', HIDDEN);
const category = { slug: 'fashion' };
const gallery = (images: ReturnType<typeof productImage>[]) => (
  <ProductGallery product={{ name: 'Cotton shirt', category, images }} />
);

describe('product photos on a card', () => {
  it('lays the thumbnail over the placeholder tile', async () => {
    const image = productImage(1);
    await renderWithProviders(<ProductCard product={summary({ image })} width={160} />);

    expect(photos()).toHaveLength(1);
    const props = photos()[0]?.props as { source: { uri: string } };
    expect(props.source.uri).toBe(image.thumbUrl);
  });

  it('shows only the placeholder for a product without a photo', async () => {
    await renderWithProviders(<ProductCard product={summary({ image: null })} width={160} />);

    expect(photos()).toHaveLength(0);
    // The card still reads as one button with its name and price.
    expect(screen.getByRole('button', { name: /^Cotton shirt, Price/ })).toBeOnTheScreen();
  });

  it('falls back to the placeholder when the photo fails to load', async () => {
    await renderWithProviders(
      <ProductCard product={summary({ image: productImage(1) })} width={160} />,
    );
    expect(photos()).toHaveLength(1);

    await fire(photos()[0] as never, 'error');

    expect(photos()).toHaveLength(0);
    expect(screen.getByRole('button', { name: /^Cotton shirt, Price/ })).toBeOnTheScreen();
  });

  it('tries a different photo again after one failed', async () => {
    const view = await renderWithProviders(
      <ProductCard product={summary({ image: productImage(1) })} width={160} />,
    );
    await fire(photos()[0] as never, 'error');
    expect(photos()).toHaveLength(0);

    await act(async () => {
      await view.rerender(
        <ProductCard product={summary({ image: productImage(2) })} width={160} />,
      );
    });

    expect(photos()).toHaveLength(1);
  });

  it('keeps the photo out of the accessibility tree (the card is read once)', async () => {
    await renderWithProviders(
      <ProductCard product={summary({ image: productImage(1) })} width={160} />,
    );

    expect(screen.queryByTestId('product-photo')).not.toBeOnTheScreen();
  });
});

describe('ProductGallery', () => {
  const pageWidth = Dimensions.get('window').width - theme.spacing[5] * 2;

  it('is the placeholder tile when the product has no photos', async () => {
    await renderWithProviders(gallery([]));

    expect(photos()).toHaveLength(0);
    expect(screen.queryByTestId('product-gallery-list')).not.toBeOnTheScreen();
  });

  it('shows one photo without dots', async () => {
    await renderWithProviders(gallery([productImage(1)]));

    expect(photos()).toHaveLength(1);
    expect(screen.queryByTestId('gallery-dot', HIDDEN)).not.toBeOnTheScreen();
    expect(screen.queryByTestId('gallery-dot-active', HIDDEN)).not.toBeOnTheScreen();
  });

  it('is one adjustable element naming the product and the page', async () => {
    await renderWithProviders(gallery([productImage(1), productImage(2)]));

    const element = screen.getByRole('adjustable', { name: 'Cotton shirt photo' });
    expect(element).toHaveAccessibilityValue({ text: '1 of 2' });
  });

  it('pages with a swipe: the label, the value and the active dot follow', async () => {
    await renderWithProviders(
      gallery([
        productImage(1, { alt: 'Front of the shirt' }),
        productImage(2, { alt: 'Back of the shirt' }),
        productImage(3),
      ]),
    );
    expect(screen.getByRole('adjustable', { name: 'Front of the shirt' })).toBeOnTheScreen();
    expect(screen.getAllByTestId('gallery-dot', HIDDEN)).toHaveLength(2);
    expect(screen.getAllByTestId('gallery-dot-active', HIDDEN)).toHaveLength(1);

    await fire(screen.getByTestId('product-gallery-list'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: pageWidth, y: 0 } },
    });
    expect(screen.getByRole('adjustable', { name: 'Back of the shirt' })).toHaveAccessibilityValue({
      text: '2 of 3',
    });

    await fire(screen.getByTestId('product-gallery-list'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: pageWidth * 2, y: 0 } },
    });
    // No description: the product name stands in.
    expect(screen.getByRole('adjustable', { name: 'Cotton shirt photo' })).toHaveAccessibilityValue(
      { text: '3 of 3' },
    );
  });

  it('moves a page for screen-reader increment and decrement, and stops at the ends', async () => {
    await renderWithProviders(gallery([productImage(1), productImage(2)]));
    const element = () => screen.getByRole('adjustable', { name: /Cotton shirt photo/ });
    const press = async (actionName: string) => {
      await fire(element(), 'accessibilityAction', { nativeEvent: { actionName } });
    };

    await press('increment');
    expect(element()).toHaveAccessibilityValue({ text: '2 of 2' });
    await press('increment');
    expect(element()).toHaveAccessibilityValue({ text: '2 of 2' });
    await press('decrement');
    await press('decrement');
    expect(element()).toHaveAccessibilityValue({ text: '1 of 2' });
  });

  it('falls back to the placeholder for a photo that fails to load', async () => {
    await renderWithProviders(gallery([productImage(1)]));

    await fire(photos()[0] as never, 'error');

    expect(photos()).toHaveLength(0);
  });
});

describe('ProductGallery: the chosen variant’s own photo', () => {
  const variantPhoto = 'https://media.example.com/variants/red.webp';

  const withVariant = (variantImageUrl: string | null) => (
    <ProductGallery
      product={{ name: 'Cotton shirt', category, images: [productImage(1), productImage(2)] }}
      variantImageUrl={variantImageUrl}
      variantLabel="Red · M"
    />
  );

  it('shows the variant photo instead of the product’s pictures, and says which variant it is', async () => {
    await renderWithProviders(withVariant(variantPhoto));

    expect(photos()).toHaveLength(1);
    const props = photos()[0]?.props as { source: { uri: string } };
    expect(props.source.uri).toBe(variantPhoto);
    expect(
      screen.getByRole('adjustable', { name: 'Cotton shirt, Red · M photo' }),
    ).toHaveAccessibilityValue({ text: '1 of 1' });
    // One page needs no dots.
    expect(screen.queryByTestId('gallery-dot-active', HIDDEN)).not.toBeOnTheScreen();
  });

  it('brings the product’s own pictures back when the variant has none', async () => {
    const view = await renderWithProviders(withVariant(variantPhoto));
    expect(photos()).toHaveLength(1);

    await act(async () => {
      await view.rerender(withVariant(null));
    });

    // The gallery is the product's two pictures again, starting on the first.
    expect(screen.getByRole('adjustable')).toHaveAccessibilityValue({ text: '1 of 2' });
    expect(screen.getAllByTestId('gallery-dot', HIDDEN)).toHaveLength(1);
    expect(photos()[0]?.props).toMatchObject({
      source: { uri: 'https://media.example.com/products/p/1/full.webp' },
    });
  });

  it('starts a new variant photo on its first page, never a page number from the last one', async () => {
    const pageWidth = Dimensions.get('window').width - theme.spacing[5] * 2;
    const view = await renderWithProviders(withVariant(null));
    await fire(screen.getByTestId('product-gallery-list'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: pageWidth, y: 0 } },
    });
    expect(screen.getByRole('adjustable')).toHaveAccessibilityValue({ text: '2 of 2' });

    await act(async () => {
      await view.rerender(withVariant(variantPhoto));
    });

    expect(screen.getByRole('adjustable')).toHaveAccessibilityValue({ text: '1 of 1' });
  });
});

describe('ProductGallery: product videos', () => {
  const video = {
    id: '9e000000-0000-4000-8000-000000000001',
    url: 'https://media.example/products/p/videos/v.mp4',
    contentType: 'video/mp4' as const,
    bytes: 2_000_000,
    title: 'Shirt in motion',
    position: 0,
  };

  it('adds each video as a page after the photos, as a poster until it is in view', async () => {
    await renderWithProviders(
      <ProductGallery
        product={{ name: 'Cotton shirt', category, images: [productImage(1)], videos: [video] }}
      />,
    );

    expect(photos()).toHaveLength(1);
    // The pages render as they come near; the video is the second of two.
    expect(screen.getByRole('adjustable').props.accessibilityValue).toEqual({ text: '1 of 2' });
    expect(screen.queryAllByTestId('gallery-dot', HIDDEN)).toHaveLength(1);
    expect(screen.getByTestId('gallery-dot-active', HIDDEN)).toBeOnTheScreen();
  });

  it('plays the video in place when it is the page in view, never as a link', async () => {
    await renderWithProviders(
      <ProductGallery product={{ name: 'Cotton shirt', category, images: [], videos: [video] }} />,
    );

    expect(screen.getByLabelText('Shirt in motion', HIDDEN)).toBeOnTheScreen();
    expect(screen.queryByText('MP4', { exact: false })).not.toBeOnTheScreen();
  });
});
