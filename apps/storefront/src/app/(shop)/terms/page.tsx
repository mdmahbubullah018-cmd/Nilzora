import { INFO_PAGES, storeContactSection } from '@nilzora/contracts';
import type { Metadata } from 'next';
import { InfoBody, InfoPageFrame, InfoRelated, InfoTitle } from '@/components/info/info-page';
import { SitePageView } from '@/components/info/site-page-view';
import { siteUrl, storeProfile } from '@/lib/seo';
import { getSitePage } from '@/lib/site-content';
import { sitePageMetadata } from '@/lib/site-page-metadata';

const page = INFO_PAGES.terms;

const builtInMetadata: Metadata = {
  title: page.title,
  description: page.summary,
  alternates: { canonical: new URL('/terms', siteUrl()).toString() },
  openGraph: { title: page.title, description: page.summary, type: 'website' },
};

/** The store's own terms when it has published them, otherwise the shared wording. */
export async function generateMetadata(): Promise<Metadata> {
  const managed = await getSitePage('terms');
  return managed === null ? builtInMetadata : sitePageMetadata(managed, '/terms');
}

/**
 * The terms of service. Shared wording, plus the store's own published contact details at the
 * end: nothing about jurisdiction, registration or dispute resolution is claimed, because the
 * owner has not decided it.
 */
export default async function TermsPage() {
  const managed = await getSitePage('terms');
  if (managed !== null) return <SitePageView page={managed} />;
  const profile = await storeProfile();
  const withContact = {
    ...page,
    sections: [...page.sections, storeContactSection(profile)],
  };

  return (
    <InfoPageFrame crumb={page.title}>
      <InfoTitle title={page.title} summary={page.summary} eyebrow="Terms" />
      <InfoBody page={withContact} />
      <InfoRelated keys={page.related} />
    </InfoPageFrame>
  );
}
