'use server';

import { uuidSchema } from '@nilzora/validation';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { adminAct, formText, type ActionState } from '@/components/admin-kit/act';

/*
 * Deleting catalogue records. adminAct() checks this app's Origin and CSRF token first; the
 * API checks products.publish and the database refuses anything still in use, so a delete
 * can never orphan an order, a product or a subcategory. Only fixed messages return.
 */

const PAGE_EXPIRED: ActionState = {
  status: 'error',
  message: 'This page is out of date. Reload it and try again.',
};

function idOf(formData: FormData, name: string): string | undefined {
  const parsed = uuidSchema.safeParse(formText(formData, name));
  return parsed.success ? parsed.data : undefined;
}

/** Deletes a product that was never ordered, then returns to the product list. */
export async function deleteProductAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const productId = idOf(formData, 'productId');
  if (productId === undefined) return PAGE_EXPIRED;
  const result = await adminAct(
    formData,
    (api, token) => api.adminDeleteProduct(token, productId),
    {
      returnTo: `/admin/products/${productId}` as Route,
      label: 'product delete',
      messages: {
        in_use:
          'This product has orders, so it cannot be deleted. Archive it instead: it leaves the store and keeps its order history.',
        product_content_locked: 'This product is on sale. Unpublish it before deleting it.',
        not_found: 'This product no longer exists. Reload the product list.',
        forbidden: 'Deleting a product needs the “Publish products” permission.',
      },
    },
  );
  if (!result.ok) return result.state;
  revalidatePath('/admin/products');
  redirect('/admin/products');
}

/** Deletes a category with no products and no subcategories, then returns to the list. */
export async function deleteCategoryAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const categoryId = idOf(formData, 'categoryId');
  if (categoryId === undefined) return PAGE_EXPIRED;
  const result = await adminAct(
    formData,
    (api, token) => api.adminDeleteCategory(token, categoryId),
    {
      returnTo: `/admin/categories/${categoryId}` as Route,
      label: 'category delete',
      messages: {
        category_in_use:
          'Products or subcategories still use this category. Move them to another category first, then delete it.',
        not_found: 'This category no longer exists. Reload the category list.',
        forbidden: 'Deleting a category needs the “Publish products” permission.',
      },
    },
  );
  if (!result.ok) return result.state;
  revalidatePath('/admin/categories');
  redirect('/admin/categories');
}
