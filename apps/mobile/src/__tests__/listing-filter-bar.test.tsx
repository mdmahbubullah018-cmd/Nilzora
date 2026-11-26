import { render, screen, userEvent, within } from '@testing-library/react-native';
import type { ProductFacets } from '@nilzora/contracts';
import {
  BROWSE_SORTS,
  type ShopFilters,
} from '../features/catalog/catalog-query';
import { ListingFilterBar } from '../features/catalog/listing-filter-bar';

/*
 * The listing toolbar: a compact row of chips for the advanced filters, the sort, the price
 * range and the sizes and colours the store really has. Every chip must state what is applied,
 * applying a choice must reach the listing through onFiltersChange, and a chip must never be
 * drawn for values nothing can be filtered by.
 */

/** The variant values a listing's products have, as /catalog/product-facets answers them. */
const FACETS: ProductFacets = {
  sizes: [
    { slug: 'm', value: 'M', productCount: 12 },
    { slug: 'l', value: 'L', productCount: 4 },
  ],
  colors: [{ slug: 'black', value: 'Black', productCount: 9, swatchHex: '#0F172A' }],
};

function filters(overrides: Partial<ShopFilters> = {}): ShopFilters {
  return { q: '', category: undefined, zone: undefined, sort: 'featured', inStock: false, ...overrides };
}

async function setup(overrides: Partial<React.ComponentProps<typeof ListingFilterBar>> = {}) {
  const onSortChange = jest.fn();
  const onFiltersChange = jest.fn();
  const onOpenFilters = jest.fn();
  await render(
    <ListingFilterBar
      filters={filters()}
      sorts={BROWSE_SORTS}
      onSortChange={onSortChange}
      onFiltersChange={onFiltersChange}
      onOpenFilters={onOpenFilters}
      filterCount={0}
      {...overrides}
    />,
  );
  return { onSortChange, onFiltersChange, onOpenFilters, user: userEvent.setup() };
}

describe('ListingFilterBar', () => {
  it('shows the three compact controls and the advanced filter count', async () => {
    await setup({ filterCount: 2 });

    expect(screen.getByRole('button', { name: 'Filters, 2 active' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sort' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Price' })).toBeOnTheScreen();
  });

  it('opens the advanced sheet from its chip', async () => {
    const { onOpenFilters, user } = await setup({ filterCount: 1 });

    await user.press(screen.getByRole('button', { name: 'Filters, 1 active' }));

    expect(onOpenFilters).toHaveBeenCalledTimes(1);
  });

  it('applies a price range in whole taka', async () => {
    const { onFiltersChange, user } = await setup();

    await user.press(screen.getByRole('button', { name: 'Price' }));
    await user.type(screen.getByLabelText('Lowest price'), '500');
    await user.type(screen.getByLabelText('Highest price'), '1500');
    await user.press(screen.getByRole('button', { name: 'Apply' }));

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ minTaka: 500, maxTaka: 1500 }),
    );
  });

  it('reads a reversed range the way it was meant', async () => {
    const { onFiltersChange, user } = await setup();

    await user.press(screen.getByRole('button', { name: 'Price' }));
    await user.type(screen.getByLabelText('Lowest price'), '900');
    await user.type(screen.getByLabelText('Highest price'), '200');
    await user.press(screen.getByRole('button', { name: 'Apply' }));

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ minTaka: 200, maxTaka: 900 }),
    );
  });

  it('states an applied range on its chip and can clear it without touching anything else', async () => {
    const { onFiltersChange, user } = await setup({
      filters: filters({ minTaka: 500, maxTaka: 1_500, brand: 'aarong' }),
    });

    expect(screen.getByRole('button', { name: '৳500 – ৳1,500' })).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Clear price' }));

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ minTaka: undefined, maxTaka: undefined, brand: 'aarong' }),
    );
  });

  it('lists the sorts the API accepts and applies a choice', async () => {
    const { onSortChange, user } = await setup();

    await user.press(screen.getByRole('button', { name: 'Sort' }));
    await user.press(screen.getByRole('radio', { name: 'Price: high to low' }));

    expect(onSortChange).toHaveBeenCalledWith('price_desc');
  });

  it('names the chosen sort on the chip', async () => {
    await setup({ filters: filters({ sort: 'newest' }) });

    expect(screen.getByRole('button', { name: 'Sort: Newest' })).toBeOnTheScreen();
  });

  it('draws no size or colour chip for a listing whose products have none', async () => {
    await setup();

    expect(screen.queryByRole('button', { name: 'Size' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Colour' })).toBeNull();
  });

  it('offers the sizes the store really has and applies the chosen ones', async () => {
    const { onFiltersChange, user } = await setup({ facets: FACETS, filters: filters({ q: 'shirt' }) });

    await user.press(screen.getByRole('button', { name: 'Size' }));
    const sheet = within(screen.getByTestId('size-sheet'));
    await user.press(sheet.getByRole('checkbox', { name: 'M' }));
    await user.press(sheet.getByRole('button', { name: 'Show results' }));

    // The search and every other filter survive the choice.
    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'shirt', sizes: ['m'] }),
    );
  });

  it('names chosen sizes and colours on their chips', async () => {
    await setup({
      facets: FACETS,
      filters: filters({ sizes: ['m', 'l'], colors: ['black'] }),
    });

    expect(screen.getByRole('button', { name: 'Size: M · L' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Colour: Black' })).toBeOnTheScreen();
  });

  it('clears a size choice from its own sheet', async () => {
    const { onFiltersChange, user } = await setup({
      facets: FACETS,
      filters: filters({ sizes: ['m'], brand: 'aarong' }),
    });

    await user.press(screen.getByRole('button', { name: 'Size: M' }));
    await user.press(within(screen.getByTestId('size-sheet')).getByRole('button', { name: 'Clear' }));

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ sizes: undefined, brand: 'aarong' }),
    );
  });
});
