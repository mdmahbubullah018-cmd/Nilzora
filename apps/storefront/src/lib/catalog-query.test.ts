import { MAX_CATALOG_OFFSET, productListQuerySchema } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import {
  categoryHref,
  LISTING_PAGE_SIZE,
  listingHref,
  maxPage,
  MAX_SEARCH_LENGTH,
  parseBrowseQuery,
  parseCategorySlug,
  parsePage,
  parseSearchQuery,
  parseSearchText,
  parseSort,
  productHref,
  BROWSE_SORTS,
  SEARCH_SORTS,
  apiFilters,
  hasActiveFilters,
  MAX_FILTER_TAKA,
  NO_FILTERS,
  parseListingFilters,
  parseTaka,
  reviewsShown,
  searchSorts,
  zoneHref,
} from './catalog-query';

describe('parseSort', () => {
  it('keeps an offered sort and falls back to the first for anything else', () => {
    expect(parseSort('newest', BROWSE_SORTS)).toBe('newest');
    expect(parseSort('relevance', BROWSE_SORTS)).toBe('featured');
    expect(parseSort('featured', SEARCH_SORTS)).toBe('relevance');
    expect(parseSort('PRICE_ASC', BROWSE_SORTS)).toBe('featured');
    expect(parseSort(undefined, BROWSE_SORTS)).toBe('featured');
  });
});

describe('parsePage', () => {
  it('accepts whole page numbers from 1', () => {
    expect(parsePage('3')).toBe(3);
    expect(parsePage('0')).toBe(1);
    expect(parsePage(undefined)).toBe(1);
  });

  it('ignores junk', () => {
    for (const junk of ['-2', '2.5', 'abc', '', ' 2', '1e3', '9999999', '0x10']) {
      expect(parsePage(junk), junk).toBe(1);
    }
  });

  it('never goes deeper than the API can page', () => {
    const deepest = maxPage();
    expect(parsePage('999999')).toBe(deepest);
    expect((deepest - 1) * LISTING_PAGE_SIZE).toBeLessThanOrEqual(MAX_CATALOG_OFFSET);
    expect(deepest * LISTING_PAGE_SIZE).toBeGreaterThan(MAX_CATALOG_OFFSET);
    expect(
      productListQuerySchema.safeParse({ page: deepest, pageSize: LISTING_PAGE_SIZE }).success,
    ).toBe(true);
  });
});

describe('parseSearchText', () => {
  it('trims and keeps blank text blank', () => {
    expect(parseSearchText('  rice  ')).toBe('rice');
    expect(parseSearchText('   ')).toBe('');
    expect(parseSearchText(undefined)).toBe('');
  });

  it('cuts long text to what the API accepts, without splitting an emoji', () => {
    const long = parseSearchText('a'.repeat(250));
    expect(long).toHaveLength(MAX_SEARCH_LENGTH);
    expect(productListQuerySchema.safeParse({ q: long }).success).toBe(true);

    const cut = parseSearchText(`${'a'.repeat(MAX_SEARCH_LENGTH - 1)}😀tail`);
    expect(cut).toBe('a'.repeat(MAX_SEARCH_LENGTH - 1));
    expect(/[\uD800-\uDFFF]/.test(cut)).toBe(false);
  });
});

describe('parseCategorySlug', () => {
  it('keeps only well-formed slugs', () => {
    expect(parseCategorySlug('home-kitchen')).toBe('home-kitchen');
    for (const junk of ['', 'Home', '../admin', 'a b', 'fashion-', '<script>']) {
      expect(parseCategorySlug(junk), junk).toBeUndefined();
    }
    expect(parseCategorySlug(undefined)).toBeUndefined();
  });
});

describe('parseBrowseQuery and parseSearchQuery', () => {
  it('reads one value of each parameter and treats repeats as absent', () => {
    expect(parseBrowseQuery({ sort: 'price_desc', page: '2', utm_source: 'x' })).toEqual({
      sort: 'price_desc',
      page: 2,
      filters: NO_FILTERS,
      zone: undefined,
    });
    expect(parseBrowseQuery({ sort: ['newest', 'price_asc'], page: ['2', '3'] })).toEqual({
      sort: 'featured',
      page: 1,
      filters: NO_FILTERS,
      zone: undefined,
    });
  });

  it('reads the collection being browsed, and drops one that cannot be a slug', () => {
    expect(parseBrowseQuery({ zone: 'mens' }).zone).toBe('mens');
    expect(parseBrowseQuery({ zone: 'Not A Slug' }).zone).toBeUndefined();
    expect(parseBrowseQuery({ zone: ['mens', 'kids'] }).zone).toBeUndefined();
  });

  it('parses a search with its filter', () => {
    expect(
      parseSearchQuery({ q: ' cotton ', category: 'fashion', sort: 'newest', page: '4' }),
    ).toEqual({ q: 'cotton', category: 'fashion', sort: 'newest', page: 4, filters: NO_FILTERS });
    expect(parseSearchQuery({})).toEqual({
      q: '',
      category: undefined,
      sort: 'relevance',
      page: 1,
      filters: NO_FILTERS,
    });
  });
});

describe('hrefs', () => {
  it('builds product and category addresses', () => {
    expect(productHref('wireless-earbuds')).toBe('/products/wireless-earbuds');
    expect(categoryHref('home-kitchen')).toBe('/categories/home-kitchen');
    // Never a path change, whatever the value.
    expect(productHref('../account?x=1')).toBe('/products/..%2Faccount%3Fx%3D1');
  });

  it('leaves defaults out of listing links', () => {
    expect(listingHref('/products', { sort: 'featured', page: 1 }, 'featured')).toBe('/products');
    expect(listingHref('/products', { sort: 'newest', page: 2 }, 'featured')).toBe(
      '/products?sort=newest&page=2',
    );
    expect(
      listingHref(
        '/search',
        { q: 'rice & oil', category: 'groceries', sort: 'relevance', page: 3 },
        'relevance',
      ),
    ).toBe('/search?q=rice+%26+oil&category=groceries&page=3');
  });

  it('keeps the collection in a listing link', () => {
    expect(listingHref('/products', { zone: 'mens', sort: 'featured' }, 'featured')).toBe(
      '/products?zone=mens',
    );
    expect(listingHref('/products', { zone: 'mens', sort: 'newest', page: 2 }, 'featured')).toBe(
      '/products?zone=mens&sort=newest&page=2',
    );
  });

  it('builds a collection link that encodes the slug', () => {
    expect(zoneHref('mens')).toBe('/products?zone=mens');
    expect(zoneHref('eid edit')).toBe('/products?zone=eid%20edit');
  });
});

describe('listing filters', () => {
  it('reads whole taka, with digit grouping, within the API bounds', () => {
    expect(parseTaka('1500')).toBe(1500);
    expect(parseTaka('1,50,000')).toBe(150_000);
    expect(parseTaka(' 0 ')).toBe(0);
    expect(parseTaka(String(MAX_FILTER_TAKA))).toBe(MAX_FILTER_TAKA);
    for (const junk of ['', '-5', '12.5', '1e3', 'cheap', String(MAX_FILTER_TAKA + 1), undefined]) {
      expect(parseTaka(junk)).toBeUndefined();
    }
  });

  it('parses each filter once, drops malformed ones and reads a reversed range as meant', () => {
    expect(
      parseListingFilters({ brand: 'aarong', min: '900', max: '100', stock: 'in', utm: 'x' }),
    ).toEqual({ brand: 'aarong', minTaka: 100, maxTaka: 900, inStock: true });
    expect(parseListingFilters({ brand: '../admin', min: ['1', '2'], stock: 'yes' })).toEqual(
      NO_FILTERS,
    );
    expect(hasActiveFilters(NO_FILTERS)).toBe(false);
    expect(hasActiveFilters({ inStock: false, maxTaka: 0 })).toBe(true);
  });

  it('reads size and colour values whether they repeat or use commas', () => {
    expect(parseListingFilters({ size: 'm,l', color: 'black' })).toMatchObject({
      sizes: ['m', 'l'],
      colors: ['black'],
    });
    expect(
      parseListingFilters({ size: ['m', 'l', 'm'], color: ['navy', 'bad value'] }),
    ).toMatchObject({ sizes: ['m', 'l'], colors: ['navy'] });
    // A facet narrows the listing just as a price does.
    expect(hasActiveFilters({ inStock: false, sizes: ['m'] })).toBe(true);
    expect(hasActiveFilters({ inStock: false, colors: ['black'] })).toBe(true);
  });

  it('sends prices to the API in poisha, and stock only when it narrows', () => {
    expect(apiFilters({ brand: 'aarong', minTaka: 5, maxTaka: 1200, inStock: true })).toEqual({
      brand: 'aarong',
      minPriceMinor: 500,
      maxPriceMinor: 120_000,
      inStock: true,
    });
    expect(apiFilters(NO_FILTERS)).toEqual({
      brand: undefined,
      minPriceMinor: undefined,
      maxPriceMinor: undefined,
      inStock: undefined,
    });
    expect(apiFilters({ inStock: false, sizes: ['m'], colors: ['black'] })).toMatchObject({
      size: ['m'],
      color: ['black'],
    });
  });

  it('keeps filters in listing links, in a fixed order, before sort and page', () => {
    expect(
      listingHref(
        '/products',
        {
          sort: 'newest',
          page: 3,
          filters: {
            brand: 'aarong',
            minTaka: 0,
            maxTaka: 999,
            inStock: true,
            sizes: ['m'],
            colors: ['black'],
          },
        },
        'featured',
      ),
    ).toBe('/products?brand=aarong&size=m&color=black&min=0&max=999&stock=in&sort=newest&page=3');
  });

  it('stops offering relevance once a search is filtered, and defaults to newest', () => {
    expect(searchSorts(NO_FILTERS)).toEqual(SEARCH_SORTS);
    expect(searchSorts({ inStock: true })).toEqual(['newest', 'price_asc', 'price_desc']);
    expect(parseSearchQuery({ q: 'pan', stock: 'in', sort: 'relevance' }).sort).toBe('newest');
  });
});

describe('reviewsShown', () => {
  it('shows batches of six, from one batch up to the most a page holds', () => {
    expect(reviewsShown(undefined)).toBe(6);
    expect(reviewsShown('2')).toBe(12);
    expect(reviewsShown('0')).toBe(6);
    expect(reviewsShown('99')).toBe(48);
    expect(reviewsShown('two')).toBe(6);
  });
});
