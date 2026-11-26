import 'server-only';
import type { HomepageSection, Navigation, PublicSitePage, SitePageSlug } from '@nilzora/contracts';
import type { PublicApiClient } from '@nilzora/web-session';
import { cache } from 'react';
import { attempt, cachedApi } from '@/lib/catalog';

/*
 * Content the store manages: static pages, navigation links and homepage sections.
 *
 * Every read goes through the same cached public fetch as the catalog (Next.js keeps an
 * answer for 60 seconds, so a change in the admin workspace reaches the site within about a
 * minute — there is no push invalidation). And every read is optional: an outage, an
 * unwritten page or an empty table all answer null, and the caller shows what the site showed
 * before this content existed. Nothing here can fail a page.
 */

export const SITE_CONTENT_TAG = 'site-content';

async function read<T>(call: (api: PublicApiClient) => Promise<T>): Promise<T | null> {
  try {
    const result = await attempt(() => call(cachedApi([SITE_CONTENT_TAG])));
    return result.kind === 'ok' ? result.value : null;
  } catch {
    // Anything unexpected also means "no managed content": the page still renders.
    return null;
  }
}

/** A published static page, or null (unwritten, unpublished, or the store is unreachable). */
export const getSitePage = cache((slug: SitePageSlug): Promise<PublicSitePage | null> =>
  read(async (api) => (await api.publicSitePage(slug)).page),
);

/** The active navigation links and published pages, or null. */
export const getNavigation = cache((): Promise<Navigation | null> =>
  read(async (api) => (await api.publicNavigation()).navigation),
);

/** The enabled homepage sections in order, or null when none are set up or none can be read. */
export const getHomepageSections = cache(async (): Promise<HomepageSection[] | null> => {
  const sections = await read(async (api) => (await api.publicHomepage()).homepage.sections);
  return sections === null || sections.length === 0 ? null : sections;
});
