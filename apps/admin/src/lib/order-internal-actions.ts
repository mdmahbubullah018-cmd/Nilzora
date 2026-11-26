'use server';

import { orderNumberSchema } from '@nilzora/contracts';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { adminAct, formText, invalid, type ActionState } from '@/components/admin-kit/act';

/*
 * Staff-only order notes and archiving. adminAct() checks this app's Origin and CSRF token
 * first; the API checks the permission and the database decides whether an order may be
 * archived (cancelled, cash never collected, no return or refund). Only fixed messages return.
 */

const PAGE_EXPIRED: ActionState = {
  status: 'error',
  message: 'This page is out of date. Reload it and try again.',
};

function orderOf(formData: FormData): string | undefined {
  const parsed = orderNumberSchema.safeParse(formText(formData, 'orderNumber'));
  return parsed.success ? parsed.data : undefined;
}

function orderPath(orderNumber: string): Route {
  return `/admin/orders/${orderNumber}` as Route;
}

export async function addOrderNoteAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const orderNumber = orderOf(formData);
  if (orderNumber === undefined) return PAGE_EXPIRED;
  const body = formText(formData, 'body').trim();
  if (body.length < 1 || body.length > 1000) {
    return invalid(
      'Write a note of up to 1000 characters.',
      { body: 'Write a note of up to 1000 characters.' },
      { body },
    );
  }
  const result = await adminAct(
    formData,
    (api, token) => api.adminAddOrderNote(token, orderNumber, body),
    {
      returnTo: orderPath(orderNumber),
      label: 'order note',
      messages: {
        forbidden: 'Adding notes needs the “Update order status” permission.',
        not_found: 'This order no longer exists.',
        rate_limited: 'Too many changes in a short time. Wait a moment, then try again.',
      },
    },
  );
  if (!result.ok) return { ...result.state, values: { body } };
  revalidatePath(orderPath(orderNumber));
  return { status: 'success', message: 'Note added.' };
}

export async function setOrderArchivedAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const orderNumber = orderOf(formData);
  if (orderNumber === undefined) return PAGE_EXPIRED;
  const archive = formText(formData, 'archive') === 'true';
  const reason = formText(formData, 'reason').trim();
  if (archive && (reason.length < 3 || reason.length > 300)) {
    return invalid('Give a reason of 3 to 300 characters.', {
      reason: 'Give a reason of 3 to 300 characters.',
    });
  }
  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminSetOrderArchived(token, orderNumber, archive ? { archive, reason } : { archive }),
    {
      returnTo: orderPath(orderNumber),
      label: 'order archive',
      messages: {
        in_use:
          'Only a cancelled order whose cash was never collected, with no return or refund, can be archived. Cancel it first.',
        forbidden: 'Archiving orders needs the “Cancel orders” permission.',
        not_found: 'This order no longer exists.',
      },
    },
  );
  if (!result.ok) return result.state;
  revalidatePath(orderPath(orderNumber));
  revalidatePath('/admin/orders');
  return {
    status: 'success',
    message: archive
      ? 'Order archived. It no longer appears in the order queues; find it under Archived.'
      : 'Order restored to the order queues.',
  };
}
