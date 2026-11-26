import { render, screen, userEvent } from '@testing-library/react-native';
import { FilterSheet, type CatalogFilterDraft } from '../features/catalog/filter-sheet';
import { FASHION, GROCERIES } from '../features/catalog/test-fixtures';

const AARONG = { slug: 'aarong', name: 'Aarong', productCount: 4 };
const EMPTY_LABEL = { slug: 'empty-label', name: 'Empty Label', productCount: 0 };

async function setup(overrides: Partial<React.ComponentProps<typeof FilterSheet>> = {}) {
  const onApply = jest.fn<void, [CatalogFilterDraft]>();
  const onReset = jest.fn();
  const onClose = jest.fn();
  const done = await render(
    <FilterSheet
      visible
      onClose={onClose}
      categories={[FASHION, GROCERIES]}
      selectedCategory={undefined}
      brands={[AARONG, EMPTY_LABEL]}
      selectedBrand={undefined}
      inStock={false}
      onApply={onApply}
      onReset={onReset}
      {...overrides}
    />,
  );
  return { onApply, onReset, onClose, done, user: userEvent.setup() };
}

describe('FilterSheet', () => {
  it('offers exactly the advanced filters the API supports', async () => {
    await setup();

    expect(screen.getByRole('header', { name: 'Filters' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'All categories' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Fashion' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Groceries' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'All brands' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Aarong' })).toBeOnTheScreen();
    // A brand with nothing on sale is not offered.
    expect(screen.queryByRole('radio', { name: 'Empty Label' })).not.toBeOnTheScreen();
    expect(screen.getByRole('checkbox', { name: 'In stock only' })).not.toBeChecked();
    // Sort and price live in the toolbar, never duplicated here.
    expect(screen.queryByRole('radio', { name: 'Newest' })).not.toBeOnTheScreen();
    expect(screen.queryByLabelText('Lowest price')).not.toBeOnTheScreen();
  });

  it('marks the filters currently applied', async () => {
    await setup({ selectedCategory: 'fashion', selectedBrand: 'aarong', inStock: true });

    expect(screen.getByRole('radio', { name: 'Fashion' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Aarong' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'In stock only' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'All categories' })).not.toBeChecked();
  });

  it('applies a chosen category, brand and availability together', async () => {
    const { onApply, onClose, user } = await setup();

    await user.press(screen.getByRole('radio', { name: 'Groceries' }));
    await user.press(screen.getByRole('radio', { name: 'Aarong' }));
    await user.press(screen.getByRole('checkbox', { name: 'In stock only' }));
    await user.press(screen.getByRole('button', { name: 'Show results' }));

    expect(onApply).toHaveBeenCalledWith({
      category: 'groceries',
      brand: 'aarong',
      inStock: true,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('hides the category group on a category screen, which fixes it', async () => {
    await setup({ showCategory: false });

    expect(screen.queryByRole('radio', { name: 'Fashion' })).not.toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Aarong' })).toBeOnTheScreen();
  });

  it('resets the filters', async () => {
    const { onReset, onClose, user } = await setup({
      selectedCategory: 'fashion',
      selectedBrand: 'aarong',
      inStock: true,
    });

    await user.press(screen.getByRole('button', { name: 'Reset' }));

    expect(onReset).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('can be dismissed without changing anything', async () => {
    const { onApply, onClose, user } = await setup();

    await user.press(screen.getByRole('button', { name: 'Close filters' }));

    expect(onClose).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('says when the categories are still loading', async () => {
    await setup({ categories: [], categoriesLoading: true });

    expect(screen.getByRole('progressbar', { name: 'Loading categories' })).toBeOnTheScreen();
  });
});
