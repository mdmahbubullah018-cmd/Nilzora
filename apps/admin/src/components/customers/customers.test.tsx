// @vitest-environment jsdom
import type { AdminCustomerDetail } from '@nilzora/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AcceptInvitePage from '@/app/accept-invite/page';
import SettingsPage from '@/app/admin/settings/page';
import { orderSummary } from '@/components/orders/fixtures';
import { DeliveryChargesView } from '@/components/settings/settings-view';
import { AuditTable } from '@/components/audit/audit-views';
import { ROLE_PERMISSIONS, testUser } from '@/test/fixtures';
import { CustomerDetailView } from './customer-views';

const gate = vi.hoisted((): { value: unknown } => ({ value: undefined }));
vi.mock('@/lib/access', () => ({ workspaceGate: () => Promise.resolve(gate.value) }));
vi.mock('@/lib/customer-actions', () => ({ setCustomerStatusAction: vi.fn() }));
vi.mock('@/lib/settings-actions', () => ({ setDeliveryChargeAction: vi.fn() }));
vi.mock('@/lib/invite-actions', () => ({ acceptInvitationAction: vi.fn() }));
vi.mock('@/lib/actions', () => ({ signInAction: vi.fn(), signOutAction: vi.fn() }));
vi.mock('@/lib/session', () => ({ session: {} }));
vi.mock('@/components/shell/workspace-shell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), usePathname: () => '/' }));

afterEach(cleanup);

const csrf = { name: 'csrf_token', token: 'signed-test-token' };

function customer(overrides: Partial<AdminCustomerDetail> = {}): AdminCustomerDetail {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'customer@example.test',
    fullName: 'Test Customer',
    phone: '+8801812345678',
    status: 'active',
    createdAt: '2026-09-01T00:00:00.000Z',
    orderCount: 1,
    lastOrderAt: '2026-10-24T08:00:00.000Z',
    avatar: null,
    googleAvatar: null,
    recentOrders: [orderSummary],
    ...overrides,
  };
}

describe('CustomerDetailView', () => {
  it('shows the profile, recent orders and a confirmed suspension with a required reason', () => {
    render(
      <CustomerDetailView customer={customer()} permissions={ROLE_PERMISSIONS.admin} csrf={csrf} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Test Customer' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'NZ100042' }).getAttribute('href')).toBe(
      '/admin/orders/NZ100042',
    );
    expect(screen.getByText('Suspend account')).toBeTruthy();
    expect(screen.getByLabelText(/Reason/).hasAttribute('required')).toBe(true);
  });

  it('shows the account id and its picture, falling back to initials', () => {
    const { container, unmount } = render(
      <CustomerDetailView
        customer={customer({
          id: '33333333-3333-4333-8333-333333333333',
          avatar: {
            url: 'https://media.test/a/full.webp',
            thumbUrl: 'https://media.test/a/t.webp',
          },
        })}
        permissions={ROLE_PERMISSIONS.admin}
        csrf={csrf}
      />,
    );
    // The persistent id, not a display code.
    expect(screen.getByText('Customer ID 33333333-3333-4333-8333-333333333333')).toBeTruthy();
    // The upload is preferred over anything Google supplied.
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://media.test/a/t.webp');
    unmount();

    // Without a picture the initials stand in, and a Google picture is used when it is all there is.
    const initials = render(
      <CustomerDetailView customer={customer()} permissions={ROLE_PERMISSIONS.admin} csrf={csrf} />,
    );
    expect(initials.container.querySelector('img')).toBeNull();
    expect(initials.container.textContent).toContain('TC');
    initials.unmount();

    const google = render(
      <CustomerDetailView
        customer={customer({ googleAvatar: 'https://lh3.googleusercontent.com/a/x' })}
        permissions={ROLE_PERMISSIONS.admin}
        csrf={csrf}
      />,
    );
    expect(google.container.querySelector('img')?.getAttribute('src')).toBe(
      'https://lh3.googleusercontent.com/a/x',
    );
  });

  it('offers reactivation for a suspended account and nothing without customers.update', () => {
    const { unmount } = render(
      <CustomerDetailView
        customer={customer({ status: 'suspended' })}
        permissions={ROLE_PERMISSIONS.admin}
        csrf={csrf}
      />,
    );
    expect(screen.getByText('Reactivate account')).toBeTruthy();
    unmount();

    render(
      <CustomerDetailView
        customer={customer({ recentOrders: null })}
        permissions={ROLE_PERMISSIONS.staff}
        csrf={csrf}
      />,
    );
    expect(screen.queryByText('Suspend account')).toBeNull();
    expect(screen.getByText(/needs the “Edit customers” permission/)).toBeTruthy();
    expect(screen.getByText('Orders are hidden')).toBeTruthy();
  });
});

describe('settings', () => {
  it('is for settings.manage only', async () => {
    gate.value = { access: 'allowed', user: testUser('admin'), csrf };
    render(await SettingsPage());
    expect(screen.getByText(/“Manage store settings” permission/)).toBeTruthy();
  });

  it('warns about unset zones and shows a form per zone', () => {
    render(
      <DeliveryChargesView
        charges={[
          { zone: 'inside_dhaka', amountMinor: 8_000, updatedAt: '2026-10-01T00:00:00.000Z' },
          { zone: 'outside_dhaka', amountMinor: null, updatedAt: null },
        ]}
        csrf={csrf}
      />,
    );
    expect(screen.getByText('Orders are refused until every zone has a charge')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(/Inside Dhaka charge/).value).toBe('80');
    expect(screen.getByLabelText<HTMLInputElement>(/Outside Dhaka charge/).value).toBe('');
  });
});

describe('AuditTable', () => {
  it('renders details as text and links targets the account may open', () => {
    render(
      <AuditTable
        data={{
          entries: [
            {
              id: 1,
              actor: { id: '99999999-9999-4999-8999-999999999999', name: 'Owner', email: null },
              action: 'order.status_changed',
              targetType: 'order',
              targetId: 'NZ100042',
              details: { from: 'pending', to: '<b>confirmed</b>' },
              createdAt: '2026-10-24T08:00:00.000Z',
            },
          ],
          page: 1,
          pageSize: 30,
          total: 1,
          totalPages: 1,
        }}
        filters={{}}
        permissions={ROLE_PERMISSIONS.admin}
      />,
    );
    expect(screen.getByText('Changed an order’s status')).toBeTruthy();
    expect(screen.getByText('<b>confirmed</b>')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'order NZ100042' }).getAttribute('href')).toBe(
      '/admin/orders/NZ100042',
    );
    expect(screen.getByRole('link', { name: 'Owner' }).getAttribute('href')).toBe(
      '/admin/audit?actor=99999999-9999-4999-8999-999999999999',
    );
  });
});

describe('AcceptInvitePage', () => {
  it('keeps a valid token in a hidden field only', async () => {
    const token = 'pkce_0123456789abcdef0123';
    const { container } = render(
      await AcceptInvitePage({
        params: Promise.resolve({}),
        searchParams: Promise.resolve({ token_hash: token }),
      }),
    );
    expect(container.querySelector('input[name="tokenHash"]')?.getAttribute('value')).toBe(token);
    expect(container.textContent).not.toContain(token);
    expect(screen.getByText(/At least 8 characters/)).toBeTruthy();
  });

  it('explains an incomplete link without a form', async () => {
    render(
      await AcceptInvitePage({
        params: Promise.resolve({}),
        searchParams: Promise.resolve({ token_hash: 'bad token' }),
      }),
    );
    expect(screen.getByText('This invitation link is incomplete or invalid')).toBeTruthy();
    expect(screen.queryByLabelText(/New password/)).toBeNull();
  });
});
