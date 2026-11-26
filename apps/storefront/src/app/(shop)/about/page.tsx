import { INFO_PAGES } from '@nilzora/contracts';
import type { Metadata } from 'next';
import { NilzoraLogo } from '@/components/brand/nilzora-logo';
import { InfoBody, InfoPageFrame, InfoRelated, InfoTitle } from '@/components/info/info-page';
import { SitePageView } from '@/components/info/site-page-view';
import { siteUrl, storeProfile } from '@/lib/seo';
import { getSitePage } from '@/lib/site-content';
import { sitePageMetadata } from '@/lib/site-page-metadata';

const page = INFO_PAGES.about;

const builtInMetadata: Metadata = {
  title: page.title,
  description: page.summary,
  alternates: { canonical: new URL('/about', siteUrl()).toString() },
  openGraph: { title: page.title, description: page.summary, type: 'website' },
};

/** The store's own About page when it has published one, otherwise the shared wording. */
export async function generateMetadata(): Promise<Metadata> {
  const managed = await getSitePage('about');
  return managed === null ? builtInMetadata : sitePageMetadata(managed, '/about');
}

/**
 * About Nilzora. The wording is shared with the Android app (see @nilzora/contracts), and the
 * only store-specific value on the page is the tagline the owner published — nothing is
 * assumed about history, team, offices or numbers.
 */
export default async function AboutPage() {
  const managed = await getSitePage('about');
  if (managed !== null) return <SitePageView page={managed} />;
  const profile = await storeProfile();
  const tagline = profile?.tagline?.trim() ?? '';

  return (
    <InfoPageFrame crumb={page.title}>
      <div className="grid justify-items-start gap-4 rounded-2xl border border-border bg-surface px-6 py-7 sm:px-8">
        <NilzoraLogo priority className="h-10 sm:h-11" />
        {tagline === '' ? null : (
          <p className="font-display text-xl font-semibold tracking-tight text-balance text-foreground sm:text-2xl">
            {tagline}
          </p>
        )}
      </div>
      <InfoTitle title={page.title} summary={page.summary} showUpdatedOn={false} />
      <InfoBody page={page} />
      <InfoRelated keys={page.related} />
    </InfoPageFrame>
  );
}
