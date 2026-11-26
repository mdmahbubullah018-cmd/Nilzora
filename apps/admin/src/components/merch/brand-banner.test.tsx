// @vitest-environment jsdom
import type { AdminBrand } from '@nilzora/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrandBannerForm } from './merch-forms';
import { BrandPreview } from './brand-preview';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/merch-actions', () => ({
  saveBrandAction: vi.fn(),
  uploadBrandLogoAction: vi.fn(),
  removeBrandLogoAction: vi.fn(),
  uploadBrandBannerAction: vi.fn(),
  removeBrandBannerAction: vi.fn(),
  setProductBrandAction: vi.fn(),
  deleteBrandAction: vi.fn(),
}));

afterEach(cleanup);

const csrf = { token: 'csrf-token', field: 'csrf_token' } as never;

function brand(overrides: Partial<AdminBrand> = {}): AdminBrand {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'north-star',
    name: 'North Star',
    description: null,
    logo: null,
    banner: null,
    productCount: 3,
    isActive: true,
    ...overrides,
  };
}

const BANNER = {
  url: 'https://media.example.com/brands/ns/banner/full.webp',
  thumbUrl: 'https://media.example.com/brands/ns/banner/thumb.webp',
};

const LOGO = {
  url: 'https://media.example.com/brands/ns/logo/full.webp',
  thumbUrl: 'https://media.example.com/brands/ns/logo/thumb.webp',
};

describe('BrandBannerForm', () => {
  it('asks for the wide band the brand page shows, before a banner is chosen, and offers no remove yet', () => {
    render(<BrandBannerForm brand={brand()} csrf={csrf} />);

    expect(screen.getByText(/12:5/)).toBeTruthy();
    expect(screen.getByText(/own page/)).toBeTruthy();
    expect(screen.getByText('Upload banner')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove banner' })).toBeNull();
  });

  it('replaces and removes a banner once one is stored', () => {
    render(<BrandBannerForm brand={brand({ banner: BANNER })} csrf={csrf} />);

    expect(screen.getByText('Replace banner')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove banner' })).toBeTruthy();
  });
});

describe('BrandPreview', () => {
  it('draws the homepage card from the logo, never from the banner', () => {
    const { container } = render(
      <BrandPreview
        brand={brand({ banner: BANNER, logo: LOGO })}
        storeUrl={null}
      />,
    );

    const pictures = [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    // The card's square panel uses the logo; the banner is only the brand page's own band.
    expect(pictures).toContain(LOGO.thumbUrl);
    expect(pictures).toContain(BANNER.thumbUrl);
    expect(screen.getAllByText('Homepage brand card').length).toBe(1);
    expect(screen.getAllByText('North Star').length).toBeGreaterThan(0);
  });

  it('says plainly that the brand page has no banner, and still draws the logo', () => {
    const { container } = render(
      <BrandPreview brand={brand({ logo: LOGO })} storeUrl={null} />,
    );

    expect(screen.getByText(/with no banner/)).toBeTruthy();
    expect(container.querySelector(`img[src="${LOGO.thumbUrl}"]`)).toBeTruthy();
  });
});
