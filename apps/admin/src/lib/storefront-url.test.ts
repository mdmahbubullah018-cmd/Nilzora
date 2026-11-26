import { afterEach, describe, expect, it } from 'vitest';
import { productShareTarget, storefrontBaseUrl, storefrontProductPath } from './storefront-url';

const PRODUCT = {
  slug: 'clay-mug',
  name: 'Clay Mug',
  summary: 'Hand-thrown in Dhaka.',
  image: { url: 'https://media.nilzora.test/products/clay-mug/full.webp' },
};

function setStorefront(value: string | undefined) {
  if (value === undefined) delete process.env.STOREFRONT_URL;
  else process.env.STOREFRONT_URL = value;
}

afterEach(() => {
  setStorefront(undefined);
});

describe('storefrontBaseUrl', () => {
  it('uses the configured storefront, and nothing else', () => {
    setStorefront('https://nilzora.com.bd');
    expect(storefrontBaseUrl()).toBe('https://nilzora.com.bd');
  });

  it('falls back to the storefront’s own development default when local', () => {
    setStorefront(undefined);
    expect(storefrontBaseUrl()).toBe('http://localhost:3000');
  });

  it('refuses a value that is not an address', () => {
    setStorefront('not a url');
    expect(storefrontBaseUrl()).toBeNull();
    expect(productShareTarget(PRODUCT)).toBeNull();
  });
});

describe('storefrontProductPath', () => {
  it('builds the public product path, encoded', () => {
    expect(storefrontProductPath('clay-mug')).toBe('/products/clay-mug');
    expect(storefrontProductPath('a b')).toBe('/products/a%20b');
  });
});

describe('productShareTarget', () => {
  it('builds the public product link, not an admin one', () => {
    setStorefront('https://nilzora.com.bd');

    expect(productShareTarget(PRODUCT)).toEqual({
      kind: 'product',
      title: 'Clay Mug',
      text: 'Clay Mug — Hand-thrown in Dhaka.',
      url: 'https://nilzora.com.bd/products/clay-mug',
      imageUrl: 'https://media.nilzora.test/products/clay-mug/full.webp',
    });
  });

  it('never produces an admin route', () => {
    setStorefront('https://nilzora.com.bd');
    const target = productShareTarget(PRODUCT);
    expect(target?.url).not.toContain('/admin');
  });

  it('shares nothing when the workspace has no storefront to point at', () => {
    setStorefront('');
    const original = process.env.NODE_ENV;
    // A production build must not guess a localhost address.
    try {
      Object.assign(process.env, { NODE_ENV: 'production' });
      expect(storefrontBaseUrl()).toBeNull();
      expect(productShareTarget(PRODUCT)).toBeNull();
    } finally {
      Object.assign(process.env, { NODE_ENV: original });
    }
  });
});
