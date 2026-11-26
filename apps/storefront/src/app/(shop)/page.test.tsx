import type { Banner } from '@nilzora/contracts';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categories, category, listing, summary } from '@/testing/catalog-fixtures';
import HomePage from './page';

const catalog = vi.hoisted(() => ({
  getCategories: vi.fn(),
  listProducts: vi.fn(),
  getBanners: vi.fn(),
  getBrands: vi.fn(),
  getCampaigns: vi.fn(),
  getShoppingZones: vi.fn(),
}));
vi.mock('@/lib/catalog', () => catalog);

const seo = vi.hoisted(() => ({
  storeProfile: vi.fn(),
  // The product cards on this page now build a share link from the site's own address.
  siteUrl: () => new URL('https://shop.example.test'),
}));
vi.mock('@/lib/seo', () => seo);

const featured = summary({ name: 'Featured bottle', isFeatured: true });
const regular = summary({ name: 'Regular pan' });
const fresh = summary({ name: 'Fresh arrival' });

function heroBanner(n: number, overrides: Partial<Banner> = {}): Banner {
  return {
    id: `0b000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    placement: 'home_hero',
    title: `Eid collection ${n}`,
    subtitle: 'Up to the admin',
    ctaLabel: 'Shop now',
    ctaHref: '/categories/fashion',
    image: {
      url: `https://media.nilzora.test/banners/${n}/full.webp`,
      thumbUrl: `https://media.nilzora.test/banners/${n}/thumb.webp`,
    },
    categorySlug: null,
    ...overrides,
  };
}

function sectionNamed(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

beforeEach(() => {
  seo.storeProfile.mockResolvedValue(null);
  catalog.getCategories.mockResolvedValue({ kind: 'ok', value: categories });
  catalog.getBanners.mockResolvedValue([]);
  catalog.getCampaigns.mockResolvedValue([]);
  catalog.getShoppingZones.mockResolvedValue([]);
  catalog.getBrands.mockResolvedValue({ kind: 'ok', value: [] });
  catalog.listProducts.mockImplementation(({ sort }: { sort: string }) =>
    Promise.resolve({
      kind: 'ok',
      value: sort === 'newest' ? listing([fresh], { total: 3 }) : listing([featured, regular]),
    }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('HomePage', () => {
  it('shows the decorative fallback hero, with no invented headline, stats or buttons', async () => {
    const { container } = render(await HomePage());

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Nilzora online shop');
    expect(container.querySelector('[data-hero-fallback]')).not.toBeNull();
    expect(
      screen.queryByText(/Everyday style|Shop Collection|Watch Our Story|New season|Hero image/i),
    ).toBeNull();
    // The old hero quoted catalog counts and a strip of badges; both are gone.
    expect(container.querySelector('dl')).toBeNull();
    expect(screen.queryByText(/Tracked orders|Clear charges|Bangladesh-wide/)).toBeNull();
    expect(screen.queryByText(/opening soon|still being prepared|Nothing is on sale/i)).toBeNull();
  });

  it('hides the whole app area while no download link or QR code is published', async () => {
    const { container } = render(await HomePage());

    expect(screen.queryAllByRole('complementary', { name: 'Get the Nilzora App' })).toHaveLength(0);
    expect(container.textContent).not.toMatch(
      /coming soon|get the nilzora app|shop faster|wherever you go/i,
    );
    expect(screen.queryByRole('link', { name: /Google Play|App Store/ })).toBeNull();
    expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull();
  });

  it('shows the admin banners as an image-only carousel', async () => {
    catalog.getBanners.mockImplementation((placement: string) =>
      Promise.resolve(placement === 'home_hero' ? [heroBanner(1), heroBanner(2)] : []),
    );
    const { container } = render(await HomePage());

    const carousel = screen.getByRole('region', { name: 'Featured banners' });
    const first = within(carousel).getByRole('img', { name: 'Eid collection 1' });
    expect(first.getAttribute('src')).toBe('https://media.nilzora.test/banners/1/full.webp');
    expect(first.closest('a')?.getAttribute('href')).toBe('/categories/fashion');
    // The banner's subtitle and button label live in the artwork, never drawn on top of it.
    expect(within(carousel).queryByText(/Up to the admin|Shop now/)).toBeNull();
    expect(container.querySelector('[data-hero-fallback]')).toBeNull();
    expect(catalog.getBanners).toHaveBeenCalledWith('home_hero');
  });

  it('shows the four benefits in order, with no threshold-based free shipping', async () => {
    render(await HomePage());

    const strip = screen.getByRole('region', { name: 'Shopping with Nilzora' });
    expect(
      within(strip)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Fast Delivery', 'Secure Checkout', 'Easy Returns', 'Customer Support']);
    // No free-delivery threshold exists and no return period, delivery time or 24/7 is invented.
    expect(strip.textContent).not.toMatch(/free delivery|free shipping|1,999|24\/7|days/i);
  });

  it('keeps free shipping out of the page even with ৳1,999+ products', async () => {
    const premium = summary({ name: 'Leather bag', priceMinor: 249_900 });
    catalog.listProducts.mockResolvedValue({ kind: 'ok', value: listing([premium]) });
    render(await HomePage());

    const strip = screen.getByRole('region', { name: 'Shopping with Nilzora' });
    expect(strip.textContent).not.toMatch(/free shipping|1,999/i);
    // The catalog is not searched for a qualifying product any more.
    expect(catalog.listProducts).not.toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'price_desc' }),
    );
  });

  it("shows the store's own published support hours in the support sheet, never an invented 24/7", async () => {
    seo.storeProfile.mockResolvedValue({ businessHours: 'Saturday to Thursday, 10am to 8pm' });
    render(await HomePage());

    const strip = screen.getByRole('region', { name: 'Shopping with Nilzora' });
    fireEvent.click(within(strip).getByRole('button', { name: 'Customer Support' }));
    const dialog = await screen.findByRole('dialog', { name: 'Customer Support' });
    expect(dialog.textContent).toContain('Saturday to Thursday, 10am to 8pm');
    expect(dialog.textContent).not.toMatch(/24\/7/);
  });

  it('lists departments, new arrivals and the products the admin featured', async () => {
    render(await HomePage());

    const tiles = sectionNamed('Shop by Category');
    expect(
      within(tiles)
        .getByRole('link', { name: /Home & Kitchen/ })
        .getAttribute('href'),
    ).toBe('/categories/home-kitchen');
    expect(within(tiles).getByRole('link', { name: 'View all' }).getAttribute('href')).toBe(
      '/categories',
    );

    const arrivals = sectionNamed('New Arrivals');
    expect(within(arrivals).getByRole('link', { name: 'Fresh arrival' })).not.toBeNull();
    expect(
      within(arrivals)
        .getByRole('link', { name: /View all/ })
        .getAttribute('href'),
    ).toBe('/products?sort=newest');

    // Only products flagged as featured: the featured sort returns everything, featured first.
    const featuredSection = sectionNamed('Featured Products');
    expect(within(featuredSection).getByRole('link', { name: 'Featured bottle' })).not.toBeNull();
    expect(within(featuredSection).queryByRole('link', { name: 'Regular pan' })).toBeNull();

    expect(catalog.listProducts).toHaveBeenCalledWith({ sort: 'featured', page: 1, pageSize: 10 });
    expect(catalog.listProducts).toHaveBeenCalledWith({ sort: 'newest', page: 1, pageSize: 4 });
  });

  it('leaves out the featured section when nothing is featured', async () => {
    catalog.listProducts.mockResolvedValue({ kind: 'ok', value: listing([regular]) });
    render(await HomePage());

    expect(screen.queryByRole('region', { name: 'Featured Products' })).toBeNull();
    expect(sectionNamed('New Arrivals')).not.toBeNull();
  });

  it("shows Men's and Women's collections only for real departments", async () => {
    const { unmount } = render(await HomePage());
    expect(screen.queryByRole('region', { name: 'Shop the Collections' })).toBeNull();
    unmount();

    catalog.getCategories.mockResolvedValue({
      kind: 'ok',
      value: [
        ...categories,
        category({ slug: 'men', name: 'Men', productCount: 3 }),
        category({ slug: 'women', name: 'Women', productCount: 5 }),
      ],
    });
    render(await HomePage());

    const collections = sectionNamed('Shop the Collections');
    expect(
      within(collections)
        .getByRole('link', { name: /Men's Collection/ })
        .getAttribute('href'),
    ).toBe('/categories/men');
    expect(
      within(collections)
        .getByRole('link', { name: /Women's Collection/ })
        .getAttribute('href'),
    ).toBe('/categories/women');
    expect(within(collections).getByText('Shop Men')).not.toBeNull();
  });

  it('shows every visible brand with its real product count, stocked ones first', async () => {
    catalog.getBrands.mockResolvedValue({
      kind: 'ok',
      value: [
        { slug: 'aarong', name: 'Aarong', description: null, logo: null, productCount: 4 },
        {
          slug: 'empty-label',
          name: 'Empty Label',
          description: null,
          logo: null,
          productCount: 0,
        },
      ],
    });
    render(await HomePage());

    const shelf = sectionNamed('Shop by Brand');
    expect(
      within(shelf)
        .getByRole('link', { name: /Aarong/ })
        .getAttribute('href'),
    ).toBe('/aarong');
    // A brand the admin has just created is on the shelf before its first product exists;
    // brands with something on sale still come first.
    expect(within(shelf).getByText('Empty Label')).not.toBeNull();
    expect(
      within(within(shelf).getByRole('list'))
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/aarong', '/empty-label']);
    expect(
      within(shelf)
        .getByRole('link', { name: /All brands/ })
        .getAttribute('href'),
    ).toBe('/brands');
  });

  it('says products are on their way when the catalog is empty, and hides empty sections', async () => {
    catalog.getCategories.mockResolvedValue({ kind: 'ok', value: [] });
    catalog.listProducts.mockResolvedValue({ kind: 'ok', value: listing([]) });
    render(await HomePage());

    expect(screen.getByText('Products are on their way')).not.toBeNull();
    expect(screen.queryByRole('region', { name: 'Shop by Category' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'New Arrivals' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Shop by Brand' })).toBeNull();
  });

  it('shows calm notices when the API cannot be reached', async () => {
    catalog.getCategories.mockResolvedValue({ kind: 'unavailable' });
    catalog.listProducts.mockResolvedValue({ kind: 'unavailable' });
    render(await HomePage());

    expect(screen.getByText('We could not load categories')).not.toBeNull();
    expect(screen.getByText('We could not load products')).not.toBeNull();
    for (const retry of screen.getAllByRole('link', { name: 'Try again' })) {
      expect(retry.getAttribute('href')).toBe('/');
    }
    // The hero still renders even when nothing loads.
    expect(screen.getByRole('heading', { level: 1 })).not.toBeNull();
  });

  it('keeps what loaded when only one product list fails', async () => {
    catalog.listProducts.mockImplementation(({ sort }: { sort: string }) =>
      Promise.resolve(
        sort === 'newest' ? { kind: 'unavailable' } : { kind: 'ok', value: listing([featured]) },
      ),
    );
    render(await HomePage());

    expect(screen.getByRole('region', { name: 'Featured Products' })).not.toBeNull();
    expect(screen.queryByRole('region', { name: 'New Arrivals' })).toBeNull();
    expect(screen.queryByText('We could not load products')).toBeNull();
    // A failed list must not masquerade as an empty one.
    expect(screen.queryByText('No new arrivals yet')).toBeNull();
  });
});
