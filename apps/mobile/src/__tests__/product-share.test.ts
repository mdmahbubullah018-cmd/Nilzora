import { Share } from 'react-native';
import {
  brandShareTarget,
  categoryShareTarget,
  productShareTarget,
  shareBrand,
  shareCategory,
  shareProduct,
  storefrontBaseUrl,
} from '@/features/share/product-share';

/*
 * The share sheet is mocked: this proves the payload and the outcomes the app produces. It is not
 * evidence that Android drew its own sheet — that needs a device (see the report).
 */
jest.mock('react-native', () => ({
  Share: {
    share: jest.fn(),
    sharedAction: 'sharedAction',
    dismissedAction: 'dismissedAction',
  },
}));

const PRODUCT = {
  slug: 'clay-mug',
  name: 'Clay Mug',
  summary: 'Hand-thrown in Dhaka.',
  imageUrl: 'https://media.nilzora.test/products/clay-mug/full.webp',
};

const share = jest.spyOn(Share, 'share');

const original = {
  storefront: process.env.EXPO_PUBLIC_STOREFRONT_URL,
  api: process.env.EXPO_PUBLIC_API_BASE_URL,
};

beforeEach(() => {
  share.mockReset();
  share.mockResolvedValue({ action: Share.sharedAction } as never);
  process.env.EXPO_PUBLIC_STOREFRONT_URL = 'https://nilzora.com.bd';
});

afterAll(() => {
  share.mockRestore();
  if (original.storefront === undefined) delete process.env.EXPO_PUBLIC_STOREFRONT_URL;
  else process.env.EXPO_PUBLIC_STOREFRONT_URL = original.storefront;
  if (original.api === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
  else process.env.EXPO_PUBLIC_API_BASE_URL = original.api;
});

describe('productShareTarget', () => {
  it('builds the product’s public page on the configured storefront', () => {
    expect(productShareTarget(PRODUCT)).toEqual({
      kind: 'product',
      title: 'Clay Mug',
      text: 'Clay Mug — Hand-thrown in Dhaka.',
      url: 'https://nilzora.com.bd/products/clay-mug',
      imageUrl: 'https://media.nilzora.test/products/clay-mug/full.webp',
    });
  });

  it('encodes the slug instead of pasting it into the address', () => {
    expect(productShareTarget({ ...PRODUCT, slug: 'a b' })?.url).toBe(
      'https://nilzora.com.bd/products/a%20b',
    );
  });

  it('shares nothing when the build has no storefront address', () => {
    // A release build never guesses; `__DEV__` is set by the test environment below.
    process.env.EXPO_PUBLIC_STOREFRONT_URL = '';
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    expect(storefrontBaseUrl()).toBeNull();
    expect(productShareTarget(PRODUCT)).toBeNull();
  });

  it('points at the local storefront in development, on the API’s own host', () => {
    process.env.EXPO_PUBLIC_STOREFRONT_URL = '';
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://192.168.0.10:4000';
    expect(storefrontBaseUrl()).toBe('http://192.168.0.10:3000');
    expect(productShareTarget(PRODUCT)?.url).toBe('http://192.168.0.10:3000/products/clay-mug');
  });
});

describe('shareProduct', () => {
  it('opens the sheet with a message that carries the address', async () => {
    await expect(shareProduct(PRODUCT)).resolves.toBe('shared');

    expect(share).toHaveBeenCalledWith({
      title: 'Clay Mug',
      message: 'Clay Mug — Hand-thrown in Dhaka.\nhttps://nilzora.com.bd/products/clay-mug',
      url: 'https://nilzora.com.bd/products/clay-mug',
    });
  });

  it('treats a dismissed sheet as neither success nor failure', async () => {
    share.mockResolvedValue({ action: 'dismissedAction', activityType: undefined });
    await expect(shareProduct(PRODUCT)).resolves.toBe('dismissed');
  });

  it('reports a real failure instead of claiming success', async () => {
    share.mockRejectedValue(new Error('no activity'));
    await expect(shareProduct(PRODUCT)).resolves.toBe('failed');
  });

  it('never opens the sheet when there is no link to share', async () => {
    process.env.EXPO_PUBLIC_STOREFRONT_URL = '';
    delete process.env.EXPO_PUBLIC_API_BASE_URL;

    await expect(shareProduct(PRODUCT)).resolves.toBe('unavailable');
    expect(share).not.toHaveBeenCalled();
  });
});

describe('category and brand targets', () => {
  const collection = {
    slug: 'panjabi',
    name: 'Panjabi',
    description: 'Festive wear for men.',
    imageUrl: 'https://media.nilzora.test/categories/panjabi/cover.webp',
  };

  it('points a category at the storefront’s own category page', () => {
    expect(categoryShareTarget(collection)).toEqual({
      kind: 'category',
      title: 'Panjabi',
      text: 'Panjabi — Festive wear for men.',
      url: 'https://nilzora.com.bd/categories/panjabi',
      imageUrl: 'https://media.nilzora.test/categories/panjabi/cover.webp',
    });
  });

  it('points a brand at the site root, where the storefront serves it', () => {
    expect(brandShareTarget({ ...collection, slug: 'aarong', name: 'Aarong' })?.url).toBe(
      'https://nilzora.com.bd/aarong',
    );
  });

  it('encodes a slug instead of pasting it into the path', () => {
    expect(categoryShareTarget({ ...collection, slug: 'a b' })?.url).toBe(
      'https://nilzora.com.bd/categories/a%20b',
    );
  });

  it('shares nothing when the build has no storefront address', async () => {
    process.env.EXPO_PUBLIC_STOREFRONT_URL = '';
    delete process.env.EXPO_PUBLIC_API_BASE_URL;

    expect(categoryShareTarget(collection)).toBeNull();
    expect(brandShareTarget(collection)).toBeNull();
    await expect(shareCategory(collection)).resolves.toBe('unavailable');
    await expect(shareBrand(collection)).resolves.toBe('unavailable');
    expect(share).not.toHaveBeenCalled();
  });

  it('opens the phone’s sheet with the collection’s page', async () => {
    await expect(shareCategory(collection)).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({
      title: 'Panjabi',
      message: 'Panjabi — Festive wear for men.\nhttps://nilzora.com.bd/categories/panjabi',
      url: 'https://nilzora.com.bd/categories/panjabi',
    });
  });
});
