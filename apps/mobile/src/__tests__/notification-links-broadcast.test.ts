import {
  categorySlugFromData,
  productSlugFromData,
  screenFromData,
} from '@/notifications/notification-links';

describe('where a broadcast tap leads', () => {
  it('opens a category only for a well-formed slug', () => {
    expect(categorySlugFromData({ categorySlug: 'fashion' })).toBe('fashion');
    expect(categorySlugFromData({ categorySlug: 'men-s-shirts' })).toBe('men-s-shirts');
    for (const bad of [
      '../admin',
      'Fashion',
      'a/b',
      'https://x.test',
      '',
      'x'.repeat(121),
      42,
      null,
    ]) {
      expect(categorySlugFromData({ categorySlug: bad })).toBeNull();
    }
    expect(categorySlugFromData(null)).toBeNull();
  });

  it('opens only the fixed screens it knows', () => {
    expect(screenFromData({ screen: 'wishlist' })).toBe('/wishlist');
    expect(screenFromData({ screen: 'home' })).toBe('/');
    expect(screenFromData({ screen: 'settings' })).toBeNull();
    expect(screenFromData({ screen: '/sign-in' })).toBeNull();
    expect(screenFromData({ screen: 'constructor' })).toBeNull();
    expect(screenFromData(undefined)).toBeNull();
  });

  it('keeps the product rule as it was', () => {
    expect(productSlugFromData({ productSlug: 'cotton-panjabi' })).toBe('cotton-panjabi');
    expect(productSlugFromData({ categorySlug: 'fashion' })).toBeNull();
  });
});
