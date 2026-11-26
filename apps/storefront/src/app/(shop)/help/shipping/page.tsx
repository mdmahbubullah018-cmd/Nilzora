import { INFO_PAGES, SITE_PAGE_PATHS } from '@nilzora/contracts';
import type { Metadata } from 'next';
import { InfoBody, InfoPageFrame, InfoRelated, InfoTitle } from '@/components/info/info-page';
import { SitePageView } from '@/components/info/site-page-view';
import { siteUrl } from '@/lib/seo';
import { getSitePage } from '@/lib/site-content';
import { sitePageMetadata } from '@/lib/site-page-metadata';

/*
 * The store's delivery policy. When the owner has published their own page in the admin
 * workspace (with their delivery times and areas) it is shown; otherwise the built-in wording,
 * shared with the Android app, which describes how delivery works and promises no delivery time.
 */

const page = INFO_PAGES.shipping;

const builtInMetadata: Metadata = {
  title: page.title,
  description: page.summary,
  alternates: { canonical: new URL(SITE_PAGE_PATHS.shipping, siteUrl()).toString() },
  openGraph: { title: page.title, description: page.summary, type: 'website' },
};

export async function generateMetadata(): Promise<Metadata> {
  const managed = await getSitePage('shipping');
  return managed === null ? builtInMetadata : sitePageMetadata(managed, SITE_PAGE_PATHS.shipping);
}

export default async function ShippingPage() {
  const managed = await getSitePage('shipping');
  if (managed !== null) return <SitePageView page={managed} />;
  return (
    <InfoPageFrame crumb={page.title}>
      <InfoTitle title={page.title} summary={page.summary} eyebrow="Delivery" />
      <InfoBody page={page} />
      <InfoRelated keys={page.related} />
    </InfoPageFrame>
  );
}
