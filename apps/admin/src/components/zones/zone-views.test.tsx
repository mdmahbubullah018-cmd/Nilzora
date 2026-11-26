// @vitest-environment jsdom
import type { AdminShoppingZone } from '@nilzora/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ZonesView } from './zone-views';

/*
 * The workspace's zones page: the tiles an admin sees, the counts that explain where a
 * collection's products come from, and the safe-delete rule (a zone that still holds
 * something cannot be deleted, and the page says why).
 */

function zone(overrides: Partial<AdminShoppingZone> = {}): AdminShoppingZone {
  return {
    id: '3f2a1b4c-0000-4000-8000-000000000001',
    slug: 'mens',
    name: "Men's",
    description: null,
    audience: 'men',
    banner: null,
    bannerAlt: null,
    mobileBanner: null,
    productCount: 4,
    seoTitle: null,
    seoDescription: null,
    displayOrder: 0,
    isActive: true,
    explicitProductCount: 0,
    categoryCount: 0,
    updatedAt: '2026-10-25T08:00:00.000Z',
    ...overrides,
  };
}

const csrf = { name: 'csrf', token: 'csrf-token' } as const;

afterEach(cleanup);

describe('the zones page', () => {
  it('shows a placeholder tile and the counts that make up a collection', () => {
    render(
      <ZonesView
        zones={[zone({ explicitProductCount: 2, categoryCount: 1, productCount: 4 })]}
        canManage
        csrf={csrf}
      />,
    );

    // The page shows the zone twice: once in the storefront preview, once in the zone's own
    // card. The card is the one with the link into the zone.
    const card = screen
      .getAllByRole('listitem')
      .find((item) => within(item).queryByRole('link', { name: /Open zone/ }) !== null);
    expect(card).toBeTruthy();
    const scoped = within(card as HTMLElement);
    expect(scoped.getAllByText("Men's").length).toBeGreaterThan(0);
    // No picture yet: the admin sees the same branded tile the storefront will draw.
    expect(scoped.getByText('Branded tile, no picture')).toBeTruthy();
    expect(scoped.getAllByText(/4 products/).length).toBeGreaterThan(0);
    expect(scoped.getByText(/1 category inherited/)).toBeTruthy();
    expect(scoped.getByText(/2 pinned products/)).toBeTruthy();
    expect(scoped.getByRole('link', { name: /Open zone/ }).getAttribute('href')).toBe(
      '/admin/zones/3f2a1b4c-0000-4000-8000-000000000001',
    );
  });

  it('previews the storefront row: two banners across and a third peeking in', () => {
    render(
      <ZonesView
        zones={[
          zone(),
          zone({ id: '3f2a1b4c-0000-4000-8000-000000000002', slug: 'womens', name: "Women's" }),
          zone({ id: '3f2a1b4c-0000-4000-8000-000000000003', slug: 'kids', name: 'Kids' }),
          zone({ id: '3f2a1b4c-0000-4000-8000-000000000004', slug: 'home', name: 'Home' }),
        ]}
        canManage
        csrf={csrf}
      />,
    );

    const preview = screen.getByRole('list', { name: 'Storefront preview' });
    // Three banners at most: two across, the third peeking. The fourth waits behind the swipe.
    expect(within(preview).getAllByRole('listitem')).toHaveLength(3);
    expect(preview.className).toContain('snap-x');
    for (const item of within(preview).getAllByRole('listitem')) {
      expect(item.className).toContain('w-[calc((100%_-_1.5rem_-_2.25rem)/2)]');
    }
  });

  it('marks hidden zones so an admin can tell the store is not showing them', () => {
    render(<ZonesView zones={[zone({ isActive: false })]} canManage csrf={csrf} />);

    expect(screen.getByText('Hidden')).toBeTruthy();
  });

  it('explains an empty store rather than showing a blank panel', () => {
    render(<ZonesView zones={[]} canManage csrf={csrf} />);

    expect(screen.getByText('No shopping zones yet')).toBeTruthy();
    expect(screen.getByText(/no collection rail/)).toBeTruthy();
  });

  it('hides the create form from an account that cannot manage zones', () => {
    render(<ZonesView zones={[]} canManage={false} csrf={csrf} />);

    expect(screen.queryByRole('button', { name: 'Create zone' })).toBeNull();
    expect(screen.getByText(/appear here once someone with zone permission/)).toBeTruthy();
  });

  it('says when a filter matched nothing, and offers the way back', () => {
    render(
      <ZonesView
        zones={[]}
        totalZones={3}
        filters={{ q: 'nothing', view: 'all' }}
        canManage
        csrf={csrf}
      />,
    );

    expect(screen.getByText('No zone matches')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Clear filters' }).getAttribute('href')).toBe(
      '/admin/zones',
    );
  });
});
