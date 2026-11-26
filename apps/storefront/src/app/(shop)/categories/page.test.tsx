import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { categories, category } from '@/testing/catalog-fixtures';
import CategoriesPage from './page';

const catalog = vi.hoisted(() => ({ getCategories: vi.fn() }));
vi.mock('@/lib/catalog', () => catalog);

afterEach(() => {
  vi.clearAllMocks();
});

describe('CategoriesPage', () => {
  it('shows a tile for each category', async () => {
    catalog.getCategories.mockResolvedValue({ kind: 'ok', value: categories });
    render(await CategoriesPage());

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Shop by category');
    expect(screen.getByRole('link', { name: 'Fashion, 1 product' }).getAttribute('href')).toBe(
      '/categories/fashion',
    );
  });

  it('has an empty state', async () => {
    catalog.getCategories.mockResolvedValue({ kind: 'ok', value: [] });
    render(await CategoriesPage());
    expect(screen.getByText('No categories yet')).not.toBeNull();
  });

  it('groups a subcategory under its department instead of listing it as its own card', async () => {
    catalog.getCategories.mockResolvedValue({
      kind: 'ok',
      value: [
        category({ slug: 'fashion', name: 'Fashion', productCount: 5 }),
        category({
          slug: 'shirts',
          name: 'Shirts',
          parentSlug: 'fashion',
          depth: 2,
          productCount: 2,
        }),
      ],
    });
    render(await CategoriesPage());

    // The department is the card; the subcategory is a link in that department's own list.
    expect(screen.getByRole('link', { name: 'Fashion, 5 products' })).not.toBeNull();
    const nav = screen.getByRole('navigation', { name: 'Subcategories of Fashion' });
    expect(
      within(nav)
        .getByRole('link', { name: /Shirts/ })
        .getAttribute('href'),
    ).toBe('/categories/shirts');
    // ...and only there: no second, card-sized tile for it.
    expect(
      screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('href') === '/categories/shirts'),
    ).toHaveLength(1);
  });

  it('shows a retry notice when the API cannot be reached', async () => {
    catalog.getCategories.mockResolvedValue({ kind: 'unavailable' });
    render(await CategoriesPage());

    expect(screen.getByText('We could not load categories')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe(
      '/categories',
    );
  });
});
