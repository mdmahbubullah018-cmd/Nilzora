import {
  adminCouponResponseSchema,
  adminRolesResponseSchema,
  storeSettingsResponseSchema,
  adminHomepageResponseSchema,
  adminSitePageListResponseSchema,
  adminSitePageResponseSchema,
  menuItemListResponseSchema,
  menuItemResponseSchema,
  HOMEPAGE_SECTION_KEYS,
  adminCategoryListResponseSchema,
  adminCategoryResponseSchema,
  adminOrderListResponseSchema,
  adminOrderResponseSchema,
  adminProductListResponseSchema,
  adminProductResponseSchema,
  analyticsOverviewResponseSchema,
  assignRoleResponseSchema,
  auditLogResponseSchema,
  customerListResponseSchema,
  customerResponseSchema,
  dashboardResponseSchema,
  deliveryChargeListResponseSchema,
  exportJobListResponseSchema,
  exportJobResponseSchema,
  REPORT_DEFINITIONS,
  REPORT_KINDS,
  reportPreviewResponseSchema,
  deliveryChargeResponseSchema,
  inventoryMovementListResponseSchema,
  mediaAssetResponseSchema,
  mediaListResponseSchema,
  moderationReviewerListResponseSchema,
  moderationTaskListResponseSchema,
  moderationTaskResponseSchema,
  salesOverviewResponseSchema,
  salesTargetResponseSchema,
  slugAvailabilityResponseSchema,
  staffInvitationResendResponseSchema,
  staffInvitationResponseSchema,
  staffListResponseSchema,
  staffMemberResponseSchema,
  type Permission,
} from '@nilzora/contracts';
import { randomUUID } from 'node:crypto';
import { z, type ZodType } from 'zod';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  adminSetup,
  errorOf,
  newProduct,
  pendingInvitee,
  sameContent,
  seedMediaAsset,
  type AdminSetup,
  type Who,
} from './admin-helpers';
import { makeImage } from './media-fakes';

/** A menu link recorded directly in the fake (no create call); returns it. */
function seedMenuItem(setup: AdminSetup) {
  const item = {
    id: randomUUID(),
    menu: 'header' as const,
    label: 'Eid sale',
    href: '/products',
    sortOrder: setup.admin.content.items.length,
    isActive: true,
    updatedAt: '2026-11-08T08:00:00.000Z',
  };
  setup.admin.content.items.push(item);
  return item;
}

const HOMEPAGE_BODY = {
  sections: HOMEPAGE_SECTION_KEYS.map((key) => ({ key, isEnabled: true })),
};

/** A real JPEG for the raw-body upload routes, made once. */
let jpeg: Buffer = Buffer.alloc(0);
beforeAll(async () => {
  jpeg = await makeImage('jpeg', 800, 600);
});

/*
 * Every admin and moderator route, checked the same way: no session → 401, a customer
 * or a suspended account → 403, each required permission denied on an otherwise
 * permitted account → 403 before the database is asked, success answered in the
 * contract's shape, every answer uncacheable, and changes behind the admin rate limit.
 */

interface RouteCase {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: (setup: AdminSetup) => string;
  body?: (setup: AdminSetup) => object;
  /** A raw upload: the body is these bytes, sent with this Content-Type. */
  raw?: { contentType: string; bytes: () => Buffer };
  /** The route needs media storage configured. */
  storage?: boolean;
  /** Each of these is required: denying any one of them refuses the request. */
  requires: Permission[];
  /** At least one of these is required (denying all of them refuses the request). */
  anyOf?: Permission[];
  /** An account the route serves. */
  as: Who;
  status: number;
  schema: ZodType;
}

const ROUTES: Record<string, RouteCase> = {
  'GET /admin/products': {
    method: 'get',
    path: () => '/admin/products',
    requires: ['products.read'],
    as: 'staff',
    status: 200,
    schema: adminProductListResponseSchema,
  },
  'GET /admin/products/:productId': {
    method: 'get',
    path: (s) => `/admin/products/${s.products.lamp.id}`,
    requires: ['products.read'],
    as: 'moderator',
    status: 200,
    schema: adminProductResponseSchema,
  },
  'POST /admin/products': {
    method: 'post',
    path: () => '/admin/products',
    body: (s) => newProduct(s),
    requires: ['products.read', 'products.create'],
    as: 'staff',
    status: 201,
    schema: adminProductResponseSchema,
  },
  'PUT /admin/products/:productId': {
    method: 'put',
    path: (s) => `/admin/products/${s.products.watch.id}`,
    body: (s) => ({ ...sameContent(s.products.watch), priceMinor: 95_000 }),
    requires: ['products.read', 'products.update'],
    as: 'staff',
    status: 200,
    schema: adminProductResponseSchema,
  },
  'POST /admin/products/:productId/status': {
    method: 'post',
    path: (s) => `/admin/products/${s.products.lamp.id}/status`,
    body: () => ({ status: 'draft' }),
    requires: ['products.read', 'products.publish'],
    as: 'admin',
    status: 200,
    schema: adminProductResponseSchema,
  },
  'POST /admin/products/:productId/stock': {
    method: 'post',
    path: (s) => `/admin/products/${s.products.lamp.id}/stock`,
    body: () => ({ change: 5, note: 'Restocked from supplier' }),
    requires: ['products.read', 'inventory.adjust'],
    as: 'staff',
    status: 200,
    schema: adminProductResponseSchema,
  },
  'POST /admin/products/:productId/submit': {
    method: 'post',
    path: (s) => `/admin/products/${s.products.watch.id}/submit`,
    requires: ['products.read', 'products.update'],
    as: 'staff',
    status: 200,
    schema: adminProductResponseSchema,
  },
  'GET /admin/categories': {
    method: 'get',
    path: () => '/admin/categories',
    requires: ['products.read'],
    as: 'staff',
    status: 200,
    schema: adminCategoryListResponseSchema,
  },
  'POST /admin/categories': {
    method: 'post',
    path: () => '/admin/categories',
    body: () => ({ slug: 'garden', name: 'Garden' }),
    requires: ['products.read', 'products.publish'],
    as: 'admin',
    status: 201,
    schema: adminCategoryResponseSchema,
  },
  'PUT /admin/categories/:categoryId': {
    method: 'put',
    path: (s) => `/admin/categories/${s.categories.kitchen.id}`,
    body: () => ({ slug: 'home-kitchen', name: 'Kitchen', sortOrder: 3 }),
    requires: ['products.read', 'products.publish'],
    as: 'admin',
    status: 200,
    schema: adminCategoryResponseSchema,
  },
  'GET /admin/inventory-movements': {
    method: 'get',
    path: () => '/admin/inventory-movements',
    requires: ['products.read'],
    anyOf: ['inventory.adjust', 'products.update'],
    as: 'staff',
    status: 200,
    schema: inventoryMovementListResponseSchema,
  },
  'GET /admin/orders': {
    method: 'get',
    path: () => '/admin/orders',
    requires: ['orders.read'],
    as: 'staff',
    status: 200,
    schema: adminOrderListResponseSchema,
  },
  'GET /admin/orders/:orderNumber': {
    method: 'get',
    path: (s) => `/admin/orders/${s.orders.pending.orderNumber}`,
    requires: ['orders.read'],
    as: 'staff',
    status: 200,
    schema: adminOrderResponseSchema,
  },
  'POST /admin/orders/:orderNumber/status': {
    method: 'post',
    path: (s) => `/admin/orders/${s.orders.pending.orderNumber}/status`,
    body: () => ({ status: 'confirmed' }),
    requires: ['orders.read', 'orders.update_status'],
    as: 'staff',
    status: 200,
    schema: adminOrderResponseSchema,
  },
  'POST /admin/orders/:orderNumber/cod-collection': {
    method: 'post',
    path: (s) => `/admin/orders/${s.orders.delivered.orderNumber}/cod-collection`,
    body: (s) => ({ amountMinor: s.orders.delivered.totalMinor }),
    requires: ['orders.read', 'payments.collect'],
    as: 'staff',
    status: 200,
    schema: adminOrderResponseSchema,
  },
  'GET /admin/customers': {
    method: 'get',
    path: () => '/admin/customers',
    requires: ['customers.read'],
    as: 'staff',
    status: 200,
    schema: customerListResponseSchema,
  },
  'GET /admin/customers/:customerId': {
    method: 'get',
    path: (s) => `/admin/customers/${s.users.customer.id}`,
    requires: ['customers.read'],
    as: 'staff',
    status: 200,
    schema: customerResponseSchema,
  },
  'POST /admin/customers/:customerId/status': {
    method: 'post',
    path: (s) => `/admin/customers/${s.users.customer.id}/status`,
    body: () => ({ status: 'suspended', reason: 'Repeated fake orders' }),
    requires: ['customers.read', 'customers.update'],
    as: 'admin',
    status: 200,
    schema: customerResponseSchema,
  },
  'GET /admin/staff': {
    method: 'get',
    path: () => '/admin/staff',
    requires: [],
    anyOf: ['staff.roles.assign', 'staff.permissions.manage'],
    as: 'admin',
    status: 200,
    schema: staffListResponseSchema,
  },
  'POST /admin/staff/invitations': {
    method: 'post',
    path: () => '/admin/staff/invitations',
    body: () => ({ email: 'new.staff@example.com', role: 'staff' }),
    requires: ['staff.invite'],
    // Only the owner creates system users.
    as: 'owner',
    status: 201,
    schema: staffInvitationResponseSchema,
  },
  'POST /admin/staff/:userId/invitation': {
    method: 'post',
    path: (s) => `/admin/staff/${pendingInvitee(s)}/invitation`,
    requires: ['staff.invite'],
    as: 'admin',
    status: 200,
    schema: staffInvitationResendResponseSchema,
  },
  'PUT /admin/staff/:userId/permissions': {
    method: 'put',
    path: (s) => `/admin/staff/${s.users.staff.id}/permissions`,
    body: () => ({ permission: 'orders.cancel', effect: 'grant' }),
    requires: ['staff.permissions.manage'],
    as: 'admin',
    status: 200,
    schema: staffMemberResponseSchema,
  },
  'PUT /admin/users/:userId/role': {
    method: 'put',
    path: (s) => `/admin/users/${s.users.customer.id}/role`,
    body: () => ({ role: 'staff' }),
    requires: ['staff.roles.assign'],
    // Only the owner assigns roles.
    as: 'owner',
    status: 200,
    schema: assignRoleResponseSchema,
  },
  'GET /moderator/queue': {
    method: 'get',
    path: () => '/moderator/queue',
    requires: ['content.approve'],
    as: 'moderator',
    status: 200,
    schema: moderationTaskListResponseSchema,
  },
  'GET /moderator/tasks/:taskId': {
    method: 'get',
    path: (s) => `/moderator/tasks/${s.tasks.assigned.id}`,
    requires: ['content.approve'],
    as: 'moderator',
    status: 200,
    schema: moderationTaskResponseSchema,
  },
  'POST /moderator/tasks/:taskId/decision': {
    method: 'post',
    path: (s) => `/moderator/tasks/${s.tasks.assigned.id}/decision`,
    body: () => ({ decision: 'approved' }),
    requires: ['content.approve'],
    as: 'moderator',
    status: 200,
    schema: moderationTaskResponseSchema,
  },
  'GET /admin/moderation': {
    method: 'get',
    path: () => '/admin/moderation',
    requires: ['moderation.assign'],
    as: 'admin',
    status: 200,
    schema: moderationTaskListResponseSchema,
  },
  'GET /admin/moderation/reviewers': {
    method: 'get',
    path: () => '/admin/moderation/reviewers',
    requires: ['moderation.assign'],
    as: 'admin',
    status: 200,
    schema: moderationReviewerListResponseSchema,
  },
  'GET /admin/moderation/:taskId': {
    method: 'get',
    path: (s) => `/admin/moderation/${s.tasks.assigned.id}`,
    requires: ['moderation.assign'],
    as: 'admin',
    status: 200,
    schema: moderationTaskResponseSchema,
  },
  'POST /admin/moderation/:taskId/assignment': {
    method: 'post',
    path: (s) => `/admin/moderation/${s.tasks.unassigned.id}/assignment`,
    body: (s) => ({ moderatorId: s.users.otherModerator.id }),
    requires: ['moderation.assign'],
    as: 'admin',
    status: 200,
    schema: moderationTaskResponseSchema,
  },
  'POST /admin/moderation/:taskId/withdraw': {
    method: 'post',
    path: (s) => `/admin/moderation/${s.tasks.assigned.id}/withdraw`,
    requires: ['products.update'],
    as: 'staff',
    status: 200,
    schema: moderationTaskResponseSchema,
  },
  'GET /admin/audit-log': {
    method: 'get',
    path: () => '/admin/audit-log',
    requires: ['audit_logs.read'],
    as: 'admin',
    status: 200,
    schema: auditLogResponseSchema,
  },
  'GET /admin/analytics/sales': {
    method: 'get',
    path: () => '/admin/analytics/sales?days=7',
    requires: ['finance.read'],
    as: 'admin',
    status: 200,
    schema: salesOverviewResponseSchema,
  },
  'GET /admin/slugs/availability': {
    method: 'get',
    path: () => '/admin/slugs/availability?kind=product&slug=desk-lamp',
    requires: ['products.read'],
    as: 'moderator',
    status: 200,
    schema: slugAvailabilityResponseSchema,
  },
  'GET /admin/media': {
    method: 'get',
    path: () => '/admin/media',
    requires: [],
    anyOf: ['settings.manage', 'products.update'],
    as: 'owner',
    storage: true,
    status: 200,
    schema: mediaListResponseSchema,
  },
  'POST /admin/media': {
    method: 'post',
    path: () => '/admin/media?alt=Shop%20front',
    raw: { contentType: 'image/jpeg', bytes: () => jpeg },
    requires: ['settings.manage'],
    as: 'owner',
    storage: true,
    status: 201,
    schema: mediaAssetResponseSchema,
  },
  'PATCH /admin/media/:id': {
    method: 'patch',
    path: (s) => `/admin/media/${seedMediaAsset(s)}`,
    body: () => ({ alt: 'Counter' }),
    requires: ['settings.manage'],
    as: 'owner',
    storage: true,
    status: 200,
    schema: mediaAssetResponseSchema,
  },
  'DELETE /admin/media/:id': {
    method: 'delete',
    path: (s) => `/admin/media/${seedMediaAsset(s)}`,
    requires: ['settings.manage'],
    as: 'owner',
    storage: true,
    status: 204,
    schema: z.object({}),
  },
  'GET /admin/analytics/overview': {
    method: 'get',
    path: () => '/admin/analytics/overview?from=2026-10-19&to=2026-10-25',
    requires: ['finance.read'],
    as: 'admin',
    status: 200,
    schema: analyticsOverviewResponseSchema,
  },
  'GET /admin/dashboard': {
    method: 'get',
    path: () => '/admin/dashboard',
    requires: [],
    anyOf: ['admin_workspace.access', 'moderator_workspace.access'],
    as: 'owner',
    status: 200,
    schema: dashboardResponseSchema,
  },
  'GET /admin/settings/delivery-charges': {
    method: 'get',
    path: () => '/admin/settings/delivery-charges',
    requires: ['settings.manage'],
    as: 'owner',
    status: 200,
    schema: deliveryChargeListResponseSchema,
  },
  'PUT /admin/settings/delivery-charges/:zone': {
    method: 'put',
    path: () => '/admin/settings/delivery-charges/inside_dhaka',
    body: () => ({ amountMinor: 6_000 }),
    requires: ['settings.manage'],
    as: 'owner',
    status: 200,
    schema: deliveryChargeResponseSchema,
  },
  'PUT /admin/settings/sales-target': {
    method: 'put',
    path: () => '/admin/settings/sales-target',
    body: () => ({ targetMinor: 5_000_000 }),
    requires: ['settings.manage'],
    as: 'owner',
    status: 200,
    schema: salesTargetResponseSchema,
  },
  'GET /admin/roles': {
    method: 'get',
    path: () => '/admin/roles',
    requires: [],
    anyOf: ['staff.roles.assign', 'staff.permissions.manage'],
    as: 'admin',
    status: 200,
    schema: adminRolesResponseSchema,
  },
  'GET /admin/audit-log (filtered)': {
    method: 'get',
    path: () => '/admin/audit-log?from=2026-10-01&to=2026-10-31&q=order',
    requires: ['audit_logs.read'],
    as: 'admin',
    status: 200,
    schema: auditLogResponseSchema,
  },
  'GET /admin/settings/store': {
    method: 'get',
    path: () => '/admin/settings/store',
    requires: ['settings.manage'],
    as: 'owner',
    status: 200,
    schema: storeSettingsResponseSchema,
  },
  'PUT /admin/settings/store': {
    method: 'put',
    path: () => '/admin/settings/store',
    body: () => ({ returnWindowDays: 10, cartInactivityMinutes: 180, repeatOrderThreshold: 3 }),
    requires: ['settings.manage'],
    as: 'owner',
    status: 200,
    schema: storeSettingsResponseSchema,
  },
  'POST /admin/coupons': {
    method: 'post',
    path: () => '/admin/coupons',
    body: () => ({ code: 'EID10', kind: 'percent', value: 10 }),
    requires: ['coupons.update', 'coupons.create'],
    as: 'admin',
    status: 201,
    schema: adminCouponResponseSchema,
  },
  'GET /admin/site-pages': {
    method: 'get',
    path: () => '/admin/site-pages',
    requires: ['settings.manage'],
    as: 'owner',
    status: 200,
    schema: adminSitePageListResponseSchema,
  },
  'PUT /admin/site-pages/:slug': {
    method: 'put',
    path: () => '/admin/site-pages/about',
    body: () => ({ title: 'About us', body: 'We sell lamps.', isPublished: true }),
    requires: ['settings.manage'],
    as: 'owner',
    status: 200,
    schema: adminSitePageResponseSchema,
  },
  'GET /admin/navigation': {
    method: 'get',
    path: () => '/admin/navigation',
    requires: ['settings.manage'],
    as: 'owner',
    status: 200,
    schema: menuItemListResponseSchema,
  },
  'POST /admin/navigation': {
    method: 'post',
    path: () => '/admin/navigation',
    body: () => ({ menu: 'header', label: 'Eid sale', href: '/products?sort=newest' }),
    requires: ['settings.manage'],
    as: 'owner',
    status: 201,
    schema: menuItemResponseSchema,
  },
  'PUT /admin/navigation/order': {
    method: 'put',
    path: () => '/admin/navigation/order',
    body: () => ({ menu: 'footer_help', ids: [] }),
    requires: ['settings.manage'],
    as: 'owner',
    status: 200,
    schema: menuItemListResponseSchema,
  },
  'PUT /admin/navigation/:id': {
    method: 'put',
    path: (s) => `/admin/navigation/${seedMenuItem(s).id}`,
    body: () => ({ menu: 'header', label: 'Winter sale', href: 'https://blog.nilzora.example/' }),
    requires: ['settings.manage'],
    as: 'owner',
    status: 200,
    schema: menuItemResponseSchema,
  },
  'DELETE /admin/navigation/:id': {
    method: 'delete',
    path: (s) => `/admin/navigation/${seedMenuItem(s).id}`,
    requires: ['settings.manage'],
    as: 'owner',
    status: 204,
    schema: z.unknown(),
  },
  'GET /admin/homepage': {
    method: 'get',
    path: () => '/admin/homepage',
    requires: ['settings.manage'],
    as: 'owner',
    status: 200,
    schema: adminHomepageResponseSchema,
  },
  'PUT /admin/homepage': {
    method: 'put',
    path: () => '/admin/homepage',
    body: () => HOMEPAGE_BODY,
    requires: ['settings.manage'],
    as: 'owner',
    status: 200,
    schema: adminHomepageResponseSchema,
  },
  // One preview per report kind, each behind its own permission.
  ...Object.fromEntries(
    REPORT_KINDS.map((kind): [string, RouteCase] => {
      const permission = REPORT_DEFINITIONS[kind].permission;
      const staffMay = ['orders.read', 'products.read', 'customers.read'].includes(permission);
      return [
        `GET /admin/reports/${kind}/preview`,
        {
          method: 'get',
          path: () => `/admin/reports/${kind}/preview?from=2026-10-01&to=2026-10-31`,
          requires: [permission],
          as: staffMay ? 'staff' : 'admin',
          status: 200,
          schema: reportPreviewResponseSchema,
        },
      ];
    }),
  ),
  'GET /admin/reports/:kind/export': {
    method: 'get',
    path: () => '/admin/reports/orders/export?format=csv&from=2026-10-01&to=2026-10-31',
    requires: ['orders.read'],
    as: 'staff',
    status: 200,
    schema: z.unknown(),
  },
  'GET /admin/orders/:orderNumber/invoice.pdf': {
    method: 'get',
    path: (s) => `/admin/orders/${s.orders.pending.orderNumber}/invoice.pdf`,
    requires: ['orders.read'],
    as: 'staff',
    status: 200,
    schema: z.unknown(),
  },
  'GET /admin/orders/:orderNumber/packing-slip.pdf': {
    method: 'get',
    path: (s) => `/admin/orders/${s.orders.pending.orderNumber}/packing-slip.pdf`,
    requires: ['orders.read'],
    as: 'staff',
    status: 200,
    schema: z.unknown(),
  },
  'POST /admin/exports': {
    method: 'post',
    path: () => '/admin/exports',
    body: () => ({
      kind: 'customers',
      format: 'xlsx',
      filters: { from: '2026-10-01', to: '2026-10-31' },
    }),
    requires: ['customers.read'],
    as: 'staff',
    status: 202,
    schema: exportJobResponseSchema,
  },
  'GET /admin/exports': {
    method: 'get',
    path: () => '/admin/exports',
    requires: [],
    anyOf: ['admin_workspace.access', 'moderator_workspace.access'],
    as: 'owner',
    status: 200,
    schema: exportJobListResponseSchema,
  },
  'GET /admin/exports/:id': {
    method: 'get',
    path: (s) => `/admin/exports/${s.admin.exports.seedDoneJob(s.users.owner.id)}`,
    requires: [],
    anyOf: ['admin_workspace.access', 'moderator_workspace.access'],
    as: 'owner',
    status: 200,
    schema: exportJobResponseSchema,
  },
  'GET /admin/exports/:id/download': {
    method: 'get',
    path: (s) => `/admin/exports/${s.admin.exports.seedDoneJob(s.users.owner.id)}/download`,
    requires: [],
    anyOf: ['admin_workspace.access', 'moderator_workspace.access'],
    as: 'owner',
    status: 200,
    schema: z.unknown(),
  },
};

const CASES = Object.entries(ROUTES);
const MUTATIONS = CASES.filter(([, route]) => route.method !== 'get');
const READS = CASES.filter(([, route]) => route.method === 'get');

function send(setup: AdminSetup, route: RouteCase, who?: Who) {
  if (route.raw) {
    return setup
      .call(route.method, route.path(setup), who)
      .set('Content-Type', route.raw.contentType)
      .send(route.raw.bytes());
  }
  const body =
    route.method === 'get' || route.method === 'delete' ? undefined : (route.body?.(setup) ?? {});
  return setup.call(route.method, route.path(setup), who, body);
}

/** A fresh fixture store for one route (with media storage when the route needs it). */
function setupFor(route: RouteCase, env: Record<string, string> = {}): AdminSetup {
  return adminSetup(env, { storage: route.storage });
}

describe.each(CASES)('%s', (_name, route) => {
  it('serves a permitted account in the contract shape, uncached', async () => {
    const setup = setupFor(route);
    const response = await send(setup, route, route.as);

    expect(response.status, JSON.stringify(response.body)).toBe(route.status);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(route.schema.safeParse(response.body).success).toBe(true);
  });

  it('refuses anonymous callers with 401 before anything else', async () => {
    const setup = setupFor(route);
    const response = await send(setup, route);

    expect(response.status).toBe(401);
    expect(errorOf(response.body).code).toBe('unauthenticated');
    expect(response.headers['www-authenticate']).toMatch(/^Bearer/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(setup.admin.calls).toEqual([]);
  });

  it('refuses customers with 403', async () => {
    const setup = setupFor(route);
    const response = await send(setup, route, 'customer');

    expect(response.status).toBe(403);
    expect(errorOf(response.body).code).toBe('forbidden');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(setup.admin.calls).toEqual([]);
  });

  it('refuses the account once it is suspended', async () => {
    const setup = setupFor(route);
    setup.users[route.as].status = 'suspended';
    const response = await send(setup, route, route.as);

    expect(response.status).toBe(403);
    expect(errorOf(response.body).code).toBe('account_suspended');
    expect(setup.admin.calls).toEqual([]);
  });

  it.each(route.requires)('refuses with 403 when %s is denied', async (permission) => {
    const setup = setupFor(route);
    setup.deny(route.as, permission);
    const response = await send(setup, route, route.as);

    expect(response.status).toBe(403);
    expect(errorOf(response.body).code).toBe('forbidden');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(setup.admin.calls).toEqual([]);
  });

  if (route.anyOf) {
    const alternatives = route.anyOf;
    it('refuses with 403 only when every alternative permission is denied', async () => {
      const setup = setupFor(route);
      setup.deny(route.as, ...alternatives);
      const refused = await send(setup, route, route.as);
      expect(refused.status).toBe(403);
      expect(errorOf(refused.body).code).toBe('forbidden');

      for (const kept of alternatives) {
        const partial = setupFor(route);
        partial.deny(route.as, ...alternatives.filter((permission) => permission !== kept));
        expect((await send(partial, route, route.as)).status, kept).toBe(route.status);
      }
    });
  }
});

describe('default role boundaries', () => {
  it.each<[string, Who, number]>([
    ['POST /admin/products/:productId/status', 'staff', 403],
    ['POST /admin/categories', 'staff', 403],
    ['GET /admin/orders', 'moderator', 403],
    ['GET /admin/customers', 'moderator', 403],
    ['POST /admin/products', 'moderator', 403],
    ['GET /admin/moderation', 'staff', 403],
    ['GET /moderator/queue', 'staff', 403],
    ['POST /admin/staff/invitations', 'staff', 403],
    ['GET /admin/audit-log', 'staff', 403],
    ['GET /admin/analytics/sales', 'staff', 403],
    ['GET /admin/analytics/overview', 'staff', 403],
    ['GET /admin/slugs/availability', 'customer', 403],
    ['GET /admin/media', 'staff', 200],
    ['GET /admin/media', 'moderator', 403],
    ['POST /admin/media', 'admin', 403],
    ['PATCH /admin/media/:id', 'admin', 403],
    ['DELETE /admin/media/:id', 'staff', 403],
    ['GET /admin/reports/sales/preview', 'staff', 403],
    ['GET /admin/reports/audit_logs/preview', 'staff', 403],
    ['GET /admin/reports/orders/preview', 'moderator', 403],
    ['GET /admin/reports/customers/preview', 'moderator', 403],
    ['GET /admin/reports/moderation/preview', 'staff', 403],
    ['GET /admin/orders/:orderNumber/invoice.pdf', 'moderator', 403],
    ['GET /admin/exports', 'customer', 403],
    ['GET /admin/roles', 'staff', 403],
    ['GET /admin/settings/store', 'admin', 403],
    ['PUT /admin/settings/store', 'admin', 403],
    ['POST /admin/coupons', 'staff', 403],
    ['GET /admin/site-pages', 'admin', 403],
    ['PUT /admin/site-pages/:slug', 'staff', 403],
    ['GET /admin/navigation', 'staff', 403],
    ['POST /admin/navigation', 'admin', 403],
    ['GET /admin/homepage', 'moderator', 403],
    ['PUT /admin/homepage', 'admin', 403],
    ['GET /admin/analytics/overview', 'moderator', 403],
    ['PUT /admin/settings/sales-target', 'admin', 403],
    ['PUT /admin/settings/sales-target', 'staff', 403],
    ['GET /admin/settings/delivery-charges', 'admin', 403],
    ['PUT /admin/settings/delivery-charges/:zone', 'admin', 403],
    ['GET /admin/dashboard', 'moderator', 200],
    ['GET /admin/dashboard', 'staff', 200],
    ['GET /admin/inventory-movements', 'moderator', 403],
    ['POST /admin/staff/:userId/invitation', 'staff', 403],
  ])('%s as %s → %i', async (name, who, status) => {
    const route = ROUTES[name];
    if (!route) throw new Error(`unknown route ${name}`);
    const setup = setupFor(route);

    expect((await send(setup, route, who)).status).toBe(status);
  });
});

describe('admin rate limit', () => {
  it.each(MUTATIONS)('limits %s per client, answering 429 uncached', async (_name, route) => {
    const setup = setupFor(route, { ADMIN_RATE_LIMIT_MAX: '1' });
    await send(setup, route, route.as);
    const limited = await send(setup, route, route.as);

    expect(limited.status).toBe(429);
    expect(errorOf(limited.body).code).toBe('rate_limited');
    expect(limited.headers['cache-control']).toBe('no-store');
  });

  it('shares one budget across every admin change', async () => {
    const setup = adminSetup({ ADMIN_RATE_LIMIT_MAX: '2' });
    const [first, second, third] = MUTATIONS.slice(0, 3).map(([, route]) => route);
    if (!first || !second || !third) throw new Error('expected admin mutations');
    await send(setup, first, first.as);
    await send(setup, second, second.as);

    expect((await send(setup, third, third.as)).status).toBe(429);
  });

  it('does not count reads', async () => {
    const setup = adminSetup({ ADMIN_RATE_LIMIT_MAX: '1' }, { storage: true });
    for (const [name, route] of READS) {
      expect((await send(setup, route, route.as)).status, name).toBe(route.status);
    }
  });
});
