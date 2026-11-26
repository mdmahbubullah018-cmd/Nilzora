import { randomUUID } from 'node:crypto';
import type { AppRole, Permission } from '@nilzora/contracts';
import request from 'supertest';
import { FakeAdmin } from './admin-fakes';
import { FakeIdentity } from './fakes';
import { testApp } from './helpers';
import { sampleDocument } from './export-fakes';
import { failingObjectStore, FakeProductImages } from './media-fakes';

/** Public address of the in-memory media bucket some setups use. */
export const MEDIA_BASE_URL = 'https://media.example.com';

export { errorOf } from './commerce-helpers';

export type Who =
  'owner' | 'admin' | 'staff' | 'moderator' | 'otherModerator' | 'customer' | 'otherCustomer';

const ACCOUNTS: Readonly<Record<Who, { email: string; role: AppRole; fullName: string }>> = {
  owner: { email: 'owner@example.com', role: 'super_admin', fullName: 'Nusrat Owner' },
  admin: { email: 'admin@example.com', role: 'admin', fullName: 'Arif Admin' },
  staff: { email: 'staff@example.com', role: 'staff', fullName: 'Sadia Staff' },
  moderator: { email: 'moderator@example.com', role: 'moderator', fullName: 'Mitu Moderator' },
  otherModerator: { email: 'moderator2@example.com', role: 'moderator', fullName: 'Rafi Reviewer' },
  customer: { email: 'rahima@example.com', role: 'customer', fullName: 'Rahima Khatun' },
  otherCustomer: { email: 'karim@example.com', role: 'customer', fullName: 'Karim Ahmed' },
};

/**
 * A small store as the admin routes see it: one account per role (two moderators and
 * two customers), a category with a product on sale (lamp), a draft (watch), a draft
 * under review (kettle: submitted by staff, assigned to the first moderator) and an
 * unassigned review (vase, submitted by staff); and orders for the customer at
 * several steps (pending, shipped, delivered awaiting cash).
 */
export function adminSetup(
  env: Record<string, string> = {},
  options: {
    /** Configure media storage (an in-memory bucket); without it media routes answer 503. */
    storage?: boolean | undefined;
  } = {},
) {
  const identity = new FakeIdentity();
  const admin = new FakeAdmin(identity);
  const users = Object.fromEntries(
    Object.entries(ACCOUNTS).map(([who, account]) => {
      const user = identity.addUser({ email: account.email, role: account.role });
      if (user.profile) user.profile.fullName = account.fullName;
      return [who, user];
    }),
  ) as Record<Who, ReturnType<FakeIdentity['addUser']>>;

  const kitchen = admin.addCategory({ slug: 'home-kitchen', name: 'Home & Kitchen' });
  const hidden = admin.addCategory({ slug: 'seasonal', name: 'Seasonal', isActive: false });
  const products = {
    lamp: admin.addProduct({
      slug: 'desk-lamp',
      name: 'Desk Lamp',
      categoryId: kitchen.id,
      priceMinor: 10_000,
      stock: 20,
      status: 'active',
      moderationStatus: 'approved',
      publishedAt: '2026-10-20T08:00:00.000Z',
    }),
    watch: admin.addProduct({ slug: 'smart-watch', name: 'Smart Watch', categoryId: kitchen.id }),
    kettle: admin.addProduct({
      slug: 'steel-kettle',
      name: 'Steel Kettle',
      categoryId: kitchen.id,
      moderationStatus: 'pending',
    }),
    vase: admin.addProduct({
      slug: 'clay-vase',
      name: 'Clay Vase',
      categoryId: kitchen.id,
      moderationStatus: 'pending',
    }),
  };
  const tasks = {
    assigned: admin.addTask(products.kettle, {
      submittedBy: users.staff.id,
      assignedTo: users.moderator.id,
      assignedAt: '2026-10-25T07:00:00.000Z',
    }),
    unassigned: admin.addTask(products.vase, { submittedBy: users.staff.id }),
  };
  const orders = {
    pending: admin.addOrder(users.customer.id, products.lamp, { quantity: 2 }),
    shipped: admin.addOrder(users.customer.id, products.lamp, { status: 'shipped' }),
    delivered: admin.addOrder(users.customer.id, products.lamp, { status: 'delivered' }),
  };
  admin.exports.documents.set(orders.pending.orderNumber, sampleDocument(orders.pending.orderNumber));

  const tokens = Object.fromEntries(
    (Object.keys(ACCOUNTS) as Who[]).map((who) => [who, identity.tokenFor(users[who])]),
  ) as Record<Who, string>;
  const objects = failingObjectStore();
  const app = testApp({
    auth: identity.deps,
    admin: admin.stores,
    env,
    ...(options.storage
      ? {
          media: {
            images: new FakeProductImages(identity),
            storage: { objects: objects.store, publicBaseUrl: MEDIA_BASE_URL },
          },
        }
      : {}),
  });

  /** A request to /api/v1<path> as one of the fixture accounts (or anonymously). */
  function call(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    who?: Who,
    body?: object,
  ): request.Test {
    let pending = request(app)[method](`/api/v1${path}`);
    if (who) pending = pending.set('Authorization', `Bearer ${tokens[who]}`);
    return body === undefined ? pending : pending.send(body);
  }

  /** A per-account denial (user_permissions effect 'deny'), applied on the next request. */
  function deny(who: Who, ...permissions: Permission[]): void {
    for (const permission of permissions) users[who].overrides.set(permission, 'deny');
  }

  return {
    identity,
    admin,
    users,
    tokens,
    categories: { kitchen, hidden },
    products,
    tasks,
    orders,
    app,
    call,
    deny,
    /** The media bucket (used only when the setup has storage). */
    objects,
  };
}

export type AdminSetup = ReturnType<typeof adminSetup>;

/** A media-library picture recorded directly in the fake (no upload); returns its id. */
export function seedMediaAsset(setup: AdminSetup, overrides: { alt?: string | null } = {}): string {
  const id = randomUUID();
  setup.admin.mediaAssets.push({
    id,
    key: `library/${id}`,
    fullKey: `library/${id}/full.webp`,
    thumbKey: `library/${id}/thumb.webp`,
    contentType: 'image/webp',
    width: 1600,
    height: 1200,
    bytes: 120_000,
    alt: overrides.alt === undefined ? 'Shop front' : overrides.alt,
    originalName: 'front.jpg',
    uploadedBy: { id: setup.users.owner.id, name: 'Nusrat Owner', email: 'owner@example.com' },
    createdAt: '2026-10-25T08:00:00.000Z',
  });
  return id;
}

/** An invited account that has not accepted yet (unconfirmed); returns its id. */
export function pendingInvitee(setup: AdminSetup, role: AppRole = 'moderator'): string {
  return setup.identity.addUser({ email: 'pending@example.com', role, confirmed: false }).id;
}

/** A valid POST /admin/products body for the setup's kitchen category. */
export function newProduct(setup: AdminSetup, overrides: object = {}) {
  return {
    categoryId: setup.categories.kitchen.id,
    slug: 'linen-apron',
    sku: 'linen-apron-01',
    name: '  Linen Apron ',
    summary: 'A sturdy kitchen apron.',
    priceMinor: 45_000,
    compareAtPriceMinor: 50_000,
    maxOrderQuantity: 5,
    isFeatured: false,
    initialStock: 12,
    ...overrides,
  };
}

/** A valid PUT /admin/products/:id body that keeps the product's current content. */
export function sameContent(product: AdminSetup['products']['lamp']) {
  return {
    categoryId: product.categoryId,
    slug: product.slug,
    name: product.name,
    summary: product.summary,
    description: product.description,
    priceMinor: product.priceMinor,
    compareAtPriceMinor: product.compareAtPriceMinor,
    maxOrderQuantity: product.maxOrderQuantity,
    isFeatured: product.isFeatured,
  };
}
