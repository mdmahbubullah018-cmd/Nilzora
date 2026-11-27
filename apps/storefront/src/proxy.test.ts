import { describe, expect, it } from 'vitest';
import { config } from './proxy';

/*
 * Pages whose forms carry a CSRF token (or read the session with read()) only work
 * under the proxy, which issues the CSRF cookie and refreshes sessions before they
 * render. A product page belongs there now: its review panel reads the customer's own
 * review and posts the review and its photos from that address. The rest of the catalog
 * stays outside it, so browsing never sets cookies.
 */

/** The subset of Next.js matcher syntax the storefront uses: exact paths, `/:path*`, `/:path+`. */
function matches(path: string): boolean {
  return config.matcher.some((pattern) => {
    for (const suffix of ['/:path+', '/:path*'] as const) {
      if (!pattern.endsWith(suffix)) continue;
      const base = pattern.slice(0, -suffix.length);
      const rest = path.startsWith(`${base}/`) ? path.slice(base.length + 1) : null;
      // `:path+` needs at least one segment; `:path*` also matches the base itself.
      return suffix === '/:path+' ? rest !== null && rest !== '' : path === base || rest !== null;
    }
    return path === pattern;
  });
}

describe('proxy matcher', () => {
  it.each([
    '/checkout',
    '/account',
    '/account/orders',
    '/account/orders/NZ100001',
    '/account/addresses',
    '/account/addresses/new',
    '/account/addresses/ad000000-0000-4000-8000-000000000001/edit',
    '/account/addresses/ad000000-0000-4000-8000-000000000001/delete',
    '/login',
    '/register',
    '/confirm-email',
    // The review form: the customer's own review is read here, and the saved review and
    // its photos are posted here.
    '/products/casual-t-shirt',
    '/api/uploads/review-photo',
  ])('covers %s, which renders CSRF-protected forms', (path) => {
    expect(matches(path)).toBe(true);
  });

  it.each(['/', '/products', '/categories', '/categories/fashion', '/search', '/cart', '/brands'])(
    'leaves %s alone, so it never sets session cookies',
    (path) => {
      expect(matches(path)).toBe(false);
    },
  );
});
