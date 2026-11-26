import 'server-only';
import type { PublicStoreProfile, SeoKind, SeoMetadata } from '@nilzora/contracts';
import type { Metadata } from 'next';
import { cache } from 'react';
import { siteUrl } from '@/lib/site-url';
import { session } from '@/lib/session';

/*
 * Page metadata
 * -------------
 * Resolved on the server from the storefront's public client, so a page's title, description
 * and canonical link describe exactly the content the visitor is about to see. The API only
 * answers for published content, so a draft product has no metadata to leak — the page itself
 * 404s and so does this read.
 *
 * Nothing here claims a ranking or invents a score: it sets what the store typed, with the
 * page's own name and summary as the fallback.
 */

/*
 * Share images and the store logo
 * ------------------------------
 * The API is the only process that knows the bucket's public address (R2_PUBLIC_BASE_URL),
 * so it resolves `ogImageKey`/`logoKey` into `ogImageUrl`/`logoUrl` on the way out (see the
 * API's media/public-url.ts). This module never builds a media URL: it only accepts a
 * finished absolute http(s) address, and shows nothing when the store has not published one.
 */

/** The site's own address, used to make every canonical and share link absolute. */
export { siteUrl };

/**
 * An absolute canonical link, or null when the stored path is not one this site may claim.
 *
 * The API validates canonical paths on save, but a canonical is a claim about identity: a
 * protocol-relative path (`//elsewhere.example`) or a path that resolves to another origin
 * would point search engines at a site Nilzora does not own. Such a row is ignored rather
 * than trusted.
 */
function canonicalUrl(path: string, base: URL): string | null {
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return null;
  const url = new URL(path, base);
  return url.origin === base.origin ? url.toString() : null;
}

const NO_INDEX: Metadata['robots'] = { index: false, follow: false };

/**
 * The share-image part of an Open Graph block, or nothing.
 *
 * The URL arrives already resolved by the API, but a metadata tag is a public claim, so it
 * is checked once more here: absolute http(s), no credentials. Anything else is dropped
 * rather than printed.
 */
function shareImage(url: string | null): { images?: { url: string }[] } {
  if (url === null) return {};
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {};
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return {};
  if (parsed.username !== '' || parsed.password !== '') return {};
  return { images: [{ url: parsed.toString() }] };
}

/**
 * The X/Twitter card, built from the same words and picture as the Open Graph block.
 *
 * It is produced only where an Open Graph block is: a page with no trustworthy canonical has no
 * share card at all, so a link preview can never describe a page this site is not claiming.
 */
export function twitterCard(
  title: string,
  description: string | null,
  imageUrl: string | null,
): NonNullable<Metadata['twitter']> {
  const image = shareImage(imageUrl)?.images?.[0]?.url;
  return {
    card: image === undefined ? 'summary' : 'summary_large_image',
    title,
    ...(description === null ? {} : { description }),
    ...(image === undefined ? {} : { images: [image] }),
  };
}

export interface PageFallback {
  title: string;
  description?: string | null;
  imageKey?: string | null;
  /**
   * The page's own address (e.g. /products/clay-mug). With it, a page the store has saved no
   * SEO for still names itself as canonical and gets a share card built from its own content.
   */
  path?: string;
  /** The page's own picture (an absolute media URL from the API), for its share card. */
  imageUrl?: string | null;
}

/** The page's own metadata, with the store's SEO overrides applied when it has any. */
export async function pageMetadata(
  kind: SeoKind,
  slug: string,
  fallback: PageFallback,
): Promise<Metadata> {
  const base = siteUrl();
  let seo: SeoMetadata | null = null;
  try {
    seo = (await session.publicApi().publicSeo(kind, slug)).seo;
  } catch {
    console.error('[nilzora] page metadata could not be resolved', { kind });
  }

  const description =
    fallback.description === null || fallback.description === undefined
      ? {}
      : { description: fallback.description };

  // No override, or the read failed: the page describes itself from its own content, and its
  // indexing is left exactly as the route decides it.
  if (seo === null) {
    const canonical = fallback.path === undefined ? null : canonicalUrl(fallback.path, base);
    return {
      title: fallback.title,
      ...description,
      ...(canonical === null
        ? {}
        : {
            alternates: { canonical },
            openGraph: {
              title: fallback.title,
              ...description,
              url: canonical,
              type: 'website',
              ...shareImage(fallback.imageUrl ?? null),
            },
            twitter: twitterCard(
              fallback.title,
              fallback.description ?? null,
              fallback.imageUrl ?? null,
            ),
          }),
    };
  }

  const canonical = canonicalUrl(seo.canonicalPath, base);
  return {
    title: seo.title,
    ...(seo.description === null ? {} : { description: seo.description }),
    ...(canonical === null
      ? {}
      : {
          alternates: { canonical },
          openGraph: {
            title: seo.ogTitle,
            ...(seo.ogDescription === null ? {} : { description: seo.ogDescription }),
            url: canonical,
            siteName: seo.defaultSeoTitle ?? 'Nilzora',
            type: 'website',
            // The store's chosen share image, or else the page's own picture.
            ...shareImage(seo.ogImageUrl ?? fallback.imageUrl ?? null),
          },
          twitter: twitterCard(
            seo.ogTitle,
            seo.ogDescription,
            seo.ogImageUrl ?? fallback.imageUrl ?? null,
          ),
        }),
    robots: seo.noIndex ? NO_INDEX : { index: true, follow: true },
  };
}

/**
 * The site's default metadata, taken from the store's published profile: the name, the title
 * template, the default description and the site name for share cards.
 *
 * Deliberately page-specific values are left out: no canonical, no share title, description
 * or URL. The root layout applies this to every page, and only a page knows its own address —
 * a site-wide canonical would tell search engines that the cart and the account pages *are*
 * the home page. Product and category pages keep overriding all of this through
 * pageMetadata().
 */
export async function storeMetadata(): Promise<Metadata> {
  const profile = await storeProfile();
  const base = siteUrl();
  const name = profile?.displayName ?? 'Nilzora';
  const title = profile?.defaultSeoTitle ?? name;
  const description = profile?.defaultSeoDescription ?? profile?.tagline ?? null;
  return {
    metadataBase: base,
    title: { default: title, template: `%s · ${name}` },
    ...(description === null ? {} : { description }),
    openGraph: {
      siteName: name,
      type: 'website',
      ...shareImage(profile?.ogImageUrl ?? null),
    },
  };
}

/** The wording this site described itself with before the store profile existed. */
const SITE_DESCRIPTION = 'Nilzora — online shopping for Bangladesh with Cash on Delivery.';

/**
 * What the root layout publishes: the store's defaults, with that fixed description standing
 * in when the store has published neither a default description nor a tagline, or when the
 * profile cannot be read at all. The site never goes without a description, and never
 * guesses one.
 */
export async function rootMetadata(): Promise<Metadata> {
  const metadata = await storeMetadata();
  return metadata.description === undefined
    ? { ...metadata, description: SITE_DESCRIPTION }
    : metadata;
}

/**
 * The public store profile, or null when the API cannot answer right now.
 *
 * Cached for the length of one request: the root metadata, the shop layout's logo and any
 * page that needs the profile share a single read instead of repeating it.
 */
export const storeProfile = cache(async (): Promise<PublicStoreProfile | null> => {
  try {
    return (await session.publicApi().publicStoreProfile()).profile;
  } catch {
    console.error('[nilzora] the store profile could not be resolved');
    return null;
  }
});
