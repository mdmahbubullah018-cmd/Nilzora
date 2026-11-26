import { bannerTarget } from '../features/brands/brand-components';

describe('bannerTarget (store paths from banners and campaign slides)', () => {
  it.each([
    ['/', '/'],
    ['/categories', '/categories'],
    ['/categories/panjabi', { pathname: '/category/[slug]', params: { slug: 'panjabi' } }],
    ['/products', { pathname: '/shop', params: {} }],
    ['/products/clay-mug', { pathname: '/product/[slug]', params: { slug: 'clay-mug' } }],
    ['/products?sort=newest', { pathname: '/shop', params: { sort: 'newest' } }],
    ['/search?q=cotton%20shirt', { pathname: '/shop', params: { q: 'cotton shirt' } }],
    ['/shop?category=sarees', { pathname: '/shop', params: { category: 'sarees' } }],
    ['/brands', '/brands'],
    ['/cart', '/cart'],
    ['/account', '/account'],
    ['/account/orders', '/orders'],
    ['/account/returns', '/returns'],
    ['/contact', '/store'],
    ['/aarong', { pathname: '/brand/[slug]', params: { slug: 'aarong' } }],
  ])('opens %s at the matching app screen', (href, expected) => {
    expect(bannerTarget(href)).toEqual(expected);
  });

  it('never treats a store section as a brand', () => {
    for (const section of ['/categories', '/shop', '/account', '/wishlist', '/orders']) {
      expect(JSON.stringify(bannerTarget(section))).not.toContain('/brand/');
    }
  });

  it('drops an unknown sort, and opens the shop for no or unknown deep paths', () => {
    expect(bannerTarget('/products?sort=drop')).toEqual({ pathname: '/shop', params: {} });
    expect(bannerTarget(null)).toEqual({ pathname: '/shop', params: {} });
    expect(bannerTarget('/some/deep/path')).toEqual({ pathname: '/shop', params: {} });
  });
});
