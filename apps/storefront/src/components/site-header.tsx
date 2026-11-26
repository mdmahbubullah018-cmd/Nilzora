import type { Brand, Category } from '@nilzora/contracts';
import type { AppDownloadLinks } from '@/lib/app-links';
import type { CatalogRead } from '@/lib/catalog';
import { brandLinks, categoryTree } from '@/lib/navigation';
import { HeaderShell, type StoreLogo } from './layout/header-shell';
import type { NavLinkItem } from './layout/nav-anchor';

export type { StoreLogo } from './layout/header-shell';

/**
 * The site header: Home, Category, Brand and New Arrivals. Categories and brands are read on
 * the server (by the shop layout) and handed to the interactive shell as plain values, so this
 * stays a synchronous component. A failed read simply leaves its menu empty.
 */
export function SiteHeader({
  categories,
  brands,
  logo = null,
  extraLinks = [],
  avatarUrl = null,
  appLinks,
}: {
  categories?: CatalogRead<Category[]> | undefined;
  brands?: CatalogRead<Brand[]> | undefined;
  logo?: StoreLogo | null;
  /** Links the store added to the header menu (empty: only the built-in ones). */
  extraLinks?: readonly NavLinkItem[];
  /** The signed-in customer's picture, shown in the account shortcut until there is none. */
  avatarUrl?: string | null;
  /** The published store listings; with neither, the header shows no app glyph. */
  appLinks?: AppDownloadLinks;
} = {}) {
  return (
    <HeaderShell
      categories={categoryTree(categories?.kind === 'ok' ? categories.value : [])}
      brands={brandLinks(brands?.kind === 'ok' ? brands.value : [])}
      logo={logo}
      extraLinks={extraLinks}
      avatarUrl={avatarUrl}
      {...(appLinks === undefined ? {} : { appLinks })}
    />
  );
}
