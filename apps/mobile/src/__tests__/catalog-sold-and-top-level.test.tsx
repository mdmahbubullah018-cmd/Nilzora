import { screen } from '@testing-library/react-native';
import { CategorySection } from '../features/catalog/home-sections';
import { departmentsOf, soldCountLabel } from '../features/catalog/catalog-query';
import { ProductCard } from '../features/catalog/product-card';
import { category, FASHION, GROCERIES, product } from '../features/catalog/test-fixtures';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

describe('soldCountLabel', () => {
  it('says nothing until something has really sold', () => {
    expect(soldCountLabel(undefined)).toBeNull();
    expect(soldCountLabel(0)).toBeNull();
    expect(soldCountLabel(Number.NaN)).toBeNull();
  });

  it('shows the figure and abbreviates only large ones', () => {
    expect(soldCountLabel(1)).toBe('1 sold');
    expect(soldCountLabel(120)).toBe('120 sold');
    expect(soldCountLabel(1200)).toBe('1.2k sold');
  });
});

describe('sold count on a product card', () => {
  it('is a quiet line under the price when the product has sold, and absent otherwise', async () => {
    const { unmount } = await renderWithProviders(
      <ProductCard product={product({ soldCount: 120 })} width={160} />,
    );
    expect(screen.getByText('120 sold', { includeHiddenElements: true })).toBeOnTheScreen();
    await unmount();

    await renderWithProviders(<ProductCard product={product()} width={160} />);
    expect(screen.queryByText(/sold$/, { includeHiddenElements: true })).not.toBeOnTheScreen();
  });
});

describe('Home category row', () => {
  const sub = category({ slug: 'shirts', name: 'Shirts', parentSlug: 'fashion', depth: 2 });
  const deep = category({ slug: 'casual', name: 'Casual', parentSlug: 'shirts', depth: 3 });

  it('keeps only the main categories', () => {
    expect(departmentsOf([FASHION, GROCERIES, sub, deep]).map((c) => c.slug)).toEqual([
      FASHION.slug,
      GROCERIES.slug,
    ]);
  });

  it('shows only main categories on the Home screen row', async () => {
    await renderWithProviders(
      <CategorySection
        query={
          {
            data: [FASHION, GROCERIES, sub, deep],
            status: 'success',
            error: null,
            isRefetching: false,
            refetch: jest.fn(),
          } as never
        }
        onSelect={jest.fn()}
        onSeeAll={jest.fn()}
      />,
    );

    expect(screen.getByText('Fashion')).toBeOnTheScreen();
    expect(screen.getByText('Groceries')).toBeOnTheScreen();
    expect(screen.queryByText('Shirts')).not.toBeOnTheScreen();
    expect(screen.queryByText('Casual')).not.toBeOnTheScreen();
  });
});
