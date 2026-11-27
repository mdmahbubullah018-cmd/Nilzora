// @vitest-environment jsdom
import type {
  CustomerInsightListResponse,
  SeoOverviewResponse,
  StaffNotificationListResponse,
  StoreProfileResponse,
} from '@nilzora/contracts';
import type { ApiClient } from '@nilzora/web-session';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CustomerInsightsPage from '@/app/admin/customers/insights/page';
import CustomersPage from '@/app/admin/customers/page';
import NotificationsPage from '@/app/admin/notifications/page';
import SeoPage from '@/app/admin/seo/page';
import SeoEditorPage from '@/app/admin/seo/[kind]/[targetId]/page';
import StoreProfilePage from '@/app/admin/store-profile/page';
import { testUser } from '@/test/fixtures';

/*
 * The Phase 3 Admin pages: what each renders from a real response shape, what it refuses to
 * an account without the permission, and what it says when the read fails or comes back
 * empty. The API is faked; nothing here claims a database was involved.
 */

const api = vi.hoisted(() => ({
  adminSeoOverview: vi.fn(),
  adminStoreProfile: vi.fn(),
  staffNotifications: vi.fn(),
  adminCustomerInsights: vi.fn(),
  adminListCustomers: vi.fn(),
}));
const read = vi.hoisted((): { outcome: 'ok' | 'signed_out' | 'unavailable' } => ({
  outcome: 'ok',
}));
const gate = vi.hoisted((): { user: unknown; csrf: unknown } => ({
  user: undefined,
  csrf: undefined,
}));

vi.mock('@/lib/session', () => ({
  session: {
    read: async (call: (client: ApiClient, token: string) => Promise<unknown>) => {
      if (read.outcome !== 'ok') return { kind: read.outcome };
      return { kind: 'ok', value: await call(api as unknown as ApiClient, 'access-token') };
    },
  },
}));
vi.mock('@/lib/access', () => ({
  workspaceGate: () => Promise.resolve({ access: 'allowed', user: gate.user, csrf: gate.csrf }),
}));
vi.mock('@/lib/actions', () => ({ signInAction: vi.fn(), signOutAction: vi.fn() }));
vi.mock('@/lib/site-actions', () => ({
  saveSeoAction: vi.fn(),
  saveStoreProfileAction: vi.fn(),
  markNotificationReadAction: vi.fn(),
  markAllNotificationsReadAction: vi.fn(),
}));
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
const PRODUCT_ID = '1d000000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '1d000000-0000-4000-8000-000000000002';
const NOTIFICATION_ID = '1d000000-0000-4000-8000-000000000003';
const AT = '2026-11-06T09:00:00.000Z';

type SeoRow = SeoOverviewResponse['entries'][number];

function seoRow(overrides: Partial<SeoRow> = {}): SeoRow {
  return {
    kind: 'product',
    id: PRODUCT_ID,
    slug: 'brass-table-lamp',
    name: 'Brass table lamp',
    isPublic: true,
    seoTitle: null,
    seoDescription: null,
    ogTitle: null,
    ogDescription: null,
    ogImageKey: null,
    canonicalPath: null,
    noIndex: false,
    missingTitle: true,
    missingDescription: true,
    updatedAt: AT,
    ...overrides,
  };
}

function seoEntry(overrides: Partial<SeoRow> = {}): SeoRow {
  return seoRow({
    seoTitle: 'Brass table lamp — warm reading light',
    seoDescription: 'A hand-finished brass lamp with a warm bulb.',
    ogTitle: 'Brass table lamp',
    ogDescription: 'A hand-finished brass lamp.',
    ogImageKey: 'products/lamp/og.webp',
    canonicalPath: '/products/brass-table-lamp',
    missingTitle: false,
    missingDescription: false,
    ...overrides,
  });
}

const storeProfile: StoreProfileResponse = {
  profile: {
    displayName: 'Nilzora',
    tagline: 'Everyday essentials from Dhaka.',
    description: null,
    logoKey: null,
    logoUrl: null,
    contactEmail: 'hello@nilzora.test',
    contactPhone: null,
    addressLine: 'House 12, Road 5',
    addressArea: 'Dhanmondi',
    addressDistrict: 'Dhaka',
    businessHours: null,
    supportEmail: 'help@nilzora.test',
    supportPhone: null,
    social: { facebook: null, instagram: null, youtube: null },
    defaultSeoTitle: null,
    defaultSeoDescription: null,
    ogImageKey: null,
    ogImageUrl: null,
    codAvailable: true,
    updatedAt: AT,
  },
};

const inbox: StaffNotificationListResponse = {
  notifications: [
    {
      id: NOTIFICATION_ID,
      kind: 'stock_low',
      title: 'Clay mug is down to 2',
      body: null,
      entityType: 'product',
      entityId: PRODUCT_ID,
      actionPath: `/admin/products/${PRODUCT_ID}`,
      readAt: null,
      createdAt: AT,
    },
    {
      id: CUSTOMER_ID,
      kind: 'order_new',
      title: 'Order NZ100042 is waiting',
      body: 'Cash on delivery.',
      entityType: 'order',
      entityId: 'ZZ100042',
      actionPath: null,
      readAt: AT,
      createdAt: AT,
    },
  ],
  page: 1,
  pageSize: 25,
  total: 2,
  unread: 1,
  totalPages: 1,
};

const insights: CustomerInsightListResponse = {
  customers: [
    {
      id: CUSTOMER_ID,
      fullName: 'Ayesha Rahman',
      email: 'ayesha@example.test',
      ordersCount: 3,
      completedOrders: 2,
      spendMinor: 780_000,
      averageOrderMinor: 260_000,
      firstOrderAt: AT,
      lastOrderAt: AT,
      segments: ['repeat', 'high_spender'],
    },
  ],
  page: 1,
  pageSize: 25,
  total: 1,
  totalPages: 1,
};

const searchParams = (values: Record<string, string> = {}) => Promise.resolve(values);

beforeEach(() => {
  gate.user = testUser('super_admin');
  gate.csrf = csrf;
  read.outcome = 'ok';
  for (const mock of Object.values(api)) mock.mockReset();
});

afterEach(cleanup);

describe('SEO overview', () => {
  it('counts the pages and flags those without a search title', async () => {
    api.adminSeoOverview.mockResolvedValue({
      entries: [
        seoRow(),
        seoRow({ kind: 'category', id: CUSTOMER_ID, slug: 'home', name: 'Home', noIndex: true }),
      ],
    });
    render(<>{await SeoPage({ searchParams: searchParams() })}</>);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('SEO');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Pages (2)');
    expect(
      screen.getByText(
        '2 public · 2 without a search title · 2 without a search description · 1 hidden from search',
      ),
    ).toBeTruthy();
    // The fallback names what is used: the product's name, or the category's.
    expect(screen.getAllByText('Missing — the product name is used')).toHaveLength(1);
    expect(screen.getAllByText('Missing — the category name is used')).toHaveLength(1);
    expect(screen.getByText('Hidden')).toBeTruthy();
  });

  it('links each page to its own metadata editor', async () => {
    api.adminSeoOverview.mockResolvedValue({ entries: [seoEntry()] });
    render(<>{await SeoPage({ searchParams: searchParams() })}</>);

    // The editor's route takes the singular kind; the plural form is a 404.
    expect(screen.getByRole('link', { name: 'Brass table lamp' }).getAttribute('href')).toBe(
      `/admin/seo/product/${PRODUCT_ID}`,
    );
    expect(screen.getByText('Brass table lamp — warm reading light')).toBeTruthy();
    expect(screen.getByText('Indexable')).toBeTruthy();
  });

  it('passes the search through to the API', async () => {
    api.adminSeoOverview.mockResolvedValue({ entries: [] });
    render(<>{await SeoPage({ searchParams: searchParams({ q: 'lamp' }) })}</>);

    expect(screen.getByLabelText('Search')).toHaveProperty('value', 'lamp');
    expect(screen.getByText('No pages match this view.')).toBeTruthy();
    expect(api.adminSeoOverview).toHaveBeenCalledWith(
      'access-token',
      expect.objectContaining({ q: 'lamp' }),
    );
  });

  it('refuses an account without products.read', async () => {
    gate.user = testUser('staff', { permissions: ['admin_workspace.access'] });
    render(<>{await SeoPage({ searchParams: searchParams() })}</>);

    expect(screen.getByText(/This needs the .View products. permission/)).toBeTruthy();
    expect(api.adminSeoOverview).not.toHaveBeenCalled();
  });

  it('says so when the list cannot be read', async () => {
    read.outcome = 'unavailable';
    render(<>{await SeoPage({ searchParams: searchParams() })}</>);

    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.getByText('This information is unavailable right now')).toBeTruthy();
  });
});

describe('SEO editor', () => {
  it('prefills every saved field, including the share preview and canonical path', async () => {
    api.adminSeoOverview.mockResolvedValue({ entries: [seoEntry()] });
    render(
      <>
        {await SeoEditorPage({
          params: Promise.resolve({ kind: 'product', targetId: PRODUCT_ID }),
        })}
      </>,
    );

    expect(screen.getByLabelText('Search title')).toHaveProperty(
      'value',
      'Brass table lamp — warm reading light',
    );
    expect(screen.getByLabelText('Search description')).toHaveProperty(
      'value',
      'A hand-finished brass lamp with a warm bulb.',
    );
    expect(screen.getByLabelText('Share title')).toHaveProperty('value', 'Brass table lamp');
    expect(screen.getByLabelText('Share description')).toHaveProperty(
      'value',
      'A hand-finished brass lamp.',
    );
    expect(screen.getByLabelText('Share image')).toHaveProperty('value', 'products/lamp/og.webp');
    expect(screen.getByLabelText('Canonical path')).toHaveProperty(
      'value',
      '/products/brass-table-lamp',
    );
    expect(screen.getByLabelText('Hide this page from search engines')).toHaveProperty(
      'checked',
      false,
    );
    expect(screen.getByRole('button', { name: 'Save metadata' })).toHaveProperty('disabled', false);
  });

  it('keeps the save disabled for an account that may only read', async () => {
    gate.user = testUser('moderator');
    api.adminSeoOverview.mockResolvedValue({ entries: [seoEntry()] });
    render(
      <>
        {await SeoEditorPage({
          params: Promise.resolve({ kind: 'product', targetId: PRODUCT_ID }),
        })}
      </>,
    );

    expect(screen.getByText('Your account can read this page but not change it.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save metadata' })).toHaveProperty('disabled', true);
  });

  it('submits one form that carries the kind, the id and the CSRF token', async () => {
    api.adminSeoOverview.mockResolvedValue({ entries: [seoEntry()] });
    const { container } = render(
      <>
        {await SeoEditorPage({
          params: Promise.resolve({ kind: 'product', targetId: PRODUCT_ID }),
        })}
      </>,
    );

    const form = container.querySelector('form') as HTMLFormElement;
    expect(form).not.toBeNull();
    expect(within(form).getByLabelText('Search title')).toBeTruthy();
    expect(form.querySelector('input[name="kind"]')).toHaveProperty('value', 'product');
    expect(form.querySelector('input[name="targetId"]')).toHaveProperty('value', PRODUCT_ID);
    expect(form.querySelector('input[name="csrf_token"]')).not.toBeNull();
  });

  it('shows the unpublished state of the page above the form', async () => {
    api.adminSeoOverview.mockResolvedValue({
      entries: [seoEntry({ isPublic: false, noIndex: true })],
    });
    render(
      <>
        {await SeoEditorPage({
          params: Promise.resolve({ kind: 'product', targetId: PRODUCT_ID }),
        })}
      </>,
    );

    expect(
      screen.getByText('This page is not public yet, so search engines cannot reach it.'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Hide this page from search engines')).toHaveProperty(
      'checked',
      true,
    );
  });

  it('answers an unknown kind or a missing page with not found', async () => {
    await expect(
      SeoEditorPage({ params: Promise.resolve({ kind: 'brand', targetId: PRODUCT_ID }) }),
    ).rejects.toMatchObject({ digest: 'NEXT_NOT_FOUND' });

    api.adminSeoOverview.mockResolvedValue({ entries: [] });
    await expect(
      SeoEditorPage({ params: Promise.resolve({ kind: 'product', targetId: PRODUCT_ID }) }),
    ).rejects.toMatchObject({ digest: 'NEXT_NOT_FOUND' });
  });
});

describe('store profile', () => {
  it('prefills the published values and offers one save', async () => {
    api.adminStoreProfile.mockResolvedValue(storeProfile);
    const { container } = render(<>{await StoreProfilePage()}</>);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Store information');
    expect(screen.getByLabelText(/^Store name/)).toHaveProperty('value', 'Nilzora');
    expect(screen.getByLabelText('Tagline')).toHaveProperty(
      'value',
      'Everyday essentials from Dhaka.',
    );
    expect(screen.getByLabelText('Contact email')).toHaveProperty('value', 'hello@nilzora.test');
    expect(screen.getByLabelText('Support email')).toHaveProperty('value', 'help@nilzora.test');
    expect(screen.getByLabelText('Street address')).toHaveProperty('value', 'House 12, Road 5');
    expect(container.querySelector('input[name="csrf_token"]')).not.toBeNull();
  });

  it('never offers private store settings', async () => {
    api.adminStoreProfile.mockResolvedValue(storeProfile);
    render(<>{await StoreProfilePage()}</>);

    // The return window, cart inactivity and insight thresholds stay in Settings.
    expect(screen.queryByLabelText(/return window/i)).toBeNull();
    expect(screen.queryByLabelText(/cart inactivity/i)).toBeNull();
    expect(screen.queryByLabelText(/insight threshold/i)).toBeNull();
  });

  it('refuses an admin, who may not manage settings', async () => {
    gate.user = testUser('admin');
    render(<>{await StoreProfilePage()}</>);

    expect(screen.getByText(/This needs the .Manage store settings. permission/)).toBeTruthy();
    expect(api.adminStoreProfile).not.toHaveBeenCalled();
  });
});

describe('notifications inbox', () => {
  it('shows the unread count, the items and a mark-all action', async () => {
    api.staffNotifications.mockResolvedValue(inbox);
    render(<>{await NotificationsPage({ searchParams: searchParams() })}</>);

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Inbox (2)');
    expect(screen.getByText('1 unread')).toBeTruthy();
    expect(screen.getByText('Low stock')).toBeTruthy();
    expect(screen.getByText('Order NZ100042 is waiting')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Mark read' })).toHaveLength(1);
    expect(screen.getByText('Read')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe(
      `/admin/products/${PRODUCT_ID}`,
    );
  });

  it('sends the id of the row being marked read', async () => {
    api.staffNotifications.mockResolvedValue(inbox);
    const { container } = render(<>{await NotificationsPage({ searchParams: searchParams() })}</>);

    expect(
      container.querySelector(`input[name="notificationId"][value="${NOTIFICATION_ID}"]`),
    ).not.toBeNull();
  });

  it('has an empty inbox state with no mark-all button', async () => {
    api.staffNotifications.mockResolvedValue({
      notifications: [],
      page: 1,
      pageSize: 25,
      total: 0,
      unread: 0,
      totalPages: 1,
    });
    render(<>{await NotificationsPage({ searchParams: searchParams() })}</>);

    expect(screen.getByText('0 unread')).toBeTruthy();
    expect(screen.getByText(/Nothing needs attention right now/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
  });

  it('reports a failed inbox read without inventing notifications', async () => {
    read.outcome = 'unavailable';
    render(<>{await NotificationsPage({ searchParams: searchParams() })}</>);

    expect(screen.queryByText('Inbox (2)')).toBeNull();
    expect(screen.getByText('This information is unavailable right now')).toBeTruthy();
  });
});

describe('customer insight', () => {
  it('shows spending, segment labels and the filter the API was asked for', async () => {
    api.adminCustomerInsights.mockResolvedValue(insights);
    render(
      <>{await CustomerInsightsPage({ searchParams: searchParams({ segment: 'repeat' }) })}</>,
    );

    expect(screen.getByRole('table', { name: 'Customer spending and segments' })).toBeTruthy();
    expect(screen.getByText('Ayesha Rahman')).toBeTruthy();
    expect(screen.getByText('৳7,800')).toBeTruthy();
    expect(screen.getByText('৳2,600')).toBeTruthy();
    expect(screen.getByText('Has ordered again')).toBeTruthy();
    expect(screen.getByText('Spending above the store threshold')).toBeTruthy();
    // The segment is a tab now; the one the API was asked for is the current page.
    expect(screen.getByRole('link', { name: 'Repeat' }).getAttribute('aria-current')).toBe('page');
    expect(api.adminCustomerInsights).toHaveBeenCalledWith(
      'access-token',
      expect.objectContaining({ segment: 'repeat' }),
    );
  });

  it('says plainly when nobody matches', async () => {
    api.adminCustomerInsights.mockResolvedValue({ ...insights, customers: [], total: 0 });
    render(<>{await CustomerInsightsPage({ searchParams: searchParams() })}</>);

    expect(screen.getByText('No customers yet')).toBeTruthy();
  });

  it('refuses an account without customers.read', async () => {
    gate.user = testUser('moderator', { permissions: ['moderator_workspace.access'] });
    render(<>{await CustomerInsightsPage({ searchParams: searchParams() })}</>);

    expect(screen.getByText(/This needs the .View customers. permission/)).toBeTruthy();
    expect(api.adminCustomerInsights).not.toHaveBeenCalled();
  });
});

describe('customers directory', () => {
  it('offers spending and segments from the customer list', async () => {
    render(
      <>{await CustomersPage({ params: Promise.resolve({}), searchParams: searchParams() })}</>,
    );

    expect(screen.getByRole('link', { name: 'Spending and segments' }).getAttribute('href')).toBe(
      '/admin/customers/insights',
    );
  });
});
