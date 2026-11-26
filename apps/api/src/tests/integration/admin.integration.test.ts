import { randomUUID } from 'node:crypto';
import {
  adminCategoryListResponseSchema,
  adminCategoryResponseSchema,
  adminOrderListResponseSchema,
  adminOrderResponseSchema,
  adminProductListResponseSchema,
  adminProductResponseSchema,
  apiErrorBodySchema,
  auditLogResponseSchema,
  authSessionSchema,
  cartQuoteResponseSchema,
  customerResponseSchema,
  dashboardResponseSchema,
  deliveryChargeListResponseSchema,
  inventoryMovementListResponseSchema,
  meResponseSchema,
  moderationReviewerListResponseSchema,
  moderationTaskListResponseSchema,
  moderationTaskResponseSchema,
  PERMISSIONS,
  placeOrderResponseSchema,
  productResponseSchema,
  salesOverviewResponseSchema,
  staffInvitationResendResponseSchema,
  staffInvitationResponseSchema,
  staffListResponseSchema,
  staffMemberResponseSchema,
  type AppRole,
  type SalesOverview,
} from '@nilzora/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApp } from '../../app';
import { createLogger } from '../../logging/logger';
import { createSupabaseAdminAccountStore } from '../../modules/admin/accounts-store';
import { createSupabaseAdminCatalogStore } from '../../modules/admin/catalog-store';
import { createSupabaseModerationStore } from '../../modules/admin/moderation-store';
import { createSupabaseAdminOrderStore } from '../../modules/admin/orders-store';
import { createSupabaseAdminReportStore } from '../../modules/admin/reports-store';
import { createSupabaseAdminCouponStore } from '../../modules/admin/coupons-store';
import { createSupabaseAdminDiscountStore } from '../../modules/admin/discounts-store';
import { createSupabaseReviewStore } from '../../modules/reviews/store';
import { createSupabaseAddressStore } from '../../modules/addresses/store';
import { createSupabaseAuthGateway } from '../../modules/auth/gateway';
import { createSupabaseCartStore } from '../../modules/cart/store';
import { createSupabaseCatalogStore } from '../../modules/catalog/store';
import { createSupabaseOrderStore } from '../../modules/orders/store';
import { createSupabaseAccountStore } from '../../modules/users/accounts';
import { createSupabaseClients } from '../../supabase/clients';
import { testConfig } from '../helpers';
import { ROLE_PERMISSIONS } from '../role-permissions';

/*
 * The admin and moderator API against the local Supabase stack: real permissions
 * (role defaults, grants and denials read by my_access on every request), real
 * SECURITY DEFINER functions that check the caller again, real RLS, the real
 * invitation email (Mailpit). Each run creates its own accounts (@example.com),
 * category, products and orders, relies on no seed data, and removes everything it
 * created afterwards. Delivery charges are only added when missing, never changed.
 */

const local = inject('supabase');
const config = testConfig({
  SUPABASE_URL: local.url,
  SUPABASE_PUBLISHABLE_KEY: local.publishableKey,
  SUPABASE_SECRET_KEY: local.secretKey,
  RATE_LIMIT_MAX: '10000',
  AUTH_RATE_LIMIT_MAX: '10000',
  ORDER_RATE_LIMIT_MAX: '10000',
  ADMIN_RATE_LIMIT_MAX: '10000',
});
const clients = createSupabaseClients(config.supabase);
const app = createApp({
  config,
  logger: createLogger(config),
  auth: {
    gateway: createSupabaseAuthGateway(clients),
    accounts: createSupabaseAccountStore(clients),
  },
  commerce: {
    catalog: createSupabaseCatalogStore(clients),
    cart: createSupabaseCartStore(clients),
    addresses: createSupabaseAddressStore(clients),
    orders: createSupabaseOrderStore(clients),
  },
  admin: {
    catalog: createSupabaseAdminCatalogStore(clients),
    orders: createSupabaseAdminOrderStore(clients),
    accounts: createSupabaseAdminAccountStore(clients),
    moderation: createSupabaseModerationStore(clients),
    reports: createSupabaseAdminReportStore(clients),
    coupons: createSupabaseAdminCouponStore(clients),
    discounts: createSupabaseAdminDiscountStore(clients),
    reviews: createSupabaseReviewStore(clients),
  },
});

const run = randomUUID().slice(0, 8);
const PASSWORD = 'shopping2026';
const emailFor = (label: string) => `it-${run}-${label}@example.com`;
const slugFor = (label: string) => `it-${run}-${label}`;
const skuFor = (label: string) => `IT-${run.toUpperCase()}-${label.toUpperCase()}`;

const DHAKA = {
  recipientName: 'Rahima Khatun',
  phone: '01712-345678',
  division: 'Dhaka',
  district: 'Dhaka',
  area: 'Dhanmondi',
  addressLine: 'House 12, Road 5',
} as const;

type Who = 'owner' | 'admin' | 'staff' | 'moderator' | 'otherModerator' | 'customer' | 'buyer';
const ROLES: Record<Who, AppRole> = {
  owner: 'super_admin',
  admin: 'admin',
  staff: 'staff',
  moderator: 'moderator',
  otherModerator: 'moderator',
  customer: 'customer',
  buyer: 'customer',
};

const accounts = {} as Record<Who, { id: string; email: string; token: string }>;
const created = {
  categories: [] as string[],
  products: [] as string[],
  zones: [] as string[],
};
/** Sales before this run placed any order (admin_sales_overview covers every order). */
let baseline: SalesOverview;

function errorOf(body: unknown) {
  return apiErrorBodySchema.parse(body).error;
}

function call(method: 'get' | 'post' | 'put', path: string, who?: Who, body?: object) {
  let pending = request(app)[method](`/api/v1${path}`);
  if (who) pending = pending.set('Authorization', `Bearer ${accounts[who].token}`);
  return body === undefined ? pending : pending.send(body);
}

async function usersOfThisRun() {
  const { data, error } = await clients.admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.filter((user) => user.email?.startsWith(`it-${run}-`));
}

async function login(email: string, password = PASSWORD) {
  const response = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return authSessionSchema.parse(response.body).accessToken;
}

/** A confirmed account whose role is seeded by the service role (a trusted fixture write). */
async function account(who: Who) {
  const email = emailFor(who.toLowerCase());
  const { data, error } = await clients.admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `Test ${who}` },
  });
  if (error) throw error;
  if (ROLES[who] !== 'customer') {
    const seeded = await clients.admin
      .from('user_roles')
      .update({ role: ROLES[who] })
      .eq('user_id', data.user.id);
    if (seeded.error) throw seeded.error;
  }
  accounts[who] = { id: data.user.id, email, token: await login(email) };
}

async function overview(): Promise<SalesOverview> {
  const response = await call('get', '/admin/analytics/sales?days=30', 'owner');
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return salesOverviewResponseSchema.parse(response.body).overview;
}

async function createProduct(label: string, initialStock: number, priceMinor = 10_000) {
  const response = await call('post', '/admin/products', 'staff', {
    categoryId: created.categories[0],
    slug: slugFor(label),
    sku: skuFor(label),
    name: `Integration ${label} ${run}`,
    priceMinor,
    maxOrderQuantity: 5,
    initialStock,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const { product } = adminProductResponseSchema.parse(response.body);
  created.products.push(product.id);
  return product;
}

/** Takes a draft through review (staff submit, admin assign, moderator approve) and publishes it. */
async function approveAndPublish(productId: string) {
  const submitted = await call('post', `/admin/products/${productId}/submit`, 'staff');
  const taskId = adminProductResponseSchema.parse(submitted.body).product.latestReview?.taskId;
  if (!taskId) throw new Error('the product was not submitted');
  await call('post', `/admin/moderation/${taskId}/assignment`, 'admin', {
    moderatorId: accounts.moderator.id,
  }).expect(200);
  await call('post', `/moderator/tasks/${taskId}/decision`, 'moderator', {
    decision: 'approved',
  }).expect(200);
  await call('post', `/admin/products/${productId}/status`, 'admin', { status: 'active' }).expect(
    200,
  );
}

async function placeOrder(who: Who, productId: string, quantity: number) {
  const address = await call('post', '/me/addresses', who, DHAKA);
  expect(address.status, JSON.stringify(address.body)).toBe(201);
  const addressId = (address.body as { address: { id: string } }).address.id;
  const items = [{ productId, quantity }];
  const quote = await call('post', '/checkout/quote', who, { items, addressId });
  const { totalMinor } = cartQuoteResponseSchema.parse(quote.body).quote;
  const placed = await call('post', '/orders', who, {
    idempotencyKey: randomUUID(),
    addressId,
    items,
    expectedTotalMinor: totalMinor,
  });
  expect(placed.status, JSON.stringify(placed.body)).toBe(201);
  return placeOrderResponseSchema.parse(placed.body).order;
}

async function stockOf(productId: string): Promise<number> {
  const { data, error } = await clients.admin
    .from('products')
    .select('stock_quantity')
    .eq('id', productId)
    .single();
  if (error) throw error;
  return data.stock_quantity;
}

/** Reads the invitation link from the email the local Auth server actually sent. */
async function invitationLink(email: string): Promise<URL> {
  const query = encodeURIComponent(`to:"${email}"`);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const search = (await (
      await fetch(`${local.mailUrl}/api/v1/search?query=${query}`)
    ).json()) as { messages: { ID: string }[] };
    const id = search.messages[0]?.ID;
    if (id) {
      const message = (await (await fetch(`${local.mailUrl}/api/v1/message/${id}`)).json()) as {
        HTML: string;
      };
      const href = /href="([^"]*\/accept-invite[^"]*)"/.exec(message.HTML)?.[1];
      if (href) return new URL(href.replaceAll('&amp;', '&'));
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('No invitation email arrived');
}

/** Every invitation link the local Auth server emailed to an address, once `count` arrived. */
async function invitationLinks(email: string, count: number): Promise<URL[]> {
  const query = encodeURIComponent(`to:"${email}"`);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const search = (await (
      await fetch(`${local.mailUrl}/api/v1/search?query=${query}`)
    ).json()) as { messages: { ID: string }[] };
    if (search.messages.length >= count) {
      const links: URL[] = [];
      for (const { ID } of search.messages) {
        const message = (await (await fetch(`${local.mailUrl}/api/v1/message/${ID}`)).json()) as {
          HTML: string;
        };
        const href = /href="([^"]*\/accept-invite[^"]*)"/.exec(message.HTML)?.[1];
        if (href) links.push(new URL(href.replaceAll('&amp;', '&')));
      }
      if (links.length >= count) return links;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Fewer than ${count} invitation emails arrived`);
}

beforeAll(async () => {
  for (const who of Object.keys(ROLES) as Who[]) await account(who);

  // Add the delivery charges only where none is set; existing values stay untouched.
  const inserted = await clients.admin
    .from('delivery_charges')
    .upsert(
      [
        { zone: 'inside_dhaka', amount_minor: 7000 },
        { zone: 'outside_dhaka', amount_minor: 13000 },
      ],
      { onConflict: 'zone', ignoreDuplicates: true },
    )
    .select('zone');
  if (inserted.error) throw inserted.error;
  created.zones = inserted.data.map((row) => row.zone);

  const category = await call('post', '/admin/categories', 'admin', {
    slug: slugFor('category'),
    name: `Integration ${run}`,
    sortOrder: 990,
  });
  expect(category.status, JSON.stringify(category.body)).toBe(201);
  created.categories.push(adminCategoryResponseSchema.parse(category.body).category.id);

  baseline = await overview();
});

afterAll(async () => {
  const userIds = (await usersOfThisRun()).map((user) => user.id);
  // Also anything saved whose answer was lost (a 503 after the commit), found by its slug.
  for (const table of ['products', 'categories'] as const) {
    const leftovers = await clients.admin.from(table).select('id').like('slug', `it-${run}-%`);
    if (leftovers.error) throw leftovers.error;
    const known = table === 'products' ? created.products : created.categories;
    for (const { id } of leftovers.data) if (!known.includes(id)) known.push(id);
  }

  // Dependency order: orders (items and history cascade), the stock ledger of this run's
  // products, products (their reviews and review events cascade), categories, the audit
  // entries of this run's accounts, any delivery charge this run added, then the accounts
  // (profiles, roles and permission overrides cascade).
  if (userIds.length > 0) {
    const orders = await clients.admin.from('orders').delete().in('user_id', userIds);
    if (orders.error) throw orders.error;
  }
  if (created.products.length > 0) {
    const ledger = await clients.admin
      .from('inventory_movements')
      .delete()
      .in('product_id', created.products);
    if (ledger.error) throw ledger.error;
    const products = await clients.admin.from('products').delete().in('id', created.products);
    if (products.error) throw products.error;
  }
  if (created.categories.length > 0) {
    const categories = await clients.admin.from('categories').delete().in('id', created.categories);
    if (categories.error) throw categories.error;
  }
  if (userIds.length > 0) {
    const audit = await clients.admin.from('audit_log').delete().in('actor_id', userIds);
    if (audit.error) throw audit.error;
  }
  if (created.zones.length > 0) {
    const zones = created.zones as ('inside_dhaka' | 'outside_dhaka')[];
    await clients.admin.from('delivery_charges').delete().in('zone', zones);
  }
  const leftovers: string[] = [];
  for (const userId of userIds) {
    const { error } = await clients.admin.auth.admin.deleteUser(userId);
    if (error) leftovers.push(userId);
  }
  if (leftovers.length > 0) throw new Error(`${leftovers.length} test users could not be deleted`);
});

describe('permissions held in the database', () => {
  it('has the role defaults the unit-test fakes assume', async () => {
    const { data, error } = await clients.admin.from('role_permissions').select('role, permission');
    if (error) throw error;
    const actual: Record<string, string[]> = {};
    for (const row of data) (actual[row.role] ??= []).push(row.permission);

    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      expect((actual[role] ?? []).sort(), role).toEqual([...permissions].sort());
    }
    const names = await clients.admin.from('permissions').select('name');
    if (names.error) throw names.error;
    expect(names.data.map((row) => row.name).sort()).toEqual([...PERMISSIONS].sort());
  });

  it('serves each role only its own workspace routes', async () => {
    const expectations: [string, Who | undefined, number][] = [
      ['/admin/products', undefined, 401],
      ['/admin/products', 'customer', 403],
      ['/moderator/queue', 'customer', 403],
      ['/admin/dashboard', 'customer', 403],
      ['/admin/products', 'moderator', 200],
      ['/admin/orders', 'moderator', 403],
      ['/admin/customers', 'moderator', 403],
      ['/moderator/queue', 'moderator', 200],
      ['/admin/orders', 'staff', 200],
      ['/moderator/queue', 'staff', 403],
      ['/admin/moderation', 'staff', 403],
      ['/admin/audit-log', 'staff', 403],
      ['/admin/staff', 'staff', 403],
      ['/admin/analytics/sales', 'staff', 403],
      ['/admin/settings/delivery-charges', 'admin', 403],
      ['/admin/settings/delivery-charges', 'owner', 200],
      ['/admin/audit-log', 'admin', 200],
    ];
    for (const [path, who, status] of expectations) {
      const response = await call('get', path, who);
      expect(response.status, `${who ?? 'anonymous'} ${path}`).toBe(status);
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });

  it('refuses a privileged function called directly with a staff token (the database re-checks)', async () => {
    const asStaff = clients.asUser(accounts.staff.token);
    const publish = await asStaff.rpc('admin_set_product_status', {
      p_product_id: randomUUID(),
      p_status: 'active',
    });
    const assignRole = await asStaff.rpc('assign_user_role', {
      p_actor_id: accounts.owner.id,
      p_target_id: accounts.staff.id,
      p_role: 'super_admin',
    });

    expect(publish.error?.code).toBe('NZ403');
    expect(assignRole.error?.code).toBe('42501');
  });
});

describe('product moderation and publishing', () => {
  it('runs create → submit → assign → decide → publish, with every refusal on the way', async () => {
    const draft = await createProduct('kettle', 10);
    expect(draft).toMatchObject({ status: 'draft', moderationStatus: 'not_submitted' });

    // Nothing is published before its content is approved; staff cannot publish at all.
    const staffPublish = await call('post', `/admin/products/${draft.id}/status`, 'staff', {
      status: 'active',
    });
    expect(staffPublish.status).toBe(403);
    const early = await call('post', `/admin/products/${draft.id}/status`, 'admin', {
      status: 'active',
    });
    expect(early.status).toBe(409);
    expect(errorOf(early.body).code).toBe('product_not_approved');

    const submitted = await call('post', `/admin/products/${draft.id}/submit`, 'staff');
    expect(submitted.status).toBe(200);
    const taskId = adminProductResponseSchema.parse(submitted.body).product.latestReview?.taskId;
    if (!taskId) throw new Error('no review was opened');

    const editWhilePending = await call('put', `/admin/products/${draft.id}`, 'staff', {
      categoryId: created.categories[0],
      slug: draft.slug,
      name: 'Renamed while under review',
      priceMinor: draft.priceMinor,
    });
    expect(editWhilePending.status).toBe(409);
    expect(errorOf(editWhilePending.body).code).toBe('product_under_review');

    // Unassigned: no moderator can see or decide it.
    const unassignedView = await call('get', `/moderator/tasks/${taskId}`, 'moderator');
    const unassignedDecision = await call(
      'post',
      `/moderator/tasks/${taskId}/decision`,
      'moderator',
      {
        decision: 'approved',
      },
    );
    expect(unassignedView.status).toBe(404);
    expect(unassignedDecision.status).toBe(404);

    // Only accounts that can review content may be assigned; the submitter (staff) cannot.
    const toSubmitter = await call('post', `/admin/moderation/${taskId}/assignment`, 'admin', {
      moderatorId: accounts.staff.id,
    });
    expect(toSubmitter.status).toBe(409);
    expect(errorOf(toSubmitter.body).code).toBe('review_not_assignable');

    const assigned = await call('post', `/admin/moderation/${taskId}/assignment`, 'admin', {
      moderatorId: accounts.moderator.id,
    });
    expect(assigned.status).toBe(200);
    expect(moderationTaskResponseSchema.parse(assigned.body).task.assignedTo).toMatchObject({
      id: accounts.moderator.id,
      email: accounts.moderator.email,
    });

    // Another moderator gets 404 from the API and from the database.
    const otherView = await call('get', `/moderator/tasks/${taskId}`, 'otherModerator');
    const otherDecision = await call(
      'post',
      `/moderator/tasks/${taskId}/decision`,
      'otherModerator',
      { decision: 'approved' },
    );
    const otherQueue = await call('get', '/moderator/queue', 'otherModerator');
    expect(otherView.status).toBe(404);
    expect(otherDecision.status).toBe(404);
    expect(
      moderationTaskListResponseSchema.parse(otherQueue.body).tasks.map((t) => t.id),
    ).not.toContain(taskId);

    const queue = await call('get', '/moderator/queue?status=pending', 'moderator');
    expect(moderationTaskListResponseSchema.parse(queue.body).tasks.map((t) => t.id)).toContain(
      taskId,
    );
    const shortNote = await call('post', `/moderator/tasks/${taskId}/decision`, 'moderator', {
      decision: 'rejected',
      note: 'No.',
    });
    expect(shortNote.status).toBe(400);

    const decided = await call('post', `/moderator/tasks/${taskId}/decision`, 'moderator', {
      decision: 'approved',
      note: 'Looks right.',
    });
    expect(decided.status).toBe(200);
    expect(moderationTaskResponseSchema.parse(decided.body).task).toMatchObject({
      status: 'approved',
      decidedBy: { id: accounts.moderator.id },
      product: { moderationStatus: 'approved' },
    });
    const again = await call('post', `/moderator/tasks/${taskId}/decision`, 'moderator', {
      decision: 'approved',
    });
    expect(again.status).toBe(409);
    expect(errorOf(again.body).code).toBe('review_closed');

    const published = await call('post', `/admin/products/${draft.id}/status`, 'admin', {
      status: 'active',
    });
    expect(published.status).toBe(200);
    expect(adminProductResponseSchema.parse(published.body).product.status).toBe('active');
    const shop = await request(app).get(`/api/v1/catalog/products/${draft.slug}`);
    expect(shop.status).toBe(200);
    expect(productResponseSchema.parse(shop.body).product.name).toBe(draft.name);

    // On sale: content is locked, while the price stays operational.
    const locked = await call('put', `/admin/products/${draft.id}`, 'staff', {
      categoryId: created.categories[0],
      slug: draft.slug,
      name: 'Renamed on sale',
      priceMinor: draft.priceMinor,
    });
    expect(locked.status).toBe(409);
    expect(errorOf(locked.body).code).toBe('product_content_locked');
    const staffReprice = await call('put', `/admin/products/${draft.id}`, 'staff', {
      categoryId: created.categories[0],
      slug: draft.slug,
      name: draft.name,
      priceMinor: 12_000,
      maxOrderQuantity: 5,
    });
    expect(staffReprice.status).toBe(403);
    expect(errorOf(staffReprice.body).message).toBe(
      'Changing the price, order limit or featuring of a product on sale needs publish permission',
    );
    const repriced = await call('put', `/admin/products/${draft.id}`, 'admin', {
      categoryId: created.categories[0],
      slug: draft.slug,
      name: draft.name,
      priceMinor: 12_000,
      maxOrderQuantity: 5,
    });
    expect(repriced.status, JSON.stringify(repriced.body)).toBe(200);
    expect(adminProductResponseSchema.parse(repriced.body).product).toMatchObject({
      priceMinor: 12_000,
      status: 'active',
      moderationStatus: 'approved',
    });

    // Every step is in the audit log under the account that took it.
    const audit = await call('get', `/admin/audit-log?pageSize=100`, 'admin');
    const entries = auditLogResponseSchema
      .parse(audit.body)
      .entries.filter((entry) => entry.targetId === draft.id || entry.targetId === taskId)
      .map((entry) => [entry.action, entry.actor?.id])
      .reverse();
    expect(entries).toEqual([
      ['product.created', accounts.staff.id],
      ['moderation.submitted', accounts.staff.id],
      ['moderation.assigned', accounts.admin.id],
      ['moderation.decided', accounts.moderator.id],
      ['product.status_changed', accounts.admin.id],
      ['product.updated', accounts.admin.id],
    ]);
  });

  it('never lets anyone decide their own submission', async () => {
    const own = await createProduct('teapot', 0);
    // The admin (who can also review content) submits; nobody may assign it back to them.
    const submitted = await call('post', `/admin/products/${own.id}/submit`, 'admin');
    const taskId = adminProductResponseSchema.parse(submitted.body).product.latestReview?.taskId;
    if (!taskId) throw new Error('no review was opened');
    const toSelf = await call('post', `/admin/moderation/${taskId}/assignment`, 'owner', {
      moderatorId: accounts.admin.id,
    });

    expect(toSelf.status).toBe(409);
    expect(errorOf(toSelf.body).code).toBe('own_submission');

    // Staff may withdraw their own submissions only; this one is the admin's.
    const byOtherStaff = await call('post', `/admin/moderation/${taskId}/withdraw`, 'staff');
    expect(byOtherStaff.status).toBe(403);
    expect(errorOf(byOtherStaff.body).message).toBe(
      'Only the submitter or a review assigner can withdraw this review',
    );
    const withdrawn = await call('post', `/admin/moderation/${taskId}/withdraw`, 'admin');
    expect(withdrawn.status).toBe(200);
    expect(moderationTaskResponseSchema.parse(withdrawn.body).task).toMatchObject({
      status: 'withdrawn',
      product: { moderationStatus: 'not_submitted' },
    });
  });
});

describe('assigners and customer details', () => {
  it('lets an assigner holding only moderation.assign list reviewers with their open reviews', async () => {
    const product = await createProduct('vase', 0);
    const submitted = await call('post', `/admin/products/${product.id}/submit`, 'staff');
    const taskId = adminProductResponseSchema.parse(submitted.body).product.latestReview?.taskId;
    if (!taskId) throw new Error('no review was opened');
    await call('post', `/admin/moderation/${taskId}/assignment`, 'admin', {
      moderatorId: accounts.moderator.id,
    }).expect(200);

    expect((await call('get', '/admin/moderation/reviewers', 'staff')).status).toBe(403);
    await call('put', `/admin/staff/${accounts.staff.id}/permissions`, 'admin', {
      permission: 'moderation.assign',
      effect: 'grant',
    }).expect(200);
    try {
      const listed = await call('get', '/admin/moderation/reviewers', 'staff');
      expect(listed.status, JSON.stringify(listed.body)).toBe(200);
      const { reviewers } = moderationReviewerListResponseSchema.parse(listed.body);
      expect(reviewers.find((reviewer) => reviewer.id === accounts.moderator.id)).toStrictEqual({
        id: accounts.moderator.id,
        name: 'Test moderator',
        email: accounts.moderator.email,
        openReviews: 1,
      });
      expect(
        reviewers.find((reviewer) => reviewer.id === accounts.otherModerator.id),
      ).toMatchObject({ openReviews: 0 });
      // Staff do not hold content.approve, so they are never offered as reviewers.
      expect(reviewers.map((reviewer) => reviewer.id)).not.toContain(accounts.staff.id);
    } finally {
      await call('put', `/admin/staff/${accounts.staff.id}/permissions`, 'admin', {
        permission: 'moderation.assign',
        effect: null,
      }).expect(200);
      await call('post', `/admin/moderation/${taskId}/withdraw`, 'staff').expect(200);
    }
  });

  it('shows one customer, email included, only to callers who may see customers', async () => {
    const detail = await call('get', `/admin/customers/${accounts.customer.id}`, 'staff');
    expect(detail.status).toBe(200);
    expect(customerResponseSchema.parse(detail.body).customer).toMatchObject({
      id: accounts.customer.id,
      email: accounts.customer.email,
      fullName: 'Test customer',
      status: 'active',
    });

    expect(
      (await call('get', `/admin/customers/${accounts.customer.id}`, 'moderator')).status,
    ).toBe(403);
    expect((await call('get', `/admin/customers/${accounts.moderator.id}`, 'admin')).status).toBe(
      404,
    );
    expect((await call('get', `/admin/customers/${randomUUID()}`, 'admin')).status).toBe(404);
  });

  it('filters the audit log by a literal action prefix', async () => {
    const literal = await call('get', '/admin/audit-log?action=product.', 'admin');
    const wildcard = await call('get', '/admin/audit-log?action=product_', 'admin');

    expect(auditLogResponseSchema.parse(literal.body).total).toBeGreaterThan(0);
    expect(auditLogResponseSchema.parse(wildcard.body).total).toBe(0);
  });
});

describe('publishing rules and staff data', () => {
  it('lets only publishers reprice or re-feature a live product; drafts stay editable', async () => {
    const product = await createProduct('clock', 3, 8_000);
    const body = (changes: object) => ({
      categoryId: created.categories[0],
      slug: product.slug,
      name: product.name,
      priceMinor: 8_000,
      maxOrderQuantity: 5,
      ...changes,
    });

    const draft = await call(
      'put',
      `/admin/products/${product.id}`,
      'staff',
      body({ priceMinor: 9_000, isFeatured: true }),
    );
    expect(draft.status, JSON.stringify(draft.body)).toBe(200);
    expect(adminProductResponseSchema.parse(draft.body).product).toMatchObject({
      priceMinor: 9_000,
      isFeatured: true,
    });

    await approveAndPublish(product.id);
    for (const changes of [
      { priceMinor: 9_500, isFeatured: true },
      { priceMinor: 9_000, isFeatured: false },
      { priceMinor: 9_000, isFeatured: true, maxOrderQuantity: 2 },
    ]) {
      const refused = await call('put', `/admin/products/${product.id}`, 'staff', body(changes));
      expect(refused.status, JSON.stringify(changes)).toBe(403);
      expect(errorOf(refused.body).code).toBe('forbidden');
    }
    const stored = await clients.admin
      .from('products')
      .select('price_minor, is_featured, max_order_quantity')
      .eq('id', product.id)
      .single();
    expect(stored.data).toStrictEqual({
      price_minor: 9_000,
      is_featured: true,
      max_order_quantity: 5,
    });

    const unchanged = await call(
      'put',
      `/admin/products/${product.id}`,
      'staff',
      body({ priceMinor: 9_000, isFeatured: true }),
    );
    expect(unchanged.status).toBe(200);
    const byAdmin = await call(
      'put',
      `/admin/products/${product.id}`,
      'admin',
      body({ priceMinor: 9_500, isFeatured: true }),
    );
    expect(byAdmin.status).toBe(200);
    expect(adminProductResponseSchema.parse(byAdmin.body).product.priceMinor).toBe(9_500);
  });

  it('never shows who created or changed a product through the Data API', async () => {
    const anon = clients.public();
    const asCustomer = clients.asUser(accounts.customer.token);
    for (const column of ['created_by', 'updated_by', 'content_updated_by']) {
      const anonymous = await anon.from('products').select(column).limit(1);
      const customer = await asCustomer.from('products').select(column).limit(1);
      expect(anonymous.error?.code, `anon ${column}`).toBe('42501');
      expect(customer.error?.code, `customer ${column}`).toBe('42501');
    }
    const listed = await anon.from('products').select('id, slug').limit(1);
    expect(listed.error).toBeNull();
  });

  it('refuses an assigner taking a review themselves; an owner may', async () => {
    const product = await createProduct('frame', 0);
    const submitted = await call('post', `/admin/products/${product.id}/submit`, 'staff');
    const taskId = adminProductResponseSchema.parse(submitted.body).product.latestReview?.taskId;
    if (!taskId) throw new Error('no review was opened');

    const byAdmin = await call('post', `/admin/moderation/${taskId}/assignment`, 'admin', {
      moderatorId: accounts.admin.id,
    });
    expect(byAdmin.status).toBe(409);
    expect(errorOf(byAdmin.body)).toMatchObject({
      code: 'own_submission',
      message:
        'Reviews go to someone who neither submitted nor last edited the content, and only an owner can take a review themselves',
    });
    const byOwner = await call('post', `/admin/moderation/${taskId}/assignment`, 'owner', {
      moderatorId: accounts.owner.id,
    });
    expect(byOwner.status).toBe(200);

    const bySubmitter = await call('post', `/admin/moderation/${taskId}/withdraw`, 'staff');
    expect(bySubmitter.status).toBe(200);
  });

  it('sorts the admin product list with a stable tie-break on id', async () => {
    const isSorted = (values: (number | string)[][]) =>
      values.every((value, index) => {
        const previous = values[index - 1];
        if (!previous) return true;
        const [a, idA] = previous as [number, string];
        const [b, idB] = value as [number, string];
        return a < b || (a === b && idA < idB);
      });
    const list = async (sort: string) => {
      const response = await call(
        'get',
        `/admin/products?categoryId=${created.categories[0]}&sort=${sort}&pageSize=100`,
        'staff',
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return adminProductListResponseSchema.parse(response.body).products;
    };

    const byPrice = await list('price_asc');
    expect(byPrice.length).toBeGreaterThan(3);
    expect(isSorted(byPrice.map((p) => [p.priceMinor, p.id]))).toBe(true);
    const byStock = await list('stock_asc');
    expect(isSorted(byStock.map((p) => [p.stockQuantity, p.id]))).toBe(true);
    const byPriceDesc = await list('price_desc');
    expect(isSorted(byPriceDesc.map((p) => [-p.priceMinor, p.id]))).toBe(true);
    const byName = await list('name_asc');
    expect(byName.map((p) => p.id).sort()).toEqual(byPrice.map((p) => p.id).sort());

    const refused = await call('get', '/admin/products?sort=created_at', 'staff');
    expect(refused.status).toBe(400);

    // Category counts include drafts for staff (a computed column, not an embedded count).
    const categories = await call('get', '/admin/categories', 'staff');
    expect(categories.status, JSON.stringify(categories.body)).toBe(200);
    const category = adminCategoryListResponseSchema
      .parse(categories.body)
      .categories.find((candidate) => candidate.id === created.categories[0]);
    expect(category?.productCount).toBe(byPrice.length);
  });
});

describe('stock and orders', () => {
  it('records stock adjustments in the ledger and refuses negative stock', async () => {
    const product = await createProduct('lamp', 10);
    const added = await call('post', `/admin/products/${product.id}/stock`, 'staff', {
      change: 5,
      note: 'Supplier delivery',
    });
    const tooMuch = await call('post', `/admin/products/${product.id}/stock`, 'staff', {
      change: -16,
      note: 'Stock count',
    });
    const ledger = await call('get', `/admin/inventory-movements?productId=${product.id}`, 'admin');

    expect(adminProductResponseSchema.parse(added.body).product.stockQuantity).toBe(15);
    expect(tooMuch.status).toBe(409);
    expect(errorOf(tooMuch.body).code).toBe('stock_below_zero');
    expect(await stockOf(product.id)).toBe(15);
    expect(
      inventoryMovementListResponseSchema
        .parse(ledger.body)
        .movements.map((m) => [m.reason, m.change, m.stockAfter, m.actor?.id, m.note]),
    ).toEqual([
      ['adjustment', 5, 15, accounts.staff.id, 'Supplier delivery'],
      ['initial_stock', 10, 10, accounts.staff.id, 'Initial stock'],
    ]);
  });

  it('fulfils a COD order step by step and records the cash once', async () => {
    const product = await createProduct('mug', 20, 5_000);
    await approveAndPublish(product.id);
    const order = await placeOrder('customer', product.id, 2);

    const found = await call('get', `/admin/orders?q=${order.orderNumber}`, 'staff');
    expect(adminOrderListResponseSchema.parse(found.body).orders.map((o) => o.orderNumber)).toEqual(
      [order.orderNumber],
    );

    const cancelByStaff = await call('post', `/admin/orders/${order.orderNumber}/status`, 'staff', {
      status: 'cancelled',
      note: 'Staff may not cancel',
    });
    expect(cancelByStaff.status).toBe(403);
    const skip = await call('post', `/admin/orders/${order.orderNumber}/status`, 'staff', {
      status: 'shipped',
    });
    expect(skip.status).toBe(409);
    expect(errorOf(skip.body).code).toBe('invalid_status_transition');

    for (const status of ['confirmed', 'processing', 'shipped', 'delivered']) {
      const step = await call('post', `/admin/orders/${order.orderNumber}/status`, 'staff', {
        status,
      });
      expect(step.status, status).toBe(200);
    }
    const wrongAmount = await call(
      'post',
      `/admin/orders/${order.orderNumber}/cod-collection`,
      'staff',
      { amountMinor: order.totalMinor - 1 },
    );
    expect(wrongAmount.status).toBe(409);
    expect(errorOf(wrongAmount.body)).toMatchObject({
      code: 'collection_amount_mismatch',
      details: { totalMinor: order.totalMinor },
    });

    const collected = await call(
      'post',
      `/admin/orders/${order.orderNumber}/cod-collection`,
      'staff',
      { amountMinor: order.totalMinor },
    );
    expect(collected.status).toBe(200);
    const detail = adminOrderResponseSchema.parse(collected.body).order;
    expect(detail).toMatchObject({ status: 'delivered', paymentStatus: 'collected' });
    expect(detail.paymentCollectedAt).not.toBeNull();
    expect(detail.history.map((event) => [event.toStatus, event.actorKind])).toEqual([
      ['pending', 'customer'],
      ['confirmed', 'staff'],
      ['processing', 'staff'],
      ['shipped', 'staff'],
      ['delivered', 'staff'],
    ]);
    const twice = await call('post', `/admin/orders/${order.orderNumber}/cod-collection`, 'staff', {
      amountMinor: order.totalMinor,
    });
    expect(twice.status).toBe(409);
    expect(errorOf(twice.body).code).toBe('payment_not_collectable');
  });

  it('cancels an order, returning its stock in the same transaction', async () => {
    const product = await createProduct('plate', 8, 3_000);
    await approveAndPublish(product.id);
    const order = await placeOrder('buyer', product.id, 3);
    expect(await stockOf(product.id)).toBe(5);

    const cancelled = await call('post', `/admin/orders/${order.orderNumber}/status`, 'admin', {
      status: 'cancelled',
      note: 'Customer asked by phone',
    });
    expect(cancelled.status).toBe(200);
    expect(adminOrderResponseSchema.parse(cancelled.body).order).toMatchObject({
      status: 'cancelled',
      paymentStatus: 'cancelled',
      cancelReason: 'Customer asked by phone',
    });
    expect(await stockOf(product.id)).toBe(8);

    const ledger = await call(
      'get',
      `/admin/inventory-movements?productId=${product.id}&reason=order_cancelled`,
      'admin',
    );
    expect(inventoryMovementListResponseSchema.parse(ledger.body).movements).toMatchObject([
      {
        change: 3,
        stockAfter: 8,
        orderNumber: order.orderNumber,
        actor: { id: accounts.admin.id },
      },
    ]);
    const again = await call('post', `/admin/orders/${order.orderNumber}/status`, 'admin', {
      status: 'confirmed',
    });
    expect(again.status).toBe(409);
  });

  it("filters the order list by one customer's id", async () => {
    const forCustomer = await call(
      'get',
      `/admin/orders?customerId=${accounts.customer.id}&pageSize=100`,
      'staff',
    );
    const forBuyer = await call(
      'get',
      `/admin/orders?customerId=${accounts.buyer.id}&pageSize=100`,
      'staff',
    );
    const forStaff = await call('get', `/admin/orders?customerId=${accounts.staff.id}`, 'staff');

    const customerOrders = adminOrderListResponseSchema.parse(forCustomer.body).orders;
    const buyerOrders = adminOrderListResponseSchema.parse(forBuyer.body).orders;
    expect(customerOrders.length).toBe(1);
    expect(buyerOrders.length).toBe(1);
    expect(customerOrders.every((order) => order.customerId === accounts.customer.id)).toBe(true);
    expect(buyerOrders.every((order) => order.customerId === accounts.buyer.id)).toBe(true);
    expect(adminOrderListResponseSchema.parse(forStaff.body).total).toBe(0);
  });
});

describe('customer and staff accounts', () => {
  it("suspends a customer, refusing the customer's very next call, and reactivates them", async () => {
    expect((await call('get', '/me', 'buyer')).status).toBe(200);
    const suspended = await call('post', `/admin/customers/${accounts.buyer.id}/status`, 'admin', {
      status: 'suspended',
      reason: 'Repeated fake orders',
    });
    const blocked = await call('get', '/me/addresses', 'buyer');
    const reactivated = await call(
      'post',
      `/admin/customers/${accounts.buyer.id}/status`,
      'admin',
      {
        status: 'active',
      },
    );
    const restored = await call('get', '/me', 'buyer');

    expect(suspended.status).toBe(200);
    expect(customerResponseSchema.parse(suspended.body).customer).toMatchObject({
      id: accounts.buyer.id,
      email: accounts.buyer.email,
      status: 'suspended',
    });
    expect(blocked.status).toBe(403);
    expect(errorOf(blocked.body).code).toBe('account_suspended');
    expect(reactivated.status).toBe(200);
    expect(restored.status).toBe(200);

    const self = await call('post', `/admin/customers/${accounts.admin.id}/status`, 'admin', {
      status: 'suspended',
      reason: 'Trying it on myself',
    });
    const staffTarget = await call(
      'post',
      `/admin/customers/${accounts.staff.id}/status`,
      'admin',
      {
        status: 'suspended',
        reason: 'Staff are managed by role',
      },
    );
    expect(self.status).toBe(403);
    expect(errorOf(self.body).code).toBe('cannot_change_self');
    expect(staffTarget.status).toBe(404);
    expect((await call('get', `/admin/customers/${accounts.staff.id}`, 'admin')).status).toBe(404);
  });

  it('applies grants and denials to the next request, a denial winning over the role', async () => {
    const put = (who: Who, target: string, body: object) =>
      call('put', `/admin/staff/${target}/permissions`, who, body);

    expect((await call('get', '/admin/audit-log', 'staff')).status).toBe(403);
    const granted = await put('admin', accounts.staff.id, {
      permission: 'audit_logs.read',
      effect: 'grant',
    });
    expect(granted.status).toBe(200);
    expect(staffMemberResponseSchema.parse(granted.body).member.permissions).toContain(
      'audit_logs.read',
    );
    expect((await call('get', '/admin/audit-log', 'staff')).status).toBe(200);

    await put('admin', accounts.staff.id, { permission: 'orders.read', effect: 'deny' }).expect(
      200,
    );
    expect((await call('get', '/admin/orders', 'staff')).status).toBe(403);
    const me = await call('get', '/me', 'staff');
    expect(meResponseSchema.parse(me.body).user.permissions).not.toContain('orders.read');

    await put('admin', accounts.staff.id, { permission: 'orders.read', effect: null }).expect(200);
    await put('admin', accounts.staff.id, { permission: 'audit_logs.read', effect: null }).expect(
      200,
    );
    expect((await call('get', '/admin/orders', 'staff')).status).toBe(200);
    expect((await call('get', '/admin/audit-log', 'staff')).status).toBe(403);
  });

  it('keeps admins within their own authority', async () => {
    const put = (who: Who, target: string, body: object) =>
      call('put', `/admin/staff/${target}/permissions`, who, body);
    const refusals: [Who, string, object, number, string][] = [
      [
        'admin',
        accounts.staff.id,
        { permission: 'settings.manage', effect: 'grant' },
        403,
        'forbidden',
      ],
      [
        'admin',
        accounts.owner.id,
        { permission: 'orders.read', effect: 'deny' },
        403,
        'account_not_manageable',
      ],
      [
        'admin',
        accounts.admin.id,
        { permission: 'orders.read', effect: 'deny' },
        403,
        'cannot_change_self',
      ],
      [
        'owner',
        accounts.customer.id,
        { permission: 'orders.read', effect: 'grant' },
        403,
        'account_not_manageable',
      ],
      [
        'staff',
        accounts.moderator.id,
        { permission: 'orders.read', effect: 'grant' },
        403,
        'forbidden',
      ],
    ];
    for (const [who, target, body, status, code] of refusals) {
      const response = await put(who, target, body);
      expect(response.status, `${who} → ${code}`).toBe(status);
      expect(errorOf(response.body).code).toBe(code);
    }

    // An owner may hand an admin a permission admins lack by default.
    await put('owner', accounts.admin.id, {
      permission: 'settings.manage',
      effect: 'grant',
    }).expect(200);
    expect((await call('get', '/admin/settings/delivery-charges', 'admin')).status).toBe(200);
    await put('owner', accounts.admin.id, { permission: 'settings.manage', effect: null }).expect(
      200,
    );
    expect((await call('get', '/admin/settings/delivery-charges', 'admin')).status).toBe(403);
  });

  it('invites a moderator by email; the invitee sets a password and signs in with the role', async () => {
    const email = emailFor('invitee');
    const refused = await call('post', '/admin/staff/invitations', 'admin', {
      email: emailFor('would-be-admin'),
      role: 'admin',
    });
    expect(refused.status).toBe(403);
    expect((await usersOfThisRun()).some((user) => user.email === emailFor('would-be-admin'))).toBe(
      false,
    );

    // Only the owner creates system users, even when the caller holds staff.invite.
    const notOwner = await call('post', '/admin/staff/invitations', 'admin', {
      email: emailFor('would-be-staff'),
      role: 'staff',
    });
    expect(notOwner.status).toBe(403);
    expect(errorOf(notOwner.body).code).toBe('forbidden');
    expect((await usersOfThisRun()).some((user) => user.email === emailFor('would-be-staff'))).toBe(
      false,
    );

    const exists = await call('post', '/admin/staff/invitations', 'owner', {
      email: accounts.customer.email,
      role: 'staff',
    });
    expect(exists.status).toBe(409);
    expect(errorOf(exists.body).code).toBe('account_exists');

    const invited = await call('post', '/admin/staff/invitations', 'owner', {
      email,
      role: 'moderator',
      fullName: 'Nadia Islam',
    });
    expect(invited.status, JSON.stringify(invited.body)).toBe(201);
    const { invitation } = staffInvitationResponseSchema.parse(invited.body);
    expect(invitation).toMatchObject({ email, role: 'moderator' });

    const link = await invitationLink(email);
    expect(`${link.origin}${link.pathname}`).toBe('http://localhost:3001/accept-invite');
    expect(link.hash).toBe('');
    expect(link.href).not.toMatch(/access_token|refresh_token/);
    const tokenHash = link.searchParams.get('token_hash') ?? '';

    const weak = await request(app)
      .post('/api/v1/auth/accept-invite')
      .send({ tokenHash, password: 'short1' });
    expect(weak.status).toBe(400);
    const accepted = await request(app)
      .post('/api/v1/auth/accept-invite')
      .send({ tokenHash, password: 'team-member-2026' });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(204);
    expect(accepted.text).toBe('');
    const replay = await request(app)
      .post('/api/v1/auth/accept-invite')
      .send({ tokenHash, password: 'team-member-2027' });
    expect(replay.status).toBe(400);
    expect(errorOf(replay.body).code).toBe('invitation_invalid');

    const token = await login(email, 'team-member-2026');
    const me = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
    expect(meResponseSchema.parse(me.body).user).toMatchObject({
      id: invitation.userId,
      role: 'moderator',
    });
    const queue = await request(app)
      .get('/api/v1/moderator/queue')
      .set('Authorization', `Bearer ${token}`);
    expect(queue.status).toBe(200);
    const role = await clients.admin
      .from('user_roles')
      .select('role, granted_by')
      .eq('user_id', invitation.userId)
      .single();
    expect(role.data).toStrictEqual({ role: 'moderator', granted_by: accounts.owner.id });

    const audit = await call(
      'get',
      `/admin/audit-log?action=staff.role_changed&actorId=${accounts.owner.id}`,
      'owner',
    );
    expect(auditLogResponseSchema.parse(audit.body).entries).toMatchObject([
      { targetId: invitation.userId, details: { from: 'customer', to: 'moderator' } },
    ]);
  });
});

describe('re-sending a pending invitation', () => {
  it('emails a new link that replaces the first; once accepted there is nothing to re-send', async () => {
    const email = emailFor('resend');
    const invited = await call('post', '/admin/staff/invitations', 'owner', {
      email,
      role: 'moderator',
    });
    expect(invited.status, JSON.stringify(invited.body)).toBe(201);
    const { userId } = staffInvitationResponseSchema.parse(invited.body).invitation;
    const [first] = await invitationLinks(email, 1);
    if (!first) throw new Error('no invitation email');

    const listed = await call('get', '/admin/staff', 'admin');
    expect(
      staffListResponseSchema.parse(listed.body).staff.find((member) => member.id === userId),
    ).toMatchObject({ invitationPending: true });

    // Supabase Auth sends at most one email per address per second (max_frequency).
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const resent = await call('post', `/admin/staff/${userId}/invitation`, 'owner');
    expect(resent.status, JSON.stringify(resent.body)).toBe(200);
    expect(staffInvitationResendResponseSchema.parse(resent.body)).toStrictEqual({
      invitation: { userId, email },
    });
    const links = await invitationLinks(email, 2);
    const second = links.find((link) => link.href !== first.href);
    if (!second) throw new Error('the re-sent email carried no new link');
    expect(`${second.origin}${second.pathname}`).toBe('http://localhost:3001/accept-invite');

    const stale = await request(app)
      .post('/api/v1/auth/accept-invite')
      .send({ tokenHash: first.searchParams.get('token_hash'), password: 'team-member-2026' });
    expect(stale.status).toBe(400);
    expect(errorOf(stale.body).code).toBe('invitation_invalid');
    const accepted = await request(app)
      .post('/api/v1/auth/accept-invite')
      .send({ tokenHash: second.searchParams.get('token_hash'), password: 'team-member-2026' });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(204);

    const after = await call('get', '/admin/staff', 'admin');
    expect(
      staffListResponseSchema.parse(after.body).staff.find((member) => member.id === userId),
    ).toMatchObject({ invitationPending: false });
    const again = await call('post', `/admin/staff/${userId}/invitation`, 'owner');
    expect(again.status).toBe(409);
    expect(errorOf(again.body).code).toBe('invitation_accepted');
    const notStaff = await call('post', `/admin/staff/${accounts.customer.id}/invitation`, 'owner');
    expect(notStaff.status).toBe(404);
    const byStaff = await call('post', `/admin/staff/${userId}/invitation`, 'staff');
    expect(byStaff.status).toBe(403);

    const audit = await call(
      'get',
      `/admin/audit-log?action=staff.invitation_resent&actorId=${accounts.owner.id}`,
      'owner',
    );
    expect(auditLogResponseSchema.parse(audit.body).entries).toMatchObject([
      { targetId: userId, details: { role: 'moderator' } },
    ]);
  });
});

describe('invitations to addresses already in use', () => {
  it('refuses a pending invitation or an unconfirmed sign-up with 409, sending nothing', async () => {
    // Supabase Auth would re-send an invitation to an unconfirmed account; the API creates
    // the account first instead, so any address already in use is refused before an email.
    const pendingEmail = emailFor('pending-admin');
    const byOwner = await call('post', '/admin/staff/invitations', 'owner', {
      email: pendingEmail,
      role: 'admin',
    });
    expect(byOwner.status, JSON.stringify(byOwner.body)).toBe(201);
    const { userId } = staffInvitationResponseSchema.parse(byOwner.body).invitation;
    await invitationLink(pendingEmail);

    const signUpEmail = emailFor('unconfirmed');
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email: signUpEmail, password: PASSWORD })
      .expect(202);

    for (const [who, email, status] of [
      ['admin', pendingEmail, 403],
      ['owner', pendingEmail, 409],
      ['admin', signUpEmail, 403],
    ] as const) {
      const response = await call('post', '/admin/staff/invitations', who, {
        email,
        role: 'staff',
      });
      expect(response.status, `${who} ${email}`).toBe(status);
      if (status === 409) expect(errorOf(response.body).code).toBe('account_exists');
    }

    const kept = await clients.admin.auth.admin.getUserById(userId);
    expect(kept.error).toBeNull();
    const role = await clients.admin
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .single();
    expect(role.data?.role).toBe('admin');
    const search = (await (
      await fetch(
        `${local.mailUrl}/api/v1/search?query=${encodeURIComponent(`to:"${pendingEmail}"`)}`,
      )
    ).json()) as { messages: unknown[] };
    expect(search.messages).toHaveLength(1);
  });
});

describe('reports and settings', () => {
  it('reports sales that match this run’s orders exactly', async () => {
    const userIds = Object.values(accounts).map((entry) => entry.id);
    const { data, error } = await clients.admin
      .from('orders')
      .select('status, payment_status, total_minor')
      .in('user_id', userIds);
    if (error) throw error;
    const open = data.filter((row) => row.status !== 'cancelled');
    const sum = (rows: typeof data) => rows.reduce((total, row) => total + row.total_minor, 0);
    expect(data).toHaveLength(2);

    const after = await overview();
    expect(after.orderCount - baseline.orderCount).toBe(open.length);
    expect(after.cancelledCount - baseline.cancelledCount).toBe(data.length - open.length);
    expect(after.salesMinor - baseline.salesMinor).toBe(sum(open));
    expect(after.collectedMinor - baseline.collectedMinor).toBe(
      sum(data.filter((row) => row.payment_status === 'collected')),
    );
    expect(after.awaitingCollectionMinor - baseline.awaitingCollectionMinor).toBe(0);
    const today = (overview: SalesOverview) => overview.daily.at(-1)?.salesMinor ?? 0;
    expect(today(after) - today(baseline)).toBe(sum(open));

    const dashboard = await call('get', '/admin/dashboard', 'owner');
    expect(dashboardResponseSchema.parse(dashboard.body).sales?.salesMinor).toBeGreaterThanOrEqual(
      sum(open),
    );
  });

  it('shows the dashboard cards each role may see', async () => {
    const moderator = dashboardResponseSchema.parse(
      (await call('get', '/admin/dashboard', 'moderator')).body,
    );
    const staff = dashboardResponseSchema.parse(
      (await call('get', '/admin/dashboard', 'staff')).body,
    );

    expect(moderator).toMatchObject({
      orders: null,
      sales: null,
      moderation: { unassigned: null },
    });
    expect(staff.orders).not.toBeNull();
    expect(staff.sales).toBeNull();
  });

  it('lets an owner save a delivery charge (here: its current value) with an audit entry', async () => {
    const listed = await call('get', '/admin/settings/delivery-charges', 'owner');
    const inside = deliveryChargeListResponseSchema
      .parse(listed.body)
      .charges.find((charge) => charge.zone === 'inside_dhaka');
    if (inside?.amountMinor == null) throw new Error('inside_dhaka has no charge');

    const saved = await call('put', '/admin/settings/delivery-charges/inside_dhaka', 'owner', {
      amountMinor: inside.amountMinor,
    });
    const tooHigh = await call('put', '/admin/settings/delivery-charges/inside_dhaka', 'owner', {
      amountMinor: 10_000_001,
    });
    const audit = await call(
      'get',
      `/admin/audit-log?action=settings.&actorId=${accounts.owner.id}`,
      'owner',
    );

    expect(saved.status).toBe(200);
    expect(tooHigh.status).toBe(400);
    expect(auditLogResponseSchema.parse(audit.body).entries[0]).toMatchObject({
      action: 'settings.delivery_charge_changed',
      targetId: 'inside_dhaka',
    });
  });
});
