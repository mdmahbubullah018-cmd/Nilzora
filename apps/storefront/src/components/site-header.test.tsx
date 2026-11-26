import type { Brand } from '@nilzora/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteHeader } from './site-header';
import { category } from '@/testing/catalog-fixtures';

const navigation = vi.hoisted(() => ({ pathname: '/products' }));
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push }),
}));

const fetchMock = vi.fn<typeof fetch>(() =>
  Promise.resolve(new Response(JSON.stringify({ count: 2 }))),
);

/** A controllable IntersectionObserver: tests decide when the top sentinel leaves the screen. */
let observed: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
class FakeIntersectionObserver {
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    observed = callback;
  }
  observe() {}
  disconnect() {
    observed = null;
  }
}

beforeEach(() => {
  navigation.pathname = '/products';
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

afterEach(() => {
  fetchMock.mockClear();
  vi.unstubAllGlobals();
  observed = null;
});

function brand(overrides: Partial<Brand> = {}): Brand {
  return {
    slug: 'aarong',
    name: 'Aarong',
    description: null,
    logo: null,
    banner: null,
    productCount: 4,
    ...overrides,
  };
}

const departments = {
  kind: 'ok' as const,
  value: [
    category({ slug: 'women', name: 'Women', productCount: 3 }),
    category({ slug: 'men', name: 'Men', productCount: 2 }),
    category({ slug: 'sarees', name: 'Sarees', parentSlug: 'women', depth: 2 }),
    category({ slug: 'jamdani', name: 'Jamdani', parentSlug: 'sarees', depth: 3 }),
    // A subcategory whose parent is not published must not surface anywhere.
    category({ slug: 'stray', name: 'Stray', parentSlug: 'hidden-parent', depth: 2 }),
  ],
};

const brands = {
  kind: 'ok' as const,
  value: [
    brand(),
    brand({ slug: 'yellow', name: 'Yellow', productCount: 2 }),
    // A brand with nothing on sale would lead to an empty page, so menus leave it out.
    brand({ slug: 'empty-label', name: 'Empty Label', productCount: 0 }),
  ],
};

function mainNav() {
  return screen.getByRole('navigation', { name: 'Main' });
}

describe('SiteHeader', () => {
  it('keeps account in the desktop header only; the tab bar owns it on phones', () => {
    render(<SiteHeader categories={departments} />);

    const account = screen.getByRole('link', { name: 'Account' });
    expect(account.getAttribute('href')).toBe('/account');
    expect(account.className).toMatch(/\bhidden\b/);
    expect(account.className).toMatch(/\blg:grid\b/);
  });

  it('shows the customer picture in the account slot once there is one, and the glyph until then', () => {
    const { container, rerender } = render(<SiteHeader categories={departments} />);
    expect(container.querySelector('a[href="/account"] img')).toBeNull();

    const picture = 'https://lh3.googleusercontent.com/a/customer-picture';
    rerender(<SiteHeader categories={departments} avatarUrl={picture} />);

    expect(container.querySelector('a[href="/account"] img')?.getAttribute('src')).toBe(picture);
    expect(screen.getByRole('link', { name: 'Account' }).getAttribute('href')).toBe('/account');
  });

  it('draws the cart and the account at one size, inside controls of one size', () => {
    const { container, rerender } = render(<SiteHeader categories={departments} />);

    // 22px of drawing in each slot, so the cart's outline and the account's outline match.
    const cartIcon = container.querySelector('a[href="/cart"] svg');
    expect(cartIcon?.getAttribute('width')).toBe('22');
    expect(cartIcon?.getAttribute('height')).toBe('22');

    const account = screen.getByRole('link', { name: 'Account' });
    expect(account.querySelector('svg')?.getAttribute('class')).toContain('size-5.5');
    expect(account.className).toContain('size-11');
    expect(container.querySelector('a[href="/cart"]')?.className).toContain('size-11');

    // A portrait needs a little more diameter than an outline to carry the same optical weight,
    // but it stays well inside the same control rather than growing past the cart.
    rerender(
      <SiteHeader categories={departments} avatarUrl="https://lh3.googleusercontent.com/a/pic" />,
    );
    const portrait = screen.getByRole('link', { name: 'Account' }).querySelector('span');
    expect(portrait?.className).toContain('size-6');
    expect(portrait?.className).not.toContain('size-7');
  });

  it('takes the cart colour from the header surface: white over the banner, primary on the bar', () => {
    render(<SiteHeader categories={departments} />);

    // The same `data-solid` switch the logo follows, so the two never disagree.
    const cart = document.querySelector('a[href="/cart"] svg');
    expect(cart?.getAttribute('class')).toContain('group-data-[solid=true]/header:text-primary');
    expect(cart?.getAttribute('stroke')).toBe('currentColor');
  });

  it('shows Home, Category, Brand, New Arrivals and Wishlist, never individual names or a Sale link', () => {
    render(<SiteHeader categories={departments} brands={brands} />);

    const nav = mainNav();
    expect(within(nav).getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/');
    expect(within(nav).getByRole('button', { name: 'Category' })).not.toBeNull();
    expect(within(nav).getByRole('button', { name: 'Brand' })).not.toBeNull();
    expect(within(nav).getByRole('link', { name: 'New Arrivals' }).getAttribute('href')).toBe(
      '/products?sort=newest',
    );
    expect(within(nav).getByRole('link', { name: 'Wishlist' }).getAttribute('href')).toBe(
      '/wishlist',
    );
    // Category and brand names stay inside the closed panels until asked for.
    expect(within(nav).queryByRole('link', { name: 'Women' })).toBeNull();
    expect(screen.queryByRole('link', { name: /sale/i })).toBeNull();
  });

  it('opens a category panel with the real hierarchy and closes it on Escape', () => {
    render(<SiteHeader categories={departments} brands={brands} />);
    const trigger = within(mainNav()).getByRole('button', { name: 'Category' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
    expect(panel?.hasAttribute('data-open')).toBe(true);
    expect(panel?.hasAttribute('inert')).toBe(false);
    const linksOf = () =>
      within(panel!)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]);
    // It opens showing only the top-level categories: the first look is never every category and
    // subcategory at once.
    expect(linksOf()).toEqual([
      ['Women', '/categories/women'],
      ['Men', '/categories/men'],
      ['All categories', '/categories'],
    ]);

    // Focusing (or hovering) a category reveals its own subcategories, and theirs, beside the list.
    fireEvent.focus(within(panel!).getByRole('link', { name: 'Women' }).closest('li')!);
    expect(linksOf()).toEqual([
      ['Women', '/categories/women'],
      ['Men', '/categories/men'],
      ['Sarees', '/categories/sarees'],
      ['Jamdani', '/categories/jamdani'],
      ['All categories', '/categories'],
    ]);
    expect(within(panel!).queryByText('Stray')).toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    // Closed panels animate out, then stay inert: out of the tab order and the accessibility tree.
    expect(panel?.hasAttribute('data-open')).toBe(false);
    expect(panel?.hasAttribute('inert')).toBe(true);
  });

  it('opens a brand panel with stocked brands only, one at a time with the category panel', () => {
    render(<SiteHeader categories={departments} brands={brands} />);
    const category = within(mainNav()).getByRole('button', { name: 'Category' });
    const brandTrigger = within(mainNav()).getByRole('button', { name: 'Brand' });

    fireEvent.click(category);
    fireEvent.click(brandTrigger);
    expect(category.getAttribute('aria-expanded')).toBe('false');
    expect(brandTrigger.getAttribute('aria-expanded')).toBe('true');

    const panel = document.getElementById(brandTrigger.getAttribute('aria-controls') ?? '')!;
    expect(
      within(panel)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Aarong', '/aarong'],
      ['Yellow', '/yellow'],
      ['All brands', '/brands'],
    ]);

    // Following a link closes the panel.
    fireEvent.click(within(panel).getByRole('link', { name: 'Aarong' }));
    expect(brandTrigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('falls back to plain directory links when nothing is published', () => {
    render(<SiteHeader />);

    const nav = mainNav();
    expect(within(nav).queryByRole('button')).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Category' }).getAttribute('href')).toBe(
      '/categories',
    );
    expect(within(nav).getByRole('link', { name: 'Brand' }).getAttribute('href')).toBe('/brands');
  });

  it('searches with a GET form to /search, in the header and in the menu, each with its own ids', () => {
    const { container } = render(<SiteHeader />);

    const forms = Array.from(container.querySelectorAll('form'));
    expect(forms).toHaveLength(2);
    for (const form of forms) {
      expect(form.getAttribute('role')).toBe('search');
      expect(form.getAttribute('action')).toBe('/search');
      expect(form.getAttribute('method') ?? 'get').toMatch(/get/i);
      const input = form.querySelector('input');
      expect(input?.name).toBe('q');
      expect(input?.type).toBe('search');
      expect(input?.disabled).toBe(false);
      expect(input?.maxLength).toBe(100);
      expect(form.querySelector(`label[for="${input?.id}"]`)?.textContent).toBe('Search products');
      expect(form.querySelector('button[type="submit"]')?.textContent).toBe('Search');
    }
    const ids = forms.map((form) => form.querySelector('input')?.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('links to the cart with a cart icon and shows its unit count once known', async () => {
    render(<SiteHeader />);

    const cart = screen.getByRole('link', { name: /^Cart/ });
    expect(cart.getAttribute('href')).toBe('/cart');
    // The Nilzora cart drawing, not a stand-in icon from the icon set.
    const drawing = [...(cart.querySelectorAll('path') ?? [])].map(
      (path) => path.getAttribute('d') ?? '',
    );
    expect(drawing.some((d) => d.startsWith('M6.4 6.75h14.5'))).toBe(true);
    expect(cart.querySelectorAll('circle')).toHaveLength(2);
    await waitFor(() => expect(cart.getAttribute('aria-label')).toBe('Cart, 2 items'));
  });

  it('keeps the cart in the phone header and no wishlist or account shortcut', () => {
    navigation.pathname = '/wishlist';
    render(<SiteHeader />);

    const cart = screen.getByRole('link', { name: /^Cart/ });
    expect(cart.className).not.toMatch(/\bhidden\b/);
    expect(cart.getAttribute('href')).toBe('/cart');

    // Wishlist stays in the desktop nav and the mobile menu; the phone header no longer has it.
    const shortcut = screen
      .getAllByRole('link', { name: /^Wishlist/ })
      .find((link) => link.className.includes('lg:hidden'));
    expect(shortcut).toBeUndefined();
  });

  it('no longer says the store is opening soon, and has no contact pill', () => {
    const { container } = render(<SiteHeader />);
    expect(container.textContent).not.toMatch(/opening soon|available soon|contact us/i);
    expect(container.querySelector('[disabled]')).toBeNull();
  });

  it('shows the logo the store published, with the home link named by the store', () => {
    render(
      <SiteHeader
        logo={{ url: 'https://media.nilzora.test/brand/logo/thumb.webp', name: 'Nilzora BD' }}
      />,
    );

    const home = screen.getByRole('link', { name: 'Nilzora BD' });
    expect(home.getAttribute('href')).toBe('/');
    const image = home.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://media.nilzora.test/brand/logo/thumb.webp');
    // The link carries the name, so the picture inside is not announced a second time.
    expect(image?.getAttribute('alt')).toBe('');
  });

  it('uses the official Nilzora artwork when the store has published no logo', () => {
    render(<SiteHeader logo={null} />);

    const home = screen.getByRole('link', { name: 'Nilzora' });
    expect(home.getAttribute('href')).toBe('/');
    const sources = Array.from(home.querySelectorAll('img')).map((img) => img.getAttribute('src'));
    expect(sources).toHaveLength(1);
    expect(sources[0]).toContain('nilzora-logo-on-light.png');
  });

  it('starts transparent over the home banner and turns solid once the page scrolls', () => {
    navigation.pathname = '/';
    const { container } = render(<SiteHeader />);
    const header = container.querySelector('header');

    expect(header?.getAttribute('data-solid')).toBe('false');
    // Over the banner both logo versions are present so they can cross-fade without a flash.
    const logos = Array.from(
      screen.getByRole('link', { name: 'Nilzora' }).querySelectorAll('img'),
    ).map((img) => img.getAttribute('src'));
    expect(logos.some((src) => src?.includes('nilzora-logo-on-dark.png'))).toBe(true);
    expect(logos.some((src) => src?.includes('nilzora-logo-on-light.png'))).toBe(true);

    act(() => observed?.([{ isIntersecting: false }]));
    expect(header?.getAttribute('data-solid')).toBe('true');

    act(() => observed?.([{ isIntersecting: true }]));
    expect(header?.getAttribute('data-solid')).toBe('false');
  });

  it('turns solid over the home banner while a menu panel is open', () => {
    navigation.pathname = '/';
    const { container } = render(<SiteHeader categories={departments} />);
    const header = container.querySelector('header');

    fireEvent.click(within(mainNav()).getByRole('button', { name: 'Category' }));
    expect(header?.getAttribute('data-solid')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(header?.getAttribute('data-solid')).toBe('false');
  });

  it('is solid from the start on every page without a banner', () => {
    navigation.pathname = '/cart';
    const { container } = render(<SiteHeader />);

    expect(container.querySelector('header')?.getAttribute('data-solid')).toBe('true');
  });
});

describe('Mobile menu', () => {
  function openMenu() {
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    return screen.getByRole('dialog', { name: 'Menu' });
  }

  function hrefs(region: HTMLElement): (string | null)[] {
    return within(region)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
  }

  it('is a bottom sheet that rises from the bottom edge, in transform only, and stays inside the screen', () => {
    render(<SiteHeader categories={departments} brands={brands} />);
    const menu = openMenu();

    // Pinned to the bottom, rounded on top, never taller than 88% of the viewport.
    expect(menu.className).toContain('bottom-0');
    expect(menu.className).toContain('rounded-t-3xl');
    expect(menu.className).toContain('max-h-[min(88dvh,42rem)]');
    // It travels up from below by translate alone (no library, no layout animation), stays
    // opaque while moving, and does not move at all for reduced motion.
    expect(menu.className).toContain('starting:open:translate-y-full');
    expect(menu.className).toContain('not-open:translate-y-full');
    expect(menu.className).toContain('not-open:opacity-100');
    expect(menu.className).toContain('motion-reduce:transition-none');
    // A tap on the overlay (the dialog itself) closes it again.
    fireEvent.click(menu);
    expect(screen.getByRole('button', { name: 'Open menu' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('groups shopping, categories and brands, without sign-in links or duplicates', () => {
    render(<SiteHeader categories={departments} brands={brands} />);
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    const menu = openMenu();
    expect(menu.hasAttribute('open')).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(within(menu).getByRole('search')).not.toBeNull();

    const shop = within(menu).getByRole('navigation', { name: 'Shop' });
    // Category and Brand are collapsible groups, closed until tapped.
    const groups = Array.from(shop.querySelectorAll(':scope > ul > li > details'));
    expect(groups.map((group) => group.querySelector('summary')?.textContent)).toEqual([
      'Category',
      'Brand',
    ]);
    expect(groups.every((group) => !group.hasAttribute('open'))).toBe(true);

    // Women has subcategories, so it expands; Men has none, so it is a plain link.
    expect(within(shop).getByText('Women').closest('summary')).not.toBeNull();
    expect(within(shop).getByText('Sarees').closest('summary')).not.toBeNull();
    expect(within(shop).getByRole('link', { name: 'Jamdani' }).getAttribute('href')).toBe(
      '/categories/jamdani',
    );
    expect(within(shop).getByRole('link', { name: 'Men' }).getAttribute('href')).toBe(
      '/categories/men',
    );
    expect(within(shop).queryByText('Stray')).toBeNull();
    expect(within(shop).queryByText('Empty Label')).toBeNull();

    expect(within(menu).queryByRole('link', { name: /sign in|register/i })).toBeNull();
    expect(within(menu).queryByRole('link', { name: /coupon/i })).toBeNull();
    const all = hrefs(menu);
    expect(new Set(all).size).toBe(all.length);

    expect(hrefs(within(menu).getByRole('navigation', { name: 'Your account' }))).toEqual([
      '/account',
      '/wishlist',
      '/vouchers',
      '/account/vouchers',
      '/account/orders',
      '/account/returns',
      '/account/addresses',
    ]);
    expect(hrefs(within(menu).getByRole('navigation', { name: 'Help' }))).toEqual([
      '/contact',
      '/help/faq',
      '/about',
      '/help/shipping',
      '/help/returns',
      '/privacy',
      '/terms',
    ]);
  });

  it('closes on the close button, on Escape and when a link is followed', () => {
    render(<SiteHeader categories={departments} />);

    let menu = openMenu();
    fireEvent.click(within(menu).getByRole('button', { name: 'Close menu' }));
    expect(menu.hasAttribute('open')).toBe(false);

    menu = openMenu();
    fireEvent(menu, new Event('cancel', { cancelable: true }));
    expect(menu.hasAttribute('open')).toBe(false);

    menu = openMenu();
    fireEvent.click(within(menu).getByRole('link', { name: 'My orders' }));
    expect(menu.hasAttribute('open')).toBe(false);
  });

  it('closes by itself when the route changes', () => {
    const { rerender } = render(<SiteHeader categories={departments} />);
    const menu = openMenu();
    expect(menu.hasAttribute('open')).toBe(true);

    navigation.pathname = '/categories/men';
    rerender(<SiteHeader categories={departments} />);
    expect(menu.hasAttribute('open')).toBe(false);
  });

  it('carries the app download glyph only when the store published a listing', () => {
    const play = 'https://play.google.com/store/apps/details?id=com.nilzora.app';
    const { rerender } = render(<SiteHeader />);
    expect(screen.queryByRole('button', { name: 'Download the Nilzora app' })).toBeNull();

    rerender(<SiteHeader appLinks={{ googlePlayUrl: play, appStoreUrl: null }} />);
    const glyphs = screen.getAllByRole('button', { name: 'Download the Nilzora app' });
    // One control, in the desktop header only. It is hidden (not merely unlabelled) below xl,
    // and the phone's way in is the strip under the trusted section.
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0]?.textContent).toContain('Get App');
    expect(glyphs[0]?.textContent).not.toContain('Get in App');
    // Brand blue while the bar is solid, and no coloured box of its own.
    expect(glyphs[0]?.className).toContain('text-primary-action');
    expect(glyphs[0]?.className).not.toMatch(/(?:^|\s)bg-(?!transparent)/);

    fireEvent.click(glyphs[0] as HTMLElement);
    expect(screen.getByRole('link', { name: /Get it on Google Play/ }).getAttribute('href')).toBe(
      play,
    );
    expect(screen.queryByRole('link', { name: /App Store/ })).toBeNull();
  });
});
