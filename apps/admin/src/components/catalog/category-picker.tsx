'use client';

import type { AdminCategory } from '@nilzora/contracts';
import { Field, NativeSelect } from '@nilzora/ui';
import { useState } from 'react';
import { categoryPath, childrenOf, MAX_CATEGORY_DEPTH } from './category-tree';
import { AutoText } from '@/components/i18n/translate';

/*
 * Choosing where a product belongs: a category, then (when it has subcategories) a subcategory,
 * and one level deeper where the tree goes that far. The product keeps one category id, the most
 * specific one chosen, so a product in a subcategory shows up under its department too.
 *
 * Every option comes from the categories the admin created. Hidden categories stay selectable
 * (marked), so editing an existing product never silently moves it.
 */

const LEVEL_LABELS = ['Category', 'Subcategory', 'Sub-subcategory'] as const;

function optionLabel(category: AdminCategory): string {
  return category.isActive ? category.name : `${category.name} (hidden)`;
}

export function CategoryPicker({
  categories,
  initialId,
  formId,
  idPrefix,
  error,
}: {
  categories: readonly AdminCategory[];
  /** The product's current category id, or '' when none is chosen yet. */
  initialId: string;
  /** The form the controls belong to (the fields sit outside the <form> element). */
  formId: string;
  idPrefix: string;
  error?: string | undefined;
}) {
  const [value, setValue] = useState(initialId);
  const path = categoryPath(categories, value);

  // One select per level: the top level always, then one for each chosen category that has children.
  const levels: { parentId: string | null; options: AdminCategory[]; selected: string }[] = [];
  let parentId: string | null = null;
  for (let level = 0; level < MAX_CATEGORY_DEPTH; level += 1) {
    const options = childrenOf(categories, parentId);
    if (options.length === 0) break;
    const selected = path[level] ?? '';
    levels.push({ parentId, options, selected });
    if (selected === '') break;
    parentId = selected;
  }

  return (
    <div className="grid gap-3">
      <input type="hidden" form={formId} name="categoryId" value={value} />
      {levels.map((level, index) => {
        const parent =
          level.parentId === null ? null : categories.find((c) => c.id === level.parentId);
        return (
          <Field
            key={level.parentId ?? 'top'}
            id={index === 0 ? `${idPrefix}-categoryId` : `${idPrefix}-categoryId-${String(index)}`}
            label={LEVEL_LABELS[index] ?? 'Subcategory'}
            error={index === 0 ? error : undefined}
            required={index === 0}
            hint={index === 0 ? undefined : 'Optional. Choose the most specific one that fits.'}
          >
            {(control) => (
              <NativeSelect
                {...control}
                form={formId}
                data-category-level={index}
                value={level.selected}
                onChange={(event) => {
                  const chosen = event.currentTarget.value;
                  // Clearing a subcategory keeps the product in the category above it.
                  setValue(chosen === '' ? (level.parentId ?? '') : chosen);
                }}
                className="max-sm:h-11"
              >
                {index === 0 ? (
                  <option value="" disabled><AutoText>Choose a category</AutoText></option>
                ) : (
                  <option value="">
                    {parent ? `No subcategory (stay in ${parent.name})` : 'No subcategory'}
                  </option>
                )}
                {level.options.map((category) => (
                  <option key={category.id} value={category.id}>
                    {optionLabel(category)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        );
      })}
    </div>
  );
}
