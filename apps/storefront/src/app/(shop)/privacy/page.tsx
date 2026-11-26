import { INFO_PAGES, storeContactSection } from '@nilzora/contracts';
import type { Metadata } from 'next';
import { InfoBody, InfoPageFrame, InfoRelated, InfoTitle } from '@/components/info/info-page';
import { SitePageView } from '@/components/info/site-page-view';
import { siteUrl, storeProfile } from '@/lib/seo';
import { getSitePage } from '@/lib/site-content';
import { sitePageMetadata } from '@/lib/site-page-metadata';

const page = INFO_PAGES.privacy;

const builtInMetadata: Metadata = {
  title: page.title,
  description: page.summary,
  alternates: { canonical: new URL('/privacy', siteUrl()).toString() },
  openGraph: { title: page.title, description: page.summary, type: 'website' },
};

/** The store's own policy when it has published one, otherwise the shared wording. */
export async function generateMetadata(): Promise<Metadata> {
  const managed = await getSitePage('privacy');
  return managed === null ? builtInMetadata : sitePageMetadata(managed, '/privacy');
}

/**
 * The privacy policy. The wording is shared with the Android app; the closing section is built
 * from the store's published profile, so a contact detail that has not been published is left
 * out rather than replaced with a placeholder.
 */
export default async function PrivacyPage() {
  const managed = await getSitePage('privacy');
  if (managed !== null) return <SitePageView page={managed} />;
  const profile = await storeProfile();
  const withContact = {
    ...page,
    sections: [...page.sections, storeContactSection(profile)],
  };

  return (
    <InfoPageFrame crumb={page.title}>
      <InfoTitle title={page.title} summary={page.summary} eyebrow="Privacy" />
      <InfoBody page={withContact} />
      <InfoRelated keys={page.related} />
    </InfoPageFrame>
  );
}
