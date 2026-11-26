import type { Brand } from '@nilzora/contracts';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listing, summary } from '@/testing/catalog-fixtures';
import BrandPage from './page';

/*
 * A brand's page at /<slug>. The banner is the page's own surface and carries only the product
 * count on a glass chip; the identity lives in the heading below it (an eyebrow, the bare mark
 * and the name), so nothing is drawn over the artwork and the name is never repeated. A brand
 * with no banner keeps the same composition on the navy band.
 */

const catalog = vi.hoisted(() => ({
  // Size and colour options come from the variant system; a page test has none unless it
  // says so, which is exactly what a catalogue without variants looks like.
  getProductFacets: vi.fn(() => Promise.resolve({ sizes: [], colors: [] })),
  getBrand: vi.fn(),
  listBrandProducts: vi.fn(),
  listProducts: vi.fn(),
}));
vi.mock('@/lib/catalog', () => catalog);
vi.mock('@/lib/session', () => ({
  session: { publicApi: () => ({ publicStoreProfile: () => Promise.resolve({ profile: null }) }) },
}));

const BANNER = {
  url: 'https://media.example.com/brands/b1/banner/full.webp',
  thumbUrl: 'https://media.example.com/brands/b1/banner/thumb.webp',
};
const LOGO = {
  url: 'https://media.example.com/brands/b1/logo/full.webp',
  thumbUrl: 'https://media.example.com/brands/b1/logo/thumb.webp',
};

function brand(overrides: Partial<Brand> = {}): Brand {
  return {
    slug: 'north-star',
    name: 'North Star',
    description: 'Outdoor essentials',
    logo: LOGO,
    banner: null,
    productCount: 3,
    ...overrides,
  };
}

function props(slug = 'north-star') {
  return {
    params: Promise.resolve({ brand: slug }),
    searchParams: Promise.resolve({}),
  } satisfies PageProps<'/[brand]'>;
}

beforeEach(() => {
  catalog.getBrand.mockResolvedValue({ kind: 'ok', value: { brand: brand(), redirectTo: null } });
  catalog.listBrandProducts.mockResolvedValue({
    kind: 'ok',
    value: listing([summary({ name: 'Trail Jacket' })], { total: 1 }),
  });
  catalog.listProducts.mockResolvedValue({
    kind: 'ok',
    value: listing([summary({ name: 'Trail Jacket' })], { total: 1 }),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('BrandPage banner', () => {
  it('draws the banner as the page’s surface, with the count on it and the identity below', async () => {
    catalog.getBrand.mockResolvedValue({
      kind: 'ok',
      value: { brand: brand({ banner: BANNER }), redirectTo: null },
    });
    const { container } = render(await BrandPage(props()));

    // Only the banner is inside the header: the mark moved out of the artwork.
    const pictures = [...container.querySelectorAll('header img')];
    expect(pictures.map((picture) => picture.getAttribute('src'))).toEqual([BANNER.url]);
    const [banner] = pictures;
    // The banner fills the frame without stretching, eagerly, as decoration.
    expect(banner?.className).toContain('object-cover');
    expect(banner?.getAttribute('alt')).toBe('');
    expect(banner?.getAttribute('loading')).toBe('eager');
    // The banner is the header's own surface, on the navy band that holds its shape while it loads.
    const header = container.querySelector('header');
    expect(header?.className).toContain('bg-brand-navy');
    // It wears the category page's banner: a min-height band, a navy scrim for contrast, the
    // share control in the corner and the brand's product count on a small glass chip.
    expect(header?.querySelector('[class*="min-h-36"]')).toBeTruthy();
    expect(header?.querySelector('[class*="from-brand-navy/85"]')).toBeTruthy();
    const chip = header?.querySelector('[class*="backdrop-blur-md"]');
    expect(chip?.textContent).toBe('3 products');

    // The mark sits beside the name in the heading below, contained and never over the artwork.
    const mark = container.querySelector(`img[src="${LOGO.thumbUrl}"]`);
    expect(mark?.className).toContain('object-contain');
    expect(header?.contains(mark ?? null)).toBe(false);

    // One heading only: the page's title, introduced by the same eyebrow the categories use.
    const heading = screen.getByRole('heading', { level: 1, name: 'North Star' });
    expect(heading.closest('header')).toBeNull();
    expect(mark?.closest('div')?.contains(heading)).toBe(true);
    expect(screen.getByText('Shop by brand')).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    // Only the supporting line follows the banner.
    expect(screen.getByText('Outdoor essentials')).toBeTruthy();
    // The brand's own products are listed below the header.
    expect(screen.getByText('Trail Jacket')).toBeTruthy();
  });

  it('keeps the same composition on the navy band when the brand has no banner', async () => {
    const { container } = render(await BrandPage(props()));

    // No banner frame to leave empty: the band is drawn, and the count chip still reports stock.
    const header = container.querySelector('header');
    expect([...container.querySelectorAll('header img')]).toEqual([]);
    expect(header?.className).toContain('bg-brand-navy');
    expect(header?.querySelector('[class*="backdrop-blur-md"]')?.textContent).toBe('3 products');
    // The identity is complete without a banner: the mark and the name still head the page.
    expect(container.querySelector(`img[src="${LOGO.thumbUrl}"]`)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'North Star' })).toBeTruthy();
  });

  it('renders a brand whose description is empty without a blank paragraph', async () => {
    catalog.getBrand.mockResolvedValue({
      kind: 'ok',
      value: { brand: brand({ description: null, banner: BANNER }), redirectTo: null },
    });
    const { container } = render(await BrandPage(props()));

    expect(container.querySelector('header')).toBeTruthy();
    expect(screen.queryByText('Outdoor essentials')).toBeNull();
  });

  it('sends a former address to the brand’s current one', async () => {
    catalog.getBrand.mockResolvedValue({
      kind: 'ok',
      value: { brand: null, redirectTo: 'north-star' },
    });

    await expect(BrandPage(props('old-name'))).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT') as unknown,
    });
  });
});
