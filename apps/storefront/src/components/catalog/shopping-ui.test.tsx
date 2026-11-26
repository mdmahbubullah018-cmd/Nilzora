import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReviewGallery } from '@/components/product/review-gallery';
import { category, productImage, summary } from '@/testing/catalog-fixtures';
import { ActiveFilters, filterChips } from './active-filters';
import { FilterSheet } from './filter-sheet';
import { swipeStep, wrapIndex } from './image-lightbox';
import { ListingFiltersForm } from './listing-filters';
import { ProductCard } from './product-card';
import { ProductGallery } from './product-gallery';

const brand = (slug: string, name: string, productCount: number) => ({
  slug,
  name,
  description: null,
  logo: null,
  banner: null,
  productCount,
});

describe('ListingFiltersForm', () => {
  it('starts from the filters in the address and keeps the search text and sort', () => {
    const { container } = render(
      <ListingFiltersForm
        action="/search"
        filters={{ brand: 'aarong', minTaka: 200, maxTaka: 900, inStock: true }}
        sort="price_asc"
        defaultSort="newest"
        q="cotton"
        brands={[brand('aarong', 'Aarong', 3), brand('empty', 'Empty', 0)]}
        searchCategories={{
          options: [
            category({ slug: 'fashion', name: 'Fashion' }),
            category({ slug: 'shirts', name: 'Shirts', parentSlug: 'fashion', depth: 2 }),
          ],
          selected: 'shirts',
        }}
        idPrefix="t"
      />,
    );

    const form = screen.getByRole('form', { name: 'Filter products' });
    expect(form.getAttribute('action')).toBe('/search');
    const hidden = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="hidden"]'),
      (input) => `${input.name}=${input.value}`,
    );
    // The price range is set in the toolbar, so the panel carries it through unchanged.
    expect(hidden).toEqual(['q=cotton', 'sort=price_asc', 'min=200', 'max=900']);
    const categorySelect = screen.getByLabelText<HTMLSelectElement>('Category');
    expect(categorySelect.value).toBe('shirts');
    expect(
      within(categorySelect)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All categories', 'Fashion', '  – Shirts']);
    // A brand with nothing on sale is not offered.
    expect(
      within(screen.getByLabelText('Brand'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All brands', 'Aarong']);
    expect(screen.queryByLabelText('Lowest price in taka')).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>('In stock only').checked).toBe(true);
    expect(screen.getByRole('link', { name: 'Clear filters' }).getAttribute('href')).toBe(
      '/search?q=cotton&category=shirts&sort=price_asc',
    );
  });

  it('leaves the default sort out and offers no "Clear filters" without filters', () => {
    const { container } = render(
      <ListingFiltersForm
        action="/products"
        filters={{ inStock: false }}
        sort="featured"
        defaultSort="featured"
        idPrefix="t"
      />,
    );
    expect(container.querySelectorAll('input[type="hidden"]')).toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'Clear filters' })).toBeNull();
    expect(screen.queryByLabelText('Brand')).toBeNull();
  });
});

describe('ActiveFilters', () => {
  it('renders nothing without filters', () => {
    const { container } = render(
      <ActiveFilters
        source={{
          path: '/products',
          filters: { inStock: false },
          sort: 'featured',
          defaultSortFor: () => 'featured',
        }}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('labels open-ended price ranges plainly', () => {
    const source = {
      path: '/products' as const,
      sort: 'featured' as const,
      defaultSortFor: () => 'featured' as const,
    };
    expect(filterChips({ ...source, filters: { inStock: false, minTaka: 500 } })[0]?.label).toBe(
      'From ৳500',
    );
    expect(filterChips({ ...source, filters: { inStock: false, maxTaka: 1500 } })[0]?.label).toBe(
      'Up to ৳1,500',
    );
  });
});

describe('FilterSheet', () => {
  it('opens the panel as a dialog and closes it once the filters are applied', () => {
    render(
      <FilterSheet activeCount={0}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <button type="submit">Apply filters</button>
        </form>
      </FilterSheet>,
    );
    const dialog = () => document.querySelector('dialog');
    expect(dialog()?.open).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(dialog()?.open).toBe(true);

    fireEvent.submit(
      screen.getByRole('button', { name: 'Apply filters' }).closest('form') as HTMLFormElement,
    );
    expect(dialog()?.open).toBe(false);
  });
});

describe('ProductCard brand', () => {
  it('names the brand before the category when the product has one', () => {
    render(<ProductCard product={summary({ brand: { slug: 'aarong', name: 'Aarong' } })} />);
    const label = screen.getByText('Aarong').closest('p');
    expect(label?.textContent).toBe('Brand: Aarong · , category: Home & Kitchen');
  });

  it('shows only the category without a brand', () => {
    render(<ProductCard product={summary({ brand: null })} />);
    expect(screen.queryByText(/Brand:/)).toBeNull();
    expect(screen.getByText('Home & Kitchen')).not.toBeNull();
  });
});

describe('image steps and swipes', () => {
  it('wraps round at both ends', () => {
    expect(wrapIndex(0, -1, 3)).toBe(2);
    expect(wrapIndex(2, 1, 3)).toBe(0);
    expect(wrapIndex(1, 1, 0)).toBe(0);
  });

  it('only treats a clear sideways movement as a swipe', () => {
    expect(swipeStep(-80, 10)).toBe(1);
    expect(swipeStep(80, -10)).toBe(-1);
    expect(swipeStep(30, 0)).toBe(0);
    expect(swipeStep(-80, 90)).toBe(0);
  });
});

describe('ProductGallery', () => {
  const images = [productImage({ alt: 'Front' }), productImage({ alt: 'Back' }), productImage()];
  const mainPicture = () =>
    screen
      .getAllByRole('img')
      .find((image) => image.getAttribute('src')?.endsWith('/full.webp'))
      ?.getAttribute('alt');

  it('steps through the pictures with the arrow buttons', () => {
    render(<ProductGallery images={images} productName="Clay Mug" />);
    expect(mainPicture()).toBe('Front');
    fireEvent.click(screen.getByRole('button', { name: 'Next picture' }));
    expect(mainPicture()).toBe('Back');
    fireEvent.click(screen.getByRole('button', { name: 'Previous picture' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous picture' }));
    // Wrapped to the last picture, which has no description of its own.
    expect(mainPicture()).toBe('Clay Mug');
  });

  it('follows a sideways swipe without opening the full-screen view', () => {
    render(<ProductGallery images={images} productName="Clay Mug" />);
    const stage = screen.getByRole('button', { name: /full screen/ }).parentElement as HTMLElement;
    fireEvent.pointerDown(stage, { clientX: 300, clientY: 100 });
    fireEvent.pointerUp(stage, { clientX: 150, clientY: 110 });
    fireEvent.click(screen.getByRole('button', { name: /full screen/ }));
    expect(mainPicture()).toBe('Back');
    expect(document.querySelector('dialog')?.open).toBe(false);
  });

  it('opens the pictures full screen, moves with the arrow keys and closes on Escape', () => {
    render(<ProductGallery images={images} productName="Clay Mug" />);
    fireEvent.click(screen.getByRole('button', { name: 'View picture 1 of 3 full screen' }));
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('aria-label')).toBe('Pictures of Clay Mug');
    expect(within(dialog).getByText('Picture 1 of 3')).not.toBeNull();

    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(within(dialog).getByText('Picture 2 of 3')).not.toBeNull();
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(within(dialog).getByText('Picture 3 of 3')).not.toBeNull();

    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(dialog.open).toBe(false);
    // The page's own picture followed the viewer.
    expect(mainPicture()).toBe('Clay Mug');
  });

  it('zooms the full-screen picture and back', () => {
    render(<ProductGallery images={images} productName="Clay Mug" />);
    fireEvent.click(screen.getByRole('button', { name: 'View picture 1 of 3 full screen' }));
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zoom in' }));
    expect(
      within(dialog).getByRole('button', { name: 'Zoom out' }).getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zoom out' }));
    expect(within(dialog).getByRole('button', { name: 'Zoom in' })).not.toBeNull();
  });

  it('shows the placeholder, with no controls, for a product without pictures', () => {
    render(<ProductGallery images={[]} productName="Clay Mug" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('ReviewGallery', () => {
  it('shows a review’s photos and opens them full screen', () => {
    const photo = { ...productImage(), id: '7f000000-0000-4000-8000-000000000009' };
    render(<ReviewGallery images={[photo]} author="Ayesha R." />);
    fireEvent.click(
      screen.getByRole('button', { name: "View photo 1 from ayesha r.'s review full screen" }),
    );
    expect(document.querySelector('dialog')?.open).toBe(true);
  });

  it('renders nothing without photos', () => {
    const { container } = render(<ReviewGallery images={[]} author="Ayesha R." />);
    expect(container.innerHTML).toBe('');
  });
});
