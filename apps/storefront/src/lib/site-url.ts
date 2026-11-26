/*
 * The site's own address, kept apart from `seo.ts` because it is public configuration rather
 * than a server read. Sharing needs the same origin on both sides: a product card (which a
 * client component may render, as the visual search results do) builds the identical share
 * link its server-rendered page does, without dragging `next/headers` into the browser.
 */

/** The site's own address, used to make every canonical and share link absolute. */
export function siteUrl(): URL {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return new URL(
    configured === undefined || configured === '' ? 'http://localhost:3000' : configured,
  );
}
