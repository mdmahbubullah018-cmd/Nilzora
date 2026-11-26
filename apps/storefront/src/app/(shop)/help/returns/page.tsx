import { INFO_PAGES, SITE_PAGE_PATHS } from '@nilzora/contracts';
import type { Metadata } from 'next';
import { InfoBody, InfoPageFrame, InfoRelated, InfoTitle } from '@/components/info/info-page';
import { SitePageView } from '@/components/info/site-page-view';
import { siteUrl } from '@/lib/seo';
import { getSitePage } from '@/lib/site-content';
import { sitePageMetadata } from '@/lib/site-page-metadata';

/*
 * The store's returns and refunds policy. When the owner has published their own page in the
 * admin workspace it is shown; otherwise the built-in wording, shared with the Android app, which
 * describes how returns actually work and promises no deadline the store has not set.
 * (Requesting a return is a different page, /account/returns.)
 */

const page = INFO_PAGES.returns;

const builtInMetadata: Metadata = {
  title: page.title,
  description: page.summary,
  alternates: { canonical: new URL(SITE_PAGE_PATHS.returns, siteUrl()).toString() },
  openGraph: { title: page.title, description: page.summary, type: 'website' },
};

export async function generateMetadata(): Promise<Metadata> {
  const managed = await getSitePage('returns');
  return managed === null ? builtInMetadata : sitePageMetadata(managed, SITE_PAGE_PATHS.returns);
}

export default async function ReturnsPolicyPage() {
  const managed = await getSitePage('returns');
  if (managed !== null) return <SitePageView page={managed} />;
  return (
    <InfoPageFrame crumb={page.title}>
      <InfoTitle title={page.title} summary={page.summary} eyebrow="Returns" />
      <InfoBody page={page} />
      <InfoRelated keys={page.related} />
    </InfoPageFrame>
  );
}
