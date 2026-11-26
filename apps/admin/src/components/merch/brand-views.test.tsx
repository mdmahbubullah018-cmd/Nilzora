// @vitest-environment jsdom
import type { AdminBrand } from '@nilzora/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrandsView } from './brand-views';

/*
 * The brands workspace as an administrator meets it: every brand opens into its own form, the
 * logo and banner pictures sit beside it, and the customer view shows the homepage card and the
 * brand page as they are really drawn. The page is assembled from the API's own data, so a brand
 * without a banner says so instead of showing an empty frame.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/slug-actions', () => ({ checkSlugAction: vi.fn() }));
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
    productCount: 2,
    isActive: true,
    ...overrides,
  };
}

function view(brands: AdminBrand[], canManage = true) {
  return render(
    <BrandsView brands={brands} totalBrands={brands.length} canManage={canManage} csrf={csrf} />,
  );
}

describe('BrandsView', () => {
  it('offers the banner upload and its shape guidance inside a brand, beside the logo', () => {
    view([brand()]);

    expect(screen.getByText('Upload banner')).toBeTruthy();
    // The banner is the wide band under the identity row on the brand's own page.
    expect(screen.getByText(/12:5/)).toBeTruthy();
    expect(screen.getByText('Upload logo')).toBeTruthy();
    // Nothing to remove yet.
    expect(screen.queryByRole('button', { name: 'Remove banner' })).toBeNull();
  });

  it('offers replace and remove once a banner is stored', () => {
    view([
      brand({
        banner: {
          url: 'https://media.example.com/brands/ns/banner/full.webp',
          thumbUrl: 'https://media.example.com/brands/ns/banner/thumb.webp',
        },
      }),
    ]);

    expect(screen.getByText('Replace banner')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove banner' })).toBeTruthy();
    expect(screen.getByText('Homepage brand card')).toBeTruthy();
  });

  it('shows the create form without a picture, because a brand needs an id first', () => {
    view([]);

    expect(screen.getByText('Add a brand')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add brand' })).toBeTruthy();
    expect(screen.queryByText('Upload logo')).toBeNull();
    expect(screen.queryByText('Upload banner')).toBeNull();
  });

  it('marks the description optional and keeps the name required', () => {
    view([brand()]);

    // Both the edit form and the create form show these fields.
    const description = screen.getAllByLabelText<HTMLTextAreaElement>(/^Description/)[0];
    expect(description?.hasAttribute('required')).toBe(false);
    expect(screen.getAllByText(/Optional\. A sentence under the name/).length).toBeGreaterThan(0);
    const name = screen.getAllByRole('textbox', { name: /^Name/ })[0];
    expect(name?.hasAttribute('required')).toBe(true);
  });

  it('shows what a viewer without publishing permission can and cannot do', () => {
    view([brand()], false);

    expect(screen.getByText(/Adding, changing and deleting them needs/)).toBeTruthy();
    expect(screen.queryByText('Upload banner')).toBeNull();
  });
});
