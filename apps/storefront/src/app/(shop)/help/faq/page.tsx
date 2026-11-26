import { FAQ_SUMMARY, FAQ_TITLE } from '@nilzora/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FaqExplorer } from '@/components/info/faq-explorer';
import { InfoPageFrame, InfoTitle } from '@/components/info/info-page';
import { SitePageView } from '@/components/info/site-page-view';
import { siteUrl, storeProfile } from '@/lib/seo';
import { getSitePage } from '@/lib/site-content';
import { sitePageMetadata } from '@/lib/site-page-metadata';

const builtInMetadata: Metadata = {
  title: FAQ_TITLE,
  description: FAQ_SUMMARY,
  alternates: { canonical: new URL('/help/faq', siteUrl()).toString() },
  openGraph: { title: FAQ_TITLE, description: FAQ_SUMMARY, type: 'website' },
};

/** The store's own FAQ text when it has published one, otherwise the searchable built-in FAQ. */
export async function generateMetadata(): Promise<Metadata> {
  const managed = await getSitePage('faq');
  return managed === null ? builtInMetadata : sitePageMetadata(managed, '/help/faq');
}

/**
 * Frequently asked questions. Every answer describes a screen or rule that exists in this
 * project, and the questions are the same ones the Android app shows, from @nilzora/contracts.
 */
export default async function FaqPage() {
  const managed = await getSitePage('faq');
  if (managed !== null) return <SitePageView page={managed} />;
  const profile = await storeProfile();
  const storeName = profile?.displayName?.trim() ?? 'Nilzora';

  return (
    <InfoPageFrame crumb={FAQ_TITLE}>
      <InfoTitle title={FAQ_TITLE} summary={FAQ_SUMMARY} showUpdatedOn={false} />
      <FaqExplorer />
      <p className="border-t border-border pt-6 text-sm text-muted-foreground">
        Still stuck? Open a conversation with {storeName} on{' '}
        <Link
          href="/contact"
          className="rounded-sm font-semibold text-link underline-offset-4 hover:underline"
        >
          Help &amp; support
        </Link>
        , or read the{' '}
        <Link
          href="/privacy"
          className="rounded-sm font-semibold text-link underline-offset-4 hover:underline"
        >
          privacy policy
        </Link>{' '}
        and the{' '}
        <Link
          href="/terms"
          className="rounded-sm font-semibold text-link underline-offset-4 hover:underline"
        >
          terms of service
        </Link>
        .
      </p>
    </InfoPageFrame>
  );
}
