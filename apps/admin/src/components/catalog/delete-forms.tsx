'use client';

import { Trash2 } from 'lucide-react';
import { useActionState } from 'react';
import { IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { deleteCategoryAction, deleteProductAction } from '@/lib/catalog-delete-actions';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/** Deletes a never-ordered product after confirmation; the API refuses one with orders. */
export function DeleteProductForm({
  productId,
  name,
  csrf,
}: {
  productId: string;
  name: string;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [state, action] = useActionState(deleteProductAction, IDLE_STATE);
  return (
    <ConfirmForm
      action={action}
      csrf={csrf}
      align="start"
      triggerVariant="ghost"
      trigger={
        <>
          <Trash2 aria-hidden="true" strokeWidth={1.75} />
          Delete product <span className="sr-only"><AutoText value={name} /></span>
        </>
      }
      title={`Delete “${name}” for good?`}
      description={tx("Its pictures, videos, variants and stock history are removed too. A product that has ever been ordered cannot be deleted: archive it instead. This cannot be undone.")}
      confirmLabel={tx("Delete product")}
      hiddenFields={{ productId }}
      error={state.status === 'error' ? state.message : undefined}
    />
  );
}

/** Deletes an unused category after confirmation; the API refuses one still in use. */
export function DeleteCategoryForm({
  categoryId,
  name,
  csrf,
}: {
  categoryId: string;
  name: string;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [state, action] = useActionState(deleteCategoryAction, IDLE_STATE);
  return (
    <ConfirmForm
      action={action}
      csrf={csrf}
      align="start"
      triggerVariant="ghost"
      trigger={
        <>
          <Trash2 aria-hidden="true" strokeWidth={1.75} />
          Delete category <span className="sr-only"><AutoText value={name} /></span>
        </>
      }
      title={`Delete the category “${name}”?`}
      description={tx("Its page disappears from the store. A category that still has products or subcategories cannot be deleted. This cannot be undone.")}
      confirmLabel={tx("Delete category")}
      hiddenFields={{ categoryId }}
      error={state.status === 'error' ? state.message : undefined}
    />
  );
}
