import type { PublicStoreProfile } from '@nilzora/contracts';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ContactPage from './page';

/*
 * The contact page prints the store's published profile. A field the store left empty is
 * absent, and a profile with nothing published says so — no placeholder number or address.
 */

const seo = vi.hoisted(() => ({ storeProfile: vi.fn() }));
vi.mock('@/lib/seo', () => seo);

afterEach(() => {
  vi.clearAllMocks();
});

function profile(overrides: Partial<PublicStoreProfile> = {}): PublicStoreProfile {
  return {
    displayName: 'Nilzora',
    tagline: null,
    description: 'A single-vendor shop in Dhaka.',
    logoKey: null,
    logoUrl: null,
    codAvailable: true,
    contactEmail: null,
    contactPhone: null,
    addressLine: 'House 12, Road 5',
    addressArea: 'Dhanmondi',
    addressDistrict: 'Dhaka',
    businessHours: 'Saturday to Thursday, 10am to 8pm',
    supportEmail: 'help@nilzora.test',
    supportPhone: '+880 1712 345678',
    social: { facebook: 'https://facebook.com/nilzora', instagram: null, youtube: null },
    defaultSeoTitle: null,
    defaultSeoDescription: null,
    ogImageKey: null,
    ogImageUrl: null,
    updatedAt: '2026-11-06T09:00:00.000Z',
    ...overrides,
  };
}

describe('ContactPage', () => {
  it('points to self-service pages first', async () => {
    seo.storeProfile.mockResolvedValue(profile());
    render(await ContactPage());

    const quick = screen
      .getByRole('heading', { name: 'Quick help' })
      .closest('section') as HTMLElement;
    expect(
      Array.from(quick.querySelectorAll('a')).map((link) => link.getAttribute('href')),
    ).toEqual(['/account/orders', '/account/returns', '/account']);
    // No newsletter or subscription form anywhere on the page.
    expect(document.querySelector('form, input')).toBeNull();
  });

  it('shows the published ways to reach the store', async () => {
    seo.storeProfile.mockResolvedValue(profile());
    render(await ContactPage());

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Help & support');
    expect(screen.getByRole('link', { name: 'help@nilzora.test' }).getAttribute('href')).toBe(
      'mailto:help@nilzora.test',
    );
    expect(screen.getByRole('link', { name: '+880 1712 345678' }).getAttribute('href')).toBe(
      'tel:+8801712345678',
    );
    expect(screen.getByText('House 12, Road 5, Dhanmondi, Dhaka')).not.toBeNull();
    expect(screen.getByText('Saturday to Thursday, 10am to 8pm')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Facebook' }).getAttribute('href')).toBe(
      'https://facebook.com/nilzora',
    );
    // Instagram was not published, so it is not offered.
    expect(screen.queryByRole('link', { name: 'Instagram' })).toBeNull();
  });

  it('falls back to the general contact address', async () => {
    seo.storeProfile.mockResolvedValue(
      profile({ supportEmail: null, supportPhone: null, contactEmail: 'hello@nilzora.test' }),
    );
    render(await ContactPage());

    expect(screen.getByRole('link', { name: 'hello@nilzora.test' })).not.toBeNull();
  });

  it('says plainly that nothing has been published yet', async () => {
    seo.storeProfile.mockResolvedValue(
      profile({
        addressLine: null,
        addressArea: null,
        addressDistrict: null,
        businessHours: null,
        supportEmail: null,
        supportPhone: null,
        social: { facebook: null, instagram: null, youtube: null },
      }),
    );
    render(await ContactPage());

    expect(screen.getByText(/has not published contact details yet/)).not.toBeNull();
    expect(screen.queryByRole('link', { name: /mailto|tel/ })).toBeNull();
  });

  it('explains a failed read without inventing details', async () => {
    seo.storeProfile.mockResolvedValue(null);
    render(await ContactPage());

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Help & support');
    expect(screen.getByText(/could not be loaded right now/)).not.toBeNull();
  });
});
