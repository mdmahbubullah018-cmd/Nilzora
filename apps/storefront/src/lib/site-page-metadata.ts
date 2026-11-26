import 'server-only';
import type { PublicSitePage } from '@nilzora/contracts';
import type { Metadata } from 'next';
import { siteUrl } from '@/lib/seo';

/**
 * Page metadata from what the store typed: its SEO title and description when it set them,
 * otherwise the page title. The canonical link is this site's own address for the page.
 */
export function sitePageMetadata(page: PublicSitePage, path: string): Metadata {
  const title = page.seoTitle ?? page.title;
  const description = page.seoDescription ?? undefined;
  return {
    title,
    ...(description === undefined ? {} : { description }),
    alternates: { canonical: new URL(path, siteUrl()).toString() },
    openGraph: { title, ...(description === undefined ? {} : { description }), type: 'website' },
  };
}
