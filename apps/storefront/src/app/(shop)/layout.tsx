import type { ReactNode } from 'react';
import { CSRF_FIELD } from '@nilzora/web-session';
import { MobileTabBar } from '@/components/layout/mobile-tab-bar';
import { PromoPopup } from '@/components/marketing/promo-popup';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader, type StoreLogo } from '@/components/site-header';
import { SupportWidget } from '@/components/support/support-widget';
import { WishlistProvider } from '@/components/wishlist/wishlist-provider';
import { appDownloadLinks } from '@/lib/app-links';
import { getBrands, getCategories } from '@/lib/catalog';
import { getPromoPopups } from '@/lib/promo-popup';
import { session } from '@/lib/session';
import { storeProfile } from '@/lib/seo';
import { getNavigation } from '@/lib/site-content';

export default async function ShopLayout({ children }: Readonly<{ children: ReactNode }>) {
  /*
   * These reads happen here, on the server, so SiteHeader stays a plain synchronous component
   * that tests (and any client boundary) can render without an async child. The profile is
   * request-cached: the root layout's metadata already resolved it, so this shares that read.
   */
  const [categories, brands, profile, current, navigation] = await Promise.all([
    getCategories(),
    getBrands(),
    storeProfile(),
    session.getSession(),
    // Links and pages the store manages; null (nothing set up, or unreachable) keeps the
    // built-in navigation exactly as it was.
    getNavigation(),
  ]);
  // The promotional popup, if one is live. Cached with the catalog and never awaited beyond the
  // other reads: a failure means no popup rather than a slower page.
  const promoPopups = await getPromoPopups();
  // The wishlist is read once for the whole shop: every heart on the page shares this list.
  // A guest gets the same provider with no server list, so hearts still work locally.
  const signedIn = current.status === 'signed_in';
  const [wishlist, csrfToken, account] = await Promise.all([
    signedIn ? session.read((api, accessToken) => api.myWishlist(accessToken)) : null,
    session.csrfToken(),
    // The header shows the customer's own picture, so it reads the profile it belongs to.
    signedIn ? session.read((api, accessToken) => api.getMe(accessToken)) : null,
  ]);
  const csrf = { name: CSRF_FIELD, token: csrfToken };
  // The customer's own upload wins over Google's picture; neither is shown when signed out.
  const headerAvatar =
    account?.kind === 'ok'
      ? (account.value.user.profile.avatar?.thumbUrl ?? account.value.user.profile.googleAvatar)
      : null;
  const logo: StoreLogo | null =
    profile?.logoUrl === null || profile?.logoUrl === undefined
      ? null
      : { url: profile.logoUrl, name: profile.displayName };
  const body = (
    <div className="relative flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface px-4 py-2 text-sm font-semibold text-foreground shadow-lg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <SiteHeader
        categories={categories}
        brands={brands}
        logo={logo}
        extraLinks={navigation?.menus.header ?? []}
        avatarUrl={headerAvatar}
        appLinks={appDownloadLinks(profile)}
      />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter profile={profile} navigation={navigation} />
      {/*
        On phones the fixed tab bar covers the end of the page; this navy strip continues the
        footer underneath it, so the last row of footer content can always be scrolled clear.
      */}
      <div
        aria-hidden="true"
        className="h-[calc(var(--nz-tabbar-h)+env(safe-area-inset-bottom))] bg-brand-navy lg:hidden"
      />
      <MobileTabBar />
      {/* The same support entry point on every customer page. It reads nothing until opened. */}
      <SupportWidget />
      {/* Renders nothing until the popup is due; mounted here so a route change keeps it. */}
      <PromoPopup popups={promoPopups} signedIn={current.status === 'signed_in'} />
    </div>
  );
  return (
    <WishlistProvider
      initialItems={wishlist?.kind === 'ok' ? wishlist.value.items : signedIn ? [] : null}
      csrf={csrf}
    >
      {body}
    </WishlistProvider>
  );
}
