import { describe, expect, it } from 'vitest';
import { absoluteShareUrl, originOf, shareMessage, shareTarget, shareablePath } from './share';

const BASE = 'https://nilzora.test';

describe('originOf', () => {
  it('reduces a configured base to its scheme and host', () => {
    expect(originOf('https://nilzora.test')).toBe('https://nilzora.test');
    expect(originOf('HTTPS://Nilzora.Test/')).toBe('https://nilzora.test');
    expect(originOf('http://192.168.0.10:3000')).toBe('http://192.168.0.10:3000');
  });

  it('refuses credentials, other schemes and anything that is not a bare origin', () => {
    expect(originOf('https://user:pass@nilzora.test')).toBeNull();
    expect(originOf('javascript:alert(1)')).toBeNull();
    expect(originOf('//nilzora.test')).toBeNull();
    expect(originOf('')).toBeNull();
  });
});

describe('shareablePath', () => {
  it('accepts the public pages a shopper can share', () => {
    for (const path of [
      '/',
      '/products/clay-mug',
      '/categories/home',
      '/north-star',
      '/brands',
      '/about',
    ]) {
      expect(shareablePath(path)).toBe(true);
    }
  });

  it('refuses account, admin, checkout and other private areas', () => {
    for (const path of [
      '/account',
      '/account/orders/NZ-1',
      '/checkout',
      '/cart',
      '/wishlist',
      '/admin/products/1',
      '/moderator',
      '/api/v1/cart',
      '/auth/callback',
      '/support',
    ]) {
      expect(shareablePath(path)).toBe(false);
    }
  });

  it('refuses anything that is not a path on this site', () => {
    for (const path of ['https://evil.test/x', '//evil.test/x', '/\\evil.test', 'products/x', '']) {
      expect(shareablePath(path)).toBe(false);
    }
  });
});

describe('absoluteShareUrl', () => {
  it('builds the canonical address on the configured origin', () => {
    expect(absoluteShareUrl('/products/clay-mug', BASE)).toBe(`${BASE}/products/clay-mug`);
    expect(absoluteShareUrl('/products/clay-mug', `${BASE}/`)).toBe(`${BASE}/products/clay-mug`);
    expect(absoluteShareUrl('/products/clay-mug', `  ${BASE}  `)).toBe(`${BASE}/products/clay-mug`);
  });

  it('ignores a path the configured base happens to carry', () => {
    // The same rule the URL class applies to an absolute path.
    expect(absoluteShareUrl('/products/clay-mug', `${BASE}/shop`)).toBe(
      `${BASE}/products/clay-mug`,
    );
  });

  it('drops the query, the fragment and a token hidden in either', () => {
    expect(absoluteShareUrl('/products/clay-mug?reviews=2#reviews', BASE)).toBe(
      `${BASE}/products/clay-mug`,
    );
    expect(absoluteShareUrl('/products/clay-mug?access_token=secret', BASE)).not.toContain(
      'secret',
    );
  });

  it('refuses a private path even when asked for one directly', () => {
    expect(absoluteShareUrl('/admin/products/1', BASE)).toBeNull();
    expect(absoluteShareUrl('/account/orders/NZ-1', BASE)).toBeNull();
  });

  it('refuses a base that is not a usable public origin', () => {
    expect(absoluteShareUrl('/products/x', 'not a url')).toBeNull();
    expect(absoluteShareUrl('/products/x', 'ftp://nilzora.test')).toBeNull();
    expect(absoluteShareUrl('/products/x', 'https://user:pass@nilzora.test')).toBeNull();
    expect(absoluteShareUrl('/products/x', 'https://nilzora.test evil.test')).toBeNull();
  });

  it('cannot be walked onto another host or another page by a dot segment', () => {
    expect(absoluteShareUrl('//evil.test/x', BASE)).toBeNull();
    expect(absoluteShareUrl('/\\evil.test', BASE)).toBeNull();
    // The dangerous shape: a public prefix, then enough .. to reach the admin workspace.
    expect(absoluteShareUrl('/products/../../admin/products/1', BASE)).toBeNull();
    expect(absoluteShareUrl('/products/%2e%2e/%2e%2e/admin', BASE)).toBeNull();
    expect(absoluteShareUrl('/products/a%2F..%2Fadmin', BASE)).toBeNull();
  });
});

describe('shareTarget', () => {
  const product = {
    kind: 'product' as const,
    title: 'Clay Mug',
    description: 'Hand-thrown in Dhaka.',
    path: '/products/clay-mug',
    base: BASE,
    imageUrl: `${BASE}/media/clay-mug.webp`,
  };

  it('carries the name, the store’s own line and the canonical address', () => {
    expect(shareTarget(product)).toEqual({
      kind: 'product',
      title: 'Clay Mug',
      text: 'Clay Mug — Hand-thrown in Dhaka.',
      url: `${BASE}/products/clay-mug`,
      imageUrl: `${BASE}/media/clay-mug.webp`,
    });
  });

  it('uses the name alone when the record has no description', () => {
    expect(shareTarget({ ...product, description: null })?.text).toBe('Clay Mug');
    expect(shareTarget({ ...product, description: '   ' })?.text).toBe('Clay Mug');
  });

  it('collapses whitespace so a shared line stays one line', () => {
    const target = shareTarget({ ...product, title: '  Clay\n  Mug ', description: ' A   mug ' });
    expect(target?.title).toBe('Clay Mug');
    expect(target?.text).toBe('Clay Mug — A mug');
  });

  it('never shares a private path, and says nothing rather than a broken link', () => {
    expect(shareTarget({ ...product, path: '/admin/products/1' })).toBeNull();
    expect(shareTarget({ ...product, path: 'https://evil.test/x' })).toBeNull();
  });

  it('refuses a record with no name', () => {
    expect(shareTarget({ ...product, title: '   ' })).toBeNull();
  });

  it('drops a picture that is not a public http(s) address', () => {
    expect(shareTarget({ ...product, imageUrl: 'javascript:alert(1)' })?.imageUrl).toBeNull();
    expect(shareTarget({ ...product, imageUrl: `/media/x.webp` })?.imageUrl).toBeNull();
    expect(
      shareTarget({ ...product, imageUrl: 'https://user:pass@nilzora.test/x.webp' })?.imageUrl,
    ).toBeNull();
  });

  it('cuts long text at a word boundary instead of mid-word', () => {
    const target = shareTarget({ ...product, title: 'Mug', description: 'word '.repeat(80) });
    expect(target?.text.length).toBeLessThanOrEqual(241);
    expect(target?.text.endsWith('…')).toBe(true);
    expect(target?.text).not.toContain('  ');
  });
});

describe('shareMessage', () => {
  it('includes the address, because Android sends only the message', () => {
    const target = shareTarget({
      kind: 'product',
      title: 'Clay Mug',
      path: '/products/clay-mug',
      base: BASE,
    });
    expect(target === null ? null : shareMessage(target)).toBe(
      `Clay Mug\n${BASE}/products/clay-mug`,
    );
  });
});
