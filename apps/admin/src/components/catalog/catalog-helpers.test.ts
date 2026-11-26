import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS } from '@/test/fixtures';
import {
  DEFAULT_PRODUCT_SORT,
  movementListHref,
  parseMovementListParams,
  parseProductListParams,
  productListHref,
  productListQuery,
  productSortOf,
  productSortParam,
} from './catalog-query';
import { CATEGORY_ID, testProduct, testReview } from './fixtures';
import { apiFieldErrors, poishaToTaka, slugify, takaToPoisha, wholeNumber } from './form-values';
import { categoryNotice, productNotice } from './notices';
import {
  canEditOperations,
  canPublish,
  canSubmitForReview,
  canWithdrawReview,
  contentLock,
  productAbilities,
} from './product-rules';
import { stockBarPercent } from './product-tile';

describe('taka and poisha', () => {
  it.each([
    ['1250', 125_000],
    ['1,250.5', 125_050],
    ['৳ 1,250.05', 125_005],
    ['0.01', 1],
  ])('reads %j as %i poisha', (text, minor) => {
    expect(takaToPoisha(text)).toBe(minor);
  });

  it.each(['', 'abc', '12.345', '-5', '1e3', '123456789'])('refuses %j', (text) => {
    expect(takaToPoisha(text)).toBeUndefined();
  });

  it('writes poisha back as an editable amount', () => {
    expect(poishaToTaka(125_000)).toBe('1250');
    expect(poishaToTaka(125_005)).toBe('1250.05');
    expect(poishaToTaka(null)).toBe('');
  });

  it('reads whole numbers, signed only when asked', () => {
    expect(wholeNumber('12')).toBe(12);
    expect(wholeNumber('-3')).toBeUndefined();
    expect(wholeNumber('-3', { signed: true })).toBe(-3);
    expect(wholeNumber('1.5')).toBeUndefined();
  });
});

describe('slugify', () => {
  it('makes a catalog address from a name', () => {
    expect(slugify('  Cotton Panjabi — Navy (XL) ')).toBe('cotton-panjabi-navy-xl');
    expect(slugify('Home & Kitchen')).toBe('home-and-kitchen');
    expect(slugify('Café Crème')).toBe('cafe-creme');
  });

  it('is empty for names without latin letters or digits, and respects the limit', () => {
    expect(slugify('শাড়ি')).toBe('');
    expect(slugify('a'.repeat(50) + ' b', 51)).toBe('a'.repeat(50));
  });
});

describe('apiFieldErrors', () => {
  it('keeps body issues on the form’s fields, in the form’s words', () => {
    const details = {
      issues: [
        { location: 'body', path: 'priceMinor', message: 'Too small' },
        { location: 'body', path: 'unknownField', message: 'x' },
        { location: 'query', path: 'name', message: 'x' },
      ],
    };
    expect(
      apiFieldErrors(
        details,
        ['price', 'name'],
        { price: 'Enter a price.' },
        { priceMinor: 'price' },
      ),
    ).toEqual({ price: 'Enter a price.' });
    expect(apiFieldErrors('nonsense', ['price'], {})).toEqual({});
  });
});

const product = testProduct;
const pendingReview = testReview();

describe('product rules', () => {
  it('locks content while on sale or under review, as the database does', () => {
    expect(contentLock(product())).toBeNull();
    expect(contentLock(product({ moderationStatus: 'approved' }))).toBeNull();
    expect(contentLock(product({ status: 'active', moderationStatus: 'approved' }))).toBe('live');
    expect(contentLock(product({ moderationStatus: 'pending' }))).toBe('review');
  });

  it('submits only drafts that are not in review or approved', () => {
    expect(canSubmitForReview(product())).toBe(true);
    expect(canSubmitForReview(product({ moderationStatus: 'changes_requested' }))).toBe(true);
    expect(canSubmitForReview(product({ moderationStatus: 'approved' }))).toBe(false);
    expect(canSubmitForReview(product({ moderationStatus: 'pending' }))).toBe(false);
    expect(canSubmitForReview(product({ status: 'archived' }))).toBe(false);
  });

  it('withdraws only a pending review, and publishes only approved content', () => {
    expect(
      canWithdrawReview(product({ moderationStatus: 'pending', latestReview: pendingReview })),
    ).toBe(true);
    expect(
      canWithdrawReview(
        product({
          moderationStatus: 'approved',
          latestReview: { ...pendingReview, status: 'approved' },
        }),
      ),
    ).toBe(false);
    expect(canPublish(product({ moderationStatus: 'approved' }))).toBe(true);
    expect(canPublish(product({ moderationStatus: 'approved', status: 'archived' }))).toBe(true);
    expect(canPublish(product({ moderationStatus: 'pending' }))).toBe(false);
    expect(canPublish(product({ status: 'active', moderationStatus: 'approved' }))).toBe(false);
  });

  it('needs products.publish to change price, limit or featuring of a product on sale', () => {
    const staff = productAbilities(ROLE_PERMISSIONS.staff);
    const admin = productAbilities(ROLE_PERMISSIONS.admin);
    expect(canEditOperations(product({ status: 'active' }), staff)).toBe(false);
    expect(canEditOperations(product({ status: 'draft' }), staff)).toBe(true);
    expect(canEditOperations(product({ status: 'archived' }), staff)).toBe(true);
    expect(canEditOperations(product({ status: 'active' }), admin)).toBe(true);
    expect(canEditOperations(product({ status: 'draft' }), { ...admin, edit: false })).toBe(false);
  });

  it('derives the controls from the verified permission list', () => {
    expect(productAbilities(ROLE_PERMISSIONS.staff)).toEqual({
      edit: true,
      publish: false,
      adjustStock: false,
      owner: false,
    });
    expect(productAbilities(ROLE_PERMISSIONS.admin)).toEqual({
      edit: true,
      publish: true,
      adjustStock: true,
      owner: false,
    });
    expect(productAbilities(ROLE_PERMISSIONS.moderator).edit).toBe(false);
    // The owner is a role, not a longer permission list: it is read from the session's role.
    expect(productAbilities(ROLE_PERMISSIONS.admin, 'super_admin').owner).toBe(true);
    expect(productAbilities(ROLE_PERMISSIONS.admin, 'admin').owner).toBe(false);
  });

  it('lets the owner publish content no review has approved, and nobody else', () => {
    const pending = product({ moderationStatus: 'pending' });
    const notSubmitted = product({ moderationStatus: 'not_submitted' });
    expect(canPublish(pending)).toBe(false);
    expect(canPublish(pending, { owner: true })).toBe(true);
    expect(canPublish(notSubmitted, { owner: true })).toBe(true);
    // Already on sale, or archived: the owner gets no publish action either.
    expect(canPublish({ status: 'active', moderationStatus: 'approved' }, { owner: true })).toBe(
      false,
    );
    expect(canPublish({ status: 'archived', moderationStatus: 'pending' }, { owner: true })).toBe(
      true,
    );
  });
});

describe('catalog query parameters', () => {
  it('keeps only valid filters and maps them to the API query', () => {
    const params = parseProductListParams({
      q: '  panjabi ',
      status: 'active',
      moderation: 'bogus',
      category: CATEGORY_ID,
      stock: 'low',
      sort: '-price',
      page: '3',
    });
    expect(params).toEqual({
      q: 'panjabi',
      status: 'active',
      moderation: undefined,
      category: CATEGORY_ID,
      stock: 'low',
      sort: { column: 'price', direction: 'desc' },
      page: 3,
    });
    expect(productListQuery(params)).toEqual({
      q: 'panjabi',
      status: 'active',
      moderationStatus: undefined,
      categoryId: CATEGORY_ID,
      stock: 'low',
      sort: 'price_desc',
      page: 3,
      pageSize: 25,
    });
    expect(parseProductListParams({ category: 'not-a-uuid', stock: ['low', 'out'] })).toMatchObject(
      {
        category: undefined,
        stock: undefined,
        page: 1,
      },
    );
  });

  it('sorts by the API’s orders only, with "updated" always newest first', () => {
    const sortOf = (sort: string | undefined) =>
      productSortOf(parseProductListParams({ sort }).sort ?? DEFAULT_PRODUCT_SORT);
    expect(sortOf('name')).toBe('name_asc');
    expect(sortOf('-stock')).toBe('stock_desc');
    expect(sortOf('price')).toBe('price_asc');
    expect(sortOf('updated')).toBe('updated_desc');
    expect(sortOf('-sku')).toBe('updated_desc');
    expect(sortOf(undefined)).toBe('updated_desc');
    // The default order is left out of links; others are kept with the filters.
    const sorted = parseProductListParams({ q: 'tea', sort: '-price', page: '3' });
    expect(productListHref(sorted, { stock: 'low' })).toBe(
      '/admin/products?q=tea&stock=low&sort=-price',
    );
    expect(productListHref(sorted, { sort: DEFAULT_PRODUCT_SORT })).toBe('/admin/products?q=tea');
    expect(productSortParam({ column: 'updated', direction: 'asc' })).toBeUndefined();
  });

  it('builds links that keep the other filters and restart paging', () => {
    const params = parseProductListParams({ q: 'tea', stock: 'out', page: '4' });
    expect(productListHref(params, { status: 'draft' })).toBe(
      '/admin/products?q=tea&status=draft&stock=out',
    );
    expect(productListHref(params, { page: 2 })).toBe('/admin/products?q=tea&stock=out&page=2');
    expect(productListHref({ stock: 'low', page: 1 }, {}, '/admin/inventory')).toBe(
      '/admin/inventory?stock=low',
    );
  });

  it('reads the ledger filters', () => {
    const params = parseMovementListParams({
      product: CATEGORY_ID,
      reason: 'adjustment',
      page: '2',
    });
    expect(params).toEqual({ product: CATEGORY_ID, reason: 'adjustment', page: 2 });
    expect(movementListHref(params, { reason: undefined })).toBe(
      `/admin/inventory?view=movements&product=${CATEGORY_ID}`,
    );
    expect(parseMovementListParams({ reason: 'stolen' }).reason).toBeUndefined();
  });
});

describe('notices and stock bars', () => {
  it('shows only known notices', () => {
    expect(productNotice('published')).toMatch(/now on sale/);
    expect(productNotice('<script>')).toBeUndefined();
    expect(categoryNotice('category-hidden')).toMatch(/no longer appear/);
    expect(categoryNotice(['category-hidden'])).toBeUndefined();
  });

  it('draws an empty bar when sold out and caps a full one', () => {
    expect(stockBarPercent(0)).toBe(0);
    expect(stockBarPercent(1)).toBe(5);
    expect(stockBarPercent(500)).toBe(100);
  });
});
