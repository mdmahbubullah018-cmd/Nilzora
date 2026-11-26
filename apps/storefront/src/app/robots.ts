import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/seo';

/**
 * What a crawler may fetch. Catalog pages are open; a customer's own pages and everything
 * behind the staff workspaces are not, because they are either personal or unreachable
 * without a session. The storefront never serves the admin or API hosts, so those paths are
 * listed only to keep a copied configuration honest.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/account', '/cart', '/checkout', '/login', '/register', '/verify-otp'],
      },
    ],
    sitemap: new URL('/sitemap.xml', base).toString(),
    host: base.origin,
  };
}
