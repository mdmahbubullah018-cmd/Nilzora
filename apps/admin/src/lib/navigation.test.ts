import type { AppRole, Permission } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS } from '@/test/fixtures';
import {
  activeNavItem,
  canSeeNavItem,
  isActivePath,
  visibleCreateActions,
  visibleNavGroups,
  workspaces,
  type NavGroup,
} from './navigation';
import { WORKSPACE_HOME } from './workspace-access';

describe('isActivePath', () => {
  it('matches a workspace home only exactly', () => {
    expect(isActivePath('/admin', '/admin', '/admin')).toBe(true);
    expect(isActivePath('/admin/orders', '/admin', '/admin')).toBe(false);
  });

  it('matches other destinations and their sub-pages', () => {
    expect(isActivePath('/admin/orders', '/admin/orders', '/admin')).toBe(true);
    expect(isActivePath('/admin/orders/42', '/admin/orders', '/admin')).toBe(true);
    expect(isActivePath('/admin/orders-archive', '/admin/orders', '/admin')).toBe(false);
  });
});

describe('workspaces', () => {
  it.each(Object.entries(workspaces))('%s links only within its own workspace', (_, config) => {
    const hrefs = config.groups.flatMap((group) => group.items.map((item) => item.href));

    expect(hrefs).toContain(config.home);
    for (const href of hrefs) expect(href.startsWith(config.home)).toBe(true);
  });

  it('switches between the two workspaces', () => {
    expect(workspaces.admin.switchTo).toBe('moderator');
    expect(workspaces.moderator.switchTo).toBe('admin');
  });

  it('uses the workspace homes the access checks protect', () => {
    expect(workspaces.admin.home).toBe(WORKSPACE_HOME.admin);
    expect(workspaces.moderator.home).toBe(WORKSPACE_HOME.moderator);
  });

  it('keeps each workspace home visible to everyone allowed into the workspace', () => {
    for (const config of Object.values(workspaces)) {
      const home = config.groups.flatMap((g) => g.items).find((i) => i.href === config.home);
      expect(home?.permission).toBeUndefined();
    }
  });
});

/** Visible labels per group, e.g. { '': ['Overview'], Catalog: ['Products', ...] }. */
function visibleLabels(groups: readonly NavGroup[], permissions: readonly Permission[]) {
  return Object.fromEntries(
    visibleNavGroups(groups, permissions).map((group) => [
      group.label ?? '',
      group.items.map((item) => item.label),
    ]),
  );
}

const adminNav = (role: AppRole) => visibleLabels(workspaces.admin.groups, ROLE_PERMISSIONS[role]);
const moderatorNav = (permissions: readonly Permission[]) =>
  visibleLabels(workspaces.moderator.groups, permissions);

describe('visibleNavGroups', () => {
  it('shows the owner everything, including Settings', () => {
    expect(adminNav('super_admin')).toEqual({
      Overview: ['Dashboard', 'Analytics', 'Order map', 'Reports'],
      Catalog: [
        'Products',
        'Categories',
        'Brands',
        'Attributes & variants',
        'Inventory',
        'Media library',
        'Reviews',
      ],
      Sales: [
        'Orders',
        'COD collections',
        'Abandoned checkouts',
        'Returns',
        'Refunds',
        'Customers',
        'Communication',
        'Customer insight',
        'Coupons & promotions',
        'Discount campaigns',
      ],
      Operations: [
        'Courier overview',
        'Shipments',
        'COD reconciliation',
        'Location mappings',
        'Providers',
        'Pricing',
        'Courier settings',
      ],
      Storefront: [
        'Shopping zones',
        'Banners',
        'Popups',
        'Homepage',
        'Menus',
        'Pages',
        'Store information',
        'SEO',
        'Store settings',
        'Image search',
      ],
      'Mobile app': ['Onboarding', 'Push broadcasts'],
      Team: ['User management', 'Roles & permissions', 'Moderators'],
      System: ['Notifications', 'Audit log'],
    });
  });

  it('hides store settings (settings.manage) from admins', () => {
    expect(adminNav('admin').Storefront).toEqual(['Shopping zones', 'SEO', 'Image search']);
    expect(adminNav('admin')['Mobile app']).toEqual(['Push broadcasts']);
    expect(adminNav('admin').System).toEqual(['Notifications', 'Audit log']);
    expect(adminNav('admin').Team).toEqual([
      'User management',
      'Roles & permissions',
      'Moderators',
    ]);
  });

  it('shows staff catalogue and order work, and only the inbox from the system group', () => {
    expect(adminNav('staff')).toEqual({
      // Staff hold the permissions of several reports (orders, products, customers).
      Overview: ['Dashboard', 'Reports'],
      Catalog: [
        'Products',
        'Categories',
        'Brands',
        'Attributes & variants',
        'Inventory',
        'Media library',
      ],
      Sales: [
        'Orders',
        'COD collections',
        'Abandoned checkouts',
        'Returns',
        'Refunds',
        'Customers',
        'Communication',
        'Customer insight',
      ],
      // Products.read, which every staff member holds, opens the SEO screen.
      Storefront: ['SEO'],
      System: ['Notifications'],
    });
  });

  it('shows only the overview, the inbox and the communication center to an account holding no item permissions', () => {
    expect(visibleLabels(workspaces.admin.groups, ['admin_workspace.access'])).toEqual({
      Overview: ['Dashboard'],
      // The workspace permission itself opens the support queue.
      Sales: ['Communication'],
      System: ['Notifications'],
    });
  });

  it('shows moderators the whole moderator navigation', () => {
    expect(moderatorNav(ROLE_PERMISSIONS.moderator)).toEqual({
      '': ['Queue', 'Messages'],
      Review: ['Product content', 'Notifications'],
      Records: ['History'],
    });
  });

  it('filters moderator items by permission and drops emptied groups', () => {
    expect(moderatorNav(['moderator_workspace.access', 'reviews.moderate'])).toEqual({
      '': ['Queue', 'Messages'],
      Review: ['Notifications'],
    });
  });

  it('shows the Operations group by courier and shipment permission', () => {
    const operations = (permissions: readonly Permission[]) =>
      visibleLabels(workspaces.admin.groups, ['admin_workspace.access', ...permissions]).Operations;
    // Admins hold every courier permission except couriers.configure; staff hold none.
    expect(adminNav('admin').Operations).toEqual([
      'Courier overview',
      'Shipments',
      'COD reconciliation',
      'Location mappings',
      'Providers',
      'Pricing',
      'Courier settings',
    ]);
    expect(adminNav('staff').Operations).toBeUndefined();
    expect(operations([])).toBeUndefined();
    expect(operations(['shipments.read'])).toEqual([
      'Courier overview',
      'Shipments',
      'Location mappings',
    ]);
    expect(operations(['couriers.read'])).toEqual([
      'Courier overview',
      'Providers',
      'Pricing',
      'Courier settings',
    ]);
    expect(operations(['couriers.cod.read'])).toEqual(['COD reconciliation']);
    // Acting permissions alone open nothing: every page needs its read permission.
    expect(
      operations(['shipments.create', 'couriers.configure', 'couriers.cod.reconcile']),
    ).toBeUndefined();
  });

  it('places Operations between Sales and Storefront', () => {
    const ids = workspaces.admin.groups.map((group) => group.id);
    expect(ids.indexOf('operations')).toBe(ids.indexOf('sales') + 1);
    expect(ids.indexOf('storefront')).toBe(ids.indexOf('operations') + 1);
  });

  it('shows Staff to an account holding either staff permission', () => {
    const staffItem = workspaces.admin.groups
      .flatMap((group) => group.items)
      .find((item) => item.label === 'User management');
    if (!staffItem) throw new Error('Staff item missing');

    expect(canSeeNavItem(staffItem, ['staff.roles.assign'])).toBe(true);
    expect(canSeeNavItem(staffItem, ['staff.permissions.manage'])).toBe(true);
    expect(canSeeNavItem(staffItem, ['staff.invite', 'audit_logs.read'])).toBe(false);
  });

  it('shows Moderators only to accounts that assign reviews', () => {
    const team = (permissions: readonly Permission[]) =>
      visibleLabels(workspaces.admin.groups, permissions).Team;
    expect(team(['admin_workspace.access', 'moderation.assign'])).toEqual(['Moderators']);
    expect(team(['admin_workspace.access', 'content.approve'])).toBeUndefined();
  });

  it('lists only destinations that exist, with no placeholder items', () => {
    const items = Object.values(workspaces).flatMap((config) =>
      config.groups.flatMap((group) => group.items),
    );
    expect(items.map((item) => item.label)).not.toContain('Customer reviews');
    expect(new Set(items.map((item) => item.href)).size).toBe(items.length);
    expect(
      Object.fromEntries(
        workspaces.admin.groups.flatMap((g) => g.items).map((i) => [i.label, i.href]),
      ),
    ).toEqual({
      Dashboard: '/admin',
      Analytics: '/admin/analytics',
      'Order map': '/admin/order-geography',
      Reports: '/admin/reports',
      Products: '/admin/products',
      Categories: '/admin/categories',
      Brands: '/admin/brands',
      'Attributes & variants': '/admin/attributes',
      Inventory: '/admin/inventory',
      'Media library': '/admin/media',
      Reviews: '/admin/reviews',
      Orders: '/admin/orders',
      'COD collections': '/admin/cod-collections',
      'Abandoned checkouts': '/admin/checkouts',
      Returns: '/admin/returns',
      Refunds: '/admin/refunds',
      Customers: '/admin/customers',
      Communication: '/admin/communication',
      'Customer insight': '/admin/customers/insights',
      'Coupons & promotions': '/admin/coupons',
      'Discount campaigns': '/admin/discounts',
      'Courier overview': '/admin/operations/couriers',
      'Location mappings': '/admin/operations/locations',
      'Courier settings': '/admin/operations/settings',
      Shipments: '/admin/operations/shipments',
      'COD reconciliation': '/admin/operations/cod',
      Providers: '/admin/operations/providers',
      Pricing: '/admin/operations/pricing',
      'Shopping zones': '/admin/zones',
      Banners: '/admin/banners',
      Popups: '/admin/popups',
      Homepage: '/admin/homepage',
      Menus: '/admin/navigation',
      Pages: '/admin/pages',
      'Store information': '/admin/store-profile',
      SEO: '/admin/seo',
      'Store settings': '/admin/settings',
      'Image search': '/admin/settings/image-search',
      Onboarding: '/admin/marketing/onboarding',
      'Push broadcasts': '/admin/broadcasts',
      'User management': '/admin/staff',
      'Roles & permissions': '/admin/roles',
      Moderators: '/admin/moderation',
      Notifications: '/admin/notifications',
      'Audit log': '/admin/audit',
    });
  });

  it('gives every group a unique key for its remembered open state', () => {
    for (const config of Object.values(workspaces)) {
      const ids = config.groups.map((group) => group.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('does not change the shared configuration', () => {
    visibleNavGroups(workspaces.admin.groups, []);
    expect(workspaces.admin.groups.flatMap((g) => g.items)).toHaveLength(45);
  });
});

describe('activeNavItem', () => {
  it('names the item and group a page belongs to, including its sub-pages', () => {
    const match = activeNavItem('admin', '/admin/orders/NZ100042');
    expect(match?.item.label).toBe('Orders');
    expect(match?.group.label).toBe('Sales');
    expect(activeNavItem('moderator', '/moderator/tasks')?.item.label).toBe('Product content');
  });

  it('matches the workspace home only exactly', () => {
    expect(activeNavItem('admin', '/admin')?.item.label).toBe('Dashboard');
    expect(activeNavItem('admin', '/admin/unknown')).toBeUndefined();
  });
});

describe('visibleCreateActions', () => {
  it('offers every create page to the owner', () => {
    expect(visibleCreateActions(ROLE_PERMISSIONS.super_admin).map((a) => a.href)).toEqual([
      '/admin/products/new',
      '/admin/categories/new',
      '/admin/coupons/new',
      '/admin/discounts/new',
      '/admin/banners',
      '/admin/brands',
      '/admin/broadcasts',
      '/admin/marketing/onboarding/new',
    ]);
  });

  it('requires every permission the create page itself checks', () => {
    // Staff create products, but categories need products.publish and coupons coupons.update.
    expect(visibleCreateActions(ROLE_PERMISSIONS.staff).map((a) => a.label)).toEqual(['Product']);
    expect(visibleCreateActions(['products.create'])).toEqual([]);
    // A banner needs settings.manage; a broadcast needs its own permission.
    expect(visibleCreateActions(['settings.manage']).map((a) => a.label)).toEqual([
      'Banner',
      'App onboarding',
    ]);
    expect(visibleCreateActions(['notifications.broadcast']).map((a) => a.label)).toEqual([
      'Push broadcast',
    ]);
    expect(visibleCreateActions([])).toEqual([]);
  });
});
