import { ApiError } from '@nilzora/api-client';
import { describeAddOutcome } from '../features/catalog/add-to-cart';
import {
  facetChoiceLabel,
  facetsQuery,
  feedQuery,
  hasActiveFilters,
  isProductNotFound,
  nextPageNumber,
  orderableLimit,
  parseProductSlug,
  parseSearchText,
  parseShopFilters,
  productCountLabel,
  productHref,
  productSpokenSummary,
  shopHref,
  sortsFor,
  sortsForFilters,
  uniqueProducts,
} from '../features/catalog/catalog-query';
import { page, productId, summary } from '../features/catalog/test-fixtures';

describe('shop filters from route parameters', () => {
  it('defaults to the featured sort with no search or category', () => {
    expect(parseShopFilters({})).toEqual({
      q: '',
      category: undefined,
      zone: undefined,
      sort: 'featured',
      brand: undefined,
      minTaka: undefined,
      maxTaka: undefined,
      inStock: false,
    });
  });

  it('keeps a valid category, collection, search and sort', () => {
    expect(
      parseShopFilters({ q: ' rice ', category: 'groceries', zone: 'mens', sort: 'price_asc' }),
    ).toEqual({
      q: 'rice',
      category: 'groceries',
      zone: 'mens',
      sort: 'price_asc',
      brand: undefined,
      minTaka: undefined,
      maxTaka: undefined,
      inStock: false,
    });
  });

  it('reads the toolbar’s brand, price and availability, refusing malformed values', () => {
    expect(
      parseShopFilters({ brand: 'aarong', min: '500', max: '1,500', stock: 'in' }),
    ).toMatchObject({ brand: 'aarong', minTaka: 500, maxTaka: 1_500, inStock: true });
    // A range typed the wrong way round is read the way it was meant.
    expect(parseShopFilters({ min: '900', max: '200' })).toMatchObject({
      minTaka: 200,
      maxTaka: 900,
    });
    expect(
      parseShopFilters({ brand: 'Not A Slug!', min: 'abc', max: '-5', stock: 'yes' }),
    ).toMatchObject({ brand: undefined, minTaka: undefined, maxTaka: undefined, inStock: false });
  });

  it('reads the sizes and colours a link asks for, dropping anything unsafe', () => {
    expect(parseShopFilters({ size: 'm,l', color: ['black', 'white'] })).toMatchObject({
      sizes: ['m', 'l'],
      colors: ['black', 'white'],
    });
    // A repeated parameter, a repeated value, and a value that is not a slug.
    expect(parseShopFilters({ size: ['m', 'm', 'Not A Slug!', 'l'] }).sizes).toEqual(['m', 'l']);
    // Nothing chosen leaves the listing exactly as it was.
    expect(parseShopFilters({ size: ',', color: '' })).not.toHaveProperty('sizes');
    expect(parseShopFilters({})).not.toHaveProperty('colors');
  });

  it('names a chosen size or colour with the store’s own value', () => {
    const sizes = [
      { slug: 'm', value: 'M', productCount: 12 },
      { slug: 'xl', value: 'XL', productCount: 2 },
    ];
    expect(facetChoiceLabel(['xl'], sizes)).toBe('XL');
    expect(facetChoiceLabel(['xl', 'm'], sizes)).toBe('XL · M');
    // The facets have not loaded, so the slug stands in rather than an empty chip.
    expect(facetChoiceLabel(['l'], [])).toBe('L');
    expect(facetChoiceLabel(undefined, sizes)).toBeNull();
  });

  it('offers best match only while searching, and falls back to the right default', () => {
    expect(sortsFor('')).toEqual(['featured', 'newest', 'price_asc', 'price_desc']);
    expect(sortsFor('rice')).toEqual(['relevance', 'newest', 'price_asc', 'price_desc']);
    expect(parseShopFilters({ sort: 'relevance' }).sort).toBe('featured');
    expect(parseShopFilters({ q: 'rice', sort: 'featured' }).sort).toBe('relevance');
  });

  it('ignores values a link should not be able to inject', () => {
    expect(
      parseShopFilters({
        category: 'Not A Slug!',
        zone: 'Not A Slug!',
        sort: 'drop table',
        q: ['a', 'b'],
      }),
    ).toEqual({
      q: '',
      category: undefined,
      zone: undefined,
      sort: 'featured',
      brand: undefined,
      minTaka: undefined,
      maxTaka: undefined,
      inStock: false,
    });
  });

  it('cuts the search to the length the API accepts, without splitting an emoji', () => {
    const long = `${'a'.repeat(99)}😀`;
    const text = parseSearchText(long);
    expect(text).toBe('a'.repeat(99));
    expect(parseSearchText('   ')).toBe('');
  });

  it('knows when a filter is on, the collection included', () => {
    expect(hasActiveFilters(parseShopFilters({ sort: 'newest' }))).toBe(false);
    expect(hasActiveFilters(parseShopFilters({ q: 'rice' }))).toBe(true);
    expect(hasActiveFilters(parseShopFilters({ category: 'fashion' }))).toBe(true);
    expect(hasActiveFilters(parseShopFilters({ zone: 'mens' }))).toBe(true);
    expect(hasActiveFilters(parseShopFilters({ brand: 'aarong' }))).toBe(true);
    expect(hasActiveFilters(parseShopFilters({ min: '500' }))).toBe(true);
    expect(hasActiveFilters(parseShopFilters({ stock: 'in' }))).toBe(true);
  });

  it('builds the API query from the filters, leaving blanks out', () => {
    expect(feedQuery(parseShopFilters({}))).toEqual({ sort: 'featured', pageSize: 24 });
    expect(feedQuery(parseShopFilters({ q: 'rice', category: 'groceries' }))).toEqual({
      q: 'rice',
      category: 'groceries',
      sort: 'relevance',
      pageSize: 24,
    });
  });

  it('sends the collection with everything else the shopper chose', () => {
    // The API decides membership; the app only carries the choice.
    expect(feedQuery(parseShopFilters({ zone: 'mens' }))).toEqual({
      zone: 'mens',
      sort: 'featured',
      pageSize: 24,
    });
    // The API refuses to rank a collection-narrowed search by best match, so it lists newest.
    expect(feedQuery(parseShopFilters({ zone: 'mens', q: 'shirt' }))).toEqual({
      q: 'shirt',
      zone: 'mens',
      sort: 'newest',
      pageSize: 24,
    });
  });

  it('never asks for a best match the API would refuse', () => {
    const refined = parseShopFilters({ q: 'shirt', size: 'm' });
    expect(refined.sort).toBe('newest');
    expect(feedQuery(refined)).toMatchObject({ q: 'shirt', size: ['m'], sort: 'newest' });
    // A category keeps the ranking: the API only narrows relevance for the other filters.
    expect(parseShopFilters({ q: 'shirt', category: 'fashion' }).sort).toBe('relevance');
    expect(sortsForFilters('shirt', refined)).toEqual(['newest', 'price_asc', 'price_desc']);
    expect(sortsForFilters('shirt', parseShopFilters({ q: 'shirt' }))).toEqual([
      'relevance',
      'newest',
      'price_asc',
      'price_desc',
    ]);
    // Browsing has no best match to lose.
    expect(sortsForFilters('', parseShopFilters({ brand: 'aarong' }))).toEqual([
      'featured',
      'newest',
      'price_asc',
      'price_desc',
    ]);
  });

  it('sends the toolbar refinements as the API’s own price, brand and stock options', () => {
    expect(
      feedQuery(
        parseShopFilters({
          brand: 'aarong',
          min: '500',
          max: '1500',
          stock: 'in',
          sort: 'price_asc',
        }),
      ),
    ).toEqual({
      brand: 'aarong',
      minPriceMinor: 50_000,
      maxPriceMinor: 150_000,
      inStock: true,
      sort: 'price_asc',
      pageSize: 24,
    });
  });

  it('sends the chosen sizes and colours as the API’s own filter', () => {
    expect(feedQuery(parseShopFilters({ size: 'm,l', color: 'black' }))).toEqual({
      size: ['m', 'l'],
      color: ['black'],
      sort: 'featured',
      pageSize: 24,
    });
    expect(hasActiveFilters(parseShopFilters({ size: 'm' }))).toBe(true);
    expect(hasActiveFilters(parseShopFilters({ color: 'black' }))).toBe(true);
  });

  it('asks for the options with every filter, the choices included', () => {
    // Each list answers the other choice: the colours a chosen size really comes in.
    expect(
      facetsQuery(
        parseShopFilters({ q: 'shirt', brand: 'aarong', stock: 'in', size: 'm', color: 'black' }),
      ),
    ).toEqual({ q: 'shirt', brand: 'aarong', inStock: true, size: ['m'], color: ['black'] });
    // Paging and sort are about one page, never about what an option offers.
    expect(facetsQuery(parseShopFilters({ sort: 'price_desc' }))).toEqual({});
  });
});

describe('links', () => {
  it('sends only the filters it is given to the shop', () => {
    expect(shopHref()).toEqual({ pathname: '/shop', params: {} });
    expect(shopHref({ category: 'fashion', sort: 'newest' })).toEqual({
      pathname: '/shop',
      params: { category: 'fashion', sort: 'newest' },
    });
  });

  it('opens the shop on a collection', () => {
    expect(shopHref({ zone: 'mens' })).toEqual({
      pathname: '/shop',
      params: { zone: 'mens' },
    });
  });

  it('encodes a product address', () => {
    expect(productHref('cotton-shirt')).toBe('/product/cotton-shirt');
    expect(productHref('a/b?c')).toBe('/product/a%2Fb%3Fc');
  });

  it('accepts only a well-formed product slug', () => {
    expect(parseProductSlug('cotton-shirt')).toBe('cotton-shirt');
    expect(parseProductSlug('Cotton Shirt')).toBeNull();
    expect(parseProductSlug(['a', 'b'])).toBeNull();
    expect(parseProductSlug(undefined)).toBeNull();
  });
});

describe('paging', () => {
  it('asks for the next page until the last', () => {
    expect(nextPageNumber(page([], { page: 1, totalPages: 3 }))).toBe(2);
    expect(nextPageNumber(page([], { page: 3, totalPages: 3 }))).toBeUndefined();
    expect(nextPageNumber(page([], { page: 1, totalPages: 0 }))).toBeUndefined();
  });

  it('stops before the offset the API refuses', () => {
    // Page 417 of 24 starts at offset 9,984; page 418 would start at 10,008 (> 10,000).
    expect(nextPageNumber(page([], { page: 416, pageSize: 24, totalPages: 900 }))).toBe(417);
    expect(nextPageNumber(page([], { page: 417, pageSize: 24, totalPages: 900 }))).toBeUndefined();
  });

  it('keeps each product once when pages overlap', () => {
    const a = summary({ id: productId(1), slug: 'a' });
    const b = summary({ id: productId(2), slug: 'b' });
    const c = summary({ id: productId(3), slug: 'c' });
    expect(uniqueProducts([page([a, b]), page([b, c])]).map((p) => p.slug)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('product facts', () => {
  it('limits an order by the API limit, and to nothing when out of stock', () => {
    expect(orderableLimit({ availability: 'in_stock', maxOrderQuantity: 4 })).toBe(4);
    expect(orderableLimit({ availability: 'low_stock', maxOrderQuantity: 2 })).toBe(2);
    expect(orderableLimit({ availability: 'out_of_stock', maxOrderQuantity: 4 })).toBe(0);
    expect(orderableLimit({ availability: 'in_stock', maxOrderQuantity: 0 })).toBe(0);
    expect(orderableLimit({ availability: 'in_stock', maxOrderQuantity: 5000 })).toBe(100);
  });

  it('reads a product as one phrase', () => {
    expect(
      productSpokenSummary({
        name: 'Cotton shirt',
        priceMinor: 125_000,
        compareAtPriceMinor: null,
        availability: 'in_stock',
      }),
    ).toBe('Cotton shirt, Price 1,250 taka, In stock');
    expect(
      productSpokenSummary({
        name: 'Cotton shirt',
        priceMinor: 100_000,
        compareAtPriceMinor: 125_000,
        availability: 'low_stock',
      }),
    ).toBe('Cotton shirt, Price 1,000 taka, was 1,250 taka, save 20 percent, Only a few left');
  });

  it('counts products in words', () => {
    expect(productCountLabel(1)).toBe('1 product');
    expect(productCountLabel(0)).toBe('0 products');
    expect(productCountLabel(24)).toBe('24 products');
  });

  it('recognises the API saying a product does not exist', () => {
    expect(isProductNotFound(new ApiError(404, 'not_found', 'Product not found'))).toBe(true);
    expect(isProductNotFound(new ApiError(0, 'network_error', 'offline'))).toBe(false);
    expect(isProductNotFound(new Error('boom'))).toBe(false);
  });
});

describe('describeAddOutcome', () => {
  it('confirms a plain add', () => {
    expect(describeAddOutcome({ outcome: 'added', requested: 1, before: 0, limit: 5 })).toEqual({
      tone: 'success',
      message: 'Added 1 item to your cart.',
      offerCart: true,
    });
  });

  it('says how many there are when the cart already held some', () => {
    expect(
      describeAddOutcome({ outcome: 'added', requested: 2, before: 1, limit: 5 }).message,
    ).toBe('Added 2 items to your cart. You now have 3 of this product.');
  });

  it('explains when the cart took fewer than asked', () => {
    expect(describeAddOutcome({ outcome: 'added', requested: 3, before: 3, limit: 5 })).toEqual({
      tone: 'warning',
      message: 'Added 2 items to your cart. The most you can order is 5, so you now have 5.',
      offerCart: true,
    });
  });

  it('explains the limit, a full cart and an invalid product', () => {
    expect(describeAddOutcome({ outcome: 'at_limit', requested: 1, before: 5, limit: 5 })).toEqual({
      tone: 'warning',
      message: 'You already have 5 in your cart. The most you can order is 5.',
      offerCart: true,
    });
    expect(
      describeAddOutcome({ outcome: 'cart_full', requested: 1, before: 0, limit: 5 }).message,
    ).toBe('Your cart is full (30 different products). Remove an item to add this one.');
    expect(describeAddOutcome({ outcome: 'invalid', requested: 1, before: 0, limit: 5 })).toEqual({
      tone: 'danger',
      message: 'We could not add this product to your cart. Please try again.',
      offerCart: false,
    });
  });
});
