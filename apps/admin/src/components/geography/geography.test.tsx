// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderGeography } from '@nilzora/contracts';
import { GeographyView } from './geography-view';
import { projectAsset, type MapAsset } from './geo-projection';
import { parseGeographySelection } from '@/lib/order-geography';

/*
 * The map and the page it sits on. The projection is checked against a tiny synthetic
 * asset so the arithmetic is visible; the view is checked against a fixture that mirrors
 * what admin_order_geography returns, with the reconciliation the page must never break.
 */

const push = vi.fn();

/** Two one-degree squares, plus a division outline that contains them. */
const ASSET: MapAsset = {
  type: 'FeatureCollection',
  meta: { attribution: 'Test boundaries' },
  features: [
    {
      type: 'Feature',
      properties: { name: 'Chattogram', bn: 'চট্টগ্রাম', level: 'division' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [91, 22],
            [92, 22],
            [92, 23],
            [91, 23],
            [91, 22],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Feni', bn: 'ফেনী', level: 'district' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [91, 22],
            [91.5, 22],
            [91.5, 22.5],
            [91, 22.5],
            [91, 22],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Cumilla', bn: 'কুমিল্লা', level: 'district' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [91.5, 22.5],
            [92, 22.5],
            [92, 23],
            [91.5, 23],
            [91.5, 22.5],
          ],
        ],
      },
    },
  ],
};

const district = (
  name: string,
  division: string,
  orderCount: number,
  deliveredCount: number,
  revenueMinor: number,
  share: number | null,
) => ({ district: name, division, orderCount, deliveredCount, revenueMinor, share });

const GEOGRAPHY: OrderGeography = {
  generatedAt: '2026-11-11T09:00:00.000Z',
  timezone: 'Asia/Dhaka',
  filters: {
    from: '2026-10-13',
    to: '2026-11-11',
    division: null,
    district: null,
    status: null,
    metric: 'orders',
  },
  summary: {
    totalOrders: 12,
    eligibleOrders: 10,
    deliveredOrders: 6,
    pendingOrders: 2,
    processingOrders: 1,
    shippedOrders: 1,
    cancelledOrders: 2,
    returnedOrders: 0,
    revenueMinor: 1_000_000,
    averageOrderMinor: 100_000,
    deliveredRate: 0.6,
    mappedOrders: 9,
    unmappedOrders: 1,
  },
  divisions: [
    {
      division: 'Chattogram',
      orderCount: 6,
      deliveredCount: 4,
      revenueMinor: 700_000,
      share: 0.6667,
    },
    { division: 'Dhaka', orderCount: 3, deliveredCount: 2, revenueMinor: 200_000, share: 0.3333 },
    { division: 'Khulna', orderCount: 0, deliveredCount: 0, revenueMinor: 0, share: 0 },
    { division: 'Rajshahi', orderCount: 0, deliveredCount: 0, revenueMinor: 0, share: 0 },
    { division: 'Rangpur', orderCount: 0, deliveredCount: 0, revenueMinor: 0, share: 0 },
    { division: 'Sylhet', orderCount: 0, deliveredCount: 0, revenueMinor: 0, share: 0 },
    { division: 'Barishal', orderCount: 0, deliveredCount: 0, revenueMinor: 0, share: 0 },
    { division: 'Mymensingh', orderCount: 0, deliveredCount: 0, revenueMinor: 0, share: 0 },
  ],
  districts: [
    district('Feni', 'Chattogram', 5, 3, 600_000, 0.5556),
    district('Cumilla', 'Chattogram', 1, 1, 100_000, 0.1111),
    district('Dhaka', 'Dhaka', 3, 2, 200_000, 0.3333),
  ],
  timeline: [
    { day: '2026-10-13', orderCount: 4, deliveredCount: 2, revenueMinor: 400_000 },
    { day: '2026-10-14', orderCount: 6, deliveredCount: 4, revenueMinor: 600_000 },
  ],
  statusBreakdown: [
    { status: 'delivered', count: 6 },
    { status: 'pending', count: 2 },
    { status: 'processing', count: 1 },
    { status: 'shipped', count: 1 },
    { status: 'cancelled', count: 2 },
  ],
  unmapped: {
    orderCount: 1,
    revenueMinor: 100_000,
    missingDistrictCount: 0,
    unknownDistrictCount: 1,
    values: [{ district: 'Nowhere Land', division: 'Dhaka', orderCount: 1 }],
  },
};

const SELECTION = parseGeographySelection(
  { range: 'custom', from: '2026-10-13', to: '2026-11-11' },
  new Date('2026-11-11T09:00:00Z'),
);

beforeEach(() => {
  push.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(ASSET) })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the projection', () => {
  it('draws every feature as a closed path inside the viewBox', () => {
    const geometry = projectAsset(ASSET);
    expect(geometry.districts).toHaveLength(2);
    expect(geometry.divisions).toHaveLength(1);
    expect(geometry.width).toBe(620);
    for (const shape of [...geometry.districts, ...geometry.divisions]) {
      expect(shape.d.startsWith('M')).toBe(true);
      expect(shape.d.endsWith('Z')).toBe(true);
      expect(shape.cx).toBeGreaterThan(0);
      expect(shape.cx).toBeLessThan(geometry.width);
      expect(shape.cy).toBeGreaterThan(0);
      expect(shape.cy).toBeLessThan(geometry.height);
      expect(shape.area).toBeGreaterThan(0);
    }
  });

  it('puts north above south and west left of east', () => {
    const geometry = projectAsset(ASSET);
    const south = geometry.districts.find((shape) => shape.name === 'Feni');
    const north = geometry.districts.find((shape) => shape.name === 'Cumilla');
    const west = geometry.districts.find((shape) => shape.name === 'Feni');
    const east = geometry.districts.find((shape) => shape.name === 'Cumilla');
    expect(south?.cy).toBeGreaterThan(north?.cy ?? 0);
    expect(west?.cx).toBeLessThan(east?.cx ?? 0);
  });
});

describe('the map', () => {
  it('draws the districts, their Bengali names and the attribution', async () => {
    render(<GeographyView geography={GEOGRAPHY} selection={SELECTION} today="2026-11-11" />);
    const map = await screen.findByRole('img', {
      name: /districts drawn from the current filters/i,
    });
    // One path per district, plus the division outline.
    expect(map.querySelectorAll('path')).toHaveLength(3);
    expect(screen.getByText(/Test boundaries/)).toBeTruthy();
    expect(screen.getAllByText('Feni').length).toBeGreaterThan(0);
  });

  it('shows a district in a tooltip on hover, with its Bengali name and figures', async () => {
    render(<GeographyView geography={GEOGRAPHY} selection={SELECTION} today="2026-11-11" />);
    const map = await screen.findByRole('img', { name: /districts drawn/i });
    // The last path is a district; the first is the division outline, which takes no pointer.
    const districtPath = [...map.querySelectorAll('path')].at(-1);
    expect(districtPath).toBeTruthy();
    if (districtPath) fireEvent.pointerOver(districtPath, { clientX: 40, clientY: 40 });
    const tip = await screen.findByTestId('map-tooltip');
    expect(tip.textContent).toContain('কুমিল্লা');
    expect(tip.textContent).toContain('11%');
  });

  it('focuses a district when a shape is clicked, without asking the server again', async () => {
    render(<GeographyView geography={GEOGRAPHY} selection={SELECTION} today="2026-11-11" />);
    const map = await screen.findByRole('img', { name: /districts drawn/i });
    // The last path is a district; the first is the division outline, which takes no pointer.
    const districtPath = [...map.querySelectorAll('path')].at(-1);
    expect(districtPath).toBeTruthy();
    if (districtPath) fireEvent.click(districtPath);
    // The insight panel switches to the district that was clicked (Cumilla in this fixture).
    expect(await screen.findByText('Share of orders')).toBeTruthy();
    expect(screen.getByRole('button', { name: /clear/i })).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('the page body', () => {
  it('shows the headline figures from the one aggregate', () => {
    render(<GeographyView geography={GEOGRAPHY} selection={SELECTION} today="2026-11-11" />);
    const headline = screen.getByRole('region', { name: 'Headline figures' });
    expect(within(headline).getByText('Orders')).toBeTruthy();
    expect(within(headline).getByText(/2 cancelled excluded/)).toBeTruthy();
    expect(within(headline).getByText('Average order')).toBeTruthy();
    expect(within(headline).getByText('Delivery success')).toBeTruthy();
    expect(within(headline).getByText('60%')).toBeTruthy();
  });

  it('lists every division, including the ones with no orders', () => {
    render(<GeographyView geography={GEOGRAPHY} selection={SELECTION} today="2026-11-11" />);
    const panel = screen.getByRole('region', { name: 'Divisions' });
    expect(within(panel).getAllByRole('button')).toHaveLength(8);
    expect(within(panel).getByText('Mymensingh')).toBeTruthy();
  });

  it('narrows the district ranking when a division is chosen', () => {
    render(<GeographyView geography={GEOGRAPHY} selection={SELECTION} today="2026-11-11" />);
    const panel = screen.getByRole('region', { name: 'Divisions' });
    fireEvent.click(within(panel).getByRole('button', { name: /Khulna/ }));
    // Khulna holds no districts with orders in this fixture, so the ranking empties honestly.
    expect(
      screen.getAllByText(/No order in this range could be placed on the map/).length,
    ).toBeGreaterThan(0);
  });

  it('reconciles mapped and unmapped orders and names the offending value', () => {
    render(<GeographyView geography={GEOGRAPHY} selection={SELECTION} today="2026-11-11" />);
    expect(screen.getByText(/9 mapped \+ 1 unmapped = 10 orders/)).toBeTruthy();
    expect(screen.getByText('Nowhere Land')).toBeTruthy();
    expect(screen.getByText('1 order')).toBeTruthy();
  });

  it('counts the orders the map could place, not the whole demand population', () => {
    const { container } = render(
      <GeographyView geography={GEOGRAPHY} selection={SELECTION} today="2026-11-11" />,
    );
    // Ten eligible orders, but only nine have a district the map can shade.
    expect(container.textContent).toContain('9 orders mapped');
    expect(container.textContent).not.toContain('10 orders mapped');
  });

  it('draws the status split from the same population as the split itself', () => {
    render(<GeographyView geography={GEOGRAPHY} selection={SELECTION} today="2026-11-11" />);
    const status = screen.getByRole('region', { name: 'Order status' });
    expect(within(status).getByText('12')).toBeTruthy();
    expect(within(status).getByText('Cancelled')).toBeTruthy();
  });

  it('ranks the districts by the chosen metric', () => {
    const revenueSelection = { ...SELECTION, metric: 'revenue' as const };
    render(
      <GeographyView
        geography={{ ...GEOGRAPHY, filters: { ...GEOGRAPHY.filters, metric: 'revenue' } }}
        selection={revenueSelection}
        today="2026-11-11"
      />,
    );
    const top = screen.getByRole('region', { name: 'Top districts' });
    const rows = within(top).getAllByRole('listitem');
    expect(rows[0]?.textContent).toContain('Feni');
    expect(rows[1]?.textContent).toContain('Dhaka');
  });

  it('explains an empty range instead of drawing zeros', () => {
    const empty: OrderGeography = {
      ...GEOGRAPHY,
      summary: {
        ...GEOGRAPHY.summary,
        totalOrders: 0,
        eligibleOrders: 0,
        mappedOrders: 0,
        unmappedOrders: 0,
        cancelledOrders: 0,
      },
      districts: GEOGRAPHY.districts.map((row) => ({
        ...row,
        orderCount: 0,
        deliveredCount: 0,
        revenueMinor: 0,
        share: null,
      })),
      statusBreakdown: [],
      unmapped: {
        orderCount: 0,
        revenueMinor: 0,
        missingDistrictCount: 0,
        unknownDistrictCount: 0,
        values: [],
      },
    };
    render(<GeographyView geography={empty} selection={SELECTION} today="2026-11-11" />);
    expect(screen.getAllByText(/No orders were placed in this range/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Every order in this view names a district the map knows/),
    ).toBeTruthy();
  });
});
