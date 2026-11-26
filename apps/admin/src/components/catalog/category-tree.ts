import type { AdminCategory } from '@nilzora/contracts';

/*
 * The category tree, as the admin screens need to see it. Everything is read from the
 * categories the admin has created: no names, groupings or example data live here.
 *
 * Order matches the database and the storefront: within one parent, by sort order and then name.
 * A category whose parent is not in the list (it cannot happen through the API, but a partial
 * read could) is shown at the top level rather than lost.
 */

export const MAX_CATEGORY_DEPTH = 3;

function byOrder(a: AdminCategory, b: AdminCategory): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

/** The direct children of `parentId` (null = the top level), in storefront order. */
export function childrenOf(
  categories: readonly AdminCategory[],
  parentId: string | null,
): AdminCategory[] {
  const known = new Set(categories.map((category) => category.id));
  return categories
    .filter((category) =>
      parentId === null
        ? category.parentId === null || !known.has(category.parentId)
        : category.parentId === parentId,
    )
    .sort(byOrder);
}

export interface CategoryRow {
  category: AdminCategory;
  /** 0 for a top-level category. */
  depth: number;
  /** The parent's id, or null at the top level. */
  parentId: string | null;
  /** The ids of this category's group (its siblings, itself included), in order. */
  groupIds: readonly string[];
  /** Zero-based place within the group. */
  position: number;
  childCount: number;
  /** Products in this category and everything beneath it. */
  branchProductCount: number;
  /** "Parent › Child", for places that show one category on its own. */
  path: string;
}

/** Every category in tree order (a parent, then its children, depth first) with its context. */
export function categoryRows(categories: readonly AdminCategory[]): CategoryRow[] {
  const rows: CategoryRow[] = [];
  const counts = new Map<string, number>();

  const branchCount = (category: AdminCategory): number => {
    const known = counts.get(category.id);
    if (known !== undefined) return known;
    const total = childrenOf(categories, category.id).reduce(
      (sum, child) => sum + branchCount(child),
      category.productCount,
    );
    counts.set(category.id, total);
    return total;
  };

  const visit = (
    group: readonly AdminCategory[],
    parentId: string | null,
    depth: number,
    parentPath: string,
  ) => {
    const groupIds = group.map((category) => category.id);
    group.forEach((category, position) => {
      const children = depth + 1 < MAX_CATEGORY_DEPTH ? childrenOf(categories, category.id) : [];
      const path = parentPath === '' ? category.name : `${parentPath} › ${category.name}`;
      rows.push({
        category,
        depth,
        parentId,
        groupIds,
        position,
        childCount: childrenOf(categories, category.id).length,
        branchProductCount: branchCount(category),
        path,
      });
      visit(children, category.id, depth + 1, path);
    });
  };

  visit(childrenOf(categories, null), null, 0, '');
  return rows;
}

/** The chain of ids from the top-level category down to `categoryId` (empty when unknown). */
export function categoryPath(categories: readonly AdminCategory[], categoryId: string): string[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const chain: string[] = [];
  let cursor = byId.get(categoryId);
  while (cursor && chain.length < MAX_CATEGORY_DEPTH) {
    chain.unshift(cursor.id);
    cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
  }
  return chain;
}

/** The sort order a new category should take to appear last in its group. */
export function nextSortOrder(
  categories: readonly AdminCategory[],
  parentId: string | null,
): number {
  const group = childrenOf(categories, parentId);
  return group.length === 0 ? 0 : Math.max(...group.map((category) => category.sortOrder)) + 10;
}

/**
 * The options for a "filter by category" select: every category in tree order, labelled with its
 * path ("Parent › Child"). Choosing a category filters to it and everything beneath it.
 */
export function categoryFilterOptions(
  categories: readonly AdminCategory[],
): { value: string; label: string }[] {
  return categoryRows(categories).map(({ category, path }) => ({
    value: category.id,
    label: category.isActive ? path : `${path} (hidden)`,
  }));
}

/** The path label of one category, for filter chips ("Parent › Child"). */
export function categoryPathLabel(
  categories: readonly AdminCategory[],
  categoryId: string,
): string | undefined {
  return categoryRows(categories).find((row) => row.category.id === categoryId)?.path;
}
