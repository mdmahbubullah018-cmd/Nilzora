// @vitest-environment jsdom
import type {
  AdminBanner,
  AdminHomepageSection,
  AdminSitePage,
  HomepageSectionKey,
  MenuItem,
} from '@nilzora/contracts';
import { HOMEPAGE_SECTION_KEYS } from '@nilzora/contracts';
import type { ApiClient } from '@nilzora/web-session';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BannersPage from '@/app/admin/banners/page';
import HomepagePage from '@/app/admin/homepage/page';
import MenusPage from '@/app/admin/navigation/page';
import SitePagesPage from '@/app/admin/pages/page';
import SitePageEditor from '@/app/admin/pages/[slug]/page';
import { RedirectSignal } from '@/test/redirect';
import { testUser } from '@/test/fixtures';
import { BannerMobileImageForm, MoveBannerForm } from '@/components/merch/banner-forms';
import { HomepageEditor } from './homepage-editor';
import { MenusView } from './menu-views';
import { SitePageForm } from './site-page-views';

/*
 * The storefront-content pages (static pages, menus, homepage sections, banners): what each
 * renders from a real response shape, what it refuses to an account without
 * settings.manage (before any API call), and how the forms check, send and report. The
 * API is faked; nothing here claims a database, the media service or a bucket was involved.
 */

const api = vi.hoisted(() => ({
  adminListSitePages: vi.fn(),
  adminListMenuItems: vi.fn(),
  adminGetHomepage: vi.fn(),
  adminListCategories: vi.fn(),
  adminListBrands: vi.fn(),
  adminListBanners: vi.fn(),
}));
const actions = vi.hoisted(() => ({
  savePage: vi.fn(),
  saveMenu: vi.fn(),
  deleteMenu: vi.fn(),
  moveMenu: vi.fn(),
  saveHomepage: vi.fn(),
  reorderBanners: vi.fn(),
  uploadMobile: vi.fn(),
  removeMobile: vi.fn(),
}));
const read = vi.hoisted((): { outcome: 'ok' | 'signed_out' | 'unavailable' } => ({ outcome: 'ok' }));
const gate = vi.hoisted((): { user: unknown; csrf: unknown } => ({ user: undefined, csrf: undefined }));

vi.mock('@/lib/session', () => ({
  session: {
    read: async (call: (client: ApiClient, token: string) => Promise<unknown>) => {
      if (read.outcome !== 'ok') return { kind: read.outcome };
      try {
        return { kind: 'ok', value: await call(api as unknown as ApiClient, 'access-token') };
      } catch {
        return { kind: 'unavailable' };
      }
    },
  },
}));
vi.mock('@/lib/access', () => ({
  workspaceGate: () => Promise.resolve({ access: 'allowed', user: gate.user, csrf: gate.csrf }),
}));
vi.mock('@/lib/actions', () => ({ signInAction: vi.fn(), signOutAction: vi.fn() }));
vi.mock('@/lib/content-actions', () => ({
  saveSitePageAction: actions.savePage,
  saveMenuItemAction: actions.saveMenu,
  deleteMenuItemAction: actions.deleteMenu,
  moveMenuItemAction: actions.moveMenu,
  saveHomepageAction: actions.saveHomepage,
}));
vi.mock('@/lib/merch-actions', () => ({
  deleteBannerAction: vi.fn(),
  deleteBrandAction: vi.fn(),
  removeBannerMobileImageAction: actions.removeMobile,
  reorderBannersAction: actions.reorderBanners,
  uploadBannerMobileImageAction: actions.uploadMobile,
  removeBrandLogoAction: vi.fn(),
  saveBannerAction: vi.fn(),
  saveBrandAction: vi.fn(),
  setProductBrandAction: vi.fn(),
  uploadBannerImageAction: vi.fn(),
  uploadBrandLogoAction: vi.fn(),
}));
vi.mock('@/components/shell/workspace-shell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('next/navigation', async () => {
  const { throwNotFound, throwRedirect } = await import('@/test/redirect');
  return {
    redirect: vi.fn(throwRedirect),
    notFound: vi.fn(throwNotFound),
    usePathname: () => '/',
    useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  };
});

const csrf = { name: 'csrf_token', token: 'signed-test-token' };
const AT = '2026-11-06T09:00:00.000Z';
const id = (n: number) => `1d000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function sitePage(overrides: Partial<AdminSitePage> = {}): AdminSitePage {
  return {
    slug: 'about',
    title: 'About Nilzora',
    body: 'We sell everyday essentials.',
    seoTitle: null,
    seoDescription: null,
    isPublished: true,
    updatedAt: AT,
    ...overrides,
  };
}

function link(n: number, overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: id(n),
    menu: 'header',
    label: `Link ${String(n)}`,
    href: `/products/${String(n)}`,
    sortOrder: n,
    isActive: true,
    updatedAt: AT,
    ...overrides,
  };
}

function sections(overrides: Partial<Record<HomepageSectionKey, Partial<AdminHomepageSection>>> = {}) {
  return HOMEPAGE_SECTION_KEYS.map(
    (key, index): AdminHomepageSection => ({
      key,
      title: null,
      itemLimit: null,
      config: {},
      isEnabled: true,
      sortOrder: index + 1,
      updatedAt: AT,
      ...overrides[key],
    }),
  );
}

function banner(n: number, overrides: Partial<AdminBanner> = {}): AdminBanner {
  return {
    id: id(100 + n),
    placement: 'home_hero',
    title: `Banner ${String(n)}`,
    subtitle: null,
    ctaLabel: null,
    ctaHref: null,
    image: null,
    mobileImage: null,
    categorySlug: null,
    categoryId: null,
    sortOrder: n,
    isActive: true,
    startsAt: null,
    endsAt: null,
    ...overrides,
  };
}

const searchParams = () => Promise.resolve({});

beforeEach(() => {
  gate.user = testUser('super_admin');
  gate.csrf = csrf;
  read.outcome = 'ok';
  for (const mock of Object.values(api)) mock.mockReset();
  for (const mock of Object.values(actions)) mock.mockReset().mockResolvedValue({ status: 'idle' });
});

afterEach(cleanup);

const staffWithoutSettings = () =>
  testUser('staff', { permissions: ['admin_workspace.access', 'products.read'] });

describe('Pages list', () => {
  it('lists all six pages, written or not, with their state and storefront address', async () => {
    api.adminListSitePages.mockResolvedValue({
      pages: [sitePage(), sitePage({ slug: 'faq', title: 'FAQ', isPublished: false })],
    });
    render(<>{await SitePagesPage()}</>);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Pages');
    const table = screen.getByRole('table', { name: 'Static pages' });
    expect(within(table).getAllByRole('row')).toHaveLength(7);
    expect(within(table).getByText('Published')).toBeTruthy();
    expect(within(table).getByText('Draft')).toBeTruthy();
    // Four pages were never written; the storefront keeps its built-in text for them.
    expect(within(table).getAllByText('Not written yet')).toHaveLength(4);
    expect(within(table).getByText('/help/faq')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Edit About us' }).getAttribute('href')).toBe('/admin/pages/about');
  });

  it('refuses an account without settings.manage before reading anything', async () => {
    gate.user = staffWithoutSettings();
    render(<>{await SitePagesPage()}</>);

    expect(screen.getByText(/This needs the .Manage store settings. permission/)).toBeTruthy();
    expect(api.adminListSitePages).not.toHaveBeenCalled();
  });

  it('says so when the pages cannot be read, and sends a lapsed session to sign in', async () => {
    read.outcome = 'unavailable';
    render(<>{await SitePagesPage()}</>);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('link', { name: /try again/i })).toBeTruthy();

    read.outcome = 'signed_out';
    await expect(SitePagesPage()).rejects.toBeInstanceOf(RedirectSignal);
  });
});

describe('Page editor', () => {
  const params = (slug: string) => ({ params: Promise.resolve({ slug }), searchParams: searchParams() });

  it('opens a saved page with its text', async () => {
    api.adminListSitePages.mockResolvedValue({ pages: [sitePage()] });
    render(<>{await SitePageEditor(params('about'))}</>);

    expect(screen.getByLabelText(/^Title/)).toHaveProperty('value', 'About Nilzora');
    expect(screen.getByLabelText('Text')).toHaveProperty('value', 'We sell everyday essentials.');
    expect(screen.getByRole('checkbox', { name: /^Published/ })).toHaveProperty('checked', true);
  });

  it('starts a page that was never written from its name, as a draft', async () => {
    api.adminListSitePages.mockResolvedValue({ pages: [] });
    render(<>{await SitePageEditor(params('privacy'))}</>);

    expect(screen.getByLabelText(/^Title/)).toHaveProperty('value', 'Privacy policy');
    expect(screen.getByLabelText('Text')).toHaveProperty('value', '');
    expect(screen.getByRole('checkbox', { name: /^Published/ })).toHaveProperty('checked', false);
  });

  it('does not exist for a slug the storefront has no page for', async () => {
    await expect(SitePageEditor(params('contact'))).rejects.toThrow();
    expect(api.adminListSitePages).not.toHaveBeenCalled();
  });

  it('refuses an account without settings.manage before reading anything', async () => {
    gate.user = staffWithoutSettings();
    render(<>{await SitePageEditor(params('about'))}</>);

    expect(screen.getByText(/This needs the .Manage store settings. permission/)).toBeTruthy();
    expect(screen.queryByLabelText('Text')).toBeNull();
    expect(api.adminListSitePages).not.toHaveBeenCalled();
  });
});

describe('SitePageForm', () => {
  const unwritten = sitePage({ title: '', body: '', isPublished: false, updatedAt: null });

  it('will not send a published page without text, and says what to do', () => {
    render(<SitePageForm page={unwritten} csrf={csrf} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /^Published/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save page' }));

    expect(screen.getByText('A published page needs text. Write it, or save it as a draft.')).toBeTruthy();
    expect(actions.savePage).not.toHaveBeenCalled();
  });

  it('sends the slug, the text and the CSRF token, and shows the outcome', async () => {
    actions.savePage.mockResolvedValue({ status: 'success', message: 'Draft saved.' });
    render(<SitePageForm page={sitePage({ isPublished: false })} csrf={csrf} />);

    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'New text' } });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save page' }));

    expect(await screen.findByText('Draft saved.')).toBeTruthy();
    const sent = actions.savePage.mock.calls[0]?.[1] as FormData;
    expect(sent.get('slug')).toBe('about');
    expect(sent.get('body')).toBe('New text');
    expect(sent.get('isPublished')).toBeNull();
    expect(sent.get('csrf_token')).toBe('signed-test-token');
  });

  it('shows a refusal instead of staying silent', async () => {
    actions.savePage.mockResolvedValue({ status: 'error', message: 'Changing the storefront needs permission.' });
    render(<SitePageForm page={sitePage()} csrf={csrf} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save page' }));
    expect(await screen.findByText('Changing the storefront needs permission.')).toBeTruthy();
  });

  it('counts the text against its limit', () => {
    render(<SitePageForm page={sitePage({ body: 'abc' })} csrf={csrf} />);
    expect(screen.getByText('3/20,000')).toBeTruthy();
  });
});

describe('Menus page', () => {
  it('shows each of the three menus with its links in order, and no invented links', async () => {
    api.adminListMenuItems.mockResolvedValue({
      items: [
        link(2),
        link(1),
        link(3, { menu: 'footer_help', label: 'Delivery', href: '/help/shipping', isActive: false }),
      ],
    });
    render(<>{await MenusPage()}</>);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Menus');
    const header = screen.getByRole('list', { name: 'Header menu links' });
    expect(within(header).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('Link 1'),
      expect.stringContaining('Link 2'),
    ]);
    // The first cannot move earlier and the last cannot move later.
    expect(screen.getByRole('button', { name: 'Move Link 1 earlier' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Move Link 2 later' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Move Link 1 later' })).toHaveProperty('disabled', false);
    // A hidden link says so; an empty menu says the built-in one stays.
    expect(screen.getByText('Hidden')).toBeTruthy();
    expect(screen.getAllByText('No links yet')).toHaveLength(1);
  });

  it('refuses an account without settings.manage before reading anything', async () => {
    gate.user = staffWithoutSettings();
    render(<>{await MenusPage()}</>);
    expect(screen.getByText(/This needs the .Manage store settings. permission/)).toBeTruthy();
    expect(api.adminListMenuItems).not.toHaveBeenCalled();
  });

  it('says so when the menus cannot be read', async () => {
    read.outcome = 'unavailable';
    render(<>{await MenusPage()}</>);
    expect(screen.queryByRole('list', { name: /menu links/ })).toBeNull();
    expect(screen.getByRole('link', { name: /try again/i })).toBeTruthy();
  });
});

describe('MenusView', () => {
  it('sends a move with the order the page was rendered with', async () => {
    actions.moveMenu.mockResolvedValue({ status: 'error', message: 'The menu changed since this page loaded.' });
    render(<MenusView items={[link(1), link(2), link(3)]} csrf={csrf} />);

    fireEvent.click(screen.getByRole('button', { name: 'Move Link 2 earlier' }));

    expect(await screen.findByText('The menu changed since this page loaded.')).toBeTruthy();
    const sent = actions.moveMenu.mock.calls[0]?.[1] as FormData;
    expect(sent.get('itemId')).toBe(id(2));
    expect(sent.get('menu')).toBe('header');
    expect(sent.get('direction')).toBe('earlier');
    expect(sent.get('order')).toBe([id(1), id(2), id(3)].join(','));
    expect(sent.get('csrf_token')).toBe('signed-test-token');
  });

  it('refuses an off-site or script link before sending', async () => {
    render(<MenusView items={[]} csrf={csrf} />);
    const header = screen.getByRole('region', { name: 'Header menu' });
    fireEvent.click(within(header).getByText(/Add a link/));

    fireEvent.change(within(header).getByLabelText(/^Label/), { target: { value: 'Sale' } });
    fireEvent.change(within(header).getByLabelText(/^Link/), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(within(header).getByRole('button', { name: 'Add link' }));

    expect(await within(header).findByText('Use a store path such as /products, or an https address.')).toBeTruthy();
    expect(actions.saveMenu).not.toHaveBeenCalled();
  });

  it('adds a link with the menu it belongs to and shows the outcome', async () => {
    actions.saveMenu.mockResolvedValue({ status: 'success', message: 'Link added.' });
    render(<MenusView items={[]} csrf={csrf} />);
    const footer = screen.getByRole('region', { name: 'Footer: Shop' });
    fireEvent.click(within(footer).getByText(/Add a link/));

    fireEvent.change(within(footer).getByLabelText(/^Label/), { target: { value: 'Everything' } });
    fireEvent.change(within(footer).getByLabelText(/^Link/), { target: { value: '/products' } });
    fireEvent.click(within(footer).getByRole('button', { name: 'Add link' }));

    expect(await within(footer).findByText('Link added.')).toBeTruthy();
    const sent = actions.saveMenu.mock.calls[0]?.[1] as FormData;
    expect(sent.get('menu')).toBe('footer_shop');
    expect(sent.get('itemId')).toBeNull();
    expect(sent.get('href')).toBe('/products');
  });

  it('tells staff a full menu cannot take another link', () => {
    const twelve = Array.from({ length: 12 }, (_, index) => link(index + 1));
    render(<MenusView items={twelve} csrf={csrf} />);
    const header = screen.getByRole('region', { name: 'Header menu' });
    expect(within(header).getByText(/holds 12 links, the most it can/)).toBeTruthy();
    expect(within(header).queryByText(/Add a link/)).toBeNull();
  });
});

describe('Homepage page', () => {
  it('shows the sections in the saved order, with the category and brand lists for the product rows', async () => {
    api.adminGetHomepage.mockResolvedValue({
      sections: sections({ featured: { sortOrder: 0, title: 'Our picks', itemLimit: 8, config: { categorySlug: 'eid' } } }),
    });
    api.adminListCategories.mockResolvedValue({ categories: [{ id: id(1), slug: 'eid', name: 'Eid' }] });
    api.adminListBrands.mockResolvedValue({ brands: [{ id: id(2), slug: 'acme', name: 'Acme' }] });
    render(<>{await HomepagePage()}</>);

    const list = screen.getByRole('list', { name: 'Homepage sections' });
    const headings = within(list).getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(headings[0]).toContain('Featured products');
    expect(headings).toHaveLength(7);
    expect(screen.getAllByLabelText('Heading')[0]).toHaveProperty('value', 'Our picks');
    expect(screen.getAllByLabelText('Only this category')[0]).toHaveProperty('value', 'eid');
    expect(screen.getAllByLabelText('Only this category')[0]?.tagName).toBe('SELECT');
  });

  it('falls back to typed slugs when the category list cannot be read', async () => {
    api.adminGetHomepage.mockResolvedValue({ sections: sections() });
    api.adminListCategories.mockRejectedValue(new Error('down'));
    api.adminListBrands.mockRejectedValue(new Error('down'));
    render(<>{await HomepagePage()}</>);

    // The page still shows; the filters become text boxes instead of invented lists.
    expect(screen.getAllByLabelText('Only this category')[0]?.tagName).toBe('INPUT');
  });

  it('refuses an account without settings.manage before reading anything', async () => {
    gate.user = staffWithoutSettings();
    render(<>{await HomepagePage()}</>);
    expect(screen.getByText(/This needs the .Manage store settings. permission/)).toBeTruthy();
    expect(api.adminGetHomepage).not.toHaveBeenCalled();
  });
});

describe('HomepageEditor', () => {
  const render7 = (overrides: Parameters<typeof sections>[0] = {}) =>
    render(<HomepageEditor sections={sections(overrides)} categories={[]} brands={[]} csrf={csrf} />);

  it('moves a section, shows it as unsaved and sends every section with its position', async () => {
    actions.saveHomepage.mockResolvedValue({ status: 'success', message: 'Homepage saved.' });
    const { container } = render7();

    fireEvent.click(screen.getByRole('button', { name: 'Move Hero banner later' }));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save homepage' }));

    expect(await screen.findByText('Homepage saved.')).toBeTruthy();
    const sent = actions.saveHomepage.mock.calls[0]?.[1] as FormData;
    expect(sent.get('position_categories')).toBe('1');
    expect(sent.get('position_hero')).toBe('2');
    expect(sent.get('enabled_hero')).toBe('on');
    expect(sent.get('csrf_token')).toBe('signed-test-token');
    expect(container.querySelectorAll('input[name^="position_"]')).toHaveLength(7);
  });

  it('hides a section by its checkbox', async () => {
    render7();
    fireEvent.click(screen.getByLabelText('Show Brands'));
    fireEvent.click(screen.getByRole('button', { name: 'Save homepage' }));

    await waitFor(() => expect(actions.saveHomepage).toHaveBeenCalled());
    const sent = actions.saveHomepage.mock.calls[0]?.[1] as FormData;
    expect(sent.get('enabled_brands')).toBeNull();
    expect(sent.get('enabled_hero')).toBe('on');
  });

  it('blocks a limit outside 1 to 24 and says so on that section', () => {
    const { container } = render7();
    const limit = container.querySelector('[name="itemLimit_featured"]') as HTMLInputElement;

    fireEvent.change(limit, { target: { value: '99' } });
    expect(screen.getByText('Use a whole number from 1 to 24, or leave it empty.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save homepage' }));

    expect(actions.saveHomepage).not.toHaveBeenCalled();
  });

  it('offers a filter only on the two product rows, and discards unsaved changes', () => {
    const { container } = render7();
    expect(container.querySelectorAll('[name^="categorySlug_"]')).toHaveLength(2);
    expect(container.querySelector('[name="categorySlug_brands"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Move Hero banner later' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect(screen.getByRole('button', { name: 'Move Hero banner earlier' })).toHaveProperty('disabled', true);
  });
});

describe('Banners page', () => {
  it('groups banners by placement, first shown first, and names the category strip', async () => {
    api.adminListBanners.mockResolvedValue({
      banners: [
        banner(2, { title: 'Second hero' }),
        banner(1, { title: 'First hero' }),
        banner(3, {
          placement: 'category',
          categoryId: id(9),
          categorySlug: 'eid-sale',
          title: 'Eid strip',
        }),
      ],
    });
    api.adminListCategories.mockResolvedValue({ categories: [] });
    const { container } = render(<>{await BannersPage()}</>);

    const sectionTitles = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(sectionTitles).toEqual(
      expect.arrayContaining(['Homepage hero', 'Category strip: eid-sale']),
    );
    const hero = screen.getByRole('region', { name: 'Homepage hero' });
    const titles = Array.from(hero.querySelectorAll('summary span.truncate')).map((node) => node.textContent);
    expect(titles).toEqual(['First hero', 'Second hero']);
    // Each banner carries the order of its own group for the move buttons.
    const orders = Array.from(hero.querySelectorAll('input[name="order"]')).map((input) => (input as HTMLInputElement).value);
    expect(orders).toEqual([`${id(101)},${id(102)}`, `${id(101)},${id(102)}`]);
    expect(container.textContent).toContain('Position 1');
  });

  it('says plainly when there are no banners', async () => {
    api.adminListBanners.mockResolvedValue({ banners: [] });
    api.adminListCategories.mockResolvedValue({ categories: [] });
    render(<>{await BannersPage()}</>);
    expect(screen.getByText('No banners yet')).toBeTruthy();
  });

  it('refuses an account without settings.manage before reading anything', async () => {
    gate.user = staffWithoutSettings();
    render(<>{await BannersPage()}</>);
    expect(screen.getByText(/This needs the .Manage store settings. permission/)).toBeTruthy();
    expect(api.adminListBanners).not.toHaveBeenCalled();
  });

  it('says so when the banners cannot be read', async () => {
    read.outcome = 'unavailable';
    render(<>{await BannersPage()}</>);
    expect(screen.queryByText('No banners yet')).toBeNull();
    expect(screen.getByRole('link', { name: /try again/i })).toBeTruthy();
  });
});

describe('MoveBannerForm', () => {
  it('cannot move the first banner earlier or the last later', () => {
    const first = banner(1);
    const { rerender } = render(
      <MoveBannerForm banner={first} order={`${first.id},${id(102)}`} index={0} count={2} csrf={csrf} />,
    );
    expect(screen.getByRole('button', { name: 'Move Banner 1 earlier' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Move Banner 1 later' })).toHaveProperty('disabled', false);

    rerender(<MoveBannerForm banner={first} order={`${id(102)},${first.id}`} index={1} count={2} csrf={csrf} />);
    expect(screen.getByRole('button', { name: 'Move Banner 1 later' })).toHaveProperty('disabled', true);
  });

  it('sends the banner, its placement, its category and the rendered order', async () => {
    actions.reorderBanners.mockResolvedValue({ status: 'error', message: 'The banners changed since this page loaded.' });
    const strip = banner(2, { placement: 'category', categoryId: id(9), categorySlug: 'eid-sale' });
    render(<MoveBannerForm banner={strip} order={`${id(101)},${strip.id}`} index={1} count={2} csrf={csrf} />);

    fireEvent.click(screen.getByRole('button', { name: 'Move Banner 2 earlier' }));

    expect(await screen.findByText('The banners changed since this page loaded.')).toBeTruthy();
    const sent = actions.reorderBanners.mock.calls[0]?.[1] as FormData;
    expect(sent.get('bannerId')).toBe(strip.id);
    expect(sent.get('placement')).toBe('category');
    expect(sent.get('categoryId')).toBe(id(9));
    expect(sent.get('direction')).toBe('earlier');
    expect(sent.get('order')).toBe(`${id(101)},${strip.id}`);
    expect(sent.get('csrf_token')).toBe('signed-test-token');
  });
});

describe('BannerMobileImageForm', () => {
  it('offers an upload only, and explains the fallback, while there is no small-screen picture', () => {
    render(<BannerMobileImageForm banner={banner(1)} csrf={csrf} />);
    expect(screen.getByText(/phones and narrow windows show the main picture/)).toBeTruthy();
    expect(screen.getByText('Upload small-screen picture')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove small-screen picture' })).toBeNull();
  });

  it('shows the current picture and removes it by banner id', async () => {
    actions.removeMobile.mockResolvedValue({ status: 'success', message: 'Small-screen picture removed.' });
    const withPicture = banner(1, {
      mobileImage: { url: 'https://media.example/b.webp', thumbUrl: 'https://media.example/b-thumb.webp' },
    });
    render(<BannerMobileImageForm banner={withPicture} csrf={csrf} />);

    expect(screen.getByAltText('The small-screen picture of Banner 1')).toBeTruthy();
    expect(screen.getByText('Replace small-screen picture')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove small-screen picture' }));

    expect(await screen.findByText('Small-screen picture removed.')).toBeTruthy();
    expect((actions.removeMobile.mock.calls[0]?.[1] as FormData).get('bannerId')).toBe(withPicture.id);
  });
});
