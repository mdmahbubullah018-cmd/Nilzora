'use server';

import { customerStatusRequestSchema } from '@nilzora/contracts';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { adminAct, formText, invalid, type ActionState } from '@/components/admin-kit/act';
import { uuidParam } from '@/components/customers/customer-query';

/**
 * Suspends a customer account (with a reason) or reactivates it. The API refuses
 * staff accounts, the caller's own account and callers without customers.update.
 */
export async function setCustomerStatusAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const customerId = uuidParam(formText(formData, 'customerId'));
  if (!customerId) {
    return {
      status: 'error',
      message: 'This customer could not be identified. Reload the page and try again.',
    };
  }

  const status = formText(formData, 'status');
  const reason = formText(formData, 'reason');
  const parsed = customerStatusRequestSchema.safeParse({ status, reason });
  if (!parsed.success) {
    const reasonIssue = parsed.error.issues.some((issue) => issue.path[0] === 'reason');
    const message = 'Give a reason of 5 to 300 characters.';
    return reasonIssue
      ? invalid(message, { reason: message }, { reason })
      : invalid('This change is not available. Reload the page and try again.');
  }

  const path = `/admin/customers/${customerId}` as Route;
  const result = await adminAct(
    formData,
    (api, token) => api.adminSetCustomerStatus(token, customerId, parsed.data),
    {
      returnTo: path,
      label: 'customer status change',
      messages: {
        not_found: 'This customer no longer exists, or your account cannot see it.',
        cannot_change_self: 'You cannot change your own account’s status.',
        account_not_manageable:
          'Only customer accounts can be suspended here. Staff accounts are managed on the Staff page.',
        bad_request: 'Give a reason of 5 to 300 characters.',
      },
    },
  );
  if (!result.ok) return { ...result.state, values: { reason } };

  revalidatePath(path);
  revalidatePath('/admin/customers');
  return {
    status: 'success',
    message:
      result.value.customer.status === 'suspended'
        ? 'The account is suspended. Its next request is refused.'
        : 'The account is active again.',
  };
}
