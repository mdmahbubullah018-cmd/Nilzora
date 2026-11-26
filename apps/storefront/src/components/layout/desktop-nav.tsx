'use client';

import { cn } from '@nilzora/ui';
import { ArrowRight, ChevronDown, ChevronRight, Heart, Ticket } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { useWishlistOptional } from '@/components/wishlist/wishlist-provider';
import { countLabel } from '@/lib/count-label';
import { NEW_ARRIVALS_HREF, type BrandLink, type CategoryNode } from '@/lib/navigation';
import { wishlistLabel } from '@/lib/wishlist-label';
import { NavAnchor, type NavLinkItem } from './nav-anchor';

type MenuId = 'category' | 'brand';

/** Pointer travel time allowed between a trigger and its panel before the panel closes. */
const CLOSE_DELAY_MS = 160;
/** Brands listed in the menu; the rest are one click away on the brand directory. */
const MENU_BRANDS = 12;

const topLinkClass =
  'relative inline-flex min-h-11 items-center gap-1 rounded-full px-2.5 text-sm font-medium whitespace-nowrap opacity-90 transition-[background-color,opacity] duration-300 after:absolute after:inset-x-3 after:bottom-1.5 after:h-0.5 after:rounded-full after:bg-current after:opacity-0 hover:bg-white/10 hover:opacity-100 aria-[current=page]:font-semibold aria-[current=page]:opacity-100 aria-[current=page]:after:opacity-100 aria-expanded:bg-white/10 aria-expanded:opacity-100 group-data-[solid=true]/header:hover:bg-surface-muted group-data-[solid=true]/header:aria-expanded:bg-surface-muted';

const panelLinkClass =
  'rounded-md text-sm text-body underline-offset-4 transition-colors hover:text-primary hover:underline';

/** A tree worth a full-width panel: several departments, or any subcategories to show. */
function isLargeTree(tree: readonly CategoryNode[]): boolean {
  return tree.length > 3 || tree.some((department) => department.children.length > 0);
}

function inSection(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function PanelFooter({
  href,
  label,
  onNavigate,
}: {
  href: Route;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <div className="mt-5 flex justify-end border-t border-border pt-4">
      <Link
        href={href}
        onClick={onNavigate}
        className="group/all inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
      >
        {label}
        <ArrowRight
          aria-hidden="true"
          className="size-4 transition-transform group-hover/all:translate-x-0.5 motion-reduce:transition-none"
        />
      </Link>
    </div>
  );
}

/**
 * The category panel in two steps: it opens showing only the top-level categories, and hovering
 * (or focusing) one reveals its own subcategories beside the list. Nothing else is expanded, so
 * the first hover never shows every category and subcategory at once. A category with no
 * subcategories simply has nothing to reveal; its name is still a link.
 */
function CategoryPanel({
  tree,
  open,
  onNavigate,
}: {
  tree: readonly CategoryNode[];
  /** Whether the panel is showing; each time it opens it starts with nothing revealed. */
  open: boolean;
  onNavigate: () => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setActive(null);
  }
  const revealed = tree.find((department) => department.slug === active);
  return (
    <>
      <div className="grid gap-x-8 lg:grid-cols-[15rem_1fr]">
        <ul role="list" className="grid content-start gap-0.5">
          {tree.map((department) => {
            const hasChildren = department.children.length > 0;
            const isActive = department.slug === active;
            return (
              <li
                key={department.slug}
                onPointerEnter={(event) => {
                  if (event.pointerType === 'mouse') setActive(department.slug);
                }}
                onFocus={() => setActive(department.slug)}
              >
                <Link
                  href={department.href}
                  onClick={onNavigate}
                  aria-expanded={hasChildren ? isActive : undefined}
                  className={cn(
                    'flex min-h-10 items-center justify-between gap-2 rounded-lg px-3 font-display text-[0.9375rem] font-semibold text-foreground transition-colors hover:bg-primary/5 hover:text-primary',
                    isActive && 'bg-primary/8 text-primary',
                  )}
                >
                  <span className="truncate">{department.name}</span>
                  {hasChildren ? (
                    <ChevronRight aria-hidden="true" className="size-4 shrink-0 opacity-60" />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
        {revealed && revealed.children.length > 0 ? (
          <div className="mt-6 grid content-start gap-3 border-t border-border pt-4 lg:mt-0 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
            <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              {revealed.name}
            </p>
            <ul
              role="list"
              className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-8 gap-y-5"
            >
              {revealed.children.map((child) => (
                <li key={child.slug} className="grid content-start gap-1.5">
                  <Link href={child.href} onClick={onNavigate} className={panelLinkClass}>
                    {child.name}
                  </Link>
                  {child.children.length > 0 ? (
                    <ul role="list" className="grid gap-1 border-l border-border pl-3">
                      {child.children.map((grandchild) => (
                        <li key={grandchild.slug}>
                          <Link
                            href={grandchild.href}
                            onClick={onNavigate}
                            className={cn(panelLinkClass, 'text-[0.8125rem] text-muted-foreground')}
                          >
                            {grandchild.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <PanelFooter href="/categories" label="All categories" onNavigate={onNavigate} />
    </>
  );
}

function BrandPanel({
  brands,
  onNavigate,
}: {
  brands: readonly BrandLink[];
  onNavigate: () => void;
}) {
  return (
    <>
      <ul role="list" className="grid grid-cols-2 gap-x-6 gap-y-1">
        {brands.slice(0, MENU_BRANDS).map((brand) => (
          <li key={brand.slug}>
            <Link
              href={brand.href}
              onClick={onNavigate}
              className={cn(panelLinkClass, 'flex min-h-10 items-center truncate')}
            >
              {brand.name}
            </Link>
          </li>
        ))}
      </ul>
      <PanelFooter href="/brands" label="All brands" onNavigate={onNavigate} />
    </>
  );
}

/**
 * One top-level entry that opens a panel: a disclosure button (not an ARIA menu), so the
 * panel's links stay ordinary links in the tab order. Opens on hover for a mouse and on click,
 * Enter or Space for everyone; closes on Escape (focus returns to the button), on a click
 * outside, when focus leaves it, and on navigation.
 */
function MenuItem({
  label,
  open,
  current,
  onOpen,
  onClose,
  wide,
  children,
}: {
  label: string;
  open: boolean;
  current: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** The category panel spans the header; the brand panel hangs under its button. */
  wide: boolean;
  children: ReactNode;
}) {
  const panelId = useId();
  const wrapper = useRef<HTMLLIElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  const cancelClose = () => window.clearTimeout(closeTimer.current);
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(onClose, CLOSE_DELAY_MS);
  };

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) onClose();
    };
    // Escape closes the panel wherever focus is (it may have been opened by hovering).
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const focusWasInside = wrapper.current?.contains(document.activeElement) ?? false;
      onClose();
      if (focusWasInside) trigger.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open, onClose]);

  const onBlur = (event: FocusEvent<HTMLLIElement>) => {
    if (open && !event.currentTarget.contains(event.relatedTarget)) onClose();
  };

  return (
    <li
      ref={wrapper}
      className={wide ? undefined : 'relative'}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse') return;
        cancelClose();
        onOpen();
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') scheduleClose();
      }}
      onBlur={onBlur}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        data-current={current || undefined}
        onClick={() => (open ? onClose() : onOpen())}
        className={cn(
          topLinkClass,
          'cursor-pointer data-current:font-semibold data-current:opacity-100',
        )}
      >
        {label}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'size-3.5 opacity-70 transition-transform duration-200 motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </button>
      <div
        id={panelId}
        data-open={open || undefined}
        // Closed panels stay in the page only to animate out: inert keeps them out of the tab
        // order and the accessibility tree, and visibility hides them once the fade ends.
        inert={!open}
        aria-hidden={!open}
        className={cn(
          // Translucent glass: a slightly see-through pane over the page, softened by a blur and
          // a touch of saturation, so it reads as a floating layer rather than a solid card.
          // 80% opacity keeps every label at high contrast whatever is behind it, even the dark
          // banner the transparent header sits over.
          'absolute top-full z-50 mt-2 rounded-2xl border border-border/70 bg-surface/80 p-6 text-body shadow-2xl shadow-brand-navy/15 ring-1 ring-white/50 backdrop-blur-xl backdrop-saturate-150',
          // An invisible bridge over the gap, so the pointer can travel from button to panel.
          'before:absolute before:inset-x-0 before:-top-3 before:h-3',
          'invisible -translate-y-1 opacity-0 transition-[opacity,translate,visibility] duration-200 ease-soft data-open:visible data-open:translate-y-0 data-open:opacity-100 motion-reduce:transition-none',
          wide
            ? 'inset-x-4 mx-auto max-w-7xl lg:inset-x-8'
            : 'left-0 w-[min(30rem,calc(100vw-4rem))] min-w-64',
        )}
      >
        {children}
      </div>
    </li>
  );
}

/**
 * The desktop main navigation: Home, Category, Brand and New Arrivals. Category and Brand open
 * panels built from the real catalog; with nothing published they are plain links to the
 * category and brand directories instead of empty menus.
 */
export function DesktopNav({
  categories,
  brands,
  extraLinks = [],
  onMenuChange,
}: {
  categories: readonly CategoryNode[];
  brands: readonly BrandLink[];
  /** Links the store added to the header menu, shown after New Arrivals. */
  extraLinks?: readonly NavLinkItem[];
  /** Lets the header turn solid while a panel is open over the home banner. */
  onMenuChange?: (open: boolean) => void;
}) {
  const pathname = usePathname() ?? '';
  // Remember the page a panel was opened on, so any navigation closes it without an effect.
  const [opened, setOpened] = useState<{ id: MenuId; on: string } | null>(null);
  const openId = opened !== null && opened.on === pathname ? opened.id : null;

  const wishlist = useWishlistOptional();
  const savedCount = wishlist?.count ?? 0;
  const savedBadge = countLabel(savedCount);
  const onWishlist = inSection(pathname, '/wishlist');

  // Which menu is open right now. A delayed close was scheduled by an earlier render, so it must
  // read the live answer from here rather than from the state it closed over.
  const openNow = useRef<MenuId | null>(null);
  const open = (id: MenuId) => {
    openNow.current = id;
    setOpened({ id, on: pathname });
    onMenuChange?.(true);
  };
  // A menu closes only itself: moving from Category to Brand opens Brand first, and Category's
  // delayed close must not then shut the menu that just opened.
  const closeMenu = (id: MenuId) => {
    if (openNow.current !== id) return;
    openNow.current = null;
    setOpened(null);
    onMenuChange?.(false);
  };

  return (
    <nav aria-label="Main" className="hidden lg:block">
      <ul role="list" className="flex items-center gap-1">
        <li>
          <Link
            href="/"
            aria-current={pathname === '/' ? 'page' : undefined}
            className={topLinkClass}
          >
            Home
          </Link>
        </li>
        {categories.length > 0 ? (
          <MenuItem
            label="Category"
            open={openId === 'category'}
            current={inSection(pathname, '/categories')}
            onOpen={() => open('category')}
            onClose={() => closeMenu('category')}
            wide={isLargeTree(categories)}
          >
            <CategoryPanel
              tree={categories}
              open={openId === 'category'}
              onNavigate={() => closeMenu('category')}
            />
          </MenuItem>
        ) : (
          <li>
            <Link
              href="/categories"
              aria-current={inSection(pathname, '/categories') ? 'page' : undefined}
              className={topLinkClass}
            >
              Category
            </Link>
          </li>
        )}
        {brands.length > 0 ? (
          <MenuItem
            label="Brand"
            open={openId === 'brand'}
            current={pathname === '/brands'}
            onOpen={() => open('brand')}
            onClose={() => closeMenu('brand')}
            wide={false}
          >
            <BrandPanel brands={brands} onNavigate={() => closeMenu('brand')} />
          </MenuItem>
        ) : (
          <li>
            <Link
              href="/brands"
              aria-current={pathname === '/brands' ? 'page' : undefined}
              className={topLinkClass}
            >
              Brand
            </Link>
          </li>
        )}
        <li>
          <Link href={NEW_ARRIVALS_HREF} className={topLinkClass}>
            New Arrivals
          </Link>
        </li>
        {extraLinks.map((item) => (
          <li key={`${item.href}-${item.label}`}>
            <NavAnchor href={item.href} className={topLinkClass}>
              {item.label}
            </NavAnchor>
          </li>
        ))}
        <li>
          <Link href="/vouchers" className={cn(topLinkClass, 'gap-1.5')}>
            <Ticket aria-hidden="true" className="size-4" strokeWidth={1.75} />
            Vouchers
          </Link>
        </li>
        <li>
          <Link
            href="/wishlist"
            aria-current={onWishlist ? 'page' : undefined}
            aria-label={savedCount > 0 ? wishlistLabel(savedCount) : undefined}
            className={cn(topLinkClass, 'gap-1.5')}
          >
            <Heart
              aria-hidden="true"
              className={cn('size-4 text-offer', onWishlist && 'fill-current')}
              strokeWidth={onWishlist ? 2 : 1.75}
            />
            Wishlist
            {savedBadge ? (
              <span
                aria-hidden="true"
                className="grid h-5 min-w-5 place-items-center rounded-full bg-white/20 px-1.5 text-[0.6875rem] font-semibold tabular-nums group-data-[solid=true]/header:bg-primary/10 group-data-[solid=true]/header:text-primary"
              >
                {savedBadge}
              </span>
            ) : null}
          </Link>
        </li>
      </ul>
    </nav>
  );
}
