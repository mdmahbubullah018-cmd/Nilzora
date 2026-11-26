import type { Navigation, PublicStoreProfile } from '@nilzora/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SiteFooter } from './site-footer';

/*
 * What the store manages reaches the footer: its own link lists, the pages it published, its
 * WhatsApp number, extra social profiles and app listings. With nothing managed the footer is
 * exactly the built-in one (site-footer.test.tsx pins that).
 */

function profile(overrides: Partial<PublicStoreProfile> = {}): PublicStoreProfile {
  return {
    displayName: 'Nilzora',
    tagline: null,
    description: null,
    logoKey: null,
    logoUrl: null,
    codAvailable: true,
    contactEmail: null,
    contactPhone: null,
    addressLine: null,
    addressArea: null,
    addressDistrict: null,
    businessHours: null,
    supportEmail: null,
    supportPhone: null,
    social: { facebook: null, instagram: null, youtube: null },
    defaultSeoTitle: null,
    defaultSeoDescription: null,
    ogImageKey: null,
    ogImageUrl: null,
    updatedAt: '2026-11-08T00:00:00.000Z',
    ...overrides,
  };
}

const empty: Navigation = {
  menus: { header: [], footerShop: [], footerHelp: [] },
  pages: [],
};

function linksIn(region: HTMLElement): [string | null, string | null][] {
  return within(region)
    .getAllByRole('link')
    .map((link) => [link.textContent, link.getAttribute('href')]);
}

describe('SiteFooter with managed content', () => {
  it('keeps the built-in lists when the store manages none', () => {
    render(<SiteFooter profile={profile()} navigation={empty} />);

    expect(linksIn(screen.getByRole('navigation', { name: 'Shop' }))).toHaveLength(4);
    expect(linksIn(screen.getByRole('navigation', { name: 'Customer service' }))).toHaveLength(3);
    expect(linksIn(screen.getByRole('navigation', { name: 'Information' }))).toEqual([
      ['About Nilzora', '/about'],
      ['Frequently asked questions', '/help/faq'],
      ['Delivery policy', '/help/shipping'],
      ['Returns and refunds policy', '/help/returns'],
      ['Privacy policy', '/privacy'],
      ['Terms of service', '/terms'],
    ]);
  });

  it('replaces a column with the store’s own links, store paths and https addresses alike', () => {
    render(
      <SiteFooter
        profile={profile()}
        navigation={{
          ...empty,
          menus: {
            header: [],
            footerShop: [{ label: 'Eid sale', href: '/products?sort=newest' }],
            footerHelp: [
              { label: 'Delivery areas', href: '/help/shipping' },
              { label: 'Our blog', href: 'https://blog.nilzora.example/latest' },
            ],
          },
        }}
      />,
    );

    expect(linksIn(screen.getByRole('navigation', { name: 'Shop' }))).toEqual([
      ['Eid sale', '/products?sort=newest'],
    ]);
    const help = within(screen.getByRole('navigation', { name: 'Customer service' }));
    expect(help.getByRole('link', { name: /Our blog/ }).getAttribute('target')).toBe('_blank');
    expect(help.getByRole('link', { name: /Our blog/ }).getAttribute('rel')).toBe(
      'noopener noreferrer',
    );
    expect(help.getByRole('link', { name: 'Delivery areas' }).getAttribute('href')).toBe(
      '/help/shipping',
    );
  });

  it('names the returns and delivery links after the pages the store published', () => {
    render(
      <SiteFooter
        profile={profile()}
        navigation={{
          ...empty,
          pages: [
            { slug: 'privacy', title: 'Privacy policy' },
            { slug: 'returns', title: 'Returns policy' },
            { slug: 'shipping', title: 'Delivery information' },
          ],
        }}
      />,
    );

    expect(linksIn(screen.getByRole('navigation', { name: 'Information' }))).toEqual([
      ['About Nilzora', '/about'],
      ['Frequently asked questions', '/help/faq'],
      ['Delivery information', '/help/shipping'],
      ['Returns policy', '/help/returns'],
      ['Privacy policy', '/privacy'],
      ['Terms of service', '/terms'],
    ]);
  });

  it('shows a WhatsApp chat link and the extra social profiles', () => {
    render(
      <SiteFooter
        profile={profile({
          whatsappNumber: '+8801712345678',
          social: {
            facebook: null,
            instagram: null,
            youtube: null,
            tiktok: 'https://www.tiktok.com/@nilzora',
            x: 'https://x.com/nilzora',
          },
        })}
      />,
    );

    const follow = within(screen.getByRole('list', { name: 'Follow us' }));
    expect(follow.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      'https://www.tiktok.com/@nilzora',
      'https://x.com/nilzora',
      'https://wa.me/8801712345678',
    ]);
    expect(follow.getByRole('link', { name: /WhatsApp/ }).getAttribute('rel')).toBe(
      'noopener noreferrer',
    );
  });

  it('shows no WhatsApp link for a number that is not a valid one', () => {
    render(<SiteFooter profile={profile({ whatsappNumber: '01712345678' })} />);

    expect(screen.queryByRole('list', { name: 'Follow us' })).toBeNull();
  });

  it('shows the app area only once a store listing is published', () => {
    const { rerender } = render(<SiteFooter profile={profile()} />);
    expect(screen.queryByRole('heading', { name: 'Get the app' })).toBeNull();

    rerender(
      <SiteFooter
        profile={profile({
          playStoreUrl: 'https://play.google.com/store/apps/details?id=com.nilzora.app',
        })}
      />,
    );
    expect(screen.getByText('Get the app')).toBeTruthy();
    expect(
      screen
        .getAllByRole('link')
        .some((link) => link.getAttribute('href')?.startsWith('https://play.google.com/')),
    ).toBe(true);
  });
});
