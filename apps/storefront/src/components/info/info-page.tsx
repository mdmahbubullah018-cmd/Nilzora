import {
  INFO_LINK_LABELS,
  INFO_PAGES_UPDATED_ON,
  sectionAnchor,
  type InfoLinkKey,
  type InfoPage,
  type InfoSection,
} from '@nilzora/contracts';
import { ArrowRight } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Breadcrumbs } from '@/components/catalog/breadcrumbs';
import { formatLongDate } from '@/lib/format';

/*
 * The editorial shell shared by About, the Privacy policy, the Terms of service and the FAQ:
 * a breadcrumb, a title block, long-form sections, a section list on wide screens, and the
 * links to read next. The words come from @nilzora/contracts, so the Android app shows the
 * same text; this file only decides how it is laid out on the web.
 */

/** The storefront address of each page the content points at. */
export const INFO_HREFS: Readonly<Record<InfoLinkKey, Route>> = {
  shop: '/products',
  faq: '/help/faq',
  privacy: '/privacy',
  terms: '/terms',
  about: '/about',
  support: '/contact',
  returns: '/help/returns',
  shipping: '/help/shipping',
};

/** The reading column every information page sits in, under the shared breadcrumb. */
export function InfoPageFrame({ crumb, children }: { crumb: string; children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
      <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: crumb }]} />
      {children}
    </div>
  );
}

export function InfoTitle({
  title,
  summary,
  eyebrow,
  showUpdatedOn = true,
}: {
  title: string;
  summary: string;
  eyebrow?: string;
  showUpdatedOn?: boolean;
}) {
  return (
    <header className="grid gap-3 border-b border-border pb-6">
      {eyebrow ? (
        <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">{eyebrow}</p>
      ) : null}
      <h1 className="font-display text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-4xl">
        {title}
      </h1>
      <p className="max-w-2xl text-base leading-relaxed text-pretty text-body">{summary}</p>
      {showUpdatedOn ? (
        <p className="text-xs text-muted-foreground">
          Last updated{' '}
          <time dateTime={INFO_PAGES_UPDATED_ON}>{formatLongDate(INFO_PAGES_UPDATED_ON)}</time>
        </p>
      ) : null}
    </header>
  );
}

/** One section: a heading that is also its anchor, then its paragraphs and bullets. */
export function InfoSectionBlock({ section }: { section: InfoSection }) {
  const anchor = sectionAnchor(section.heading);
  return (
    <section aria-labelledby={anchor} className="grid scroll-mt-32 gap-3">
      <h2
        id={anchor}
        className="font-display text-lg font-semibold tracking-tight text-foreground sm:text-xl"
      >
        {section.heading}
      </h2>
      {section.paragraphs.map((paragraph, index) => (
        <p
          key={index}
          className="max-w-[68ch] leading-relaxed wrap-break-word text-pretty text-body"
        >
          {paragraph}
        </p>
      ))}
      {section.bullets === undefined ? null : (
        <ul role="list" className="grid max-w-[68ch] gap-2">
          {section.bullets.map((bullet, index) => (
            <li key={index} className="flex gap-3 leading-relaxed wrap-break-word text-body">
              <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
              <span className="min-w-0">{bullet}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The body of a page with the list of its sections beside it on large screens. The list is a
 * plain in-page navigation, so it works without JavaScript and is announced as such.
 */
export function InfoBody({ page }: { page: InfoPage }) {
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-12">
      <div className="grid gap-8">
        {page.intro.map((paragraph, index) => (
          <p
            key={index}
            className="max-w-[68ch] text-base leading-relaxed wrap-break-word text-pretty text-body"
          >
            {paragraph}
          </p>
        ))}
        {page.notice ? (
          <p className="max-w-[68ch] rounded-xl border border-border bg-surface-muted/60 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
            {page.notice}
          </p>
        ) : null}
        {page.sections.map((section) => (
          <InfoSectionBlock key={section.heading} section={section} />
        ))}
      </div>
      <nav aria-labelledby="info-contents" className="hidden lg:block">
        <div className="grid gap-3 lg:sticky lg:top-28">
          <p
            id="info-contents"
            className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase"
          >
            On this page
          </p>
          <ol className="grid gap-1.5 text-sm">
            {page.sections.map((section, index) => (
              <li key={section.heading} className="flex gap-2">
                <span
                  aria-hidden="true"
                  className="w-4 shrink-0 text-right text-muted-foreground tabular-nums"
                >
                  {index + 1}
                </span>
                <a
                  href={`#${sectionAnchor(section.heading)}`}
                  className="min-w-0 rounded-sm text-body underline-offset-4 hover:text-foreground hover:underline"
                >
                  {section.heading}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </nav>
    </div>
  );
}

/** What to read next, in the order the shared content asks for. */
export function InfoRelated({ keys }: { keys: InfoPage['related'] }) {
  return (
    <nav aria-label="More information" className="grid gap-3 border-t border-border pt-6">
      <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        Keep reading
      </p>
      <ul role="list" className="grid gap-2 sm:grid-cols-3">
        {keys.map((key) => (
          <li key={key}>
            <Link
              href={INFO_HREFS[key]}
              className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/40 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {INFO_LINK_LABELS[key]}
              <ArrowRight
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
              />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
