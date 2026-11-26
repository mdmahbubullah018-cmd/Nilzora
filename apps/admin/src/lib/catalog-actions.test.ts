import type {
  AdminCategory,
  AdminProductDetail,
  CategoryInput,
  CreateProductRequest,
  StockAdjustmentRequest,
  UpdateProductRequest,
} from '@nilzora/contracts';
import { ApiError, type FormState, type SessionAct, type SessionCall } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedirectSignal, throwRedirect } from '@/test/redirect';
import {
  adjustStockAction,
  createProductAction,
  saveCategoryAction,
  setCategoryActiveAction,
  setProductStatusAction,
  submitForReviewAction,
  updateProductAction,
  withdrawReviewAction,
} from './catalog-actions';

type Gate = 'ok' | 'untrusted' | 'signed_out' | 'unavailable';

const browser = vi.hoisted((): { gate: Gate } => ({ gate: 'ok' }));
const api = vi.hoisted(() => ({
  adminGetProduct: vi.fn<(token: string, id: string) => Promise<{ product: AdminProductDetail }>>(),
  adminCreateProduct:
    vi.fn<
      (token: string, body: CreateProductRequest) => Promise<{ product: AdminProductDetail }>
    >(),
  adminUpdateProduct:
    vi.fn<
      (
        token: string,
        id: string,
        body: UpdateProductRequest,
      ) => Promise<{ product: AdminProductDetail }>
    >(),
  adminAdjustStock:
    vi.fn<
      (
        token: string,
        id: string,
        body: StockAdjustmentRequest,
      ) => Promise<{ product: AdminProductDetail }>
    >(),
  adminSubmitProduct:
    vi.fn<(token: string, id: string) => Promise<{ product: AdminProductDetail }>>(),
  adminWithdrawModeration: vi.fn<(token: string, taskId: string) => Promise<unknown>>(),
  adminSetProductStatus:
    vi.fn<
      (
        token: string,
        id: string,
        body: { status: string },
      ) => Promise<{ product: AdminProductDetail }>
    >(),
  adminListCategories: vi.fn<(token: string) => Promise<{ categories: AdminCategory[] }>>(),
  adminCreateCategory:
    vi.fn<(token: string, body: CategoryInput) => Promise<{ category: AdminCategory }>>(),
  adminUpdateCategory:
    vi.fn<
      (token: string, id: string, body: CategoryInput) => Promise<{ category: AdminCategory }>
    >(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('./session', () => ({
  session: {
    act: async <T>(_formData: FormData, call: SessionCall<T>): Promise<SessionAct<T>> => {
      if (browser.gate !== 'ok') return { kind: browser.gate };
      return { kind: 'ok', value: await call(api as never, 'tok') };
    },
  },
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn(throwRedirect) }));
vi.mock('next/cache', () => ({ revalidatePath }));

const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const CATEGORY_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '33333333-3333-4333-8333-333333333333';
const idle: FormState = { status: 'idle' };

function product(overrides: Partial<AdminProductDetail> = {}): AdminProductDetail {
  return {
    id: PRODUCT_ID,
    slug: 'cotton-panjabi',
    sku: 'NZ-PANJABI',
    name: 'Cotton panjabi',
    summary: 'Soft cotton',
    description: null,
    status: 'active',
    moderationStatus: 'approved',
    priceMinor: 250_000,
    compareAtPriceMinor: 300_000,
    stockQuantity: 12,
    maxOrderQuantity: 10,
    isFeatured: false,
    image: null,
    images: [],
    category: { id: CATEGORY_ID, slug: 'fashion', name: 'Fashion', isActive: true },
    publishedAt: '2026-10-21T06:00:00.000Z',
    updatedAt: '2026-10-25T06:00:00.000Z',
    createdAt: '2026-10-20T06:00:00.000Z',
    latestReview: null,
    ...overrides,
  };
}

const category: AdminCategory = {
  id: CATEGORY_ID,
  slug: 'fashion',
  name: 'Fashion',
  description: 'Clothes',
  sortOrder: 2,
  isActive: true,
  parentId: null,
  isFeatured: false,
  imageUrl: null,
  productCount: 4,
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  data.append('csrf_token', 'signed-csrf-value');
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

function apiError(status: number, code: string, details?: unknown): ApiError {
  return new ApiError(status, code, 'API text that must never be shown', 'req-1', { details });
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.catch((e: unknown) => e);
  if (!(error instanceof RedirectSignal))
    throw new Error(`expected a redirect, got ${String(error)}`);
  return error.url;
}

const CREATE_FIELDS = {
  name: 'Cotton Panjabi',
  slug: '',
  categoryId: CATEGORY_ID,
  summary: '',
  description: 'Breathable cotton.',
  price: '2,500',
  compareAtPrice: '',
  maxOrderQuantity: '5',
  isFeatured: 'on',
  sku: 'nz-panjabi-m',
  initialStock: '20',
};

beforeEach(() => {
  browser.gate = 'ok';
  for (const mock of Object.values(api)) mock.mockReset();
  revalidatePath.mockReset();
  api.adminGetProduct.mockResolvedValue({ product: product() });
  api.adminCreateProduct.mockResolvedValue({ product: product({ status: 'draft' }) });
  api.adminUpdateProduct.mockResolvedValue({ product: product() });
  api.adminAdjustStock.mockResolvedValue({ product: product() });
  api.adminSubmitProduct.mockResolvedValue({ product: product() });
  api.adminSetProductStatus.mockResolvedValue({ product: product() });
  api.adminWithdrawModeration.mockResolvedValue({});
  api.adminListCategories.mockResolvedValue({ categories: [category] });
  api.adminCreateCategory.mockResolvedValue({ category });
  api.adminUpdateCategory.mockResolvedValue({ category });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('createProductAction', () => {
  it('creates a draft from validated fields only and opens it', async () => {
    const fields = { ...CREATE_FIELDS, status: 'active', stockQuantity: '999', role: 'admin' };
    await expect(redirectOf(createProductAction(idle, form(fields)))).resolves.toBe(
      `/admin/products/${PRODUCT_ID}?notice=created`,
    );
    expect(api.adminCreateProduct).toHaveBeenCalledWith('tok', {
      categoryId: CATEGORY_ID,
      slug: 'cotton-panjabi',
      name: 'Cotton Panjabi',
      summary: null,
      description: 'Breathable cotton.',
      priceMinor: 250_000,
      compareAtPriceMinor: null,
      maxOrderQuantity: 5,
      isFeatured: true,
      sku: 'NZ-PANJABI-M',
      initialStock: 20,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/products');
  });

  it('reports every invalid field before calling the API, keeping what was typed', async () => {
    const state = await createProductAction(
      idle,
      form({
        ...CREATE_FIELDS,
        name: '',
        categoryId: 'nope',
        price: 'cheap',
        compareAtPrice: '10',
        maxOrderQuantity: '500',
        sku: '!',
      }),
    );
    expect(state.status).toBe('error');
    expect(Object.keys(state.fieldErrors ?? {}).sort()).toEqual(
      ['categoryId', 'maxOrderQuantity', 'name', 'price', 'sku'].sort(),
    );
    expect(state.values?.price).toBe('cheap');
    expect(api.adminCreateProduct).not.toHaveBeenCalled();
  });

  it('refuses a former price that is not above the price', async () => {
    const state = await createProductAction(
      idle,
      form({ ...CREATE_FIELDS, compareAtPrice: '2000' }),
    );
    expect(state.fieldErrors).toEqual({
      compareAtPrice: 'Enter a former price higher than the price, or leave it empty.',
    });
  });

  it('never calls the API for an untrusted form', async () => {
    browser.gate = 'untrusted';
    const state = await createProductAction(idle, form(CREATE_FIELDS));
    expect(state.message).toMatch(/expired or did not come from Nilzora/);
    expect(api.adminCreateProduct).not.toHaveBeenCalled();
  });

  it('sends a lapsed session to sign in and back to the form', async () => {
    browser.gate = 'signed_out';
    await expect(redirectOf(createProductAction(idle, form(CREATE_FIELDS)))).resolves.toBe(
      '/login?next=%2Fadmin%2Fproducts%2Fnew',
    );
  });

  it.each([
    [apiError(409, 'sku_taken'), { sku: 'Another product already uses this SKU. Choose another.' }],
    [
      apiError(409, 'slug_taken'),
      { slug: 'Another item already uses this address. Choose another.' },
    ],
    [
      apiError(400, 'validation_failed', {
        issues: [{ location: 'body', path: 'priceMinor', message: 'Too big' }],
      }),
      { price: expect.stringMatching(/Enter the price in taka/) as unknown as string },
    ],
  ])('maps %s to a field message', async (error, fieldErrors) => {
    api.adminCreateProduct.mockRejectedValue(error);
    const state = await createProductAction(idle, form(CREATE_FIELDS));
    expect(state.fieldErrors).toEqual(fieldErrors);
    expect(state.message).toBe('Check the highlighted fields.');
  });

  it('explains a missing permission and an outage without the API’s text', async () => {
    api.adminCreateProduct.mockRejectedValue(apiError(403, 'forbidden'));
    const forbidden = await createProductAction(idle, form(CREATE_FIELDS));
    expect(forbidden.message).toMatch(/does not have permission/);

    api.adminCreateProduct.mockRejectedValue(apiError(503, 'service_unavailable'));
    const outage = await createProductAction(idle, form(CREATE_FIELDS));
    expect(outage.message).toMatch(/could not confirm the product was created/);
    expect(JSON.stringify([forbidden, outage])).not.toContain('must never be shown');
  });
});

describe('updateProductAction', () => {
  it('changes only the pricing section, sending the rest as the API has it', async () => {
    const data = form({
      productId: PRODUCT_ID,
      section: 'pricing',
      price: '2400',
      compareAtPrice: '',
      // Fields of other sections are ignored.
      name: 'Hijacked name',
    });
    await expect(redirectOf(updateProductAction(idle, data))).resolves.toBe(
      `/admin/products/${PRODUCT_ID}?notice=pricing`,
    );
    expect(api.adminUpdateProduct).toHaveBeenCalledWith('tok', PRODUCT_ID, {
      categoryId: CATEGORY_ID,
      slug: 'cotton-panjabi',
      name: 'Cotton panjabi',
      summary: 'Soft cotton',
      description: null,
      priceMinor: 240_000,
      compareAtPriceMinor: null,
      maxOrderQuantity: 10,
      isFeatured: false,
    });
  });

  it('saves content and ordering sections', async () => {
    await redirectOf(
      updateProductAction(
        idle,
        form({
          productId: PRODUCT_ID,
          section: 'content',
          name: 'Linen panjabi',
          slug: 'linen-panjabi',
          categoryId: CATEGORY_ID,
          summary: '',
          description: 'New text',
        }),
      ),
    );
    expect(api.adminUpdateProduct.mock.calls[0]?.[2]).toMatchObject({
      name: 'Linen panjabi',
      slug: 'linen-panjabi',
      summary: null,
      priceMinor: 250_000,
    });

    await redirectOf(
      updateProductAction(
        idle,
        form({
          productId: PRODUCT_ID,
          section: 'ordering',
          maxOrderQuantity: '3',
          isFeatured: 'on',
        }),
      ),
    );
    expect(api.adminUpdateProduct.mock.calls[1]?.[2]).toMatchObject({
      maxOrderQuantity: 3,
      isFeatured: true,
      name: 'Cotton panjabi',
    });
  });

  it('flags a price at or above the saved former price on the pricing form', async () => {
    const state = await updateProductAction(
      idle,
      form({ productId: PRODUCT_ID, section: 'pricing', price: '3500', compareAtPrice: '3000' }),
    );
    expect(state.fieldErrors).toEqual({
      compareAtPrice: 'Enter a former price higher than the price, or leave it empty.',
    });
    expect(api.adminUpdateProduct).not.toHaveBeenCalled();
  });

  it.each([
    ['product_content_locked', /on sale, so its content cannot change/],
    ['product_under_review', /under review/],
    ['not_found', /no longer exists/],
    ['rate_limited', /Too many changes/],
  ])('explains %s', async (code, message) => {
    api.adminUpdateProduct.mockRejectedValue(apiError(409, code));
    const state = await updateProductAction(
      idle,
      form({
        productId: PRODUCT_ID,
        section: 'content',
        name: 'New',
        slug: 'new',
        categoryId: CATEGORY_ID,
      }),
    );
    expect(state.message).toMatch(message);
  });

  it('explains the publish permission when the API refuses changing a product on sale', async () => {
    api.adminUpdateProduct.mockRejectedValue(apiError(403, 'forbidden'));
    const state = await updateProductAction(
      idle,
      form({ productId: PRODUCT_ID, section: 'ordering', maxOrderQuantity: '3' }),
    );
    expect(state.message).toMatch(
      /on sale, the price, former price, order limit and featuring need/,
    );
    expect(state.values?.maxOrderQuantity).toBe('3');

    // Content refusals keep the general wording.
    const content = await updateProductAction(
      idle,
      form({
        productId: PRODUCT_ID,
        section: 'content',
        name: 'N',
        slug: 'n',
        categoryId: CATEGORY_ID,
      }),
    );
    expect(content.message).toMatch(/does not have permission to do this/);
  });

  it('refuses a tampered product id or section without calling the API', async () => {
    for (const fields of [
      { productId: '../../admin', section: 'pricing' },
      { productId: PRODUCT_ID, section: 'status' },
    ]) {
      const state = await updateProductAction(idle, form(fields));
      expect(state.message).toMatch(/out of date/);
    }
    expect(api.adminGetProduct).not.toHaveBeenCalled();
  });
});

describe('updateProductAction with several sections (the one-form product page)', () => {
  function editForm(fields: Record<string, string>, sections: string[]): FormData {
    const data = form({ productId: PRODUCT_ID, ...fields });
    for (const section of sections) data.append('section', section);
    return data;
  }

  it('saves every shown section in one change and returns with the general notice', async () => {
    api.adminGetProduct.mockResolvedValue({ product: product({ status: 'draft' }) });
    const url = await redirectOf(
      updateProductAction(
        idle,
        editForm(
          {
            name: 'Linen panjabi',
            slug: 'linen-panjabi',
            categoryId: CATEGORY_ID,
            summary: '',
            description: '',
            sizeChart: 'Size | Chest (cm)\nM | 96\nL',
            price: '2400',
            compareAtPrice: '',
            maxOrderQuantity: '4',
            isFeatured: 'on',
            tags: 'Summer Sale, eid-2026, summer sale',
          },
          ['content', 'pricing', 'ordering'],
        ),
      ),
    );
    expect(url).toBe(`/admin/products/${PRODUCT_ID}?notice=saved`);
    expect(api.adminUpdateProduct).toHaveBeenCalledTimes(1);
    expect(api.adminUpdateProduct.mock.calls[0]?.[2]).toEqual({
      categoryId: CATEGORY_ID,
      slug: 'linen-panjabi',
      name: 'Linen panjabi',
      summary: null,
      description: null,
      priceMinor: 240_000,
      compareAtPriceMinor: null,
      maxOrderQuantity: 4,
      isFeatured: true,
      // Tags are normalised and de-duplicated by the contract.
      tags: ['summer sale', 'eid-2026'],
      // A short row is padded to the width of the chart.
      sizeChart: { columns: ['Size', 'Chest (cm)'], rows: [['M', '96'], ['L', '']] },
    });
  });

  it('keeps the tags and size chart when the form does not show them, and clears an emptied chart', async () => {
    await redirectOf(
      updateProductAction(idle, editForm({ maxOrderQuantity: '3' }, ['ordering'])),
    );
    expect(api.adminUpdateProduct.mock.calls[0]?.[2]).not.toHaveProperty('tags');
    expect(api.adminUpdateProduct.mock.calls[0]?.[2]).not.toHaveProperty('sizeChart');

    api.adminGetProduct.mockResolvedValue({ product: product({ status: 'draft' }) });
    await redirectOf(
      updateProductAction(
        idle,
        editForm(
          { name: 'Cotton panjabi', slug: 'cotton-panjabi', categoryId: CATEGORY_ID, sizeChart: '' },
          ['content'],
        ),
      ),
    );
    expect(api.adminUpdateProduct.mock.calls[1]?.[2]).toMatchObject({ sizeChart: null });
  });

  it('reports bad tags and a bad size chart beside their fields, before any API call', async () => {
    const state = await updateProductAction(
      idle,
      editForm(
        {
          name: 'Cotton panjabi',
          slug: 'cotton-panjabi',
          categoryId: CATEGORY_ID,
          sizeChart: 'Size | Chest\nM | 96 | extra',
          maxOrderQuantity: '3',
          tags: 'ok, Not_Allowed!',
        },
        ['content', 'ordering'],
      ),
    );
    expect(state.fieldErrors?.sizeChart).toMatch(/more entries than there are columns/);
    expect(state.fieldErrors?.tags).toMatch(/lower-case letters, numbers, spaces and hyphens/);
    expect(state.values?.tags).toBe('ok, Not_Allowed!');
    expect(api.adminGetProduct).not.toHaveBeenCalled();
  });

  it('refuses a section named twice or an unknown one among known ones', async () => {
    for (const sections of [['pricing', 'pricing'], ['pricing', 'status']]) {
      const state = await updateProductAction(idle, editForm({ price: '1' }, sections));
      expect(state.message).toMatch(/out of date/);
    }
    expect(api.adminGetProduct).not.toHaveBeenCalled();
  });
});

describe('createProductAction with tags and a size chart', () => {
  it('sends them when the form shows them', async () => {
    await redirectOf(
      createProductAction(
        idle,
        form({ ...CREATE_FIELDS, tags: 'new in', sizeChart: 'Size\nM' }),
      ),
    );
    expect(api.adminCreateProduct.mock.calls[0]?.[1]).toMatchObject({
      tags: ['new in'],
      sizeChart: { columns: ['Size'], rows: [['M']] },
    });
  });
});

describe('adjustStockAction', () => {
  it('records a signed change with its reason', async () => {
    await expect(
      redirectOf(
        adjustStockAction(
          idle,
          form({ productId: PRODUCT_ID, direction: 'remove', quantity: '3', note: 'Damaged' }),
        ),
      ),
    ).resolves.toBe(`/admin/products/${PRODUCT_ID}?notice=stock`);
    expect(api.adminAdjustStock).toHaveBeenCalledWith('tok', PRODUCT_ID, {
      change: -3,
      note: 'Damaged',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/inventory');
  });

  it('requires a quantity and a reason', async () => {
    const state = await adjustStockAction(
      idle,
      form({ productId: PRODUCT_ID, direction: 'add', quantity: '0', note: 'x' }),
    );
    expect(Object.keys(state.fieldErrors ?? {}).sort()).toEqual(['note', 'quantity']);
    expect(api.adminAdjustStock).not.toHaveBeenCalled();
  });

  it('marks the quantity when stock would go below zero, and warns before retrying an unknown outcome', async () => {
    api.adminAdjustStock.mockRejectedValue(apiError(409, 'stock_below_zero'));
    const below = await adjustStockAction(
      idle,
      form({ productId: PRODUCT_ID, direction: 'remove', quantity: '99', note: 'Count' }),
    );
    expect(below.fieldErrors?.quantity).toMatch(/less than zero/);

    api.adminAdjustStock.mockRejectedValue(apiError(503, 'service_unavailable'));
    const lost = await adjustStockAction(
      idle,
      form({ productId: PRODUCT_ID, direction: 'add', quantity: '5', note: 'Delivery' }),
    );
    expect(lost.message).toMatch(/check the stock and its recent movements before trying again/);
  });
});

describe('review actions', () => {
  it('submits a draft for review', async () => {
    await expect(
      redirectOf(submitForReviewAction(idle, form({ productId: PRODUCT_ID }))),
    ).resolves.toBe(`/admin/products/${PRODUCT_ID}?notice=submitted`);
    expect(api.adminSubmitProduct).toHaveBeenCalledWith('tok', PRODUCT_ID);
  });

  it('explains why a product cannot be submitted', async () => {
    api.adminSubmitProduct.mockRejectedValue(apiError(409, 'product_content_locked'));
    const state = await submitForReviewAction(idle, form({ productId: PRODUCT_ID }));
    expect(state.message).toMatch(/Only draft products can be submitted/);
  });

  it('withdraws the product’s own pending review, never a task id from the form', async () => {
    api.adminGetProduct.mockResolvedValue({
      product: product({
        status: 'draft',
        moderationStatus: 'pending',
        latestReview: {
          taskId: TASK_ID,
          status: 'pending',
          note: null,
          submittedAt: '2026-10-24T06:00:00.000Z',
          decidedAt: null,
          assigned: true,
        },
      }),
    });
    const data = form({ productId: PRODUCT_ID, taskId: '44444444-4444-4444-8444-444444444444' });
    await expect(redirectOf(withdrawReviewAction(idle, data))).resolves.toBe(
      `/admin/products/${PRODUCT_ID}?notice=withdrawn`,
    );
    expect(api.adminWithdrawModeration).toHaveBeenCalledWith('tok', TASK_ID);
  });

  it('says so when there is no review in progress', async () => {
    const state = await withdrawReviewAction(idle, form({ productId: PRODUCT_ID }));
    expect(state.message).toMatch(/no review in progress/);
    expect(api.adminWithdrawModeration).not.toHaveBeenCalled();
  });
});

describe('setProductStatusAction', () => {
  it.each([
    ['active', 'draft', 'published'],
    ['draft', 'active', 'unpublished'],
    ['archived', 'draft', 'archived'],
    ['draft', 'archived', 'restored'],
  ] as const)('sets %s (from %s) and confirms "%s"', async (status, before, notice) => {
    api.adminGetProduct.mockResolvedValue({ product: product({ status: before }) });
    await expect(
      redirectOf(setProductStatusAction(idle, form({ productId: PRODUCT_ID, status }))),
    ).resolves.toBe(`/admin/products/${PRODUCT_ID}?notice=${notice}`);
    expect(api.adminSetProductStatus).toHaveBeenCalledWith('tok', PRODUCT_ID, { status });
  });

  it('returns to the product list it was used from, and nowhere else', async () => {
    const back = (returnTo: string) =>
      redirectOf(
        setProductStatusAction(idle, form({ productId: PRODUCT_ID, status: 'active', returnTo })),
      );
    await expect(back('/admin/products?status=draft&sort=-price&page=2')).resolves.toBe(
      '/admin/products?status=draft&sort=-price&page=2&notice=published',
    );
    await expect(back('/admin/products')).resolves.toBe('/admin/products?notice=published');
    for (const elsewhere of [
      'https://evil.example/admin/products',
      '//evil.example',
      '/admin/products/../staff',
      '/admin/staff',
      '/admin/products?x=<script>',
    ]) {
      await expect(back(elsewhere)).resolves.toBe(`/admin/products/${PRODUCT_ID}?notice=published`);
    }
  });

  it('explains that publishing needs approved content, and refuses unknown statuses', async () => {
    api.adminSetProductStatus.mockRejectedValue(apiError(409, 'product_not_approved'));
    const state = await setProductStatusAction(
      idle,
      form({ productId: PRODUCT_ID, status: 'active' }),
    );
    expect(state.message).toMatch(/Only products with approved content can be published/);

    const tampered = await setProductStatusAction(
      idle,
      form({ productId: PRODUCT_ID, status: 'deleted' }),
    );
    expect(tampered.message).toMatch(/out of date/);
  });

  it('reports an unreachable API and a signed-out session', async () => {
    browser.gate = 'unavailable';
    const state = await setProductStatusAction(
      idle,
      form({ productId: PRODUCT_ID, status: 'draft' }),
    );
    expect(state.message).toMatch(/could not be reached/);

    browser.gate = 'signed_out';
    await expect(
      redirectOf(setProductStatusAction(idle, form({ productId: PRODUCT_ID, status: 'draft' }))),
    ).resolves.toBe(`/login?next=%2Fadmin%2Fproducts%2F${PRODUCT_ID}`);
  });
});

describe('category actions', () => {
  it('creates a category, making the address from the name', async () => {
    await expect(
      redirectOf(
        saveCategoryAction(
          idle,
          form({
            name: 'Home & Kitchen',
            slug: '',
            description: '',
            sortOrder: '3',
            isActive: 'on',
          }),
        ),
      ),
    ).resolves.toBe('/admin/categories?notice=category-created');
    expect(api.adminCreateCategory).toHaveBeenCalledWith('tok', {
      name: 'Home & Kitchen',
      slug: 'home-and-kitchen',
      description: null,
      sortOrder: 3,
      isActive: true,
      parentId: null,
      isFeatured: false,
    });
  });

  it('edits a category without changing its visibility', async () => {
    api.adminListCategories.mockResolvedValue({ categories: [{ ...category, isActive: false }] });
    await redirectOf(
      saveCategoryAction(
        idle,
        form({
          categoryId: CATEGORY_ID,
          name: 'Fashion',
          slug: 'fashion',
          sortOrder: '1',
          isActive: 'on',
        }),
      ),
    );
    expect(api.adminUpdateCategory.mock.calls[0]?.[2]).toMatchObject({
      isActive: false,
      sortOrder: 1,
    });
  });

  it('marks a taken address and an invalid sort order', async () => {
    api.adminCreateCategory.mockRejectedValue(apiError(409, 'slug_taken'));
    const taken = await saveCategoryAction(idle, form({ name: 'Fashion', slug: 'fashion' }));
    expect(taken.fieldErrors).toEqual({
      slug: 'Another item already uses this address. Choose another.',
    });

    const bad = await saveCategoryAction(idle, form({ name: 'Fashion', sortOrder: '1.5' }));
    expect(bad.fieldErrors?.sortOrder).toMatch(/whole number/);
  });

  it('hides a category with every other field as the API has it', async () => {
    await expect(
      redirectOf(setCategoryActiveAction(idle, form({ categoryId: CATEGORY_ID, active: 'false' }))),
    ).resolves.toBe('/admin/categories?notice=category-hidden');
    expect(api.adminUpdateCategory).toHaveBeenCalledWith('tok', CATEGORY_ID, {
      slug: 'fashion',
      name: 'Fashion',
      description: 'Clothes',
      sortOrder: 2,
      isActive: false,
      parentId: null,
      isFeatured: false,
    });
  });

  it('keeps a subcategory under its parent and featured when it is shown or hidden', async () => {
    const PARENT_ID = '44444444-4444-4444-8444-444444444444';
    api.adminListCategories.mockResolvedValue({
      categories: [{ ...category, parentId: PARENT_ID, isFeatured: true }],
    });
    await redirectOf(setCategoryActiveAction(idle, form({ categoryId: CATEGORY_ID, active: 'false' })));
    // The PUT replaces every field: leaving these out would move it to the top level.
    expect(api.adminUpdateCategory.mock.calls[0]?.[2]).toMatchObject({
      parentId: PARENT_ID,
      isFeatured: true,
      isActive: false,
    });
  });

  it('reports a missing category, a refusal and a tampered value', async () => {
    api.adminListCategories.mockResolvedValue({ categories: [] });
    const gone = await setCategoryActiveAction(
      idle,
      form({ categoryId: CATEGORY_ID, active: 'true' }),
    );
    expect(gone.message).toMatch(/category no longer exists/);

    api.adminListCategories.mockResolvedValue({ categories: [category] });
    api.adminUpdateCategory.mockRejectedValue(apiError(403, 'forbidden'));
    const refused = await setCategoryActiveAction(
      idle,
      form({ categoryId: CATEGORY_ID, active: 'false' }),
    );
    expect(refused.message).toMatch(/does not have permission/);

    const tampered = await setCategoryActiveAction(
      idle,
      form({ categoryId: CATEGORY_ID, active: 'maybe' }),
    );
    expect(tampered.message).toMatch(/out of date/);
  });
});
