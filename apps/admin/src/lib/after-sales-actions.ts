'use server';

import { orderNumberSchema, type ApiErrorCode, type RefundMethod } from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { revalidatePath } from 'next/cache';
import type { Route } from 'next';
import {
  adminAct,
  formText,
  invalid,
  takaToMinor,
  type ActionState,
} from '@/components/admin-kit/act';

/*
 * Returns and refunds, as staff act on them. The database function is the authority on
 * every rule — eligibility, quantities, balances and stock — so these actions only shape
 * the request. A refund is never completed here without the payout reference the database
 * insists on, and stock is only restocked from a return that was marked received.
 */

const RETURNS_PATH = '/admin/returns' as Route;
const REFUNDS_PATH = '/admin/refunds' as Route;

const AFTER_SALES_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  not_found: 'That record no longer exists. Reload the page.',
  bad_request: 'Check the details and try again.',
  return_not_eligible: 'Only delivered orders inside the return window can be returned.',
  return_quantity_exceeded: 'More units were chosen than can still be returned.',
  return_closed: 'This return has already moved on.',
  refund_exceeds_balance: 'The amount is more than this order can still refund.',
  refund_not_decidable: 'This refund is no longer waiting for a decision.',
  refund_not_completable: 'Approve the refund before recording the payout.',
  forbidden: 'Your account does not have permission for this action.',
  rate_limited: 'Too many changes in a short time. Wait a moment, then try again.',
};

function idOf(formData: FormData, name: string): string | undefined {
  const parsed = uuidSchema.safeParse(formText(formData, name));
  return parsed.success ? parsed.data : undefined;
}

function returnPath(returnId: string): Route {
  return `/admin/returns/${returnId}` as Route;
}

function refundPath(refundId: string): Route {
  return `/admin/refunds/${refundId}` as Route;
}

function refreshReturn(returnId: string): void {
  revalidatePath(RETURNS_PATH);
  revalidatePath(returnPath(returnId));
}

function refreshRefund(refundId: string): void {
  revalidatePath(REFUNDS_PATH);
  revalidatePath(refundPath(refundId));
  // A refund changes what the customer's order page shows.
  revalidatePath('/admin/orders');
}

const DECISIONS = ['approved', 'rejected', 'received', 'completed', 'cancelled'] as const;
type Decision = (typeof DECISIONS)[number];

function decisionOf(value: string): Decision | undefined {
  return DECISIONS.find((candidate) => candidate === value);
}

const PAGE_EXPIRED: ActionState = {
  status: 'error',
  message: 'This page is out of date. Reload it and try again.',
};

const RETURN_DECISION_DONE: Record<Decision, string> = {
  approved: 'Return approved. Mark the goods received when they arrive.',
  rejected: 'Return rejected.',
  received: 'Goods marked as received. They can be restocked now.',
  completed: 'Return completed.',
  cancelled: 'Return cancelled.',
};

/** Approve, reject, mark received, complete or cancel a return. */
export async function decideReturnAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const returnId = idOf(formData, 'returnId');
  const status = decisionOf(formText(formData, 'status'));
  if (!returnId || !status) return PAGE_EXPIRED;
  const note = formText(formData, 'note').trim();
  if (note.length > 300) {
    return invalid(
      'Check the highlighted fields',
      { note: 'Keep the note under 300 characters.' },
      { note },
    );
  }
  if (status === 'rejected' && note.length < 3) {
    return invalid(
      'Give the customer a reason to reject the return.',
      { note: 'Give a reason of 3 to 300 characters.' },
      { note },
    );
  }

  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminDecideReturn(token, returnId, {
        status,
        ...(note === '' ? {} : { note }),
      }),
    {
      returnTo: returnPath(returnId),
      label: 'return decision',
      messages: AFTER_SALES_MESSAGES,
    },
  );
  if (!result.ok) return { ...result.state, values: { note } };
  refreshReturn(returnId);
  return { status: 'success', message: RETURN_DECISION_DONE[status] };
}

/** Put the units of a received return back into stock. */
export async function restockReturnAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const returnId = idOf(formData, 'returnId');
  if (!returnId) return PAGE_EXPIRED;
  const note = formText(formData, 'note').trim();
  if (note.length > 300) {
    return invalid(
      'Check the highlighted fields',
      { note: 'Keep the note under 300 characters.' },
      { note },
    );
  }

  const result = await adminAct(
    formData,
    (api, token) => api.adminRestockReturn(token, returnId, note === '' ? undefined : note),
    {
      returnTo: returnPath(returnId),
      label: 'return restock',
      messages: {
        ...AFTER_SALES_MESSAGES,
        forbidden: 'Restocking needs the “Adjust stock” permission.',
        // Not idempotent: a lost answer may hide a saved restock.
        service_unavailable:
          'Nilzora could not confirm the restock. Reload the page and check before trying again.',
      },
    },
  );
  if (!result.ok) return { ...result.state, values: { note } };
  refreshReturn(returnId);
  revalidatePath('/admin/inventory');
  return { status: 'success', message: 'The returned units are back in stock.' };
}

const METHODS: RefundMethod[] = ['cod_manual', 'bank_transfer'];

function methodOf(value: string): RefundMethod {
  return METHODS.find((candidate) => candidate === value) ?? 'cod_manual';
}

/** Ask for money to go back on an order (nothing moves until it is approved and paid out). */
export async function requestRefundAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const orderNumber = formText(formData, 'orderNumber').trim().toUpperCase();
  const amountText = formText(formData, 'amount');
  const amountMinor = takaToMinor(amountText);
  const reason = formText(formData, 'reason').trim();
  const values = { orderNumber, amount: amountText, reason };
  const errors: Record<string, string> = {};
  if (!orderNumberSchema.safeParse(orderNumber).success) {
    errors.orderNumber = 'Enter the order number, e.g. NZ100001.';
  }
  if (amountMinor === undefined || amountMinor < 1)
    errors.amount = 'Enter the amount to refund in taka.';
  if (reason.length < 3) errors.reason = 'Say why the money goes back.';
  else if (reason.length > 200) errors.reason = 'Keep the reason under 200 characters.';
  if (Object.keys(errors).length > 0 || amountMinor === undefined) {
    return invalid('Check the highlighted fields', errors, values);
  }
  const returnRequestId = formText(formData, 'returnRequestId').trim();

  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminRequestRefund(token, {
        orderNumber,
        amountMinor,
        reason,
        method: methodOf(formText(formData, 'method')),
        ...(returnRequestId === '' ? {} : { returnRequestId }),
      }),
    { returnTo: REFUNDS_PATH, label: 'refund request', messages: AFTER_SALES_MESSAGES },
  );
  revalidatePath(REFUNDS_PATH);
  if (!result.ok) return result.state;
  revalidatePath(refundPath(result.value.refund.id));
  return {
    status: 'success',
    message: 'Refund requested. It needs approval before any money is paid out.',
  };
}

/** Approve or reject a requested refund. */
export async function decideRefundAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const refundId = idOf(formData, 'refundId');
  const decision = formText(formData, 'decision');
  if (!refundId || (decision !== 'approve' && decision !== 'reject')) return PAGE_EXPIRED;
  const note = formText(formData, 'note').trim();
  if (note.length > 300) {
    return invalid(
      'Check the highlighted fields',
      { note: 'Keep the note under 300 characters.' },
      { note },
    );
  }
  if (decision === 'reject' && note.length < 5) {
    return invalid(
      'Give a reason to reject the refund.',
      { note: 'Give a reason of 5 to 300 characters.' },
      { note },
    );
  }

  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminDecideRefund(token, refundId, {
        approve: decision === 'approve',
        ...(note === '' ? {} : { note }),
      }),
    { returnTo: refundPath(refundId), label: 'refund decision', messages: AFTER_SALES_MESSAGES },
  );
  if (!result.ok) return { ...result.state, values: { note } };
  refreshRefund(refundId);
  return {
    status: 'success',
    message:
      decision === 'approve'
        ? 'Refund approved. Record the payout with its reference once the money is handed back.'
        : 'Refund rejected.',
  };
}

/** Record that the money actually went back: the reference is the evidence. */
export async function completeRefundAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const refundId = idOf(formData, 'refundId');
  if (!refundId) return PAGE_EXPIRED;
  const reference = formText(formData, 'reference').trim();
  const note = formText(formData, 'note').trim();
  const values = { reference, note };
  const errors: Record<string, string> = {};
  if (reference.length < 3 || reference.length > 120) {
    errors.reference = 'Enter the receipt or transfer reference (3 to 120 characters).';
  }
  if (note.length > 500) errors.note = 'Keep the note under 500 characters.';
  if (Object.keys(errors).length > 0)
    return invalid('Check the highlighted fields', errors, values);

  const result = await adminAct(
    formData,
    (api, token) =>
      api.adminCompleteRefund(token, refundId, {
        reference,
        ...(note === '' ? {} : { note }),
      }),
    {
      returnTo: refundPath(refundId),
      label: 'refund completion',
      messages: {
        ...AFTER_SALES_MESSAGES,
        // Not idempotent: a lost answer may hide a recorded payout.
        service_unavailable:
          'Nilzora could not confirm the payout. Reload the page and check before trying again.',
      },
    },
  );
  if (!result.ok) return { ...result.state, values };
  refreshRefund(refundId);
  return { status: 'success', message: 'Payout recorded. The refund is paid out.' };
}

/** Cancels an open refund, with the reason kept in its history. */
export async function cancelRefundAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const refundId = idOf(formData, 'refundId');
  if (!refundId) return PAGE_EXPIRED;
  const note = formText(formData, 'note').trim();
  if (note.length < 5 || note.length > 300) {
    return invalid(
      'Give a reason to cancel the refund.',
      { note: 'Give a reason of 5 to 300 characters.' },
      { note },
    );
  }

  const result = await adminAct(
    formData,
    (api, token) => api.adminCancelRefund(token, refundId, note),
    {
      returnTo: refundPath(refundId),
      label: 'refund cancel',
      messages: AFTER_SALES_MESSAGES,
    },
  );
  if (!result.ok) return { ...result.state, values: { note } };
  refreshRefund(refundId);
  return { status: 'success', message: 'Refund cancelled.' };
}
