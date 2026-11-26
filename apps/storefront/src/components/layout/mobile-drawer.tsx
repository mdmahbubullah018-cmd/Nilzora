'use client';

import { cn, Dialog } from '@nilzora/ui';
import { ChevronDown } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NEW_ARRIVALS_HREF, type BrandLink, type CategoryNode } from '@/lib/navigation';
import { headerIconButton } from './header-styles';
import { NavAnchor, type NavLinkItem } from './nav-anchor';
import { SearchField } from './search-field';

/** One line of the menu button. */
const GLYPH_LINE =
  'absolute inset-x-0 h-[1.5px] rounded-full bg-current transition-[translate,rotate,opacity] duration-300 ease-soft motion-reduce:transition-none';

/**
 * The menu button's three even lines, folding into a close mark while the menu is open: the top
 * line travels to the middle and turns a quarter turn, the middle line fades out, and the bottom
 * line mirrors the top. Transform and opacity only, so nothing around it can shift.
 */
function MenuGlyph({ open }: { open: boolean }) {
  return (
    // The lines are `bg-current`, so this is where the button's colour is set: primary once
    // the bar is solid (matching the cart glyph), otherwise the header's own foreground.
    <span
      aria-hidden="true"
      className="relative block h-4 w-5 group-data-[solid=true]/header:text-primary"
    >
      <span className={cn(GLYPH_LINE, 'top-px', open ? 'translate-y-1.5 rotate-45' : 'rotate-0')} />
      <span
        className={cn(
          GLYPH_LINE,
          'top-1/2 -translate-y-1/2',
          open ? 'scale-x-50 opacity-0' : 'opacity-100',
        )}
      />
      <span
        className={cn(GLYPH_LINE, 'bottom-px', open ? '-translate-y-1.5 -rotate-45' : 'rotate-0')}
      />
    </span>
  );
}

interface DrawerLinkItem {
  href: Route;
  label: string;
}

const SHOP_LINKS: readonly DrawerLinkItem[] = [
  { href: '/', label: 'Home' },
  { href: NEW_ARRIVALS_HREF, label: 'New Arrivals' },
  { href: '/products', label: 'All products' },
];

/*
 * Account pages send a signed-out visitor to sign in, so they are safe to list for everyone;
 * signing in itself is the header's account button. A guest's wishlist is this browser's, so
 * the wishlist page is listed for everyone as well.
 */
const ACCOUNT_LINKS: readonly DrawerLinkItem[] = [
  { href: '/account', label: 'My account' },
  { href: '/wishlist', label: 'Wishlist' },
  { href: '/vouchers', label: 'Voucher Center' },
  { href: '/account/vouchers', label: 'My Vouchers' },
  { href: '/account/orders', label: 'My orders' },
  { href: '/account/returns', label: 'Returns and refunds' },
  { href: '/account/addresses', label: 'Addresses' },
];

const HELP_LINKS: readonly DrawerLinkItem[] = [
  { href: '/contact', label: 'Help & support' },
  { href: '/help/faq', label: 'Frequently asked questions' },
  { href: '/about', label: 'About Nilzora' },
  { href: '/help/shipping', label: 'Delivery policy' },
  { href: '/help/returns', label: 'Returns and refunds policy' },
  { href: '/privacy', label: 'Privacy policy' },
  { href: '/terms', label: 'Terms of service' },
];

const rowClass =
  'flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-[0.9375rem] font-medium text-foreground transition-colors hover:bg-surface-muted';

const summaryClass = cn(
  rowClass,
  'cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden',
);

/** Rotates only when its own <details> is open, however deeply groups are nested. */
function Chevron() {
  return (
    <ChevronDown
      aria-hidden="true"
      className="size-4 shrink-0 opacity-60 transition-transform duration-200 motion-reduce:transition-none [details[open]>summary>&]:rotate-180"
    />
  );
}

function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p
      id={id}
      className="px-3 pb-1 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase"
    >
      {children}
    </p>
  );
}

/**
 * The phone and tablet menu: a panel that drops from directly beneath the header, on the shared
 * native <dialog>, which gives focus containment, an inert page behind it, Escape to close and
 * focus restoration. The page cannot scroll while it is open (see the modal rule in
 * @nilzora/ui/styles.css). It closes on a tap on the overlay, on Escape, on any link and on
 * every route change.
 *
 * The button's three lines fold into a close mark while the panel is open, and the header itself
 * never moves: the panel is anchored below the bar, and the bar turns solid with it so the two
 * read as one surface.
 */
export function MobileDrawer({
  categories,
  brands,
  extraLinks = [],
  onOpenChange,
}: {
  categories: readonly CategoryNode[];
  brands: readonly BrandLink[];
  /** Links the store added to the header menu, listed after the built-in shop links. */
  extraLinks?: readonly NavLinkItem[];
  /** Told whenever the panel opens or closes, so the header can turn solid with it. */
  onOpenChange?: (open: boolean) => void;
}) {
  const pathname = usePathname() ?? '';
  // The drawer remembers the route it was opened on, so any navigation closes it by itself.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn !== null && openedOn === pathname;
  const setOpen = (next: boolean) => {
    setOpenedOn(next ? pathname : null);
    onOpenChange?.(next);
  };
  const close = () => setOpen(false);

  // A route change closes the panel by itself, so the header is told as well.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) onOpenChange?.(false);
    wasOpen.current = open;
  }, [open, onOpenChange]);

  const link = (item: DrawerLinkItem, className?: string) => (
    <li key={`${item.href}-${item.label}`}>
      <Link href={item.href} onClick={close} className={cn(rowClass, className)}>
        {item.label}
      </Link>
    </li>
  );

  /** A category with its subcategories: expandable when it has any, a plain link otherwise. */
  const categoryItem = (node: CategoryNode, depth: number): ReactNode => {
    const indent = depth > 0 ? 'text-sm font-normal text-body' : undefined;
    if (node.children.length === 0) return link({ href: node.href, label: node.name }, indent);
    return (
      <li key={node.slug}>
        <details>
          <summary className={cn(summaryClass, indent)}>
            {node.name}
            <Chevron />
          </summary>
          <ul role="list" className="ml-3 grid border-l border-border pl-2">
            {link({ href: node.href, label: `All ${node.name}` }, 'text-sm font-normal text-body')}
            {node.children.map((child) => categoryItem(child, depth + 1))}
          </ul>
        </details>
      </li>
    );
  };

  return (
    <>
      <button
        type="button"
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        // On a phone the button is a small frosted disc: faint white wash, blur and a soft ring.
        className={cn(
          headerIconButton,
          'max-lg:bg-white/35 max-lg:ring-1 max-lg:ring-white/50 max-lg:backdrop-blur-md max-lg:backdrop-saturate-150',
          'lg:hidden',
        )}
      >
        <MenuGlyph open={open} />
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => setOpen(next)}
        side="bottom"
        // Frosted glass: a see-through surface over a blur, a soft white edge and a gentle shadow.
        // 75% keeps every label at strong contrast over the page behind.
        panelClassName="border border-b-0 border-white/60 bg-surface/75 shadow-2xl shadow-brand-navy/20 ring-1 ring-brand-navy/5 backdrop-blur-xl backdrop-saturate-150"
        hideTitle
        title="Menu"
        closeLabel="Close menu"
        // A bottom sheet: it rises from the bottom edge (transform only, 260 ms, no library) over a
        // light scrim, and goes back down the same way. Tapping the scrim, Escape, the close button,
        // a link or a route change closes it; the page behind is inert and cannot scroll (see the
        // modal rule in @nilzora/ui/styles.css) and the sheet's own body scrolls when it is tall.
        // Reduced motion: it appears and disappears without moving.
        className={[
          'text-body duration-260 ease-out motion-reduce:duration-0',
          'transition-[translate,display,overlay] transition-discrete motion-reduce:transition-none',
          // Slide only: the Dialog's default fade is switched off so the sheet stays opaque while it
          // travels (otherwise it would vanish at once on close instead of sliding down).
          'starting:open:translate-y-full starting:open:opacity-100',
          'not-open:translate-y-full not-open:opacity-100',
          'backdrop:bg-brand-navy/30 backdrop:backdrop-blur-none',
        ].join(' ')}
      >
        <div className="grid gap-6 pb-4">
          <SearchField id="search-drawer" />

          <nav aria-labelledby="drawer-shop">
            <SectionTitle id="drawer-shop">Shop</SectionTitle>
            <ul role="list" className="grid">
              {SHOP_LINKS.map((item) => link(item))}
              {extraLinks.map((item) => (
                <li key={`${item.href}-${item.label}`}>
                  <NavAnchor href={item.href} onClick={close} className={rowClass}>
                    {item.label}
                  </NavAnchor>
                </li>
              ))}
              <li>
                <details>
                  <summary className={summaryClass}>
                    Category
                    <Chevron />
                  </summary>
                  <ul role="list" className="ml-3 grid border-l border-border pl-2">
                    {link({ href: '/categories', label: 'All categories' }, 'text-sm text-primary')}
                    {categories.map((node) => categoryItem(node, 0))}
                  </ul>
                </details>
              </li>
              <li>
                <details>
                  <summary className={summaryClass}>
                    Brand
                    <Chevron />
                  </summary>
                  <ul role="list" className="ml-3 grid border-l border-border pl-2">
                    {link({ href: '/brands', label: 'All brands' }, 'text-sm text-primary')}
                    {brands.map((brand) =>
                      link(
                        { href: brand.href, label: brand.name },
                        'text-sm font-normal text-body',
                      ),
                    )}
                  </ul>
                </details>
              </li>
            </ul>
          </nav>

          <nav aria-labelledby="drawer-account">
            <SectionTitle id="drawer-account">Your account</SectionTitle>
            <ul role="list" className="grid">
              {ACCOUNT_LINKS.map((item) => link(item))}
            </ul>
          </nav>

          <nav aria-labelledby="drawer-help">
            <SectionTitle id="drawer-help">Help</SectionTitle>
            <ul role="list" className="grid">
              {HELP_LINKS.map((item) => link(item))}
            </ul>
          </nav>
        </div>
      </Dialog>
    </>
  );
}
