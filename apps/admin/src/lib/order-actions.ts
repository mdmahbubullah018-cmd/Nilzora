'use server';

import {
  codCollectionRequestSchema,
  orderNumberSchema,
  orderStatusChangeRequestSchema,
} from '@nilzora/contracts';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  adminAct,
  formText,
  invalid,
  takaToMinor,
  type ActionState,
} from '@/components/admin-kit/act';
import { withNotice, type OrderNotice } from '@/components/orders/order-query';

const CASH_COLLECTED: OrderNotice = 'cash_collected';

/*
 * Order fulfilment and cash collection. The API and the database decide whether the
 * change is allowed (permission, current status, amount); these actions only shape
 * the request and turn refusals into fixed messages.
 */

const MISSING_ORDER: ActionState = {
  status: 'error',
  message: 'This order could not be identified. Reload the page and try again.',
};

const COD_COLLECTIONS_PATH = '/admin/cod-collections';

/**
 * The COD collections list to return to after recording cash from it: only that list's
 * own path with plain query parameters, never another page or site (the value comes from
 * the form).
 */
function listReturnPath(value: string): string | undefined {
  return /^\/admin\/cod-collections(\?[A-Za-z0-9_.~%=&+-]*)?$/.test(value) &&
    !value.includes('notice=')
    ? value
    : undefined;
}

function orderPath(orderNumber: string): Route {
  return `/admin/orders/${orderNumber}` as Route;
}

function refresh(orderNumber: string): void {
  revalidatePath(orderPath(orderNumber));
  revalidatePath('/admin/orders');
  revalidatePath('/admin');
}

const STATUS_MESSAGES = {
  invalid_status_transition:
    'This order has moved on since the page loaded. Reload it to see its current status.',
  not_found: 'This order no longer exists, or your account cannot see it.',
  forbidden: 'Your account does not have permission to make this change.',
} as const;

/** One fulfilment step (confirmed, processing, shipped, delivered) or a cancellation. */
export async function changeOrderStatusAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const orderNumber = orderNumberSchema.safeParse(formText(formData, 'orderNumber'));
  if (!orderNumber.success) return MISSING_ORDER;

  const status = formText(formData, 'status');
  const note = formText(formData, 'note');
  const parsed = orderStatusChangeRequestSchema.safeParse({ status, note });
  if (!parsed.success) {
    const cancelling = status === 'cancelled';
    const noteError = cancelling
      ? 'Give a reason of 5 to 300 characters.'
      : 'Keep the note under 300 characters.';
    const noteIssue = parsed.error.issues.some((issue) => issue.path[0] === 'note');
    return invalid(
      noteIssue ? noteError : 'This change is not available. Reload the page and try again.',
      noteIssue ? { note: noteError } : {},
      { note, status },
    );
  }

  const result = await adminAct(
    formData,
    (api, token) => api.adminUpdateOrderStatus(token, orderNumber.data, parsed.data),
    {
      returnTo: orderPath(orderNumber.data),
      label: 'order status change',
      messages: STATUS_MESSAGES,
    },
  );
  // `status` tells the form which step's panel the message belongs to.
  if (!result.ok) return { ...result.state, values: { note, status } };

  refresh(orderNumber.data);
  // The step's form is gone once it is done, so the confirmation travels with the page
  // (the notice keys are the statuses; see ORDER_NOTICES).
  redirect(withNotice(orderPath(orderNumber.data), result.value.order.status));
}

/** Records that the courier handed over the order's cash (the amount must equal the total). */
export async function recordCodCollectionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const orderNumber = orderNumberSchema.safeParse(formText(formData, 'orderNumber'));
  if (!orderNumber.success) return MISSING_ORDER;

  const amount = formText(formData, 'amount');
  const amountMinor = takaToMinor(amount);
  const parsed = codCollectionRequestSchema.safeParse({ amountMinor });
  if (amountMinor === undefined || !parsed.success) {
    const message = 'Enter the amount received in taka, e.g. 1250 or 1250.50.';
    return invalid(message, { amount: message }, { amount });
  }

  const result = await adminAct(
    formData,
    (api, token) => api.adminRecordCodCollection(token, orderNumber.data, parsed.data),
    {
      returnTo: orderPath(orderNumber.data),
      label: 'cash collection',
      messages: {
        ...STATUS_MESSAGES,
        payment_not_collectable:
          'Cash can be recorded only for a delivered order still awaiting payment. Reload to see its current state.',
        collection_amount_mismatch:
          'The amount differs from the order total. Count the cash again; nothing was recorded.',
      },
    },
  );
  if (!result.ok) return { ...result.state, values: { amount } };

  refresh(orderNumber.data);
  revalidatePath(COD_COLLECTIONS_PATH);
  // Recorded from the COD collections list: back to that list (its own address only).
  const list = listReturnPath(formText(formData, 'returnTo'));
  redirect(withNotice(list ?? orderPath(orderNumber.data), CASH_COLLECTED));
}
