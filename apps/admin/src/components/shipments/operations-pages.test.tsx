// @vitest-environment jsdom
import type { CourierOverviewResponse } from '@nilzora/contracts';
import type { ApiClient } from '@nilzora/web-session';
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CodPage from '@/app/admin/operations/cod/page';
import CouriersPage from '@/app/admin/operations/couriers/page';
import LocationsPage from '@/app/admin/operations/locations/page';
import SettingsPage from '@/app/admin/operations/settings/page';
import PricingPage from '@/app/admin/operations/pricing/page';
import ProvidersPage from '@/app/admin/operations/providers/page';
import ShipmentsPage from '@/app/admin/operations/shipments/page';
import { testUser } from '@/test/fixtures';
import { courierConfig, provider, shipment } from './fixtures';

const api = vi.hoisted(() => ({
  adminCourierOverview: vi.fn(),
  adminCourierConfig: vi.fn(),
  adminListShipments: vi.fn(),
  adminCodPositions: vi.fn(),
  adminListCourierSettlements: vi.fn(),
}));
const gate = vi.hoisted((): { value: unknown } => ({ value: undefined }));

vi.mock('@/lib/session', () => ({
  session: {
    read: async (call: (client: ApiClient, token: string) => Promise<unknown>) => ({
      kind: 'ok',
      value: await call(api as unknown as ApiClient, 'access-token'),
    }),
  },
}));
vi.mock('@/lib/access', () => ({ workspaceGate: () => Promise.resolve(gate.value) }));
vi.mock('@/lib/courier-actions', () => ({}));
vi.mock('@/components/shell/workspace-shell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('next/navigation', async () => {
  const { throwNotFound, throwRedirect } = await import('@/test/redirect');
  return { redirect: vi.fn(throwRedirect), notFound: vi.fn(throwNotFound), usePathname: () => '/' };
});
vi.mock('next/form', () => ({
  default: ({ action, ...props }: ComponentProps<'form'> & { action: string }) => (
    <form action={action} method="get" {...props} />
  ),
}));

const csrf = { name: 'csrf_token', token: 'signed-test-token' };
const props = (searchParams: Record<string, string> = {}) => ({
  params: Promise.resolve({}),
  searchParams: Promise.resolve(searchParams),
});

const config = courierConfig({ providers: [provider()] });

const overview: CourierOverviewResponse = {
  total: 12,
  bookingPending: 1,
  uncertain: 2,
  pendingPickup: 3,
  inTransit: 4,
  delivered: 5,
  failed: 1,
  returned: 0,
  cancelled: 1,
  syncErrors: 0,
  codAwaitingSettlementMinor: 250_000,
  includesMock: false,
  mode: 'mock',
  providers: [
    {
      provider: 'steadfast',
      displayName: 'Steadfast',
      isEnabled: false,
      settled: 0,
      delivered: 3,
      failed: 1,
    },
  ],
};

afterEach(cleanup);
beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  api.adminCourierConfig.mockResolvedValue(config);
});

describe('Operations pages refuse accounts without their read permission', () => {
  it.each([
    ['Courier overview', CouriersPage, 'View shipments and tracking'],
    ['Shipments', ShipmentsPage, 'View shipments and tracking'],
    ['COD reconciliation', CodPage, 'View courier COD and settlements'],
    ['Courier providers', ProvidersPage, 'View couriers and rate cards'],
    ['Courier pricing', PricingPage, 'View couriers and rate cards'],
    ['Courier settings', SettingsPage, 'View couriers and rate cards'],
    ['Location mappings', LocationsPage, 'View shipments and tracking'],
  ] as const)('%s', async (title, Page, permission) => {
    gate.value = { access: 'allowed', user: testUser('staff'), csrf };
    const page = Page as unknown as (pageProps: unknown) => Promise<ReactNode>;
    render(await page(props()));
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
    expect(screen.getByText(new RegExp(`“${permission}” permission`))).toBeTruthy();
    for (const mock of Object.values(api)) expect(mock).not.toHaveBeenCalled();
  });
});

describe('CourierOverviewPage', () => {
  it('shows the mode, uncertain bookings first and COD awaiting settlement', async () => {
    gate.value = { access: 'allowed', user: testUser('admin'), csrf };
    api.adminCourierOverview.mockResolvedValue(overview);
    render(await CouriersPage(props()));
    expect(api.adminCourierOverview).toHaveBeenCalledWith('access-token', { includeMock: false });
    expect(screen.getAllByText('Test mode — no real parcels').length).toBeGreaterThan(0);
    expect(screen.getByText('2 bookings need checking')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Courier settings' }).getAttribute('href')).toBe(
      '/admin/operations/settings',
    );
    expect(screen.getByText('৳2,500')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Include test data' }).getAttribute('href')).toBe(
      '/admin/operations/couriers?test=1',
    );
  });

  it('asks for test data only when the switch is on', async () => {
    gate.value = { access: 'allowed', user: testUser('admin'), csrf };
    api.adminCourierOverview.mockResolvedValue({ ...overview, includesMock: true });
    render(await CouriersPage(props({ test: '1' })));
    expect(api.adminCourierOverview).toHaveBeenCalledWith('access-token', { includeMock: true });
    expect(screen.getByText(/Test shipments from the mock courier are included/)).toBeTruthy();
  });
});

describe('ShipmentsPage', () => {
  it('lists shipments with the parsed filters and flags test ones', async () => {
    gate.value = { access: 'allowed', user: testUser('admin'), csrf };
    api.adminListShipments.mockResolvedValue({
      shipments: [shipment({ isMock: true, bookingUncertain: true })],
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
    });
    render(await ShipmentsPage(props({ status: 'in_transit', courier: 'pathao', q: 'NZ1' })));
    expect(api.adminListShipments).toHaveBeenCalledWith('access-token', {
      status: 'in_transit',
      provider: 'pathao',
      kind: 'all',
      q: 'NZ1',
      from: undefined,
      to: undefined,
      includeMock: false,
      page: 1,
      pageSize: 25,
    });
    expect(screen.getByText('NZ100001-F1')).toBeTruthy();
    expect(screen.getByText('Test')).toBeTruthy();
    expect(screen.getByText('Check the courier portal')).toBeTruthy();
  });
});

describe('PricingPage', () => {
  it('titles the rate cards as Internal Estimate rates and hides changes from readers', async () => {
    gate.value = {
      access: 'allowed',
      user: testUser('staff', { permissions: ['admin_workspace.access', 'couriers.read'] }),
      csrf,
    };
    render(await PricingPage());
    expect(
      screen.getByRole('heading', { name: 'Negotiated rates (used for Internal Estimates)' }),
    ).toBeTruthy();
    expect(screen.queryByText('Add a negotiated rate')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save courier settings' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Courier settings' }).getAttribute('href')).toBe(
      '/admin/operations/settings',
    );
  });
});
