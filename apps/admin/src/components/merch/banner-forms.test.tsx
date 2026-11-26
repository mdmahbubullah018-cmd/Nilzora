// @vitest-environment jsdom
import type { AdminBanner, AdminCategory } from '@nilzora/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BannerForm } from './banner-forms';

vi.mock('@/lib/merch-actions', () => ({
  saveBannerAction: vi.fn(),
  uploadBannerImageAction: vi.fn(),
  uploadBannerMobileImageAction: vi.fn(),
  removeBannerMobileImageAction: vi.fn(),
  reorderBannersAction: vi.fn(),
  deleteBannerAction: vi.fn(),
}));

afterEach(cleanup);

const csrf = { token: 'csrf-token', field: 'csrf_token' } as never;
const categories: AdminCategory[] = [];

function banner(overrides: Partial<AdminBanner> = {}): AdminBanner {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    placement: 'home_secondary',
    title: '',
    subtitle: null,
    ctaLabel: null,
    ctaHref: null,
    imageAlt: 'A stand-in picture',
    image: {
      url: 'https://media.example.com/b/1/full.webp',
      thumbUrl: 'https://media.example.com/b/1/thumb.webp',
    },
    mobileImage: null,
    categoryId: null,
    categorySlug: null,
    sortOrder: 0,
    isActive: true,
    startsAt: null,
    endsAt: null,
    ...overrides,
  };
}

/*
 * Every word on a banner is optional. The form must let an image-only banner through, keep the
 * picture description rule, and show a live preview of what a shopper would actually see.
 */

describe('BannerForm', () => {
  it('leaves every content field optional, so a picture-only banner can be saved', () => {
    render(<BannerForm banner={banner()} categories={categories} csrf={csrf} />);

    for (const name of ['title', 'subtitle', 'ctaLabel', 'ctaHref', 'imageAlt']) {
      const field = document.querySelector<HTMLInputElement>(`[name="${name}"]`);
      expect(field).not.toBeNull();
      expect(field?.required).toBe(false);
    }
    expect(screen.queryByText(/Every word is optional/)).not.toBeNull();
  });

  it('previews the words as they are typed, and withdraws them when cleared', () => {
    render(<BannerForm banner={banner()} categories={categories} csrf={csrf} />);

    const preview = screen.getByRole('img', { name: /Preview of the banner being edited/ });
    // A picture-only banner: no caption in the preview.
    expect(preview.querySelector('[class*="bg-white/4"]')).toBeNull();

    fireEvent.input(document.querySelector('[name="title"]') as HTMLInputElement, {
      target: { value: 'Eid sale' },
    });
    fireEvent.input(document.querySelector('[name="subtitle"]') as HTMLInputElement, {
      target: { value: 'Up to 40% off' },
    });

    expect(screen.getByRole('img', { name: /Preview of the banner being edited/ }).textContent).toContain(
      'Eid sale',
    );
    expect(
      preview.querySelector('[class*="bg-white/4"]') ??
        screen
          .getByRole('img', { name: /Preview of the banner being edited/ })
          .querySelector('[class*="bg-white/4"]'),
    ).not.toBeNull();
    // The picture guidance names the shape the artwork is shown in.
    expect(screen.getByText(/12:5/)).not.toBeNull();

    fireEvent.input(document.querySelector('[name="title"]') as HTMLInputElement, {
      target: { value: '' },
    });
    fireEvent.input(document.querySelector('[name="subtitle"]') as HTMLInputElement, {
      target: { value: '' },
    });

    expect(
      screen
        .getByRole('img', { name: /Preview of the banner being edited/ })
        .querySelector('[class*="bg-white/4"]'),
    ).toBeNull();
  });
});
