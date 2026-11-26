import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import robots from './robots';

const SITE = 'https://nilzora.test';

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

/** The single rule set a `*` crawler gets; the route shape allows several. */
function rule() {
  const value = robots().rules;
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined) throw new Error('robots() returned no rules');
  return first;
}

describe('robots', () => {
  it('opens the catalogue to crawlers', () => {
    expect(rule().userAgent).toBe('*');
    expect(rule().allow).toBe('/');
  });

  it('keeps a customer’s own pages and the sign-in flow out of search', () => {
    expect(rule().disallow).toStrictEqual([
      '/account',
      '/cart',
      '/checkout',
      '/login',
      '/register',
      '/verify-otp',
    ]);
  });

  it('points crawlers at the sitemap on the same host', () => {
    expect(robots().sitemap).toBe(`${SITE}/sitemap.xml`);
    expect(robots().host).toBe(SITE);
  });

  it('uses the configured address rather than a hardcoded domain', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://shop.example.test';

    expect(robots().sitemap).toBe('https://shop.example.test/sitemap.xml');
  });
});
