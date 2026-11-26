// @vitest-environment jsdom
import { ApiError, type ApiClient, type SessionUser } from '@nilzora/web-session';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AnalyticsPage from '@/app/admin/analytics/page';
import AttributesPage from '@/app/admin/attributes/page';
import BrandsPage from '@/app/admin/brands/page';
import CategoryPage from '@/app/admin/categories/[categoryId]/page';
import NewCategoryPage from '@/app/admin/categories/new/page';
import CategoriesPage from '@/app/admin/categories/page';
import MediaLibraryPage from '@/app/admin/media/page';
import ProductVariantsPage from '@/app/admin/products/[productId]/variants/page';
import ReviewsPage from '@/app/admin/reviews/page';
import InventoryPage from '@/app/admin/inventory/page';
import ProductPage from '@/app/admin/products/[productId]/page';
import NewProductPage from '@/app/admin/products/new/page';
import ProductsPage from '@/app/admin/products/page';
import { analyticsOverview } from '@/components/dashboard/fixtures';
import { testUser } from '@/test/fixtures';
import { RedirectSignal } from '@/test/redirect';
import {
  CATEGORY_ID,
  page,
  PRODUCT_ID,
  testCategory,
  testMovement,
  testProduct,
  testReview,
} from './fixtures';

const gate = vi.hoisted(() => ({ user: null as SessionUser | null }));
type ReadOutcome = 'ok' | 'signed_out' | 'unavailable';
const read = vi.hoisted((): { outcome: ReadOutcome } => ({ outcome: 'ok' }));
const api = vi.hoisted(() => ({
  adminListProducts: vi.fn(),
  adminGetProduct: vi.fn(),
  adminListCategories: vi.fn(),
  adminListBrands: vi.fn(),
  adminGetProductBrand: vi.fn(),
  adminListInventoryMovements: vi.fn(),
  adminAnalyticsOverview:
    vi.fn<
      (token: string, query: { from: string; to: string; compare?: string }) => Promise<unknown>
    >(),
  adminGetModerationTask: vi.fn(),
  adminProductVariants: vi.fn(),
  adminListProductVideos: vi.fn(),
  adminListAttributes: vi.fn(),
  adminListReviews: vi.fn(),
  adminListMedia: vi.fn(),
  adminCategoryCampaigns: vi.fn(),
  adminSeoOverview: vi.fn(),
  adminListZones: vi.fn(),
  adminProductZones: vi.fn(),
}));

vi.mock('@/lib/access', () => ({
  workspaceGate: () =>
    Promise.resolve({
      access: 'allowed',
      user: gate.user,
      csrf: { name: 'csrf_token', token: 't' },
    }),
}));
vi.mock('@/lib/session', () => ({
  session: {
    read: async (call: (client: ApiClient, token: string) => Promise<unknown>) => {
      if (read.outcome !== 'ok') return { kind: read.outcome };
      return { kind: 'ok', value: await call(api as unknown as ApiClient, 'access-token') };
    },
  },
}));
vi.mock('@/components/shell/workspace-shell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/lib/catalog-actions', () => ({
  createProductAction: vi.fn(),
  updateProductAction: vi.fn(),
  adjustStockAction: vi.fn(),
  submitForReviewAction: vi.fn(),
  withdrawReviewAction: vi.fn(),
  setProductStatusAction: vi.fn(),
  saveCategoryAction: vi.fn(),
  setCategoryActiveAction: vi.fn(),
  moveCategoryAction: vi.fn(),
}));
vi.mock('next/navigation', async () => {
  // Imported here: the pages (and so this mock) load before the test's own imports.
  const { throwRedirect } = await import('@/test/redirect');
  // The image upload form reads the router to refresh the page after a confirmed upload.
  return {
    redirect: vi.fn(throwRedirect),
    useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  };
});
vi.mock('next/form', () => ({
  default: ({ action, ...props }: ComponentProps<'form'> & { action: string }) => (
    <form action={action} method="get" {...props} />
  ),
}));

function props<T>(params: T, searchParams: Record<string, string> = {}) {
  return { params: Promise.resolve(params), searchParams: Promise.resolve(searchParams) } as never;
}

async function show(element: Promise<ReactNode>) {
  render(await element);
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.catch((e: unknown) => e);
  if (!(error instanceof RedirectSignal)) throw new Error('expected a redirect');
  return error.url;
}

/**
 * The triggers of confirmations (a <summary> before hydration, a dialog button after)
 * and single-step buttons in `root`, leaving out the confirmation panels themselves.
 */
function actionLabels(root: ParentNode = document): (string | null)[] {
  return Array.from(
    root.querySelectorAll('summary, button[aria-haspopup="dialog"], button[type="submit"]'),
  )
    .filter((element) => !element.closest('dialog, details > div'))
    .map((element) => element.textContent);
}

function summaries(): (string | null)[] {
  return actionLabels();
}

function hrefs(): (string | null)[] {
  return screen.queryAllByRole('link').map((link) => link.getAttribute('href'));
}

const withoutCatalog = testUser('staff', { permissions: ['admin_workspace.access'] });

beforeEach(() => {
  gate.user = testUser('admin');
  read.outcome = 'ok';
  for (const mock of Object.values(api)) mock.mockReset();
  api.adminListProducts.mockResolvedValue(page('products', [testProduct()]));
  api.adminGetProduct.mockResolvedValue({ product: testProduct() });
  api.adminListCategories.mockResolvedValue({ categories: [testCategory] });
  api.adminListBrands.mockResolvedValue({ brands: [] });
  api.adminGetProductBrand.mockResolvedValue({ brand: null });
  api.adminListInventoryMovements.mockResolvedValue(page('movements', [testMovement()]));
  api.adminGetModerationTask.mockResolvedValue({ task: { assignedTo: null } });
  api.adminProductVariants.mockResolvedValue({ variants: [] });
  api.adminListProductVideos.mockResolvedValue({ videos: [] });
  api.adminListAttributes.mockResolvedValue({ attributes: [] });
  api.adminListReviews.mockResolvedValue(page('reviews', []));
  api.adminListMedia.mockResolvedValue(page('assets', []));
  api.adminCategoryCampaigns.mockResolvedValue({ campaigns: [] });
  api.adminSeoOverview.mockResolvedValue({ entries: [] });
  // The account in these tests holds zones.manage, so the zone panel is read too.
  api.adminListZones.mockResolvedValue({ zones: [] });
  api.adminProductZones.mockResolvedValue({ mine: [], inherited: [], resolved: [] });
  api.adminAnalyticsOverview.mockImplementation((_token, query) =>
    Promise.resolve({
      overview: analyticsOverview(
        Math.round((Date.parse(query.to) - Date.parse(query.from)) / 86_400_000) + 1,
        { compare: query.compare !== 'false' },
      ),
    }),
  );
});
afterEach(cleanup);

describe('products page', () => {
  it('lists products with their stock, price, status and review, and the filters from the URL', async () => {
    gate.user = testUser('staff');
    await show(
      ProductsPage(
        props({}, { stock: 'low', category: CATEGORY_ID, q: 'panjabi', sort: '-stock' }),
      ),
    );

    expect(api.adminListProducts).toHaveBeenCalledWith('access-token', {
      q: 'panjabi',
      status: undefined,
      moderationStatus: undefined,
      categoryId: CATEGORY_ID,
      stock: 'low',
      sort: 'stock_desc',
      page: 1,
      pageSize: 25,
    });
    const table = screen.getByRole('table', { name: 'Products' });
    const row = within(table).getAllByRole('row')[1];
    expect(row).toBeTruthy();
    const cells = within(row as HTMLElement);
    expect(cells.getByRole('link', { name: 'Cotton panjabi' }).getAttribute('href')).toBe(
      `/admin/products/${PRODUCT_ID}`,
    );
    expect(cells.getByText('NZ-PANJABI')).toBeTruthy();
    expect(cells.getByText('In stock')).toBeTruthy();
    expect(cells.getByText('৳2,500')).toBeTruthy();
    expect(cells.getByText('৳3,000')).toBeTruthy();
    expect(cells.getByText('Draft')).toBeTruthy();
    expect(cells.getByText('Not submitted')).toBeTruthy();
    // Staff may create products; the filters in effect can each be removed.
    expect(hrefs()).toContain('/admin/products/new');
    expect(
      screen.getByRole('link', { name: 'Stock: Low or out of stock, remove filter' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Category: Fashion, remove filter' })).toBeTruthy();
    // Every row has one way in, named for what it does: staff may edit, so it says Edit.
    expect(cells.getByRole('link', { name: 'Edit Cotton panjabi' }).getAttribute('href')).toBe(
      `/admin/products/${PRODUCT_ID}`,
    );
    expect(cells.queryByRole('link', { name: 'View Cotton panjabi' })).toBeNull();
    expect(actionLabels(table)).toEqual([]);
  });

  it('names the row action for what the account may do, without a second link', async () => {
    gate.user = testUser('moderator', {
      permissions: [
        'admin_workspace.access',
        'products.read',
        'content.approve',
        'reviews.moderate',
      ],
    });
    await show(ProductsPage(props({})));
    const table = screen.getByRole('table', { name: 'Products' });
    const cells = within(within(table).getAllByRole('row')[1] as HTMLElement);

    // A read-only account gets a view, not a button that promises an editor it cannot use.
    expect(cells.getByRole('link', { name: 'View Cotton panjabi' }).getAttribute('href')).toBe(
      `/admin/products/${PRODUCT_ID}`,
    );
    expect(cells.queryByRole('link', { name: 'Edit Cotton panjabi' })).toBeNull();
  });

  it('sorts by the column headings, keeping the filters', async () => {
    await show(ProductsPage(props({}, { stock: 'low', sort: '-stock' })));
    const table = screen.getByRole('table', { name: 'Products' });
    const heading = (name: string) =>
      within(table).getByRole('columnheader', { name: new RegExp(`^${name}`) });
    expect(heading('Stock').getAttribute('aria-sort')).toBe('descending');
    expect(within(heading('Stock')).getByRole('link').getAttribute('href')).toBe(
      '/admin/products?stock=low&sort=stock',
    );
    expect(within(heading('Product')).getByRole('link').getAttribute('href')).toBe(
      '/admin/products?stock=low&sort=name',
    );
    expect(within(heading('Price')).getByRole('link').getAttribute('href')).toBe(
      '/admin/products?stock=low&sort=price',
    );
    // "Updated" has one order, the default, which links without a sort.
    expect(within(heading('Updated')).getByRole('link').getAttribute('href')).toBe(
      '/admin/products?stock=low',
    );
    cleanup();

    await show(ProductsPage(props({})));
    const updated = within(screen.getByRole('table', { name: 'Products' })).getByRole(
      'columnheader',
      { name: /^Updated/ },
    );
    expect(updated.getAttribute('aria-sort')).toBe('descending');
    expect(within(updated).queryByRole('link')).toBeNull();
  });

  it('gives products.publish holders the status actions each product allows', async () => {
    api.adminListProducts.mockResolvedValue(
      page('products', [
        testProduct({ status: 'active', moderationStatus: 'approved', name: 'Live tea' }),
        testProduct({
          id: '44444444-4444-4444-8444-444444444444',
          moderationStatus: 'approved',
          name: 'Approved saree',
        }),
        testProduct({ id: '55555555-5555-4555-8555-555555555555', name: 'Plain draft' }),
      ]),
    );
    await show(ProductsPage(props({}, { status: 'draft', notice: 'published' })));
    expect(screen.getByText(/Published\. The product is now on sale/)).toBeTruthy();
    const rows = within(screen.getByRole('table', { name: 'Products' })).getAllByRole('row');
    const actions = (index: number) => actionLabels(rows[index] ?? new DocumentFragment());
    expect(actions(1)).toEqual(['Unpublish Live tea', 'Archive Live tea']);
    expect(actions(2)).toEqual(['Publish Approved saree', 'Archive Approved saree']);
    expect(actions(3)).toEqual(['Archive Plain draft']);
    // Each form brings the user back to this exact list.
    const returnTo = rows[1]?.querySelector<HTMLInputElement>('input[name="returnTo"]');
    expect(returnTo?.value).toBe('/admin/products?status=draft');
  });

  it('offers no "New product" without products.create', async () => {
    gate.user = testUser('moderator', { permissions: ['admin_workspace.access', 'products.read'] });
    await show(ProductsPage(props({})));
    expect(hrefs()).not.toContain('/admin/products/new');
  });

  it('explains a missing permission without asking the API', async () => {
    gate.user = withoutCatalog;
    await show(ProductsPage(props({})));
    expect(screen.getByRole('heading', { level: 1, name: 'Products' })).toBeTruthy();
    expect(screen.getByText(/“View products” permission/)).toBeTruthy();
    expect(api.adminListProducts).not.toHaveBeenCalled();
  });

  it('shows an unavailable state, never made-up rows, and sends a lapsed session to sign in', async () => {
    read.outcome = 'unavailable';
    await show(ProductsPage(props({})));
    expect(screen.getByText('This information is unavailable right now')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    cleanup();

    read.outcome = 'signed_out';
    await expect(redirectOf(ProductsPage(props({})))).resolves.toBe(
      '/login?next=%2Fadmin%2Fproducts',
    );
  });

  it('tells an empty catalog from an empty search', async () => {
    api.adminListProducts.mockResolvedValue(page('products', []));
    await show(ProductsPage(props({})));
    expect(screen.getByText('No products yet')).toBeTruthy();
    cleanup();
    await show(ProductsPage(props({}, { q: 'nothing' })));
    expect(screen.getByText('No products match these filters')).toBeTruthy();
  });
});

describe('product page', () => {
  it('locks the content of a product on sale and hides what staff may not do', async () => {
    gate.user = testUser('staff');
    api.adminGetProduct.mockResolvedValue({
      product: testProduct({ status: 'active', moderationStatus: 'approved' }),
    });
    await show(ProductPage(props({ productId: PRODUCT_ID })));

    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Cotton panjabi');
    expect(screen.getByText('Content is locked while the product is on sale')).toBeTruthy();
    // Staff cannot unpublish, so the page does not send them to a control they do not have.
    expect(screen.getAllByText(/cannot unpublish products/)).toHaveLength(2);
    expect(screen.queryByLabelText(/^Name/)).toBeNull();
    // On sale, price, limit, featuring and tags need products.publish, which staff lack.
    expect(screen.queryByLabelText(/^Price \(BDT\)/)).toBeNull();
    expect(screen.queryByLabelText(/^Most units per order/)).toBeNull();
    // Nothing to change, so there is no product form and no save bar.
    expect(screen.queryByRole('region', { name: 'Save changes' })).toBeNull();
    // Content and media both say so, and pricing/merchandising name the missing permission.
    expect(screen.getAllByText(/needs the “Publish products” permission/)).toHaveLength(4);
    expect(
      within(screen.getByRole('region', { name: 'Pricing' })).getByText('৳2,500'),
    ).toBeTruthy();
    // The preview shows the saved product, not empty placeholders, while nothing is editable.
    const preview = within(screen.getByLabelText('Product page preview'));
    expect(preview.getByText('Cotton panjabi')).toBeTruthy();
    expect(preview.getByText('Save 17%')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.queryByText('Unpublish')).toBeNull();
    expect(
      screen.getByText('Your account cannot publish, unpublish or archive products.'),
    ).toBeTruthy();
    expect(screen.getByText('Your account cannot adjust stock.')).toBeTruthy();
    // The ledger links to the order behind a movement.
    expect(hrefs()).toContain('/admin/orders/NZ100042');
  });

  it('tells an account that can unpublish how to unlock a product on sale', async () => {
    gate.user = testUser('admin');
    api.adminGetProduct.mockResolvedValue({
      product: testProduct({ status: 'active', moderationStatus: 'approved' }),
    });
    await show(ProductPage(props({ productId: PRODUCT_ID })));

    // The admin holds products.publish, so the advice it gives can actually be followed.
    expect(screen.getAllByText(/unpublish the product, edit the content/)).toHaveLength(1);
    expect(screen.getAllByText(/unpublish the product, edit the images/)).toHaveLength(1);
    expect(screen.queryByText(/cannot unpublish products/)).toBeNull();
    // The control that makes the advice possible is on the page.
    expect(screen.getAllByText('Unpublish').length).toBeGreaterThan(0);
  });

  it('lets staff change the pricing of a draft and names the reviewer generically', async () => {
    gate.user = testUser('staff');
    api.adminGetProduct.mockResolvedValue({
      product: testProduct({
        moderationStatus: 'pending',
        latestReview: testReview({ assigned: true }),
      }),
    });
    await show(ProductPage(props({ productId: PRODUCT_ID })));
    expect(screen.getByLabelText(/^Price \(BDT\)/)).toBeTruthy();
    expect(screen.getByLabelText(/^Most units per order/)).toBeTruthy();
    // The content is under review, so only operations are editable.
    expect(screen.queryByLabelText(/^Name/)).toBeNull();
    // Staff may not read reviews, so no lookup is made.
    expect(screen.getByText('A moderator')).toBeTruthy();
    expect(api.adminGetModerationTask).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Open review' })).toBeNull();
  });

  it('names the reviewer for accounts that assign reviews, and links to the review', async () => {
    api.adminGetProduct.mockResolvedValue({
      product: testProduct({
        moderationStatus: 'pending',
        latestReview: testReview({ assigned: true }),
      }),
    });
    api.adminGetModerationTask.mockResolvedValue({
      task: {
        assignedTo: {
          id: '00000000-0000-4000-8000-0000000000d1',
          name: null,
          email: 'mod@example.test',
        },
      },
    });
    await show(ProductPage(props({ productId: PRODUCT_ID })));
    expect(api.adminGetModerationTask).toHaveBeenCalledWith('access-token', testReview().taskId);
    expect(screen.getByText('mod@example.test')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open review' }).getAttribute('href')).toBe(
      `/admin/moderation/${testReview().taskId}`,
    );
    cleanup();

    // A failed lookup falls back to the generic wording.
    api.adminGetModerationTask.mockRejectedValue(new ApiError(404, 'not_found', 'gone'));
    await show(ProductPage(props({ productId: PRODUCT_ID })));
    expect(screen.getByText('A moderator')).toBeTruthy();
  });

  it('offers publishing once approved, and every control to an admin', async () => {
    api.adminGetProduct.mockResolvedValue({
      product: testProduct({
        moderationStatus: 'approved',
        latestReview: testReview({ status: 'approved', assigned: true }),
      }),
    });
    await show(ProductPage(props({ productId: PRODUCT_ID }, { notice: 'content' })));

    expect(screen.getByText(/Content saved/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
    expect(screen.getByLabelText(/^Name/)).toBeTruthy();
    expect(screen.getByLabelText(/^Price \(BDT\)/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record adjustment' })).toBeTruthy();
    expect(screen.getByText('Archive')).toBeTruthy();
    // Approved content cannot be submitted again.
    expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull();
    expect(screen.getByText(/Changing the content clears its review/)).toBeTruthy();
  });

  it('explains that publishing needs approval and shows the moderator’s request', async () => {
    api.adminGetProduct.mockResolvedValue({
      product: testProduct({
        moderationStatus: 'changes_requested',
        latestReview: testReview({
          status: 'changes_requested',
          note: 'Add the fabric weight.',
          decidedAt: '2026-10-25T04:00:00.000Z',
          assigned: true,
        }),
      }),
    });
    await show(ProductPage(props({ productId: PRODUCT_ID })));
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.getByText(/Publishing needs approved content/)).toBeTruthy();
    expect(screen.getByText('Add the fabric weight.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeTruthy();
  });

  it('lets the store owner publish content no review has approved, saying so first', async () => {
    api.adminGetProduct.mockResolvedValue({
      product: testProduct({ moderationStatus: 'pending', latestReview: testReview() }),
    });
    gate.user = testUser('super_admin');
    await show(ProductPage(props({ productId: PRODUCT_ID })));
    // The permission alone is not enough: the role decides, and the owner is told what it means.
    expect(screen.getByRole('button', { name: 'Publish without review' })).toBeTruthy();
    expect(screen.getByText(/Publishing now approves this content yourself/)).toBeTruthy();
    cleanup();

    gate.user = testUser('admin');
    await show(ProductPage(props({ productId: PRODUCT_ID })));
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish without review' })).toBeNull();
  });

  it('offers withdrawing a pending review and locks the content meanwhile', async () => {
    api.adminGetProduct.mockResolvedValue({
      product: testProduct({ moderationStatus: 'pending', latestReview: testReview() }),
    });
    await show(ProductPage(props({ productId: PRODUCT_ID })));
    expect(screen.getByText('Content is locked while it is under review')).toBeTruthy();
    expect(screen.getByText('Withdraw review')).toBeTruthy();
    expect(screen.getByText('Waiting for a moderator to be assigned.')).toBeTruthy();
  });

  it('links to the search metadata editor for this product', async () => {
    gate.user = testUser('staff');
    api.adminGetProduct.mockResolvedValue({ product: testProduct({ status: 'draft' }) });
    await show(ProductPage(props({ productId: PRODUCT_ID })));

    expect(screen.getByRole('heading', { level: 2, name: 'Search metadata' })).toBeTruthy();
    // The SEO editor's route is singular: /admin/seo/product/:id.
    expect(hrefs()).toContain(`/admin/seo/product/${PRODUCT_ID}`);
    // Staff can change product content, so they are offered the editor rather than a read-only view.
    expect(screen.getByRole('link', { name: 'Edit search metadata' })).toBeTruthy();
  });

  it('previews the product in search results from the one SEO store, and says what fills a gap', async () => {
    api.adminSeoOverview.mockResolvedValue({
      entries: [
        {
          kind: 'product',
          id: PRODUCT_ID,
          slug: 'cotton-panjabi',
          name: 'Cotton panjabi',
          isPublic: false,
          seoTitle: null,
          seoDescription: 'Breathable cotton panjabi for Eid.',
          ogTitle: null,
          ogDescription: null,
          ogImageKey: null,
          canonicalPath: null,
          noIndex: true,
          missingTitle: true,
          missingDescription: false,
          updatedAt: '2026-10-25T06:00:00.000Z',
        },
      ],
    });
    await show(ProductPage(props({ productId: PRODUCT_ID })));

    // Narrowed to this product's address: the same read the SEO editor makes.
    expect(api.adminSeoOverview).toHaveBeenCalledWith('access-token', { q: 'cotton-panjabi' });
    const snippet = within(screen.getByLabelText('Search result preview'));
    expect(snippet.getByText('Cotton panjabi')).toBeTruthy();
    expect(snippet.getByText('Breathable cotton panjabi for Eid.')).toBeTruthy();
    expect(screen.getByText('Title: uses the product name')).toBeTruthy();
    expect(screen.getByText('Hidden from search engines')).toBeTruthy();
  });

  it('keeps stock on the variants of a product that has them, with no product-level form', async () => {
    api.adminProductVariants.mockResolvedValue({
      variants: [
        {
          id: '77777777-7777-4777-8777-777777777777',
          sku: 'NZ-PANJABI-M',
          priceMinor: null,
          compareAtPriceMinor: null,
          stockQuantity: 4,
          imageUrl: null,
          position: 0,
          isActive: true,
          label: 'Size: M',
          attributeValueIds: ['88888888-8888-4888-8888-888888888888'],
        },
      ],
    });
    await show(ProductPage(props({ productId: PRODUCT_ID })));

    // The database refuses a product-level change once variants exist, so none is offered.
    expect(screen.queryByRole('button', { name: 'Record adjustment' })).toBeNull();
    const table = within(screen.getByRole('table', { name: 'Stock per variant' }));
    expect(table.getByRole('rowheader', { name: 'Size: M' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Adjust variant stock' }).getAttribute('href')).toBe(
      `/admin/products/${PRODUCT_ID}/variants`,
    );
  });

  it('lists what the product still needs, linking each to its section', async () => {
    await show(ProductPage(props({ productId: PRODUCT_ID })));

    const checklist = within(screen.getByRole('region', { name: /Launch checklist/ }));
    // The fixture has a summary but no description, pictures, review or SEO row.
    expect(checklist.getByText('2 of 8 done')).toBeTruthy();
    expect(checklist.getByRole('link', { name: /Pictures: to do/ }).getAttribute('href')).toBe(
      '#product-media',
    );
    expect(checklist.getByRole('link', { name: /Summary for product cards: done/ })).toBeTruthy();
    expect(
      checklist.getByRole('link', { name: /Search title and description: unknown/ }),
    ).toBeTruthy();
    const nav = within(screen.getByRole('navigation', { name: 'Product sections' }));
    expect(nav.getByRole('link', { name: 'Inventory' }).getAttribute('href')).toBe(
      '#product-inventory',
    );
  });

  it('points an account without products.read at nothing it may not see', async () => {
    gate.user = testUser('staff', { permissions: ['admin_workspace.access'] });
    api.adminGetProduct.mockResolvedValue({ product: testProduct({ status: 'draft' }) });
    await show(ProductPage(props({ productId: PRODUCT_ID })));

    expect(screen.queryByRole('heading', { level: 2, name: 'Search metadata' })).toBeNull();
  });

  it('answers a missing product or a malformed id with not found', async () => {
    api.adminGetProduct.mockRejectedValue(new ApiError(404, 'not_found', 'Product not found'));
    await show(ProductPage(props({ productId: PRODUCT_ID })));
    expect(screen.getByText('Not found')).toBeTruthy();
    cleanup();

    api.adminGetProduct.mockClear();
    await show(ProductPage(props({ productId: 'not-an-id' })));
    expect(screen.getByText('Not found')).toBeTruthy();
    expect(api.adminGetProduct).not.toHaveBeenCalled();
  });
});

describe('new product page', () => {
  it('needs products.create', async () => {
    gate.user = testUser('moderator', { permissions: ['admin_workspace.access', 'products.read'] });
    await show(NewProductPage());
    expect(screen.getByText(/“Create products” permission/)).toBeTruthy();
    expect(api.adminListCategories).not.toHaveBeenCalled();
  });

  it('asks for a category first when there is none', async () => {
    api.adminListCategories.mockResolvedValue({ categories: [] });
    await show(NewProductPage());
    expect(screen.getByRole('heading', { name: 'Create a category first' })).toBeTruthy();
    expect(hrefs()).toContain('/admin/categories/new');
  });

  it('shows the sectioned create form', async () => {
    await show(NewProductPage());
    for (const name of [
      'Basic info',
      'Media',
      'Pricing',
      'Inventory',
      'Size chart',
      'Visibility & status',
      'Merchandising',
      'Variants',
    ]) {
      expect(screen.getByRole('heading', { name })).toBeTruthy();
    }
    expect(screen.getByRole('option', { name: 'Fashion' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeTruthy();
  });
});

describe('categories page', () => {
  it('gives products.publish holders edit and visibility controls', async () => {
    await show(CategoriesPage(props({}, { notice: 'category-hidden' })));
    expect(screen.getByText(/Category hidden/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Edit Fashion' })).toBeTruthy();
    // The trigger names its category for screen readers (the icon-only reorder arrows have no text).
    expect(summaries().filter((label) => label !== '')).toEqual(['Hide Fashion']);
    // Inside the table the confirmation opens as a dialog (never clipped by the table).
    expect(screen.getByRole('button', { name: 'Hide Fashion' }).getAttribute('aria-haspopup')).toBe(
      'dialog',
    );
    expect(screen.getByRole('link', { name: '4 products in Fashion' }).getAttribute('href')).toBe(
      `/admin/products?category=${CATEGORY_ID}`,
    );
  });

  it('shows subcategories under their parent, in order, with branch counts and the new actions', async () => {
    const CHILD_A = '11111111-1111-4111-8111-aaaaaaaaaaaa';
    const CHILD_B = '11111111-1111-4111-8111-bbbbbbbbbbbb';
    const other = {
      ...testCategory,
      id: '11111111-1111-4111-8111-cccccccccccc',
      slug: 'other',
      name: 'Other',
      sortOrder: 5,
      productCount: 1,
    };
    api.adminListCategories.mockResolvedValue({
      categories: [
        other,
        {
          ...testCategory,
          id: CHILD_B,
          slug: 'child-b',
          name: 'Child B',
          parentId: CATEGORY_ID,
          sortOrder: 10,
          productCount: 2,
        },
        {
          ...testCategory,
          id: CHILD_A,
          slug: 'child-a',
          name: 'Child A',
          parentId: CATEGORY_ID,
          sortOrder: 0,
          productCount: 3,
        },
        testCategory,
      ],
    });
    await show(CategoriesPage(props({})));

    // Tree order: a category, then its subcategories (in their own order), then the next one.
    const names = screen
      .getAllByRole('link', { name: /^Edit / })
      .map((link) => link.textContent?.replace('Edit', '').trim());
    expect(names).toEqual(['Fashion', 'Child A', 'Child B', 'Other']);
    // A department's count includes its subcategories (4 own + 3 + 2).
    expect(
      screen.getByRole('link', { name: '9 products in Fashion and its subcategories' }),
    ).toBeTruthy();
    // Subcategories are added from the parent's own row, with that parent preselected.
    expect(
      screen.getByRole('link', { name: 'Add subcategory to Fashion' }).getAttribute('href'),
    ).toBe(`/admin/categories/new?parent=${CATEGORY_ID}`);
    // Reorder arrows stay inside the group: the first cannot go earlier, the last not later.
    expect(
      screen.getByRole('button', { name: 'Move Child A earlier' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Move Child A later' }).hasAttribute('disabled'),
    ).toBe(false);
    expect(
      screen.getByRole('button', { name: 'Move Child B later' }).hasAttribute('disabled'),
    ).toBe(true);
    // The top level is its own group: Fashion is first, Other is last.
    expect(
      screen.getByRole('button', { name: 'Move Fashion earlier' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'Move Other later' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(
      screen.getByRole('button', { name: 'Move Other earlier' }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('is read-only for staff', async () => {
    gate.user = testUser('staff');
    await show(CategoriesPage(props({})));
    expect(screen.queryByRole('link', { name: 'Edit Fashion' })).toBeNull();
    expect(summaries()).toEqual([]);
    expect(screen.getByText(/needs the “Publish products” permission/)).toBeTruthy();
  });
});

describe('inventory page', () => {
  it('counts products on sale exactly as the lists it links to, lowest stock first', async () => {
    type Query = { stock?: string; status?: string; sort?: string; pageSize?: number };
    api.adminListProducts.mockImplementation((_token: string, query: Query) => {
      if (query.pageSize === 1) {
        const totals: Record<string, number> = {
          'any:any': 12,
          'active:any': 9,
          'active:low': 3,
          'active:out': 1,
        };
        const key = `${query.status ?? 'any'}:${query.stock ?? 'any'}`;
        return Promise.resolve(page('products', [], totals[key] ?? 0));
      }
      if (query.stock === 'low') {
        return Promise.resolve(
          page('products', [
            testProduct({ name: 'Saree', status: 'active', stockQuantity: 0 }),
            testProduct({
              id: '44444444-4444-4444-8444-444444444444',
              name: 'Tea',
              status: 'active',
              stockQuantity: 3,
            }),
          ]),
        );
      }
      return Promise.resolve(page('products', [testProduct()]));
    });
    await show(InventoryPage(props({})));

    expect(api.adminListProducts).toHaveBeenCalledWith('access-token', {
      status: 'active',
      stock: 'low',
      sort: 'stock_asc',
      pageSize: 100,
    });
    const figures = screen.getByRole('region', { name: 'Stock summary' });
    const card = (label: string) => {
      const text = within(figures).getByText(label);
      return text.closest('a') ?? text.closest('.relative');
    };
    expect(card('On sale')?.textContent).toContain('9');
    expect(card('On sale')?.textContent).toContain('Of 12 products in any status');
    expect(card('In stock')?.textContent).toContain('6');
    expect(card('Low or out of stock')?.textContent).toContain('3');
    expect(card('Low or out of stock')?.getAttribute('href')).toBe(
      '/admin/inventory?status=active&stock=low',
    );
    expect(card('Out of stock')?.getAttribute('href')).toBe(
      '/admin/inventory?status=active&stock=out',
    );
    const attention = screen.getByRole('region', { name: 'Needs attention' });
    const names = within(attention)
      .getAllByRole('link')
      .map((link) => link.textContent)
      .filter((text) => text === 'Saree' || text === 'Tea');
    expect(names).toEqual(['Saree', 'Tea']);
    expect(within(attention).getByRole('link', { name: 'Restock Saree' })).toBeTruthy();
    // The stock table sorts by name and stock through the API.
    const table = screen.getByRole('table', { name: 'Stock levels' });
    const stockHead = within(table).getByRole('columnheader', { name: /^Stock/ });
    expect(within(stockHead).getByRole('link').getAttribute('href')).toBe(
      '/admin/inventory?sort=stock',
    );
    expect(within(table).getByRole('link', { name: 'Adjust Cotton panjabi' })).toBeTruthy();
  });

  it('shows the stock ledger with order links and actors', async () => {
    api.adminListInventoryMovements.mockResolvedValue(
      page('movements', [
        testMovement(),
        testMovement({
          id: 8,
          change: 5,
          reason: 'adjustment',
          note: 'Received from supplier',
          orderNumber: null,
          actor: { id: '00000000-0000-4000-8000-0000000000c2', name: 'Rahim', email: null },
        }),
      ]),
    );
    await show(InventoryPage(props({}, { view: 'movements', reason: 'adjustment' })));

    expect(api.adminListInventoryMovements).toHaveBeenCalledWith('access-token', {
      productId: undefined,
      reason: 'adjustment',
      page: 1,
      pageSize: 25,
    });
    const table = screen.getByRole('table', { name: 'Stock ledger' });
    expect(within(table).getByRole('link', { name: 'NZ100042' }).getAttribute('href')).toBe(
      '/admin/orders/NZ100042',
    );
    expect(within(table).getByText('Customer')).toBeTruthy();
    expect(within(table).getByText('Rahim')).toBeTruthy();
    expect(within(table).getByText('Received from supplier')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Reason: Adjustment, remove filter' })).toBeTruthy();
  });

  it('explains a missing permission', async () => {
    gate.user = withoutCatalog;
    await show(InventoryPage(props({})));
    expect(screen.getByText(/“View products” permission/)).toBeTruthy();
    expect(api.adminListProducts).not.toHaveBeenCalled();
  });
});

/** The address' search parameters, as Next passes them to the brands page. */
function brandsProps(params: Record<string, string> = {}) {
  return { searchParams: Promise.resolve(params) } as Parameters<typeof BrandsPage>[0];
}

describe('page-level permission checks', () => {
  it('refuses the brands, attributes and category pages before any API call', async () => {
    gate.user = withoutCatalog;
    await show(BrandsPage(brandsProps()));
    expect(screen.getByText(/“View products” permission/)).toBeTruthy();
    cleanup();
    await show(AttributesPage());
    expect(screen.getByText(/“View products” permission/)).toBeTruthy();
    cleanup();
    // Creating and editing categories also needs products.publish, which staff lack.
    gate.user = testUser('staff');
    await show(NewCategoryPage({ searchParams: Promise.resolve({}) } as never));
    expect(screen.getByText(/“Publish products” permission/)).toBeTruthy();
    cleanup();
    await show(CategoryPage(props({ categoryId: CATEGORY_ID })));
    expect(screen.getByText(/“Publish products” permission/)).toBeTruthy();
    expect(api.adminListBrands).not.toHaveBeenCalled();
    expect(api.adminListAttributes).not.toHaveBeenCalled();
    expect(api.adminListCategories).not.toHaveBeenCalled();
  });

  it('refuses the variants and reviews pages before any API call', async () => {
    gate.user = withoutCatalog;
    await show(ProductVariantsPage(props({ productId: PRODUCT_ID })));
    expect(screen.getByText(/“View products” permission/)).toBeTruthy();
    expect(api.adminProductVariants).not.toHaveBeenCalled();
    cleanup();
    gate.user = testUser('staff');
    await show(ReviewsPage(props({})));
    expect(screen.getByText(/“Moderate customer reviews” permission/)).toBeTruthy();
    expect(api.adminListReviews).not.toHaveBeenCalled();
  });

  it('offers brand deletion to publishers only', async () => {
    api.adminListBrands.mockResolvedValue({
      brands: [
        {
          id: '66666666-6666-4666-8666-666666666666',
          slug: 'north-star',
          name: 'North Star',
          description: null,
          logo: null,
          productCount: 2,
          isActive: true,
        },
      ],
    });
    await show(BrandsPage(brandsProps()));
    expect(screen.getByRole('button', { name: 'Delete brand North Star' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Add a brand' })).toBeTruthy();
    cleanup();

    gate.user = testUser('staff');
    await show(BrandsPage(brandsProps()));
    expect(screen.getByText('North Star')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete brand North Star' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Add a brand' })).toBeNull();
  });

  it('shows attribute forms only with products.update', async () => {
    gate.user = testUser('moderator', { permissions: ['admin_workspace.access', 'products.read'] });
    await show(AttributesPage());
    expect(screen.queryByRole('button', { name: 'Add attribute' })).toBeNull();
    expect(screen.getByText(/needs the “Edit products” permission/)).toBeTruthy();
    cleanup();
    gate.user = testUser('staff');
    await show(AttributesPage());
    expect(screen.getByRole('button', { name: 'Add attribute' })).toBeTruthy();
  });

  it('lets staff rename a value and add one to an attribute, and lists hidden attributes apart', async () => {
    api.adminListAttributes.mockResolvedValue({
      attributes: [
        {
          id: 'a1000000-0000-4000-8000-000000000001',
          slug: 'size',
          name: 'Size',
          position: 0,
          isActive: true,
          values: [
            { id: 'a2000000-0000-4000-8000-000000000001', slug: 'm', value: 'M', position: 0 },
          ],
        },
        {
          id: 'a1000000-0000-4000-8000-000000000002',
          slug: 'old-fit',
          name: 'Old fit',
          position: 1,
          isActive: false,
          values: [],
        },
      ],
    });
    gate.user = testUser('staff');
    await show(AttributesPage());

    const sizeValues = within(screen.getByRole('list', { name: 'Size values' }));
    expect(sizeValues.getByText(/edit this size value/)).toBeTruthy();
    expect(screen.getByLabelText('New size value')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Save attribute' }).length).toBeGreaterThan(0);
    expect(screen.getByText('Hidden attributes (1)')).toBeTruthy();
    expect(screen.getByText('1 available · 1 hidden')).toBeTruthy();
    cleanup();

    gate.user = testUser('moderator', { permissions: ['admin_workspace.access', 'products.read'] });
    await show(AttributesPage());
    // Read-only: values are plain chips, with nothing to edit.
    expect(screen.queryByText(/edit this size value/)).toBeNull();
    expect(screen.queryByLabelText('New size value')).toBeNull();
  });

  it('offers a product only the attributes its variants already use, and its own pictures', async () => {
    const SIZE = 'a1000000-0000-4000-8000-000000000001';
    const COLOUR = 'a1000000-0000-4000-8000-000000000002';
    const M = 'a2000000-0000-4000-8000-000000000001';
    const NAVY = 'a2000000-0000-4000-8000-000000000003';
    api.adminListAttributes.mockResolvedValue({
      attributes: [
        {
          id: SIZE,
          slug: 'size',
          name: 'Size',
          position: 0,
          isActive: true,
          values: [{ id: M, slug: 'm', value: 'M', position: 0 }],
        },
        {
          id: COLOUR,
          slug: 'colour',
          name: 'Colour',
          position: 1,
          isActive: true,
          values: [{ id: NAVY, slug: 'navy', value: 'Navy', position: 0 }],
        },
        {
          id: 'a1000000-0000-4000-8000-000000000009',
          slug: 'material',
          name: 'Material',
          position: 2,
          isActive: true,
          values: [
            {
              id: 'a2000000-0000-4000-8000-000000000009',
              slug: 'linen',
              value: 'Linen',
              position: 0,
            },
          ],
        },
      ],
    });
    api.adminProductVariants.mockResolvedValue({
      variants: [
        {
          id: '77777777-7777-4777-8777-777777777777',
          sku: 'NZ-PANJABI-M-NAVY',
          priceMinor: null,
          compareAtPriceMinor: null,
          stockQuantity: 4,
          imageUrl: null,
          position: 0,
          isActive: true,
          label: 'Size: M / Colour: Navy',
          attributeValueIds: [M, NAVY],
        },
      ],
    });
    api.adminGetProduct.mockResolvedValue({
      product: testProduct({
        images: [
          {
            id: '99999999-9999-4999-8999-999999999999',
            url: 'https://media.example.com/products/p/1/full.webp',
            thumbUrl: 'https://media.example.com/products/p/1/thumb.webp',
            alt: 'Front view',
            width: 1600,
            height: 1600,
            position: 0,
          },
        ],
      }),
    });
    gate.user = testUser('staff');
    await show(ProductVariantsPage(props({ productId: PRODUCT_ID })));

    const add = within(screen.getByRole('region', { name: 'Add a variant' }));
    // Sold by Size and Colour already: Material cannot be mixed in, and each is required.
    expect(add.getByLabelText(/^Size/)).toBeTruthy();
    expect(add.getByLabelText(/^Colour/)).toBeTruthy();
    expect(add.queryByLabelText(/^Material/)).toBeNull();
    expect(screen.getByText(/Sold by Size and Colour/)).toBeTruthy();
    // The product's own pictures can be picked for a variant.
    expect(add.getByRole('radio', { name: /Picture 1: Front view/ })).toBeTruthy();
    expect(add.getByRole('radio', { name: 'No picture of its own' })).toBeTruthy();
  });

  it('gives variant controls by permission: edit, stock and delete', async () => {
    api.adminProductVariants.mockResolvedValue({
      variants: [
        {
          id: '77777777-7777-4777-8777-777777777777',
          sku: 'NZ-PANJABI-M',
          priceMinor: null,
          compareAtPriceMinor: null,
          stockQuantity: 4,
          imageUrl: null,
          position: 0,
          isActive: true,
          label: 'Size: M',
          attributeValueIds: ['88888888-8888-4888-8888-888888888888'],
        },
      ],
    });
    gate.user = testUser('staff');
    await show(ProductVariantsPage(props({ productId: PRODUCT_ID })));
    expect(screen.getByText('Size: M')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide from the storefront' })).toBeTruthy();
    // Staff hold neither inventory.adjust nor products.publish.
    expect(screen.queryByRole('button', { name: 'Update stock' })).toBeNull();
    expect(summaries()).not.toContain('Delete Size: M');
    cleanup();

    gate.user = testUser('admin');
    await show(ProductVariantsPage(props({ productId: PRODUCT_ID })));
    expect(screen.getByRole('button', { name: 'Update stock' })).toBeTruthy();
    expect(summaries()).toContain('Delete Size: M');
    cleanup();

    gate.user = testUser('moderator', { permissions: ['admin_workspace.access', 'products.read'] });
    await show(ProductVariantsPage(props({ productId: PRODUCT_ID })));
    expect(screen.getByText('View only')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hide from the storefront' })).toBeNull();
  });
});

describe('media library page', () => {
  const asset = {
    id: '99999999-9999-4999-8999-999999999999',
    key: 'library/99999999-9999-4999-8999-999999999999',
    url: 'https://media.example.com/library/x.webp',
    thumbUrl: 'https://media.example.com/library/x-thumb.webp',
    contentType: 'image/webp',
    width: 1600,
    height: 900,
    bytes: 120_000,
    alt: 'Shop front',
    originalName: 'front.jpg',
    uploadedBy: null,
    createdAt: '2026-10-25T06:00:00.000Z',
  };

  it('is forbidden without settings.manage or products.update, without asking the API', async () => {
    gate.user = testUser('moderator', { permissions: ['admin_workspace.access', 'products.read'] });
    await show(MediaLibraryPage(props({})));
    expect(screen.getByRole('heading', { level: 1, name: 'Media library' })).toBeTruthy();
    expect(
      screen.getByText(/“Manage store settings” or the “Edit products” permission/),
    ).toBeTruthy();
    expect(api.adminListMedia).not.toHaveBeenCalled();
  });

  it('lets product editors browse and copy keys, and only settings managers change it', async () => {
    api.adminListMedia.mockResolvedValue(page('assets', [asset]));
    gate.user = testUser('staff');
    await show(MediaLibraryPage(props({}, { q: 'front', page: '2' })));
    expect(api.adminListMedia).toHaveBeenCalledWith('access-token', {
      q: 'front',
      page: 2,
      pageSize: 24,
    });
    expect(screen.getByText('front.jpg')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy key' })).toBeTruthy();
    expect(screen.queryByLabelText('Add pictures')).toBeNull();
    expect(summaries()).not.toContain('Delete');
    cleanup();

    gate.user = testUser('super_admin');
    await show(MediaLibraryPage(props({})));
    expect(screen.getByLabelText('Add pictures')).toBeTruthy();
    expect(summaries()).toContain('Delete');
  });

  it('tells an empty library from an empty search', async () => {
    await show(MediaLibraryPage(props({})));
    expect(screen.getByText('The library is empty')).toBeTruthy();
    cleanup();
    await show(MediaLibraryPage(props({}, { q: 'nothing' })));
    expect(screen.getByText('No pictures match this search')).toBeTruthy();
  });
});

describe('analytics page', () => {
  it('is forbidden without finance.read, without asking the API', async () => {
    gate.user = testUser('staff');
    await show(AnalyticsPage(props({})));
    expect(screen.getByText(/“View sales and finance” permission/)).toBeTruthy();
    expect(api.adminAnalyticsOverview).not.toHaveBeenCalled();
  });

  it('reads the chosen range once, with its comparison, and shows every panel', async () => {
    await show(AnalyticsPage(props({}, { range: '7d' })));
    expect(api.adminAnalyticsOverview).toHaveBeenCalledTimes(1);
    expect(api.adminAnalyticsOverview.mock.calls[0]?.[1]).toMatchObject({ compare: 'true' });
    const figures = screen.getByRole('region', { name: 'Headline figures' });
    // 7 days of ৳1,000.
    expect(within(figures).getAllByText('৳7,000').length).toBeGreaterThan(0);
    expect(within(figures).getAllByText('vs previous 7 days').length).toBeGreaterThan(0);
    for (const name of [
      'Revenue and orders',
      'Order status',
      'Cash on delivery',
      'Targets and rates',
      'Top products',
      'Day by day',
    ]) {
      expect(screen.getByRole('region', { name })).toBeTruthy();
    }
    expect(screen.getByRole('link', { name: '7 days' }).getAttribute('aria-current')).toBe('true');
  });

  it('groups a long custom range by month and leaves the comparison out when asked', async () => {
    await show(
      AnalyticsPage(
        props({}, { range: 'custom', from: '2025-12-01', to: '2026-10-31', compare: '0' }),
      ),
    );
    expect(api.adminAnalyticsOverview.mock.calls[0]?.[1]).toEqual({
      from: '2025-12-01',
      to: '2026-10-31',
      compare: 'false',
    });
    expect(screen.getByRole('region', { name: 'Month by month' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Orders by status per month' })).toBeTruthy();
  });

  it('shows an unavailable state when the report cannot be read', async () => {
    read.outcome = 'unavailable';
    await show(AnalyticsPage(props({})));
    expect(screen.getByText('This information is unavailable right now')).toBeTruthy();
  });
});
