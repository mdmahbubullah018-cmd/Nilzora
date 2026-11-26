'use client';

import { cn } from '@nilzora/ui';
import { Heart, House, LayoutGrid, MessageCircle, UserRound, type LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useWishlistOptional } from '@/components/wishlist/wishlist-provider';
import { countLabel } from '@/lib/count-label';
import { openSupport, subscribeSupportOpen, supportOpenSnapshot } from '@/lib/support-events';
import { wishlistLabel } from '@/lib/wishlist-label';

/*
 * The phone tab bar: Home, Categories, Wishlist, Chat and Account.
 *
 * It is fixed to the bottom of the viewport, above the device's gesture area. Counts and
 * saved state come from the same sources the rest of the shop uses, and Chat raises the same
 * window event every other support entry point uses, so the widget stays the only chat UI.
 */

type TabItem =
  | { kind: 'link'; href: Route; label: string; icon: LucideIcon }
  | { kind: 'chat'; label: string; icon: LucideIcon };

/** The five items, in order. */
const TABS: readonly TabItem[] = [
  { kind: 'link', href: '/', label: 'Home', icon: House },
  { kind: 'link', href: '/categories', label: 'Categories', icon: LayoutGrid },
  { kind: 'link', href: '/wishlist', label: 'Wishlist', icon: Heart },
  // The same MessageCircle glyph the desktop "Chat with us" launcher shows.
  { kind: 'chat', label: 'Chat', icon: MessageCircle },
  { kind: 'link', href: '/account', label: 'Account', icon: UserRound },
];

function inSection(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isCurrent(pathname: string, href: Route): boolean {
  return href === '/' ? pathname === '/' : inSection(pathname, href);
}

/**
 * A short pop on the icon when an item is pressed. It animates one transform on one element
 * with the Web Animations API: no timers, no re-renders, nothing that can delay the link or
 * the click. Reduced-motion users keep the colour-only response.
 */
function popIcon(event: ReactPointerEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>): void {
  const icon = event.currentTarget.querySelector<HTMLElement>('[data-tab-icon]');
  if (icon === null || typeof icon.animate !== 'function') return;
  if (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return;
  }
  icon.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(0.88)', offset: 0.35 },
      { transform: 'scale(1.06)', offset: 0.7 },
      { transform: 'scale(1)' },
    ],
    { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  );
}

function popOnKey(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.key === 'Enter' || event.key === ' ') popIcon(event);
}

const tabClass =
  'group flex h-full min-h-11 min-w-0 touch-manipulation flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg px-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-[current=page]:text-primary data-active:text-primary';

const iconBoxClass =
  'relative grid h-7 min-w-9 place-items-center rounded-full px-2 transition-[background-color,color] duration-300 ease-soft motion-reduce:transition-none';

/** The label is the first thing to give way on a 320px screen, never the page's width. */
const labelClass = 'max-w-full min-w-0 truncate px-0.5 text-[0.6875rem] leading-none';
const badgeClass =
  'absolute -top-1 -right-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[0.625rem] leading-none font-semibold tabular-nums';

export function MobileTabBar() {
  const pathname = usePathname() ?? '';
  const wishlist = useWishlistOptional();
  const wishlistCount = wishlist?.count ?? 0;
  const wishlistBadge = countLabel(wishlistCount);
  const chatOpen = useSyncExternalStore(subscribeSupportOpen, supportOpenSnapshot, () => false);

  return (
    /*
     * The bar the shop has always had: a strip across the foot of the screen, white glass with a
     * hairline along its top edge, so the page scrolls away beneath it. The current tab is shown
     * by a restrained tint — a soft pill behind the icon, primary colour on the icon and label —
     * never by filling the glyph in, so every icon keeps the same outline weight.
     */
    <nav
      aria-label="Bottom navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/60 bg-surface/70 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_20px_-6px_rgb(15_23_42/0.16)] backdrop-blur-xl backdrop-saturate-150 lg:hidden"
    >
      <ul
        role="list"
        className="mx-auto grid h-(--nz-tabbar-h) w-full max-w-lg grid-cols-5 items-stretch px-0.5 sm:px-1"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isWishlist = tab.kind === 'link' && tab.href === '/wishlist';
          const current = tab.kind === 'link' ? isCurrent(pathname, tab.href) : chatOpen;
          const badge = isWishlist ? wishlistBadge : null;

          const content = (
            <>
              <span
                data-tab-icon=""
                aria-hidden="true"
                className={cn(iconBoxClass, current ? 'bg-primary/12' : 'bg-transparent')}
              >
                {/* The same outline glyph in both states: the tint, not a fill, marks the choice. */}
                <Icon className="size-5.5" strokeWidth={1.75} />
                {badge ? (
                  <span className={cn(badgeClass, 'bg-offer-badge text-offer-badge-foreground')}>
                    {badge}
                  </span>
                ) : null}
              </span>
              <span className={cn(labelClass, current ? 'font-semibold' : 'font-medium')}>
                {tab.label}
              </span>
            </>
          );

          return (
            <li key={tab.label} className="min-w-0">
              {tab.kind === 'chat' ? (
                <button
                  type="button"
                  onClick={() => {
                    // The widget owns the panel; never reset a conversation that is already open.
                    if (!chatOpen) openSupport();
                  }}
                  data-active={current || undefined}
                  onPointerDown={popIcon}
                  onKeyDown={popOnKey}
                  className={cn(tabClass, 'w-full cursor-pointer')}
                >
                  {content}
                </button>
              ) : (
                <Link
                  href={tab.href}
                  aria-current={current ? 'page' : undefined}
                  aria-label={isWishlist ? wishlistLabel(wishlistCount) : undefined}
                  onPointerDown={popIcon}
                  onKeyDown={popOnKey}
                  className={tabClass}
                >
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
