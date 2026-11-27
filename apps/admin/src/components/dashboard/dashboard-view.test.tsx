// @vitest-environment jsdom
import type { Permission } from '@nilzora/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parseReportRange } from '@/lib/date-range';
import { ROLE_PERMISSIONS } from '@/test/fixtures';
import { DashboardView } from './dashboard-view';
import {
  analyticsOverview,
  auditEntry,
  dashboardSummary,
  pendingReviews,
  recentOrder,
} from './fixtures';
import type { DashboardData } from './load-dashboard';

afterEach(cleanup);

const now = new Date('2026-10-25T12:00:00.000Z');
const range = parseReportRange({}, now);

function ownerData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    range,
    now,
    summary: { kind: 'ok', value: dashboardSummary },
    analytics: { kind: 'ok', value: analyticsOverview(30) },
    recentOrders: { kind: 'ok', value: [recentOrder] },
    activity: { kind: 'ok', value: [auditEntry] },
    catalogue: {
      kind: 'ok',
      value: { products: 128, activeProducts: 96, outOfStock: 7, customers: 412 },
    },
    pendingReviews: { kind: 'ok', value: pendingReviews },
    abandoned: {
      kind: 'ok',
      value: {
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-30T00:00:00.000Z',
        abandonedCount: 9,
        openCount: 4,
        recentCount: 2,
        potentialValueMinor: 250_000,
        recoveredCount: 2,
        recoveryRatePercent: 22.2,
        attemptCount: 5,
        contactedCount: 3,
        dismissedCount: 1,
        trackingSince: '2026-01-05T00:00:00.000Z',
      },
    },
    ...overrides,
  };
}

function renderView(data: DashboardData, permissions: readonly Permission[]) {
  return render(<DashboardView data={data} permissions={permissions} viewerName="Ayesha Rahman" />);
}

/** The titles of the panels (regions labelled by a heading), in page order. */
function panelTitles(): (string | undefined)[] {
  return screen
    .queryAllByRole('region')
    .filter((region) => region.hasAttribute('aria-labelledby'))
    .map((region) => within(region).getAllByRole('heading')[0]?.textContent);
}

describe('DashboardView', () => {
  it('shows the owner every analytics panel and the live work, in order', () => {
    renderView(ownerData(), ROLE_PERMISSIONS.super_admin);

    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeTruthy();
    expect(panelTitles()).toEqual([
      'Revenue and orders',
      'Order status',
      'Orders by status per day',
      'Busiest times',
      'Cash on delivery',
      'Delivery zones',
      'Shopping journey',
      'Targets and rates',
      'Top products',
      'Sales by category',
      'Top customers',
      'Live work',
      'Recent orders',
      'Open orders',
      'Low stock',
      'Customer reviews',
      'Content reviews',
      'Recent activity',
    ]);
  });

  it('draws the shopping journey from the counts the API returned, with drop-off', () => {
    const data = ownerData();
    const overview = data.analytics?.kind === 'ok' ? data.analytics.value : null;
    if (!overview) throw new Error('fixture is missing its analytics');
    overview.funnel = { carts: 40, checkouts: 25, orders: 10 };

    renderView(data, ROLE_PERMISSIONS.super_admin);
    const journey = screen.getByRole('region', { name: 'Shopping journey' });

    // Each stage is the API's own count, not a total the panel worked out.
    expect(within(journey).getByText('Carts created')).toBeTruthy();
    expect(within(journey).getByText('40')).toBeTruthy();
    expect(within(journey).getByText('25')).toBeTruthy();
    expect(within(journey).getByText('10')).toBeTruthy();
    // 10 of 40 carts became orders, shown both in the tile and in the funnel's own footer.
    expect(within(journey).getAllByText('25%').length).toBeGreaterThan(0);
    // Stage by stage: 25 of 40 carts reached checkout, 10 of 25 checkouts became orders.
    expect(within(journey).getByText('62.5%')).toBeTruthy();
    expect(within(journey).getByText('40%')).toBeTruthy();
    // 40 → 25 loses 15; 25 → 10 loses another 15.
    expect(within(journey).getByText('Biggest drop-off')).toBeTruthy();
    // The tracking caveat is stated instead of product views being invented.
    expect(within(journey).getByText(/Product views are not tracked/)).toBeTruthy();

    // The abandoned figures come from the metrics read, never from the funnel arithmetic.
    // "Abandoned checkouts" appears as both the panel's link and the figure's label.
    expect(within(journey).getAllByText('Abandoned checkouts').length).toBeGreaterThan(0);
    expect(within(journey).getByText('4')).toBeTruthy();
    expect(within(journey).getByText(/waiting in carts/)).toBeTruthy();
  });

  it('says plainly when the abandoned figures could not be read', () => {
    renderView(ownerData({ abandoned: { kind: 'unavailable' } }), ROLE_PERMISSIONS.super_admin);
    const journey = screen.getByRole('region', { name: 'Shopping journey' });
    expect(within(journey).getByText('Not available to this account')).toBeTruthy();
  });

  it('hides conversions when the range starts before checkout tracking began', () => {
    const data = ownerData();
    const overview = data.analytics?.kind === 'ok' ? data.analytics.value : null;
    if (!overview) throw new Error('fixture is missing its analytics');
    overview.funnel = { carts: 8, checkouts: 2, orders: 20 };
    if (data.abandoned?.kind === 'ok') {
      // Tracking began after this range started, so orders include days with no cart records.
      data.abandoned.value.trackingSince = '2026-11-05T00:00:00.000Z';
      data.abandoned.value.openCount = 0;
    }

    renderView(data, ROLE_PERMISSIONS.super_admin);
    const journey = screen.getByRole('region', { name: 'Shopping journey' });

    expect(within(journey).getByText('Partial coverage')).toBeTruthy();
    // A share of 20 orders from 8 carts would be 250%: it must never be shown.
    expect(within(journey).queryByText('250%')).toBeNull();
    expect(within(journey).queryByText('1,000%')).toBeNull();
    // The counts themselves stay, because they are exact.
    expect(within(journey).getByText('20')).toBeTruthy();
  });

  it('shows the six headline figures with the change against the previous period', () => {
    renderView(ownerData(), ROLE_PERMISSIONS.super_admin);
    const figures = screen.getByRole('region', { name: 'Headline figures' });

    for (const label of [
      'Revenue',
      'Orders',
      'Average order value',
      'New customers',
      'Pending COD',
      'Low-stock items',
    ]) {
      expect(within(figures).getByText(label)).toBeTruthy();
    }
    // 30 days of ৳1,000 is ৳30,000 against ৳15,000 before: up 100%.
    expect(within(figures).getAllByText('৳30,000').length).toBeGreaterThan(0);
    const revenueCard = within(figures).getByText('Revenue').closest('div');
    expect(revenueCard?.parentElement?.parentElement?.textContent).toContain('100%');
  });

  it('offers the report periods as links that keep the comparison setting', () => {
    renderView(ownerData(), ROLE_PERMISSIONS.super_admin);
    const periods = screen.getByRole('navigation', { name: 'Report period' });
    expect(
      within(periods)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/admin?range=today', '/admin?range=7d', '/admin?range=30d', '/admin?range=month']);
    expect(
      within(periods).getByRole('link', { name: '30 days' }).getAttribute('aria-current'),
    ).toBe('true');
  });

  it('keeps the range popover above the cards below it', () => {
    const { container } = renderView(ownerData(), ROLE_PERMISSIONS.super_admin);

    // Every panel on this page paints a backdrop blur, so each one is its own stacking context.
    // The bar that holds the custom-range popover needs an order of its own, or the calendar
    // would be drawn *under* the cards that come after it.
    const bar = container.querySelector('.nz-glass');
    expect(bar?.className).toContain('relative');
    expect(bar?.className).toContain('z-20');
    // The popover itself still rises above the bar's own content.
    const popover = screen.getByText('From').closest('form');
    expect(popover?.className).toContain('z-30');
  });

  it('gives staff without finance.read the waiting work instead of sales', () => {
    renderView(
      ownerData({ analytics: null, activity: null, pendingReviews: null }),
      ROLE_PERMISSIONS.staff,
    );
    expect(screen.queryByRole('navigation', { name: 'Report period' })).toBeNull();
    expect(screen.queryByText('Revenue and orders')).toBeNull();
    const figures = screen.getByRole('region', { name: 'Headline figures' });
    expect(within(figures).getByText('To confirm')).toBeTruthy();
    expect(within(figures).getByText('Cash to record')).toBeTruthy();
    expect(screen.queryByText('Recent activity')).toBeNull();
  });

  it('says so when the analytics cannot be read, instead of showing zeros', () => {
    renderView(ownerData({ analytics: { kind: 'unavailable' } }), ROLE_PERMISSIONS.super_admin);
    expect(screen.getByRole('region', { name: 'Analytics' })).toBeTruthy();
    expect(screen.queryByText('Revenue and orders')).toBeNull();
  });

  it('shows honest empty states for a period without orders', () => {
    renderView(
      ownerData({
        analytics: { kind: 'ok', value: analyticsOverview(7, { dailyRevenue: Array(7).fill(0) }) },
      }),
      ROLE_PERMISSIONS.super_admin,
    );
    expect(screen.getAllByText('No orders were placed in this period.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Nothing was sold in this period.').length).toBe(2);
    expect(screen.getByText('No delivered orders in this period')).toBeTruthy();
  });

  it('leaves out top customers when the account may not read customers', () => {
    const overview = { ...analyticsOverview(30), topCustomers: null };
    renderView(ownerData({ analytics: { kind: 'ok', value: overview } }), ROLE_PERMISSIONS.admin);
    expect(screen.queryByText('Top customers')).toBeNull();
  });

  it('lists customer reviews waiting for a decision with a link to moderate them', () => {
    renderView(ownerData(), ROLE_PERMISSIONS.super_admin);
    const reviews = screen.getByRole('region', { name: 'Customer reviews' });
    expect(within(reviews).getByText('3 reviews waiting for a decision')).toBeTruthy();
    expect(within(reviews).getByText('Handloom cotton saree')).toBeTruthy();
    expect(within(reviews).getByRole('link', { name: 'Moderate' }).getAttribute('href')).toBe(
      '/admin/reviews?status=pending',
    );
  });
});
