import { SITE_PAGE_PATHS, type Navigation, type PublicStoreProfile } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { NilzoraLogo } from '@/components/brand/nilzora-logo';
import { BrandGlyph } from '@/components/brand/social-icons';
import { FooterSection } from '@/components/layout/footer-section';
import { NavAnchor } from '@/components/layout/nav-anchor';
import { StoreBadgeOptions } from '@/components/marketing/store-badges';
import { appDownloadLinks, hasAppAction, type AppDownloadLinks } from '@/lib/app-links';
import { socialProfiles, whatsappUrl } from '@/lib/contact-links';
import { NEW_ARRIVALS_HREF } from '@/lib/navigation';

/** A store path (typed) or, for a link the store added itself, an https address. */
type FooterLink = { href: string; label: string };

/*
 * Every link goes to a page that exists, and no destination appears twice. The information
 * pages (About, FAQ, Privacy policy, Terms of service) have their own column beside Shop and
 * Customer service, so the customer service column keeps its three self-service links.
 */
const CUSTOMER_SERVICE: readonly (FooterLink & { href: Route })[] = [
  { href: '/contact', label: 'Help & support' },
  { href: '/account/orders', label: 'Track your order' },
  { href: '/account/returns', label: 'Returns and refunds' },
];

/** The pages a shopper reads before or after buying. Their wording is shared with the app. */
const INFORMATION: readonly FooterLink[] = [
  { href: '/about', label: 'About Nilzora' },
  { href: '/help/faq', label: 'Frequently asked questions' },
  { href: '/help/shipping', label: 'Delivery policy' },
  { href: '/help/returns', label: 'Returns and refunds policy' },
  { href: '/privacy', label: 'Privacy policy' },
  { href: '/terms', label: 'Terms of service' },
];

/**
 * The Shop column is exactly these four links, in this order: no individual category or brand
 * names. Account pages stay reachable from the header and the mobile menu.
 */
const SHOP: readonly FooterLink[] = [
  { href: '/categories', label: 'Categories' },
  { href: '/brands', label: 'Brands' },
  { href: NEW_ARRIVALS_HREF, label: 'New Arrivals' },
  { href: '/products', label: 'All Products' },
];

/** Shown only when the store has not published its own tagline. */
const DEFAULT_LINE = 'Online shopping for Bangladesh.';

const linkClass =
  'inline-flex min-h-9 items-center rounded-sm text-foreground/80 underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

function LinkList({ links }: { links: readonly FooterLink[] }) {
  return (
    <ul role="list" className="grid gap-1">
      {links.map((link) => (
        <li key={`${link.href}-${link.label}`}>
          <NavAnchor href={link.href} className={linkClass}>
            {link.label}
          </NavAnchor>
        </li>
      ))}
    </ul>
  );
}

/**
 * The site footer: the brand, customer service, shop and account links, and the app when the
 * store has published it. Store-specific values (tagline, social profiles, app links) come from
 * the store profile; anything not filled in is left out rather than replaced with a placeholder.
 * Contact details live on the Help & support page, not here.
 */
export function SiteFooter({
  profile = null,
  appLinks = appDownloadLinks(profile),
  navigation = null,
}: {
  profile?: PublicStoreProfile | null;
  appLinks?: AppDownloadLinks;
  /**
   * The links and pages the store manages. An empty menu keeps the built-in links of its
   * column; a published returns or delivery page is added to the Information column.
   */
  navigation?: Navigation | null;
} = {}) {
  const year = new Date().getFullYear();
  const storeName = profile?.displayName ?? 'Nilzora';

  const managed = navigation?.menus;
  const serviceLinks: readonly FooterLink[] =
    managed && managed.footerHelp.length > 0 ? managed.footerHelp : CUSTOMER_SERVICE;
  const shopLinks: readonly FooterLink[] =
    managed && managed.footerShop.length > 0 ? managed.footerShop : SHOP;
  // Every information page always exists: the store's own published text replaces the built-in
  // wording (and its title replaces the built-in label), and the returns and delivery policies
  // fall back to the built-in wording until the store publishes its own.
  const publishedTitle = new Map(
    (navigation?.pages ?? [])
      .filter((page) => page.slug === 'returns' || page.slug === 'shipping')
      .map((page) => [SITE_PAGE_PATHS[page.slug], page.title]),
  );
  const informationLinks: readonly FooterLink[] = INFORMATION.map((link) => ({
    ...link,
    label: publishedTitle.get(link.href) ?? link.label,
  }));

  const whatsapp = whatsappUrl(profile?.whatsappNumber);
  const social = [
    ...socialProfiles(profile),
    ...(whatsapp === null
      ? []
      : [{ glyph: 'whatsapp' as const, label: 'WhatsApp', href: whatsapp }]),
  ];

  const showApp = hasAppAction(appLinks);

  return (
    <footer className="mt-auto border-t border-primary/15 bg-linear-to-b from-surface to-primary/8 text-sm text-foreground/80">
      <div className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 md:pt-14 lg:px-8">
        <div
          className={cn(
            'grid gap-x-10 gap-y-2 pb-2 md:grid-cols-2 md:gap-y-10 md:pb-12',
            // Brand, Customer service, Shop, Information and (only with a real download
            // action) the app. The brand column carries its own width at every size.
            showApp ? 'lg:grid-cols-[1.4fr_1fr_1fr_1fr_1.1fr]' : 'lg:grid-cols-[1.5fr_1fr_1fr_1fr]',
          )}
        >
          <div className="grid content-start gap-5 pb-8 md:col-span-2 md:pb-0 lg:col-span-1">
            {/*
              On phones and tablets the branding row is followed immediately by the store options
              themselves — the mark and its wording, never icons alone, and never behind a menu.
              From lg the brand column stacks and the "Get the app" column takes them.
            */}
            <Link href="/" aria-label={storeName} className="justify-self-start rounded-md">
              <NilzoraLogo surface="on-light" decorative className="h-9" />
            </Link>
            {showApp ? (
              <StoreBadgeOptions links={appLinks} tone="light" size="md" className="lg:hidden" />
            ) : null}
            <p className="max-w-xs leading-relaxed text-foreground/80">
              {profile?.tagline ?? DEFAULT_LINE}
            </p>
            {social.length > 0 ? (
              <ul role="list" aria-label="Follow us" className="flex gap-2">
                {social.map(({ glyph, label, href }) => (
                  <li key={glyph}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${storeName} on ${label} (opens in a new tab)`}
                      className="grid size-11 place-items-center rounded-full bg-surface text-primary ring-1 ring-primary/20 transition-colors hover:bg-primary hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      <BrandGlyph name={glyph} className="size-4.5" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <FooterSection id="footer-service" title="Customer service" as="nav">
            <LinkList links={serviceLinks} />
          </FooterSection>

          <FooterSection id="footer-shop" title="Shop" as="nav">
            <LinkList links={shopLinks} />
          </FooterSection>

          <FooterSection id="footer-information" title="Information" as="nav">
            <LinkList links={informationLinks} />
          </FooterSection>

          {showApp ? (
            // Phones carry the options in the brand column above, so this column is the wider
            // layouts' home for them.
            <div className="hidden lg:block">
              <FooterSection id="footer-app" title="Get the app">
                {/*
                  The same mark-plus-wording as the phone strip: no QR code and no promotional
                  sentence.
                */}
                <div className="inline-flex rounded-xl border border-primary/20 bg-surface p-2.5">
                  <StoreBadgeOptions
                    links={appLinks}
                    tone="light"
                    className="flex-col items-start gap-2"
                  />
                </div>
              </FooterSection>
            </div>
          ) : null}
        </div>
      </div>
      {/* The base strip: the pressed primary blue (white on it is about 6:1), one line of text. */}
      <div className="bg-primary-action-hover text-xs text-white">
        <p className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          © {year} {storeName}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
