import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it } from 'vitest';
import { categories, listing, summary } from '@/testing/catalog-fixtures';
import { availabilityLabel, AvailabilityBadge } from './availability';
import { Breadcrumbs } from './breadcrumbs';
import { CatalogNotFound } from './catalog-not-found';
import { ListingSkeleton } from './catalog-skeletons';
import { CatalogUnavailable } from './catalog-states';
import { CategoryDepartments, CategoryNav, CategoryTiles, productCountLabel } from './categories';
import { ListingToolbar, priceRangeLabel } from './listing-toolbar';
import { pageWindow, Pagination } from './pagination';
import { ProductCard, ProductGrid } from './product-card';
import { listingSummary, ProductListing } from './product-listing';

const hrefFor = (page: number) => `/products?page=${page}` as Route;

function hrefs(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('a'), (link) => link.getAttribute('href'));
}

describe('ProductCard', () => {
  it('is one link named by the product, with its price, offer and availability', () => {
    const product = summary({
      slug: 'cotton-bedsheet-set-double',
      name: 'Cotton Bedsheet Set, Double',
      priceMinor: 220_000,
      compareAtPriceMinor: 260_000,
      availability: 'low_stock',
    });
    const { container } = render(<ProductCard product={product} />);

    // One product link; the quick-add control is a separate, deliberate affordance.
    const links = container.querySelectorAll('a');
    expect(links).toHaveLength(1);
    const link = screen.getByRole('link', { name: 'Cotton Bedsheet Set, Double' });
    expect(link.getAttribute('href')).toBe('/products/cotton-bedsheet-set-double');
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe(
      'Cotton Bedsheet Set, Double',
    );
    expect(screen.getByText('৳2,200')).not.toBeNull();
    expect(container.querySelector('.line-through')?.textContent).toBe('Was ৳2,600');
    expect(screen.getByText('Save 15%')).not.toBeNull();
    expect(screen.getByText('Only a few left')).not.toBeNull();
    expect(screen.getByText('Home & Kitchen')).not.toBeNull();
  });

  it('shows no offer without a higher former price, and fits the page outline', () => {
    render(<ProductCard product={summary({ availability: 'out_of_stock' })} headingLevel="h2" />);

    expect(screen.queryByText(/^Save/)).toBeNull();
    expect(screen.getByText('Out of stock')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 2 })).not.toBeNull();
  });

  it('renders untrusted product text as text', () => {
    const { container } = render(
      <ProductCard product={summary({ name: '<img src=x onerror=alert(1)>' })} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('link', { name: '<img src=x onerror=alert(1)>' })).not.toBeNull();
  });
});

describe('ProductGrid', () => {
  it('lists each product once', () => {
    render(<ProductGrid products={[summary(), summary(), summary()]} />);
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3);
  });
});

describe('AvailabilityBadge', () => {
  it('names each stock band', () => {
    expect(availabilityLabel('in_stock')).toBe('In stock');
    expect(availabilityLabel('low_stock')).toBe('Only a few left');
    expect(availabilityLabel('out_of_stock')).toBe('Out of stock');
    render(<AvailabilityBadge availability="in_stock" />);
    expect(screen.getByText('In stock')).not.toBeNull();
  });
});

describe('pageWindow', () => {
  it('shows the ends, the current page and its neighbours', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageWindow(1, 10)).toEqual([1, 2, null, 10]);
    expect(pageWindow(10, 10)).toEqual([1, null, 9, 10]);
    // A gap of one page shows that page instead of an ellipsis.
    expect(pageWindow(4, 10)).toEqual([1, 2, 3, 4, 5, null, 10]);
  });
});

describe('Pagination', () => {
  it('renders nothing for a single page or a page out of range', () => {
    const one = render(<Pagination page={1} totalPages={1} hrefFor={hrefFor} />);
    expect(one.container.innerHTML).toBe('');
    one.unmount();
    const beyond = render(<Pagination page={4} totalPages={3} hrefFor={hrefFor} />);
    expect(beyond.container.innerHTML).toBe('');
  });

  it('links to neighbours and pages, marking the current one', () => {
    render(<Pagination page={2} totalPages={3} hrefFor={hrefFor} />);

    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(
      within(nav)
        .getByRole('link', { name: /Previous/ })
        .getAttribute('href'),
    ).toBe('/products?page=1');
    expect(within(nav).getByRole('link', { name: /Next/ }).getAttribute('href')).toBe(
      '/products?page=3',
    );
    const current = within(nav).getByRole('link', { name: 'Page 2' });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Page 1' }).getAttribute('aria-current')).toBe(
      null,
    );
  });

  it('never links past the last page or before the first', () => {
    const last = render(<Pagination page={3} totalPages={3} hrefFor={hrefFor} />);
    expect(screen.queryByRole('link', { name: /Next/ })).toBeNull();
    expect(hrefs(last.container)).not.toContain('/products?page=4');
    last.unmount();

    render(<Pagination page={1} totalPages={3} hrefFor={hrefFor} />);
    expect(screen.queryByRole('link', { name: /Previous/ })).toBeNull();
    expect(hrefs(document.body)).not.toContain('/products?page=0');
  });
});

describe('ProductListing', () => {
  it('summarises the results', () => {
    expect(listingSummary(listing([summary()]))).toBe('1 product');
    expect(
      listingSummary(listing([summary()], { page: 2, pageSize: 24, total: 57, totalPages: 3 })),
    ).toBe('Showing 25–48 of 57 products');
    expect(
      listingSummary(listing([summary()], { page: 1, pageSize: 24, total: 2_000, totalPages: 84 })),
    ).toBe('Showing 1–24 of 2,000 products');
  });

  it('shows the grid, controls and pagination', () => {
    render(
      <ProductListing
        listing={listing([summary(), summary()], { total: 30, totalPages: 2 })}
        hrefFor={hrefFor}
        empty={<p>Nothing here</p>}
        controls={<p>Controls</p>}
      />,
    );

    expect(screen.getByText('Showing 1–24 of 30 products')).not.toBeNull();
    expect(screen.getByText('Controls')).not.toBeNull();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);
    expect(screen.getByRole('navigation', { name: 'Pagination' })).not.toBeNull();
    expect(screen.queryByText('Nothing here')).toBeNull();
  });

  it('shows the empty state when nothing matches', () => {
    render(<ProductListing listing={listing([])} hrefFor={hrefFor} empty={<p>Nothing here</p>} />);
    expect(screen.getByText('Nothing here')).not.toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('offers the last page for a page past the end', () => {
    render(
      <ProductListing
        listing={listing([], { page: 9, total: 30, totalPages: 2 })}
        hrefFor={hrefFor}
        empty={<p>Nothing here</p>}
      />,
    );
    expect(screen.getByText('This page is past the end of the list')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Go to the last page' }).getAttribute('href')).toBe(
      '/products?page=2',
    );
    expect(screen.queryByText('Nothing here')).toBeNull();
  });
});

describe('ListingToolbar', () => {
  const noFacets = { sizes: [], colors: [] };

  it('is one GET form with a compact chip per control', () => {
    const { container } = render(
      <ListingToolbar
        path="/products"
        sorts={['featured', 'newest']}
        sort="newest"
        defaultSort="featured"
        filters={{ inStock: false }}
        facets={noFacets}
      />,
    );

    const form = container.querySelector('form');
    expect(form?.getAttribute('action')).toBe('/products');
    // A chosen sort is named on the chip; the default one simply reads "Sort".
    expect(screen.getByRole('button', { name: 'Newest' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Price' })).toBeTruthy();
    // With no facets there is no size or colour control to click.
    expect(screen.queryByRole('button', { name: 'Size' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Colour' })).toBeNull();
  });

  it('re-sorts as soon as an order is chosen in the sort panel', () => {
    const { container } = render(
      <ListingToolbar
        path="/products"
        sorts={['featured', 'newest']}
        sort="featured"
        defaultSort="featured"
        filters={{ inStock: false }}
        facets={noFacets}
      />,
    );
    const form = container.querySelector('form');
    let submitted = 0;
    if (!form) throw new Error('no form');
    form.requestSubmit = () => {
      submitted += 1;
    };

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Newest' }));
    expect(submitted).toBe(1);
  });

  it('offers the sizes and colours this listing really has, with counts', () => {
    render(
      <ListingToolbar
        path="/products"
        sorts={['featured']}
        sort="featured"
        defaultSort="featured"
        filters={{ inStock: false }}
        facets={{
          sizes: [
            { slug: 'm', value: 'M', productCount: 4 },
            { slug: 'l', value: 'L', productCount: 2 },
          ],
          colors: [{ slug: 'black', value: 'Black', productCount: 3, swatchHex: '#0F172A' }],
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Size' }));
    expect(screen.getByRole('checkbox', { name: /M/ })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /L/ })).toBeTruthy();
    // The panel's controls belong to the toolbar form, so a submit carries them.
    const form = screen.getByRole('checkbox', { name: /M/ }).getAttribute('form');
    expect(form).toBe('listing-toolbar-form');
  });

  it('states the price range on its chip and keeps Apply and Clear in the panel', () => {
    render(
      <ListingToolbar
        path="/products"
        sorts={['featured']}
        sort="featured"
        defaultSort="featured"
        filters={{ inStock: true, minTaka: 500, maxTaka: 1_500 }}
        facets={noFacets}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /500/ }));
    expect(screen.getByLabelText<HTMLInputElement>('Lowest price in taka').value).toBe('500');
    expect(screen.getByLabelText<HTMLInputElement>('Highest price in taka').value).toBe('1500');
    expect(screen.getByRole('button', { name: 'Apply price' }).getAttribute('form')).toBe(
      'listing-toolbar-form',
    );
    // Clearing the range keeps the other filters.
    expect(screen.getByRole('link', { name: 'Clear' }).getAttribute('href')).toBe(
      '/products?stock=in',
    );
  });

  it('keeps the search text, category, collection and filters while re-sorting', () => {
    const { container } = render(
      <ListingToolbar
        path="/search"
        sorts={['newest', 'price_asc']}
        sort="newest"
        defaultSort="newest"
        q="cotton"
        category="fashion"
        zone="eid"
        filters={{
          brand: 'aarong',
          inStock: true,
          sizes: ['m'],
          colors: ['black'],
          minTaka: 500,
          maxTaka: 1_500,
        }}
        facets={noFacets}
      />,
    );

    const kept = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="hidden"]'),
      (input) => `${input.name}=${input.value}`,
    );
    // Every applied dimension travels with the form, so choosing a sort or a price can never
    // silently drop the sizes, colours or range already in force.
    expect(kept).toEqual([
      'q=cotton',
      'category=fashion',
      'zone=eid',
      'brand=aarong',
      'stock=in',
      'size=m',
      'color=black',
      'min=500',
      'max=1500',
    ]);
  });

  it('leaves the open panel’s own dimension to that panel, so a value can be unselected', () => {
    const { container } = render(
      <ListingToolbar
        path="/products"
        sorts={['featured']}
        sort="featured"
        defaultSort="featured"
        filters={{ inStock: false, sizes: ['m'] }}
        facets={{
          sizes: [
            { slug: 'm', value: 'M', productCount: 3 },
            { slug: 'l', value: 'L', productCount: 1 },
          ],
          colors: [],
        }}
      />,
    );
    const hiddenNames = () =>
      Array.from(
        container.querySelectorAll<HTMLInputElement>('input[type="hidden"]'),
        (input) => input.name,
      );

    expect(hiddenNames()).toContain('size');
    const sizeChip = [...container.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]')]
      .find((chip) => (chip.textContent ?? '').startsWith('M'));
    expect(sizeChip).toBeDefined();
    fireEvent.click(sizeChip as HTMLButtonElement);
    // The panel's checkboxes are now the only source of `size`, so unticking M really removes it.
    expect(hiddenNames()).not.toContain('size');
  });

  it('labels every shape of price range', () => {
    expect(priceRangeLabel({ inStock: false })).toBeNull();
    expect(priceRangeLabel({ inStock: false, minTaka: 500 })).toBe('From ৳500');
    expect(priceRangeLabel({ inStock: false, maxTaka: 1_500 })).toBe('Up to ৳1,500');
    expect(priceRangeLabel({ inStock: false, minTaka: 500, maxTaka: 1_500 })).toBe(
      '৳500 – ৳1,500',
    );
  });
});

describe('categories', () => {
  it('counts products', () => {
    expect(productCountLabel(0)).toBe('0 products');
    expect(productCountLabel(1)).toBe('1 product');
    expect(productCountLabel(125_000)).toBe('1,25,000 products');
  });

  it('links each tile to its category, named with its count', () => {
    render(<CategoryTiles categories={categories} />);
    expect(
      screen.getByRole('link', { name: 'Home & Kitchen, 4 products' }).getAttribute('href'),
    ).toBe('/categories/home-kitchen');
    expect(screen.getByRole('link', { name: 'Fashion, 1 product' }).getAttribute('href')).toBe(
      '/categories/fashion',
    );
  });

  it('groups subcategories under their department on the index', () => {
    const [first, second] = categories;
    if (!first || !second) throw new Error('fixtures');
    const child = {
      ...second,
      slug: 'child-one',
      name: 'Child one',
      parentSlug: first.slug,
      productCount: 2,
    };
    render(<CategoryDepartments categories={[first, second, child]} />);
    // Only departments are cards; the subcategory is a link inside its department's nav.
    expect(screen.getAllByRole('link').filter((link) => link.closest('nav') === null)).toHaveLength(
      2,
    );
    const nav = screen.getByRole('navigation', { name: `Subcategories of ${first.name}` });
    expect(
      within(nav)
        .getByRole('link', { name: /Child one/ })
        .getAttribute('href'),
    ).toBe('/categories/child-one');
    expect(
      screen.queryByRole('navigation', { name: `Subcategories of ${second.name}` }),
    ).toBeNull();
  });

  it('gives each subcategory its own artwork and a four-across index on desktop', () => {
    const [first, second] = categories;
    if (!first || !second) throw new Error('fixtures');
    const child = {
      ...second,
      slug: 'child-one',
      name: 'Child one',
      parentSlug: first.slug,
      image: {
        url: 'https://media.example.test/categories/child/full.webp',
        thumbUrl: 'https://media.example.test/categories/child/thumb.webp',
      },
    };
    const { container } = render(<CategoryDepartments categories={[first, child]} />);

    // Four tracks at `lg`, so a wide screen shows four departments per row.
    const grid = container.querySelector('ul.grid');
    expect(grid?.className).toContain('lg:grid-cols-4');
    expect(grid?.className).toContain('md:grid-cols-3');
    expect(grid?.className).toContain('grid-cols-2');

    // The subcategory pill shows its real cover, small enough never to rival the card above it.
    const nav = screen.getByRole('navigation', { name: `Subcategories of ${first.name}` });
    const picture = within(nav).getByRole('link', { name: /Child one/ }).querySelector('img');
    expect(picture?.getAttribute('src')).toBe(child.image.thumbUrl);
  });

  it('marks the listing on screen in the category links', () => {    const { unmount } = render(<CategoryNav categories={categories} current="fashion" />);
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    expect(within(nav).getByRole('link', { name: 'Fashion' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(
      within(nav).getByRole('link', { name: 'All products' }).getAttribute('aria-current'),
    ).toBeNull();
    unmount();

    render(<CategoryNav categories={categories} current="all" />);
    expect(screen.getByRole('link', { name: 'All products' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });
});

describe('Breadcrumbs', () => {
  it('links the trail and marks the current page', () => {
    render(
      <Breadcrumbs
        items={[
          { label: 'Home', href: '/' },
          { label: 'Fashion', href: '/products' },
          { label: 'Panjabi' },
        ]}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Home', 'Fashion']);
    expect(within(nav).getByText('Panjabi').getAttribute('aria-current')).toBe('page');
  });
});

describe('notices', () => {
  it('explains an outage and offers a retry', () => {
    render(
      <CatalogUnavailable kind="unavailable" retryHref="/products?page=2" subject="products" />,
    );
    expect(screen.getByText('We could not load products')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe(
      '/products?page=2',
    );
  });

  it('asks a fast searcher to wait', () => {
    render(<CatalogUnavailable kind="rate_limited" retryHref="/search?q=rice" />);
    expect(screen.getByText('Too many searches at once')).not.toBeNull();
  });

  it('keeps shoppers browsing after a missing product or category', () => {
    const { unmount } = render(<CatalogNotFound subject="product" />);
    expect(screen.getByText('Product not found')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Browse all products' }).getAttribute('href')).toBe(
      '/products',
    );
    unmount();
    render(<CatalogNotFound subject="category" />);
    expect(screen.getByText('Category not found')).not.toBeNull();
  });

  it('announces loading once while the skeleton stays decorative', () => {
    render(<ListingSkeleton label="Searching" />);
    expect(screen.getByRole('status').textContent).toBe('Searching');
  });
});
