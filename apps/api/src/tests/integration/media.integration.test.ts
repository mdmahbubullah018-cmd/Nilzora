import { randomUUID } from 'node:crypto';
import {
  adminProductListResponseSchema,
  adminProductResponseSchema,
  apiErrorBodySchema,
  authSessionSchema,
  productImageListResponseSchema,
  productImageUploadResponseSchema,
  productListResponseSchema,
  productResponseSchema,
  type AppRole,
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
import { createMemoryObjectStore } from '../../modules/media/object-store';
import { createSupabaseProductImageStore } from '../../modules/media/store';
import { createSupabaseOrderStore } from '../../modules/orders/store';
import { createSupabaseAccountStore } from '../../modules/users/accounts';
import { createSupabaseClients } from '../../supabase/clients';
import { testConfig } from '../helpers';
import { makeImage } from '../media-fakes';

/*
 * Product images against the local Supabase stack: the real admin_*_product_image
 * functions (permissions, content rules, the limit of eight), real RLS for public and
 * staff reads, and the real embedded reads of the catalog stores. Only the object store
 * is in memory: nothing here ever contacts Cloudflare R2. Each run creates its own
 * accounts, category and products, and removes everything it created afterwards.
 */

const local = inject('supabase');
const BASE_URL = 'https://media.example.com';
const config = testConfig({
  SUPABASE_URL: local.url,
  SUPABASE_PUBLISHABLE_KEY: local.publishableKey,
  SUPABASE_SECRET_KEY: local.secretKey,
  RATE_LIMIT_MAX: '10000',
  AUTH_RATE_LIMIT_MAX: '10000',
  ADMIN_RATE_LIMIT_MAX: '10000',
});
const clients = createSupabaseClients(config.supabase);
const objects = createMemoryObjectStore();
const app = createApp({
  config,
  logger: createLogger(config),
  auth: {
    gateway: createSupabaseAuthGateway(clients),
    accounts: createSupabaseAccountStore(clients),
  },
  commerce: {
    catalog: createSupabaseCatalogStore(clients, { mediaBaseUrl: BASE_URL }),
    cart: createSupabaseCartStore(clients),
    addresses: createSupabaseAddressStore(clients),
    orders: createSupabaseOrderStore(clients),
  },
  admin: {
    catalog: createSupabaseAdminCatalogStore(clients, { mediaBaseUrl: BASE_URL }),
    orders: createSupabaseAdminOrderStore(clients),
    accounts: createSupabaseAdminAccountStore(clients),
    moderation: createSupabaseModerationStore(clients),
    reports: createSupabaseAdminReportStore(clients),
    coupons: createSupabaseAdminCouponStore(clients),
    discounts: createSupabaseAdminDiscountStore(clients),
    reviews: createSupabaseReviewStore(clients),
  },
  media: {
    images: createSupabaseProductImageStore(clients),
    storage: { objects, publicBaseUrl: BASE_URL },
  },
});

const run = randomUUID().slice(0, 8);
const PASSWORD = 'shopping2026';
const emailFor = (label: string) => `it-${run}-${label}@example.com`;

type Who = 'staff' | 'moderator' | 'customer';
const ROLES: Record<Who, AppRole> = {
  staff: 'staff',
  moderator: 'moderator',
  customer: 'customer',
};
const accounts = {} as Record<Who, { id: string; token: string }>;
const created = { categories: [] as string[], products: [] as string[] };

function errorOf(body: unknown) {
  return apiErrorBodySchema.parse(body).error;
}

function call(
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  who?: Who,
  body?: object,
) {
  let pending = request(app)[method](`/api/v1${path}`);
  if (who) pending = pending.set('Authorization', `Bearer ${accounts[who].token}`);
  return body === undefined ? pending : pending.send(body);
}

async function upload(productId: string, who: Who | undefined, size = 700) {
  let pending = request(app)
    .post(`/api/v1/admin/products/${productId}/images`)
    .set('Content-Type', 'image/jpeg');
  if (who) pending = pending.set('Authorization', `Bearer ${accounts[who].token}`);
  return pending.send(await makeImage('jpeg', size, size));
}

async function account(who: Who) {
  const email = emailFor(who);
  const { data, error } = await clients.admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  if (ROLES[who] !== 'customer') {
    const seeded = await clients.admin
      .from('user_roles')
      .update({ role: ROLES[who] })
      .eq('user_id', data.user.id);
    if (seeded.error) throw seeded.error;
  }
  const login = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  accounts[who] = { id: data.user.id, token: authSessionSchema.parse(login.body).accessToken };
}

async function draftProduct(label: string) {
  const response = await call('post', '/admin/products', 'staff', {
    categoryId: created.categories[0],
    slug: `it-${run}-${label}`,
    sku: `IT-${run.toUpperCase()}-${label.toUpperCase()}`,
    name: `Image test ${label} ${run}`,
    priceMinor: 10_000,
    maxOrderQuantity: 5,
    initialStock: 5,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const { product } = adminProductResponseSchema.parse(response.body);
  created.products.push(product.id);
  return product;
}

beforeAll(async () => {
  for (const who of Object.keys(ROLES) as Who[]) await account(who);
  const category = await clients.admin
    .from('categories')
    .insert({ slug: `it-${run}-images`, name: `Images ${run}` })
    .select('id')
    .single();
  if (category.error) throw category.error;
  created.categories.push(category.data.id);
});

afterAll(async () => {
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
  const userIds = Object.values(accounts).map((entry) => entry.id);
  if (userIds.length > 0) {
    const audit = await clients.admin.from('audit_log').delete().in('actor_id', userIds);
    if (audit.error) throw audit.error;
  }
  for (const userId of userIds) await clients.admin.auth.admin.deleteUser(userId);
});

describe('product images against the real database', () => {
  it('registers images for staff and shows them to staff on the admin product', async () => {
    const product = await draftProduct('basic');

    const first = await upload(product.id, 'staff');
    const second = await upload(product.id, 'staff', 640);

    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    const firstImage = productImageUploadResponseSchema.parse(first.body).image;
    const secondImage = productImageUploadResponseSchema.parse(second.body).image;
    expect([firstImage.position, secondImage.position]).toEqual([0, 1]);
    expect(firstImage.url).toBe(`${BASE_URL}/products/${product.id}/${firstImage.id}/full.webp`);

    const detail = await call('get', `/admin/products/${product.id}`, 'staff');
    const images = adminProductResponseSchema.parse(detail.body).product.images;
    expect(images.map((image) => image.id)).toEqual([firstImage.id, secondImage.id]);

    const list = await call('get', `/admin/products?q=${encodeURIComponent(product.sku)}`, 'staff');
    const listed = adminProductListResponseSchema.parse(list.body).products[0];
    expect(listed?.image?.id).toBe(firstImage.id);
  });

  it('records the change as content: the product goes back for review and the edit is audited', async () => {
    const product = await draftProduct('review');
    await upload(product.id, 'staff').then((response) => expect(response.status).toBe(201));

    const detail = await call('get', `/admin/products/${product.id}`, 'staff');
    expect(adminProductResponseSchema.parse(detail.body).product.moderationStatus).toBe(
      'not_submitted',
    );

    const audit = await clients.admin
      .from('audit_log')
      .select('action, details')
      .eq('target_id', product.id)
      .eq('action', 'product.image_added');
    expect(audit.error).toBeNull();
    expect(audit.data).toHaveLength(1);
    expect(JSON.stringify(audit.data)).not.toMatch(/token|secret|password/i);
  });

  it('refuses callers without products.update (moderator, customer, anonymous)', async () => {
    const product = await draftProduct('denied');

    expect((await upload(product.id, 'moderator')).status).toBe(403);
    expect((await upload(product.id, 'customer')).status).toBe(403);
    expect((await upload(product.id, undefined)).status).toBe(401);
    const rows = await clients.admin
      .from('product_images')
      .select('id')
      .eq('product_id', product.id);
    expect(rows.data).toEqual([]);
  });

  it('stops at eight images and cleans up the refused ninth', async () => {
    const product = await draftProduct('limit');
    for (let index = 0; index < 8; index += 1) {
      const response = await upload(product.id, 'staff', 420);
      expect(response.status, JSON.stringify(response.body)).toBe(201);
    }
    const before = objects.objects.size;

    const ninth = await upload(product.id, 'staff', 420);

    expect(ninth.status).toBe(409);
    expect(errorOf(ninth.body).code).toBe('image_limit_reached');
    expect(objects.objects.size).toBe(before);
  });

  it('changes the description, reorders and deletes, closing the gap and removing the objects', async () => {
    const product = await draftProduct('edit');
    const a = productImageUploadResponseSchema.parse(
      (await upload(product.id, 'staff')).body,
    ).image;
    const b = productImageUploadResponseSchema.parse(
      (await upload(product.id, 'staff')).body,
    ).image;

    const alt = await call('patch', `/admin/product-images/${a.id}`, 'staff', {
      alt: 'Front view',
    });
    expect(productImageListResponseSchema.parse(alt.body).images[0]?.alt).toBe('Front view');

    const order = await call('put', `/admin/products/${product.id}/images/order`, 'staff', {
      imageIds: [b.id, a.id],
    });
    expect(
      productImageListResponseSchema.parse(order.body).images.map((image) => image.id),
    ).toEqual([b.id, a.id]);

    const bad = await call('put', `/admin/products/${product.id}/images/order`, 'staff', {
      imageIds: [b.id],
    });
    expect(bad.status).toBe(400);

    const removed = await call('delete', `/admin/product-images/${b.id}`, 'staff');
    const remaining = productImageListResponseSchema.parse(removed.body).images;
    expect(remaining.map((image) => [image.id, image.position])).toEqual([[a.id, 0]]);
    expect(objects.objects.has(`products/${product.id}/${b.id}/full.webp`)).toBe(false);
    expect(objects.objects.has(`products/${product.id}/${a.id}/full.webp`)).toBe(true);
  });

  it('shows images to the public only once the product is on sale, and locks them then', async () => {
    const product = await draftProduct('public');
    const image = productImageUploadResponseSchema.parse(
      (await upload(product.id, 'staff')).body,
    ).image;

    // A draft is invisible to the public: no product and so no image.
    expect((await call('get', `/catalog/products/it-${run}-public`)).status).toBe(404);
    const anon = await clients.public().from('product_images').select('id').eq('id', image.id);
    expect(anon.data).toEqual([]);

    // Publish as a trusted fixture write (the review flow is covered elsewhere).
    const published = await clients.admin
      .from('products')
      .update({ status: 'active', moderation_status: 'approved' })
      .eq('id', product.id);
    expect(published.error).toBeNull();

    const detail = await call('get', `/catalog/products/it-${run}-public`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    const shown = productResponseSchema.parse(detail.body).product;
    expect(shown.image?.id).toBe(image.id);
    expect(shown.images.map((entry) => entry.thumbUrl)).toEqual([
      `${BASE_URL}/products/${product.id}/${image.id}/thumb.webp`,
    ]);

    const listing = await call(
      'get',
      `/catalog/products?q=${encodeURIComponent(`Image test public ${run}`)}`,
    );
    const item = productListResponseSchema
      .parse(listing.body)
      .items.find((entry) => entry.id === product.id);
    expect(item?.image?.id).toBe(image.id);

    const publicRead = await clients
      .public()
      .from('product_images')
      .select('id')
      .eq('id', image.id);
    expect(publicRead.data).toEqual([{ id: image.id }]);

    // On sale, the images are locked.
    expect((await upload(product.id, 'staff')).status).toBe(409);
    expect((await call('delete', `/admin/product-images/${image.id}`, 'staff')).status).toBe(409);
    expect(
      (await call('patch', `/admin/product-images/${image.id}`, 'staff', { alt: 'x' })).status,
    ).toBe(409);
  });

  it('keeps image rows and creators out of reach of direct writes and public reads', async () => {
    const product = await draftProduct('direct');
    const image = productImageUploadResponseSchema.parse(
      (await upload(product.id, 'staff')).body,
    ).image;

    const asStaff = clients.asUser(accounts.staff.token);
    const insert = await asStaff.from('product_images').insert({
      id: randomUUID(),
      product_id: product.id,
      storage_key: 'x',
      width: 500,
      height: 500,
      bytes: 10,
      position: 3,
    });
    const update = await asStaff
      .from('product_images')
      .update({ alt_text: 'hijack' })
      .eq('id', image.id);
    const remove = await asStaff.from('product_images').delete().eq('id', image.id);
    const creator = await asStaff.from('product_images').select('created_by').eq('id', image.id);

    expect(insert.error).not.toBeNull();
    expect(update.error).not.toBeNull();
    expect(remove.error).not.toBeNull();
    expect(creator.error).not.toBeNull();
    const row = await clients.admin
      .from('product_images')
      .select('alt_text')
      .eq('id', image.id)
      .single();
    expect(row.data?.alt_text).toBeNull();
  });
});
