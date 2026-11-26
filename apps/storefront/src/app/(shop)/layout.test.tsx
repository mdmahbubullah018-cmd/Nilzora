import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ShopLayout from './layout';

/*
 * The shop layout is where the store's published logo reaches the header. The header and the
 * footer are stubbed out so this test is about the wiring: what the layout reads, and what it
 * hands to the header (a resolved URL, or nothing at all).
 */

const catalog = vi.hoisted(() => ({
  getCategories: vi.fn(),
  getBrands: vi.fn(() => Promise.resolve({ kind: 'ok', value: [] })),
}));
const seo = vi.hoisted(() => ({ storeProfile: vi.fn() }));
const sessionMock = vi.hoisted(() => ({
  getSession: vi.fn(() => Promise.resolve({ status: 'signed_out' })),
  csrfToken: vi.fn(() => Promise.resolve('csrf-token')),
  read: vi.fn(),
}));

const siteContent = vi.hoisted(() => ({ getNavigation: vi.fn(() => Promise.resolve(null)) }));
// The promotional popup is its own feature with its own tests; here it is simply "nothing live".
const promoPopup = vi.hoisted(() => ({ getPromoPopups: vi.fn(() => Promise.resolve([])) }));

vi.mock('@/lib/catalog', () => catalog);
vi.mock('@/lib/promo-popup', () => promoPopup);
vi.mock('@/lib/seo', () => seo);
vi.mock('@/lib/site-content', () => siteContent);
vi.mock('@/lib/session', () => ({ session: sessionMock }));
vi.mock('@/components/wishlist/wishlist-provider', () => ({
  WishlistProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/support/support-widget', () => ({ SupportWidget: () => null }));
vi.mock('@/components/layout/mobile-tab-bar', () => ({ MobileTabBar: () => null }));
vi.mock('@/components/site-footer', () => ({
  SiteFooter: ({ navigation }: { navigation?: { pages: { slug: string }[] } | null }) => (
    <footer
      data-testid="footer"
      data-pages={navigation?.pages.map((page) => page.slug).join(',')}
    />
  ),
}));
vi.mock('@/components/site-header', () => ({
  SiteHeader: ({
    logo,
    extraLinks,
  }: {
    logo?: { url: string; name: string } | null;
    extraLinks?: { label: string }[];
  }) => (
    <header
      data-testid="header"
      data-logo={logo?.url ?? ''}
      data-name={logo?.name ?? ''}
      data-extra={(extraLinks ?? []).map((link) => link.label).join(',')}
    />
  ),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function profile(overrides: Record<string, unknown> = {}) {
  return {
    displayName: 'Nilzora',
    logoKey: null,
    logoUrl: null,
    codAvailable: true,
    ...overrides,
  };
}

describe('ShopLayout', () => {
  it('hands the resolved logo URL to the header', async () => {
    catalog.getCategories.mockResolvedValue({ kind: 'ok', value: [] });
    seo.storeProfile.mockResolvedValue(
      profile({
        displayName: 'Nilzora BD',
        logoUrl: 'https://media.nilzora.test/brand/logo/thumb.webp',
      }),
    );

    render(await ShopLayout({ children: <p>Shop</p> }));

    const header = screen.getByTestId('header');
    expect(header.getAttribute('data-logo')).toBe(
      'https://media.nilzora.test/brand/logo/thumb.webp',
    );
    expect(header.getAttribute('data-name')).toBe('Nilzora BD');
  });

  it('hands nothing to the header when the store has no logo', async () => {
    catalog.getCategories.mockResolvedValue({ kind: 'ok', value: [] });
    seo.storeProfile.mockResolvedValue(profile());

    render(await ShopLayout({ children: <p>Shop</p> }));

    expect(screen.getByTestId('header').getAttribute('data-logo')).toBe('');
  });

  it('still renders the page when the profile cannot be read', async () => {
    catalog.getCategories.mockResolvedValue({ kind: 'ok', value: [] });
    seo.storeProfile.mockResolvedValue(null);

    render(await ShopLayout({ children: <p>Shop content</p> }));

    expect(screen.getByText('Shop content')).not.toBeNull();
    expect(screen.getByTestId('header').getAttribute('data-logo')).toBe('');
  });

  it('hands the store’s header links and navigation to the header and footer', async () => {
    catalog.getCategories.mockResolvedValue({ kind: 'ok', value: [] });
    seo.storeProfile.mockResolvedValue(profile());
    siteContent.getNavigation.mockResolvedValue({
      menus: {
        header: [{ label: 'Eid sale', href: '/products' }],
        footerShop: [],
        footerHelp: [],
      },
      pages: [{ slug: 'returns', title: 'Returns' }],
    } as never);

    render(await ShopLayout({ children: <p>Shop</p> }));

    expect(screen.getByTestId('header').getAttribute('data-extra')).toBe('Eid sale');
    expect(screen.getByTestId('footer').getAttribute('data-pages')).toBe('returns');
  });

  it('keeps the built-in navigation when the store manages none', async () => {
    siteContent.getNavigation.mockResolvedValue(null);
    catalog.getCategories.mockResolvedValue({ kind: 'ok', value: [] });
    seo.storeProfile.mockResolvedValue(profile());

    render(await ShopLayout({ children: <p>Shop</p> }));

    expect(screen.getByTestId('header').getAttribute('data-extra')).toBe('');
    expect(screen.getByTestId('footer').getAttribute('data-pages')).toBeNull();
  });
});
