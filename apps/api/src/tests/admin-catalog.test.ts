import {
  adminCategoryListResponseSchema,
  adminCategoryResponseSchema,
  adminProductListResponseSchema,
  adminProductResponseSchema,
  inventoryMovementListResponseSchema,
} from '@nilzora/contracts';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DB_MESSAGE } from './admin-fakes';
import { adminSetup, errorOf, newProduct, sameContent } from './admin-helpers';

describe('GET /api/v1/admin/products', () => {
  it('lists every product in any state, most recently changed first, with paging', async () => {
    const setup = adminSetup();
    const response = await setup.call('get', '/admin/products?pageSize=3', 'staff');

    expect(response.status).toBe(200);
    const page = adminProductListResponseSchema.parse(response.body);
    expect(page).toMatchObject({ page: 1, pageSize: 3, total: 4, totalPages: 2 });
    expect(page.products.map((product) => product.slug)).toEqual([
      'clay-vase',
      'steel-kettle',
      'smart-watch',
    ]);
    expect(page.products[0]).toMatchObject({ status: 'draft', moderationStatus: 'pending' });
  });

  it.each([
    ['status', 'status=active', ['desk-lamp']],
    ['moderation status', 'moderationStatus=pending', ['clay-vase', 'steel-kettle']],
    ['a search on the SKU', 'q=SMART', ['smart-watch']],
    ['a search with LIKE and filter syntax', 'q=%25lamp_*,(x)', []],
  ])('filters by %s', async (_label, query, slugs) => {
    const setup = adminSetup();
    const response = await setup.call('get', `/admin/products?${query}`, 'staff');

    expect(response.status).toBe(200);
    const { products } = adminProductListResponseSchema.parse(response.body);
    expect(products.map((product) => product.slug)).toEqual(slugs);
  });

  it.each([
    ['name_asc', ['clay-vase', 'desk-lamp', 'smart-watch', 'steel-kettle']],
    ['name_desc', ['steel-kettle', 'smart-watch', 'desk-lamp', 'clay-vase']],
    ['price_asc', ['steel-kettle', 'desk-lamp', 'clay-vase', 'smart-watch']],
    ['price_desc', ['smart-watch', 'clay-vase', 'desk-lamp', 'steel-kettle']],
    ['stock_asc', ['clay-vase', 'smart-watch', 'steel-kettle', 'desk-lamp']],
    ['stock_desc', ['desk-lamp', 'steel-kettle', 'smart-watch', 'clay-vase']],
  ])('sorts by %s', async (sort, slugs) => {
    const setup = adminSetup();
    Object.assign(setup.products.watch, { priceMinor: 90_000, stock: 5 });
    Object.assign(setup.products.vase, { priceMinor: 30_000, stock: 2 });
    Object.assign(setup.products.kettle, { priceMinor: 5_000, stock: 12 });
    const response = await setup.call('get', `/admin/products?sort=${sort}`, 'staff');

    expect(response.status).toBe(200);
    const { products } = adminProductListResponseSchema.parse(response.body);
    expect(products.map((product) => product.slug)).toEqual(slugs);
  });

  it('breaks ties by product id so pages never overlap', async () => {
    const setup = adminSetup();
    for (const product of Object.values(setup.products)) product.priceMinor = 10_000;
    const ids = Object.values(setup.products)
      .map((product) => product.id)
      .sort();
    const first = await setup.call('get', '/admin/products?sort=price_asc&pageSize=2', 'staff');
    const second = await setup.call(
      'get',
      '/admin/products?sort=price_asc&pageSize=2&page=2',
      'staff',
    );

    const listed = [first, second].flatMap((response) =>
      adminProductListResponseSchema.parse(response.body).products.map((product) => product.id),
    );
    expect(listed).toEqual(ids);
  });

  it.each(['price', 'updated_asc', 'id', 'name_asc,id'])('rejects the sort %j', async (sort) => {
    const setup = adminSetup();
    const response = await setup.call('get', `/admin/products?sort=${sort}`, 'staff');

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(setup.admin.calls).toEqual([]);
  });

  it('filters low and sold-out stock', async () => {
    const setup = adminSetup();
    setup.products.watch.stock = 0;
    setup.products.vase.stock = 3;
    const low = await setup.call('get', '/admin/products?stock=low', 'staff');
    const out = await setup.call('get', '/admin/products?stock=out', 'staff');

    const slugs = (body: unknown) =>
      adminProductListResponseSchema.parse(body).products.map((product) => product.slug);
    expect(slugs(low.body).sort()).toEqual(['clay-vase', 'smart-watch']);
    expect(slugs(out.body)).toEqual(['smart-watch']);
  });

  it('answers a search with nothing searchable left without asking the database', async () => {
    const setup = adminSetup();
    const response = await setup.call('get', '/admin/products?q=%25%25*', 'staff');

    expect(response.status).toBe(200);
    expect(adminProductListResponseSchema.parse(response.body)).toMatchObject({
      products: [],
      total: 0,
    });
    expect(setup.admin.calls).toEqual([]);
  });

  it.each([
    ['an unknown status', 'status=sold'],
    ['an oversized page', 'pageSize=500'],
    ['a page past the limit', 'page=1001'],
    ['a malformed category', 'categoryId=kitchen'],
    ['an unknown stock filter', 'stock=none'],
  ])('rejects %s', async (_label, query) => {
    const setup = adminSetup();
    const response = await setup.call('get', `/admin/products?${query}`, 'staff');

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(setup.admin.calls).toEqual([]);
  });
});

describe('GET /api/v1/admin/products/:productId', () => {
  it('shows a product with its latest review', async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'get',
      `/admin/products/${setup.products.kettle.id}`,
      'staff',
    );

    const { product } = adminProductResponseSchema.parse(response.body);
    expect(product).toMatchObject({
      slug: 'steel-kettle',
      stockQuantity: 10,
      latestReview: { taskId: setup.tasks.assigned.id, status: 'pending', assigned: true },
    });
  });

  it('answers 404 for an unknown product and 400 for a malformed id', async () => {
    const setup = adminSetup();
    const missing = await setup.call('get', `/admin/products/${randomUUID()}`, 'staff');
    const malformed = await setup.call('get', '/admin/products/desk-lamp', 'staff');

    expect(missing.status).toBe(404);
    expect(errorOf(missing.body)).toMatchObject({
      code: 'not_found',
      message: 'Product not found',
    });
    expect(malformed.status).toBe(400);
    expect(errorOf(malformed.body).code).toBe('validation_failed');
  });
});

describe('POST /api/v1/admin/products', () => {
  it('creates a draft as the caller and records its initial stock', async () => {
    const setup = adminSetup();
    const response = await setup.call('post', '/admin/products', 'staff', newProduct(setup));

    expect(response.status).toBe(201);
    const { product } = adminProductResponseSchema.parse(response.body);
    expect(product).toMatchObject({
      sku: 'LINEN-APRON-01',
      name: 'Linen Apron',
      status: 'draft',
      moderationStatus: 'not_submitted',
      stockQuantity: 12,
      publishedAt: null,
      latestReview: null,
    });
    expect(setup.admin.movements.at(-1)).toMatchObject({
      productId: product.id,
      change: 12,
      reason: 'initial_stock',
      actorId: setup.users.staff.id,
    });
    expect(setup.admin.audit.at(-1)).toMatchObject({
      action: 'product.created',
      actorId: setup.users.staff.id,
    });
  });

  it.each([
    ['a status', { status: 'active' }],
    ['a moderation status', { moderationStatus: 'approved' }],
    ['a stock level', { stockQuantity: 500 }],
    ['an author', { createdBy: randomUUID() }],
    ['an actor', { actorId: randomUUID() }],
    ['a publication date', { publishedAt: '2026-10-25T08:00:00.000Z' }],
    ['an id', { id: randomUUID() }],
  ])('rejects a body that sets %s, creating nothing', async (_label, extra) => {
    const setup = adminSetup();
    const response = await setup.call('post', '/admin/products', 'staff', {
      ...newProduct(setup),
      ...extra,
    });

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(setup.admin.calls).toEqual([]);
    expect(setup.admin.products).toHaveLength(4);
  });

  it.each([
    ['a former price not above the price', { compareAtPriceMinor: 45_000 }],
    ['a zero price', { priceMinor: 0 }],
    ['a fractional price', { priceMinor: 450.5 }],
    ['negative initial stock', { initialStock: -1 }],
    ['an invalid SKU', { sku: '-x' }],
    ['an invalid address', { slug: 'Linen Apron' }],
    ['a per-order limit above 100', { maxOrderQuantity: 101 }],
  ])('rejects %s', async (_label, extra) => {
    const setup = adminSetup();
    const response = await setup.call('post', '/admin/products', 'staff', {
      ...newProduct(setup),
      ...extra,
    });

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
  });

  it('refuses an unknown category (NZ412) and duplicate SKUs and addresses (23505)', async () => {
    const setup = adminSetup();
    const category = await setup.call('post', '/admin/products', 'staff', {
      ...newProduct(setup),
      categoryId: randomUUID(),
    });
    const sku = await setup.call('post', '/admin/products', 'staff', {
      ...newProduct(setup),
      sku: 'DESK-LAMP',
    });
    const slug = await setup.call('post', '/admin/products', 'staff', {
      ...newProduct(setup),
      slug: 'desk-lamp',
    });

    expect(category.status).toBe(400);
    expect(errorOf(category.body)).toMatchObject({
      code: 'bad_request',
      message: 'Choose an existing category and values within range',
    });
    expect(sku.status).toBe(409);
    expect(errorOf(sku.body).code).toBe('sku_taken');
    expect(slug.status).toBe(409);
    expect(errorOf(slug.body).code).toBe('slug_taken');
    for (const response of [category, sku, slug]) {
      expect(JSON.stringify(response.body)).not.toContain(DB_MESSAGE);
    }
  });
});

describe('PUT /api/v1/admin/products/:productId', () => {
  it('lets publishers change price and limits of a product on sale, keeping its review', async () => {
    const setup = adminSetup();
    const { lamp } = setup.products;
    const response = await setup.call('put', `/admin/products/${lamp.id}`, 'admin', {
      ...sameContent(lamp),
      priceMinor: 12_500,
      maxOrderQuantity: 4,
    });

    expect(response.status).toBe(200);
    expect(adminProductResponseSchema.parse(response.body).product).toMatchObject({
      priceMinor: 12_500,
      maxOrderQuantity: 4,
      status: 'active',
      moderationStatus: 'approved',
    });
  });

  it.each([
    ['the price', { priceMinor: 12_500 }],
    ['the former price', { compareAtPriceMinor: 15_000 }],
    ['the per-order limit', { maxOrderQuantity: 4 }],
    ['the featuring', { isFeatured: true }],
  ])(
    'refuses staff without products.publish changing %s of a product on sale',
    async (_label, change) => {
      const setup = adminSetup();
      const { lamp } = setup.products;
      const response = await setup.call('put', `/admin/products/${lamp.id}`, 'staff', {
        ...sameContent(lamp),
        ...change,
      });

      expect(response.status).toBe(403);
      expect(errorOf(response.body)).toMatchObject({
        code: 'forbidden',
        message:
          'Changing the price, order limit or featuring of a product on sale needs publish permission',
      });
      expect(lamp).toMatchObject({ priceMinor: 10_000, maxOrderQuantity: 10, isFeatured: false });
    },
  );

  it('lets staff reprice a draft and save a product on sale unchanged', async () => {
    const setup = adminSetup();
    const { watch, lamp } = setup.products;
    const draft = await setup.call('put', `/admin/products/${watch.id}`, 'staff', {
      ...sameContent(watch),
      priceMinor: 95_000,
      isFeatured: true,
    });
    const unchanged = await setup.call('put', `/admin/products/${lamp.id}`, 'staff', {
      ...sameContent(lamp),
    });

    expect(draft.status).toBe(200);
    expect(adminProductResponseSchema.parse(draft.body).product).toMatchObject({
      priceMinor: 95_000,
      isFeatured: true,
    });
    expect(unchanged.status).toBe(200);
  });

  it('keeps the standard permission answer on routes other than product edits', async () => {
    const setup = adminSetup();
    setup.admin.nextFailure = { code: 'NZ403' };
    const response = await setup.call(
      'post',
      `/admin/products/${setup.products.lamp.id}/stock`,
      'staff',
      { change: 1, note: 'Recount' },
    );

    expect(response.status).toBe(403);
    expect(errorOf(response.body).message).toBe('You do not have permission to do this');
  });

  it('sends a draft back for review when its content changes', async () => {
    const setup = adminSetup();
    const { watch } = setup.products;
    watch.moderationStatus = 'changes_requested';
    const response = await setup.call('put', `/admin/products/${watch.id}`, 'staff', {
      ...sameContent(watch),
      name: 'Smart Watch Pro',
    });

    expect(response.status).toBe(200);
    expect(adminProductResponseSchema.parse(response.body).product).toMatchObject({
      name: 'Smart Watch Pro',
      moderationStatus: 'not_submitted',
    });
  });

  it('refuses content changes on sale (NZ430) and under review (NZ431)', async () => {
    const setup = adminSetup();
    const { lamp, kettle } = setup.products;
    const onSale = await setup.call('put', `/admin/products/${lamp.id}`, 'staff', {
      ...sameContent(lamp),
      name: 'Brighter Lamp',
    });
    const underReview = await setup.call('put', `/admin/products/${kettle.id}`, 'staff', {
      ...sameContent(kettle),
      description: 'Now with a whistle.',
    });

    expect(onSale.status).toBe(409);
    expect(errorOf(onSale.body).code).toBe('product_content_locked');
    expect(underReview.status).toBe(409);
    expect(errorOf(underReview.body).code).toBe('product_under_review');
    expect(lamp.name).toBe('Desk Lamp');
  });

  it.each([
    ['the SKU', { sku: 'NEW-SKU' }],
    ['the stock level', { stockQuantity: 0 }],
    ['the status', { status: 'active' }],
    ['the moderation status', { moderationStatus: 'approved' }],
    ['the editor', { updatedBy: randomUUID() }],
  ])('rejects a body that sets %s', async (_label, extra) => {
    const setup = adminSetup();
    const { watch } = setup.products;
    const response = await setup.call('put', `/admin/products/${watch.id}`, 'staff', {
      ...sameContent(watch),
      ...extra,
    });

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(setup.admin.calls).toEqual([]);
  });

  it('answers 404 for an unknown product and 409 for an address in use', async () => {
    const setup = adminSetup();
    const { watch } = setup.products;
    const missing = await setup.call('put', `/admin/products/${randomUUID()}`, 'staff', {
      ...sameContent(watch),
    });
    const taken = await setup.call('put', `/admin/products/${watch.id}`, 'staff', {
      ...sameContent(watch),
      slug: 'desk-lamp',
    });

    expect(missing.status).toBe(404);
    expect(errorOf(missing.body).message).toBe('Product not found');
    expect(taken.status).toBe(409);
    expect(errorOf(taken.body).code).toBe('slug_taken');
  });
});

describe('POST /api/v1/admin/products/:productId/status', () => {
  it('publishes approved content and refuses anything else (NZ432)', async () => {
    const setup = adminSetup();
    const { watch } = setup.products;
    const refused = await setup.call('post', `/admin/products/${watch.id}/status`, 'admin', {
      status: 'active',
    });
    watch.moderationStatus = 'approved';
    const published = await setup.call('post', `/admin/products/${watch.id}/status`, 'admin', {
      status: 'active',
    });

    expect(refused.status).toBe(409);
    expect(errorOf(refused.body).code).toBe('product_not_approved');
    expect(published.status).toBe(200);
    expect(adminProductResponseSchema.parse(published.body).product.status).toBe('active');
  });

  it.each([{ status: 'deleted' }, { status: 'active', moderationStatus: 'approved' }, {}])(
    'rejects %o',
    async (body) => {
      const setup = adminSetup();
      const response = await setup.call(
        'post',
        `/admin/products/${setup.products.watch.id}/status`,
        'admin',
        body,
      );

      expect(response.status).toBe(400);
      expect(setup.admin.calls).toEqual([]);
    },
  );
});

describe('DELETE /api/v1/admin/products/:productId', () => {
  it('deletes a product that is not on sale for an account that may publish', async () => {
    const setup = adminSetup();
    const { watch } = setup.products;
    const deleted = await setup.call('delete', `/admin/products/${watch.id}`, 'admin');
    const again = await setup.call('get', `/admin/products/${watch.id}`, 'admin');

    expect(deleted.status).toBe(204);
    expect(again.status).toBe(404);
  });

  it('refuses a product on sale (unpublish first)', async () => {
    const setup = adminSetup();
    const { watch } = setup.products;
    watch.status = 'active';
    const response = await setup.call('delete', `/admin/products/${watch.id}`, 'admin');

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('product_content_locked');
  });

  it('is refused without products.publish, before the database is asked', async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'delete',
      `/admin/products/${setup.products.watch.id}`,
      'staff',
    );

    expect(response.status).toBe(403);
    expect(setup.admin.calls).toEqual([]);
  });
});

describe('POST /api/v1/admin/products/:productId/stock', () => {
  it('records a signed adjustment in the ledger as the caller', async () => {
    const setup = adminSetup();
    const { lamp } = setup.products;
    const response = await setup.call('post', `/admin/products/${lamp.id}/stock`, 'staff', {
      change: -4,
      note: '  Damaged in storage ',
    });

    expect(response.status).toBe(200);
    expect(adminProductResponseSchema.parse(response.body).product.stockQuantity).toBe(16);
    expect(setup.admin.movements.at(-1)).toMatchObject({
      change: -4,
      stockAfter: 16,
      reason: 'adjustment',
      note: 'Damaged in storage',
      actorId: setup.users.staff.id,
    });
  });

  it('refuses to go below zero (NZ433) and changes nothing', async () => {
    const setup = adminSetup();
    const { lamp } = setup.products;
    const response = await setup.call('post', `/admin/products/${lamp.id}/stock`, 'staff', {
      change: -21,
      note: 'Stock count',
    });

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('stock_below_zero');
    expect(lamp.stock).toBe(20);
  });

  it.each([
    ['a zero change', { change: 0, note: 'Nothing' }],
    ['a fractional change', { change: 1.5, note: 'Half a lamp' }],
    ['a short reason', { change: 1, note: 'ok' }],
    ['no reason', { change: 1 }],
    ['a stock level', { change: 1, note: 'Recount', stockAfter: 99 }],
    ['an absolute stock', { stockQuantity: 99, note: 'Recount' }],
    ['an actor', { change: 1, note: 'Recount', actorId: randomUUID() }],
  ])('rejects %s', async (_label, body) => {
    const setup = adminSetup();
    const response = await setup.call(
      'post',
      `/admin/products/${setup.products.lamp.id}/stock`,
      'staff',
      body,
    );

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(setup.admin.calls).toEqual([]);
  });

  it('answers 404 for an unknown product', async () => {
    const setup = adminSetup();
    const response = await setup.call('post', `/admin/products/${randomUUID()}/stock`, 'staff', {
      change: 1,
      note: 'Recount',
    });

    expect(response.status).toBe(404);
  });
});

describe('POST /api/v1/admin/products/:productId/submit', () => {
  it('submits a draft for review', async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'post',
      `/admin/products/${setup.products.watch.id}/submit`,
      'staff',
    );

    expect(response.status).toBe(200);
    const { product } = adminProductResponseSchema.parse(response.body);
    expect(product).toMatchObject({
      moderationStatus: 'pending',
      latestReview: { status: 'pending', assigned: false },
    });
    expect(setup.admin.tasks.at(-1)).toMatchObject({ submittedBy: setup.users.staff.id });
  });

  it('refuses products on sale (NZ430) and products already under review (NZ431)', async () => {
    const setup = adminSetup();
    const onSale = await setup.call(
      'post',
      `/admin/products/${setup.products.lamp.id}/submit`,
      'staff',
    );
    const pending = await setup.call(
      'post',
      `/admin/products/${setup.products.kettle.id}/submit`,
      'staff',
    );

    expect(onSale.status).toBe(409);
    expect(errorOf(onSale.body)).toMatchObject({
      code: 'product_content_locked',
      message: 'Only draft products can be submitted for review',
    });
    expect(pending.status).toBe(409);
    expect(errorOf(pending.body).code).toBe('product_under_review');
  });

  it('rejects a body with any field', async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'post',
      `/admin/products/${setup.products.watch.id}/submit`,
      'staff',
      { assignedTo: setup.users.staff.id },
    );

    expect(response.status).toBe(400);
    expect(setup.admin.calls).toEqual([]);
  });
});

describe('admin categories', () => {
  it('lists hidden categories too, with product counts', async () => {
    const setup = adminSetup();
    const response = await setup.call('get', '/admin/categories', 'staff');

    const { categories } = adminCategoryListResponseSchema.parse(response.body);
    expect(
      categories.map((category) => [category.slug, category.isActive, category.productCount]),
    ).toEqual([
      ['home-kitchen', true, 4],
      ['seasonal', false, 0],
    ]);
  });

  it('creates and replaces categories', async () => {
    const setup = adminSetup();
    const created = await setup.call('post', '/admin/categories', 'admin', {
      slug: 'garden',
      name: ' Garden ',
      description: '',
    });
    const id = adminCategoryResponseSchema.parse(created.body).category.id;
    const updated = await setup.call('put', `/admin/categories/${id}`, 'admin', {
      slug: 'garden',
      name: 'Garden & Outdoors',
      isActive: false,
    });

    expect(created.status).toBe(201);
    expect(adminCategoryResponseSchema.parse(created.body).category).toMatchObject({
      name: 'Garden',
      description: null,
      sortOrder: 0,
      isActive: true,
      productCount: 0,
    });
    expect(updated.status).toBe(200);
    expect(adminCategoryResponseSchema.parse(updated.body).category).toMatchObject({
      name: 'Garden & Outdoors',
      isActive: false,
    });
  });

  it('refuses an address in use (23505) and unknown categories (NZ404)', async () => {
    const setup = adminSetup();
    const taken = await setup.call('post', '/admin/categories', 'admin', {
      slug: 'seasonal',
      name: 'Seasonal again',
    });
    const missing = await setup.call('put', `/admin/categories/${randomUUID()}`, 'admin', {
      slug: 'garden',
      name: 'Garden',
    });

    expect(taken.status).toBe(409);
    expect(errorOf(taken.body)).toMatchObject({
      code: 'slug_taken',
      message: 'Another category already uses this address',
    });
    expect(missing.status).toBe(404);
    expect(errorOf(missing.body).message).toBe('Category not found');
  });

  it('rejects counts and ids in the body', async () => {
    const setup = adminSetup();
    const response = await setup.call('post', '/admin/categories', 'admin', {
      slug: 'garden',
      name: 'Garden',
      productCount: 10,
    });

    expect(response.status).toBe(400);
    expect(setup.admin.calls).toEqual([]);
  });

  async function tree(setup: ReturnType<typeof adminSetup>) {
    const create = async (slug: string, name: string, parentId?: string) => {
      const response = await setup.call('post', '/admin/categories', 'admin', {
        slug,
        name,
        ...(parentId === undefined ? {} : { parentId }),
      });
      return adminCategoryResponseSchema.parse(response.body).category.id;
    };
    const parent = await create('apparel', 'Apparel');
    const first = await create('apparel-one', 'One', parent);
    const second = await create('apparel-two', 'Two', parent);
    return { parent, first, second };
  }

  it('lists the products of a category together with those of its subcategories', async () => {
    const setup = adminSetup();
    const { parent, first, second } = await tree(setup);
    for (const [slug, categoryId] of [
      ['direct-item', parent],
      ['first-item', first],
      ['second-item', second],
    ] as const) {
      const created = await setup.call(
        'post',
        '/admin/products',
        'admin',
        newProduct(setup, { slug, sku: slug, categoryId }),
      );
      expect(created.status).toBe(201);
    }
    const slugsFor = async (categoryId: string) => {
      const response = await setup.call('get', `/admin/products?categoryId=${categoryId}`, 'staff');
      return adminProductListResponseSchema
        .parse(response.body)
        .products.map((product) => product.slug)
        .sort();
    };

    // A department shows its own products and every subcategory's; a subcategory only its own.
    expect(await slugsFor(parent)).toEqual(['direct-item', 'first-item', 'second-item']);
    expect(await slugsFor(first)).toEqual(['first-item']);
    expect(await slugsFor(setup.categories.kitchen.id)).not.toContain('first-item');
  });

  it('reorders one group of categories atomically, in the order given', async () => {
    const setup = adminSetup();
    const { parent, first, second } = await tree(setup);

    const reorder = await setup.call('post', '/admin/categories/reorder', 'admin', {
      parentId: parent,
      ids: [second, first],
    });
    expect(reorder.status).toBe(204);

    const list = await setup.call('get', '/admin/categories', 'admin');
    const orders = new Map(
      adminCategoryListResponseSchema
        .parse(list.body)
        .categories.map((category) => [category.id, category.sortOrder]),
    );
    expect(orders.get(second)).toBe(0);
    expect(orders.get(first)).toBe(10);
  });

  it('refuses a reorder that is not exactly one group, a repeat, or a stranger', async () => {
    const setup = adminSetup();
    const { parent, first, second } = await tree(setup);
    const call = (body: object) => setup.call('post', '/admin/categories/reorder', 'admin', body);

    // Partial list, a repeated id, another group's category, extra fields: nothing is reordered.
    expect((await call({ parentId: parent, ids: [first] })).status).toBe(400);
    expect((await call({ parentId: parent, ids: [first, first] })).status).toBe(400);
    expect(
      (await call({ parentId: parent, ids: [first, setup.categories.kitchen.id] })).status,
    ).toBe(400);
    expect((await call({ parentId: null, ids: [first, second] })).status).toBe(400);
    expect((await call({ parentId: parent, ids: [first, second], extra: true })).status).toBe(400);
    expect((await call({ parentId: parent, ids: [] })).status).toBe(400);
  });

  it('lets only people who may publish products reorder categories', async () => {
    const setup = adminSetup();
    const { parent, first, second } = await tree(setup);
    const response = await setup.call('post', '/admin/categories/reorder', 'staff', {
      parentId: parent,
      ids: [second, first],
    });
    expect(response.status).toBe(403);
  });

  it('nests a subcategory under a parent and marks it featured', async () => {
    const setup = adminSetup();
    const parent = await setup.call('post', '/admin/categories', 'admin', {
      slug: 'men',
      name: 'Men',
    });
    const parentId = adminCategoryResponseSchema.parse(parent.body).category.id;

    const child = await setup.call('post', '/admin/categories', 'admin', {
      slug: 'men-panjabi',
      name: 'Panjabi',
      parentId,
      isFeatured: true,
    });

    expect(child.status).toBe(201);
    expect(adminCategoryResponseSchema.parse(child.body).category).toMatchObject({
      parentId,
      isFeatured: true,
      imageUrl: null,
    });

    const list = await setup.call('get', '/admin/categories', 'admin');
    const bySlug = new Map(
      adminCategoryListResponseSchema
        .parse(list.body)
        .categories.map((category) => [category.slug, category]),
    );
    expect(bySlug.get('men')).toMatchObject({ parentId: null, isFeatured: false });
    expect(bySlug.get('men-panjabi')).toMatchObject({ parentId, isFeatured: true });
  });

  it('deletes an empty category', async () => {
    const setup = adminSetup();
    const created = await setup.call('post', '/admin/categories', 'admin', {
      slug: 'empty-shelf',
      name: 'Empty shelf',
    });
    const id = adminCategoryResponseSchema.parse(created.body).category.id;

    const deleted = await setup.call('delete', `/admin/categories/${id}`, 'admin');

    expect(deleted.status).toBe(204);
    expect(setup.admin.calls).toContain('deleteCategory');
  });

  it('refuses to delete a category that still has products', async () => {
    const setup = adminSetup();
    // `home-kitchen` is a seeded category that already holds products.
    const list = await setup.call('get', '/admin/categories', 'admin');
    const inUse = adminCategoryListResponseSchema
      .parse(list.body)
      .categories.find((category) => category.slug === 'home-kitchen');
    expect(inUse).toBeDefined();

    const response = await setup.call('delete', `/admin/categories/${inUse?.id ?? ''}`, 'admin');

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('category_in_use');
  });

  it('refuses to delete a category that still has subcategories', async () => {
    const setup = adminSetup();
    const parent = await setup.call('post', '/admin/categories', 'admin', {
      slug: 'women',
      name: 'Women',
    });
    const parentId = adminCategoryResponseSchema.parse(parent.body).category.id;
    await setup.call('post', '/admin/categories', 'admin', {
      slug: 'women-saree',
      name: 'Saree',
      parentId,
    });

    const response = await setup.call('delete', `/admin/categories/${parentId}`, 'admin');

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('category_in_use');
  });

  it('refuses deletion to staff who cannot publish', async () => {
    const setup = adminSetup();
    const created = await setup.call('post', '/admin/categories', 'admin', {
      slug: 'temp-shelf',
      name: 'Temp',
    });
    const id = adminCategoryResponseSchema.parse(created.body).category.id;

    const response = await setup.call('delete', `/admin/categories/${id}`, 'staff');

    expect(response.status).toBe(403);
  });

  it('answers 503 for a category image when media storage is not configured', async () => {
    const setup = adminSetup();
    const created = await setup.call('post', '/admin/categories', 'admin', {
      slug: 'photo-shelf',
      name: 'Photo shelf',
    });
    const id = adminCategoryResponseSchema.parse(created.body).category.id;

    const response = await setup
      .call('post', `/admin/categories/${id}/image`, 'admin')
      .set('Content-Type', 'image/jpeg')
      .send(Buffer.from([0xff, 0xd8, 0xff]));

    expect(response.status).toBe(503);
    expect(errorOf(response.body).code).toBe('media_unavailable');
  });
});

describe('category page banner', () => {
  async function categoryId(setup: ReturnType<typeof adminSetup>) {
    const created = await setup.call('post', '/admin/categories', 'admin', {
      slug: 'banner-shelf',
      name: 'Banner shelf',
    });
    return adminCategoryResponseSchema.parse(created.body).category.id;
  }

  it('answers 503 for a banner upload when media storage is not configured', async () => {
    const setup = adminSetup();
    const id = await categoryId(setup);

    const response = await setup
      .call('post', `/admin/categories/${id}/banner`, 'admin')
      .set('Content-Type', 'image/jpeg')
      .send(Buffer.from([0xff, 0xd8, 0xff]));

    expect(response.status).toBe(503);
    expect(errorOf(response.body).code).toBe('media_unavailable');
  });

  it('removes a banner for those who can publish, and refuses everyone else', async () => {
    const setup = adminSetup();
    const id = await categoryId(setup);
    setup.admin.banners.set(id, `categories/${id}/11111111-1111-4111-8111-111111111111`);

    const refused = await setup.call('delete', `/admin/categories/${id}/banner`, 'moderator');
    const removed = await setup.call('delete', `/admin/categories/${id}/banner`, 'admin');

    expect(refused.status).toBe(403);
    expect(setup.admin.banners.has(id)).toBe(false);
    expect(removed.status).toBe(204);
  });

  it('answers 404 for a banner on a category that does not exist', async () => {
    const setup = adminSetup();

    const response = await setup.call(
      'delete',
      '/admin/categories/99999999-9999-4999-8999-999999999999/banner',
      'admin',
    );

    expect(response.status).toBe(404);
  });
});

describe('GET /api/v1/admin/inventory-movements', () => {
  it('lists the ledger newest first, filtered by product and reason', async () => {
    const setup = adminSetup();
    const { lamp, watch } = setup.products;
    await setup.call('post', `/admin/products/${lamp.id}/stock`, 'staff', {
      change: 3,
      note: 'Supplier delivery',
    });
    await setup.call('post', `/admin/products/${watch.id}/stock`, 'staff', {
      change: 2,
      note: 'Returned stock',
    });
    const all = await setup.call('get', '/admin/inventory-movements', 'admin');
    const lampOnly = await setup.call(
      'get',
      `/admin/inventory-movements?productId=${lamp.id}&reason=adjustment`,
      'admin',
    );

    const listed = inventoryMovementListResponseSchema.parse(all.body);
    expect(listed.movements.map((movement) => movement.product.id)).toEqual([watch.id, lamp.id]);
    expect(listed.movements[0]?.actor).toMatchObject({
      id: setup.users.staff.id,
      name: 'Sadia Staff',
      email: 'staff@example.com',
    });
    const filtered = inventoryMovementListResponseSchema.parse(lampOnly.body);
    expect(filtered).toMatchObject({ total: 1, movements: [{ change: 3, stockAfter: 23 }] });
  });

  it('is for those who adjust stock or edit products, not for reviewers', async () => {
    const setup = adminSetup();
    const moderator = await setup.call('get', '/admin/inventory-movements', 'moderator');
    setup.users.otherModerator.overrides.set('inventory.adjust', 'grant');
    const granted = await setup.call('get', '/admin/inventory-movements', 'otherModerator');

    expect(moderator.status).toBe(403);
    expect(granted.status).toBe(200);
  });

  it('rejects an unknown reason', async () => {
    const setup = adminSetup();
    const response = await setup.call('get', '/admin/inventory-movements?reason=theft', 'admin');

    expect(response.status).toBe(400);
  });
});

describe('database failures on admin catalog routes', () => {
  it('answers a permission withdrawn between the API check and the database (NZ403) with 403', async () => {
    const setup = adminSetup();
    setup.admin.nextFailure = { code: 'NZ403' };
    const response = await setup.call('post', '/admin/products', 'staff', newProduct(setup));

    expect(response.status).toBe(403);
    expect(errorOf(response.body).code).toBe('forbidden');
  });

  it('answers a check violation (23514) with 400 bad_request', async () => {
    const setup = adminSetup();
    setup.admin.nextFailure = { code: '23514' };
    const response = await setup.call('post', '/admin/products', 'staff', newProduct(setup));

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('bad_request');
  });

  it.each([
    ['an unexpected SQLSTATE', { code: 'XX000' }],
    ['an unknown unique key', { code: '23505', details: 'Key (token)=(x) already exists.' }],
    ['a network failure', { code: '' }],
  ])('answers %s with 503, never the database text', async (_label, failure) => {
    const setup = adminSetup();
    setup.admin.nextFailure = failure;
    const response = await setup.call('get', '/admin/products', 'staff');

    expect(response.status).toBe(503);
    expect(errorOf(response.body).code).toBe('service_unavailable');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(response.body)).not.toContain(DB_MESSAGE);
    expect(JSON.stringify(response.body)).not.toContain('Key (');
  });
});
