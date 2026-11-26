import { describe, expect, it } from 'vitest';
import { testCategory } from './fixtures';
import {
  categoryFilterOptions,
  categoryPath,
  categoryPathLabel,
  categoryRows,
  nextSortOrder,
} from './category-tree';

function node(
  id: string,
  name: string,
  parentId: string | null,
  sortOrder: number,
  productCount = 0,
) {
  return {
    ...testCategory,
    id,
    slug: name.toLowerCase(),
    name,
    parentId,
    sortOrder,
    productCount,
  };
}

// Names here are arbitrary test labels, not catalogue content.
const A = node('a', 'Alpha', null, 20, 1);
const B = node('b', 'Beta', null, 10, 2);
const A1 = node('a1', 'Alpha one', 'a', 0, 3);
const A2 = node('a2', 'Alpha two', 'a', 10, 4);
const A11 = node('a11', 'Alpha deep', 'a1', 0, 5);
const ALL = [A, B, A1, A2, A11];

describe('categoryRows', () => {
  it('lists a parent then its children, depth first, in sort order', () => {
    expect(categoryRows(ALL).map((row) => [row.category.id, row.depth])).toEqual([
      ['b', 0],
      ['a', 0],
      ['a1', 1],
      ['a11', 2],
      ['a2', 1],
    ]);
  });

  it('counts a branch and exposes the sibling group for reordering', () => {
    const rows = new Map(categoryRows(ALL).map((row) => [row.category.id, row]));
    expect(rows.get('a')?.branchProductCount).toBe(1 + 3 + 5 + 4);
    expect(rows.get('a1')?.groupIds).toEqual(['a1', 'a2']);
    expect(rows.get('a2')?.position).toBe(1);
    expect(rows.get('a11')?.path).toBe('Alpha › Alpha one › Alpha deep');
  });

  it('keeps a category whose parent is missing at the top level', () => {
    const rows = categoryRows([node('x', 'Orphan', 'gone', 0)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.depth).toBe(0);
  });
});

describe('category helpers', () => {
  it('builds the chain from the top down', () => {
    expect(categoryPath(ALL, 'a11')).toEqual(['a', 'a1', 'a11']);
    expect(categoryPath(ALL, 'nope')).toEqual([]);
  });

  it('puts a new category last in its group', () => {
    expect(nextSortOrder(ALL, 'a')).toBe(20);
    expect(nextSortOrder(ALL, null)).toBe(30);
    expect(nextSortOrder(ALL, 'b')).toBe(0);
  });

  it('labels filter options by path and marks hidden categories', () => {
    const options = categoryFilterOptions([A, { ...A1, isActive: false }]);
    expect(options).toEqual([
      { value: 'a', label: 'Alpha' },
      { value: 'a1', label: 'Alpha › Alpha one (hidden)' },
    ]);
    expect(categoryPathLabel(ALL, 'a2')).toBe('Alpha › Alpha two');
    expect(categoryPathLabel(ALL, 'zzz')).toBeUndefined();
  });
});
