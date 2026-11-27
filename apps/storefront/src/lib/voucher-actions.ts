'use server';

import { voucherSchema, type Voucher } from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { ApiError, type ApiClient } from '@nilzora/web-session';
import { revalidatePath } from 'next/cache';
import { session } from '@/lib/session';

/*
 * Collecting a voucher. session.act() checks this app's Origin and CSRF token before the API
 * call; the API collects for the signed-in account only and the database applies every rule
 * (window, audience, collection cap, once per customer). Only fixed messages return.
 */

export interface CollectAnswer {
  ok: boolean;
  voucher?: Voucher;
  message?: string;
  signedOut?: boolean;
}

const MESSAGES: Record<string, string> = {
  voucher_unavailable:
    'This voucher cannot be collected on your account right now. Check its dates and conditions.',
  rate_limited: 'Too many tries in a short time. Wait a moment, then try again.',
};

export async function collectVoucherAction(formData: FormData): Promise<CollectAnswer> {
  const voucherId = uuidSchema.safeParse(formData.get('voucherId'));
  if (!voucherId.success) return { ok: false, message: 'Choose a voucher first.' };
  try {
    const outcome = await session.act(formData, async (api: ApiClient, accessToken: string) =>
      voucherSchema.parse((await api.collectVoucher(accessToken, voucherId.data)).voucher),
    );
    if (outcome.kind === 'signed_out') {
      return { ok: false, signedOut: true, message: 'Sign in to collect vouchers.' };
    }
    if (outcome.kind === 'untrusted') {
      return { ok: false, message: 'This page is out of date. Reload it and try again.' };
    }
    if (outcome.kind !== 'ok') {
      return { ok: false, message: 'Nilzora could not reach your vouchers. Please try again.' };
    }
    revalidatePath('/vouchers');
    revalidatePath('/account/vouchers');
    return { ok: true, voucher: outcome.value };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401)
        return { ok: false, signedOut: true, message: 'Sign in to collect vouchers.' };
      const known = MESSAGES[error.code];
      if (known) return { ok: false, message: known };
    }
    return { ok: false, message: 'That voucher could not be collected. Please try again.' };
  }
}
