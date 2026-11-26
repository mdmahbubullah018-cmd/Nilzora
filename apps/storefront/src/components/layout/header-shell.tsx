'use client';

import { cn } from '@nilzora/ui';
import { Avatar } from '@nilzora/ui';
import { Search, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { NilzoraLogo } from '@/components/brand/nilzora-logo';
import { CartLink } from '@/components/cart-link';
import type { AppDownloadLinks } from '@/lib/app-links';
import type { BrandLink, CategoryNode } from '@/lib/navigation';
import { AppDownloadMenu } from './app-download-menu';
import { DesktopNav } from './desktop-nav';
import { headerIconButton } from './header-styles';
import { MobileDrawer } from './mobile-drawer';
import type { NavLinkItem } from './nav-anchor';
import { SearchField } from './search-field';

/** The store's uploaded logo, already resolved to a public URL by the API. */
export interface StoreLogo {
  url: string;
  /** The store's own name, used to name the home link. */
  name: string;
}

/** Pages whose first section is a full-bleed banner the header sits on top of. */
const OVERLAY_PATHS = new Set(['/']);

/**
 * The interactive part of the site header.
 *
 * Over the home banner it starts fully transparent with white content. Once the page has
 * scrolled about 40px it fades into a frosted white bar with navy content. Scrolling is detected
 * by an IntersectionObserver watching a 40px sentinel at the top of the page, so there is no
 * scroll listener at all, and only opacity and colours animate, which keeps the change smooth.
 * Every other page gets the solid bar from the start.
 */
export function HeaderShell({
  categories,
  brands,
  logo,
  extraLinks = [],
  avatarUrl = null,
  appLinks = { googlePlayUrl: null, appStoreUrl: null },
}: {
  categories: readonly CategoryNode[];
  brands: readonly BrandLink[];
  logo: StoreLogo | null;
  /** Links the store added to the header menu. */
  extraLinks?: readonly NavLinkItem[];
  /** The signed-in customer's picture; the account glyph shows until there is one. */
  avatarUrl?: string | null;
  /** The published store listings; with neither, the app glyph is not drawn at all. */
  appLinks?: AppDownloadLinks;
}) {
  const pathname = usePathname() ?? '';
  const overlay = OVERLAY_PATHS.has(pathname);
  const sentinel = useRef<HTMLSpanElement>(null);
  const [scrolled, setScrolled] = useState(false);
  // The page a desktop menu was opened on; any navigation clears it by itself.
  const [menuOpenOn, setMenuOpenOn] = useState<string | null>(null);
  const menuOpen = menuOpenOn === pathname;
  // The phone menu is a white panel under the bar, so the bar turns solid with it as well.
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const element = sentinel.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      setScrolled(entry ? !entry.isIntersecting : false);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A menu panel is white, so the bar turns solid with it for one continuous surface.
  const solid = !overlay || scrolled || menuOpen || drawerOpen;

  return (
    <>
      <span
        ref={sentinel}
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 h-10 w-px"
      />
      <header
        data-solid={solid}
        className={cn(
          'group/header sticky top-0 z-40 h-(--nz-header-h) transition-colors duration-300 ease-soft',
          // Over the banner, focus outlines switch to the sky ring that reads on dark imagery.
          // Below lg the bar is always the light one (see the surface below), so its content is
          // always navy there; from lg the banner-transparent behaviour is unchanged.
          solid
            ? 'text-foreground'
            : 'text-white [--nz-ring:var(--nz-ring-on-dark)] max-lg:text-foreground max-lg:[--nz-ring:var(--nz-ring)]',
        )}
      >
        {/* The frosted bar: always present, only its opacity animates. */}
        <div
          aria-hidden="true"
          data-header-surface=""
          className="absolute inset-0 border-b border-border/80 bg-surface/90 opacity-0 shadow-sm shadow-brand-navy/5 backdrop-blur-xl transition-opacity duration-300 ease-soft group-data-[solid=true]/header:opacity-100 max-lg:border-primary/15 max-lg:bg-linear-to-b max-lg:from-surface max-lg:to-primary/6 max-lg:opacity-100"
        />

        {/*
          The header spans the same stage as the home hero, so the controls on the right line up
          with the app panel's column below them instead of floating over the gap between tiles.
        */}
        <div className="relative mx-auto flex h-full max-w-(--nz-stage-max) items-center gap-1 px-2 sm:px-4 lg:gap-8 lg:px-8">
          <MobileDrawer
            categories={categories}
            brands={brands}
            extraLinks={extraLinks}
            onOpenChange={setDrawerOpen}
          />

          {/* Named once by the link itself; the logo pictures inside are decorative. */}
          <Link
            href="/"
            aria-label={logo?.name ?? 'Nilzora'}
            className="grid shrink-0 rounded-md px-1 lg:px-0"
          >
            {overlay ? (
              <span className="col-start-1 row-start-1 flex items-center transition-opacity duration-300 ease-soft group-data-[solid=true]/header:opacity-0 max-lg:opacity-0">
                <NilzoraLogo surface="on-dark" decorative priority className="h-8 lg:h-9" />
              </span>
            ) : null}
            <span
              className={cn(
                'col-start-1 row-start-1 flex items-center transition-opacity duration-300 ease-soft',
                overlay &&
                  'opacity-0 group-data-[solid=true]/header:opacity-100 max-lg:opacity-100',
              )}
            >
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- an uploaded logo, already an optimised WebP from the media service
                <img
                  src={logo.url}
                  alt=""
                  className="h-8 w-auto max-w-40 object-contain lg:h-9"
                  loading="eager"
                />
              ) : (
                <NilzoraLogo surface="on-light" decorative priority className="h-8 lg:h-9" />
              )}
            </span>
          </Link>

          <DesktopNav
            categories={categories}
            brands={brands}
            extraLinks={extraLinks}
            onMenuChange={(open) => setMenuOpenOn(open ? pathname : null)}
          />

          {/*
            From xl the controls line up with the stage column: the search field takes the room
            the app glyph and the icons leave. The column is widened by 3% — which grows the
            search field by roughly 4–5% of its own width — so the field reads comfortably while
            the icons stay on the stage column's right edge. Its height is untouched.
          */}
          <div className="ml-auto flex items-center gap-0.5 xl:w-[calc(var(--nz-stage-col)*1.07-2rem)] xl:shrink-0">
            {/*
              The app glyph sits immediately left of the search field, in the desktop header only
              (from xl, where that field appears). Below xl the header carries no app control at
              all — the download strip under the trusted section is the way in there.
            */}
            <AppDownloadMenu links={appLinks} onDark={!solid} />
            <SearchField
              id="search-header"
              variant="header"
              className="mr-2 hidden min-w-0 flex-1 xl:block"
            />
            <Link
              href="/search"
              aria-label="Search"
              className={cn(headerIconButton, 'xl:hidden')}
            >
              {/* Same colour logic as the cart glyph: primary once the bar is solid, otherwise
                  the header's own foreground (white over the banner, ink on the phone bar). */}
              <Search
                aria-hidden="true"
                className="size-5 group-data-[solid=true]/header:text-primary"
              />
            </Link>
            {/*
              On phones the cart stays here and account moves to the tab bar's fifth item;
              wishlist is the third tab. From lg the desktop header keeps all three icons.
            */}
            <Link
              href="/account"
              aria-label="Account"
              className={cn(
                headerIconButton,
                'hidden lg:grid',
                // The same background-aware colour as the app glyph: brand blue on the frosted
                // bar, white over the banner, so the account mark never disappears.
                solid ? 'text-primary-action' : 'text-white',
              )}
            >
              {avatarUrl ? (
                // 24px against the cart's 22px glyph: a filled round portrait needs a touch more
                // diameter than an outline icon to carry the same optical weight, and both sit in
                // the same 44px control.
                <Avatar name="Account" url={avatarUrl} className="size-6 text-[0.6875rem]" />
              ) : (
                <UserRound aria-hidden="true" className="size-5.5" />
              )}
            </Link>
            <CartLink className={headerIconButton} />
          </div>
        </div>
      </header>
    </>
  );
}
