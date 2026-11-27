import { ApiError, type ApiClient, type FormState } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedirectSignal, throwRedirect } from '@/test/redirect';
import {
  cancelRefundAction,
  completeRefundAction,
  decideRefundAction,
  decideReturnAction,
  requestRefundAction,
  restockReturnAction,
} from './after-sales-actions';
import { saveCouponAction, setCouponActiveAction } from './coupon-actions';
import { recordCodCollectionAction } from './order-actions';

/*
 * The sales actions that used to drop their result (returns, refunds, coupon switch) or
 * lacked a check (creating a coupon): each now answers with a state the form shows, with
 * fixed messages only, and nothing reaches the API from an untrusted form.
 */

type Outcome = 'ok' | 'untrusted' | 'signed_out' | 'unavailable';

const api = vi.hoisted(() => ({
  adminDecideReturn: vi.fn(),
  adminRestockReturn: vi.fn(),
  adminRequestRefund: vi.fn(),
  adminDecideRefund: vi.fn(),
  adminCompleteRefund: vi.fn(),
  adminCancelRefund: vi.fn(),
  adminCreateCoupon: vi.fn(),
  adminUpdateCoupon: vi.fn(),
  adminSetCouponActive: vi.fn(),
  adminRecordCodCollection: vi.fn(),
}));
const act = vi.hoisted((): { outcome: Outcome; permissions: string[] } => ({
  outcome: 'ok',
  permissions: [],
}));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('@/lib/session', () => ({
  session: {
    act: async (_formData: FormData, call: (client: ApiClient, token: string) => unknown) => {
      if (act.outcome !== 'ok') return { kind: act.outcome };
      return { kind: 'ok', value: await call(api as unknown as ApiClient, 'access-token') };
    },
    getSession: () =>
      Promise.resolve({ status: 'signed_in', user: { permissions: act.permissions } }),
  },
}));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(throwRedirect) }));

const IDLE: FormState = { status: 'idle' };
const RETURN = '4b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f';
const REFUND = '9d1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f';
const COUPON = '55555555-5555-4555-8555-555555555555';
const API_TEXT = 'API text that must not reach the browser';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

function refusal(status: number, code: string): ApiError {
  return new ApiError(status, code, API_TEXT, 'req-1');
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.catch((e: unknown) => e);
  if (!(error instanceof RedirectSignal)) throw new Error('expected a redirect');
  return error.url;
}

beforeEach(() => {
  act.outcome = 'ok';
  act.permissions = [];
  revalidatePath.mockReset();
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({});
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('return actions answer with a state', () => {
  it('records a decision and says what happened', async () => {
    const state = await decideReturnAction(
      IDLE,
      form({ returnId: RETURN, status: 'approved', note: ' ok ' }),
    );
    expect(state).toEqual({
      status: 'success',
      message: 'Return approved. Mark the goods received when they arrive.',
    });
    expect(api.adminDecideReturn).toHaveBeenCalledWith('access-token', RETURN, {
      status: 'approved',
      note: 'ok',
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/returns/${RETURN}`);
  });

  it('asks for a reason before rejecting, keeping what was typed', async () => {
    const state = await decideReturnAction(
      IDLE,
      form({ returnId: RETURN, status: 'rejected', note: '' }),
    );
    expect(state.status).toBe('error');
    expect(state.fieldErrors?.note).toMatch(/reason/);
    expect(api.adminDecideReturn).not.toHaveBeenCalled();
  });

  it('shows a fixed message for a refusal, never the API’s text', async () => {
    api.adminDecideReturn.mockRejectedValue(refusal(409, 'return_closed'));
    const closed = await decideReturnAction(IDLE, form({ returnId: RETURN, status: 'completed' }));
    expect(closed).toMatchObject({ status: 'error', message: 'This return has already moved on.' });

    api.adminDecideReturn.mockRejectedValue(refusal(403, 'forbidden'));
    const forbidden = await decideReturnAction(
      IDLE,
      form({ returnId: RETURN, status: 'approved' }),
    );
    expect(forbidden.message).toBe('Your account does not have permission for this action.');
    expect(JSON.stringify([closed, forbidden])).not.toContain(API_TEXT);
  });

  it('refuses a tampered id or decision, and an untrusted form, before the API', async () => {
    expect(
      (await decideReturnAction(IDLE, form({ returnId: '../x', status: 'approved' }))).message,
    ).toMatch(/out of date/);
    expect(
      (await decideReturnAction(IDLE, form({ returnId: RETURN, status: 'teleport' }))).message,
    ).toMatch(/out of date/);
    act.outcome = 'untrusted';
    const untrusted = await decideReturnAction(
      IDLE,
      form({ returnId: RETURN, status: 'approved' }),
    );
    expect(untrusted.status).toBe('error');
    expect(api.adminDecideReturn).not.toHaveBeenCalled();
  });

  it('restocks and says so, with its own permission message and a warning for an unknown outcome', async () => {
    const done = await restockReturnAction(
      IDLE,
      form({ returnId: RETURN, note: 'back on the shelf' }),
    );
    expect(done).toEqual({ status: 'success', message: 'The returned units are back in stock.' });
    expect(api.adminRestockReturn).toHaveBeenCalledWith(
      'access-token',
      RETURN,
      'back on the shelf',
    );
    expect(revalidatePath).toHaveBeenCalledWith('/admin/inventory');

    api.adminRestockReturn.mockRejectedValue(refusal(403, 'forbidden'));
    expect((await restockReturnAction(IDLE, form({ returnId: RETURN }))).message).toMatch(
      /Adjust stock/,
    );

    api.adminRestockReturn.mockRejectedValue(refusal(503, 'service_unavailable'));
    expect((await restockReturnAction(IDLE, form({ returnId: RETURN }))).message).toMatch(
      /check before trying again/,
    );
  });
});

describe('refund actions answer with a state', () => {
  it('approves, and rejects only with a reason', async () => {
    const approved = await decideRefundAction(
      IDLE,
      form({ refundId: REFUND, decision: 'approve' }),
    );
    expect(approved.status).toBe('success');
    expect(approved.message).toMatch(/Refund approved/);
    expect(api.adminDecideRefund).toHaveBeenCalledWith('access-token', REFUND, { approve: true });

    const noReason = await decideRefundAction(
      IDLE,
      form({ refundId: REFUND, decision: 'reject', note: 'no' }),
    );
    expect(noReason.fieldErrors?.note).toMatch(/5 to 300/);
    expect(api.adminDecideRefund).toHaveBeenCalledTimes(1);

    const rejected = await decideRefundAction(
      IDLE,
      form({ refundId: REFUND, decision: 'reject', note: 'Goods were not returned' }),
    );
    expect(rejected).toEqual({ status: 'success', message: 'Refund rejected.' });
    expect(api.adminDecideRefund).toHaveBeenLastCalledWith('access-token', REFUND, {
      approve: false,
      note: 'Goods were not returned',
    });
  });

  it('explains a refund that is no longer waiting for a decision', async () => {
    api.adminDecideRefund.mockRejectedValue(refusal(409, 'refund_not_decidable'));
    const state = await decideRefundAction(IDLE, form({ refundId: REFUND, decision: 'approve' }));
    expect(state).toMatchObject({
      status: 'error',
      message: 'This refund is no longer waiting for a decision.',
    });
  });

  it('records a payout only with its reference', async () => {
    const missing = await completeRefundAction(IDLE, form({ refundId: REFUND, reference: 'x' }));
    expect(missing.fieldErrors?.reference).toMatch(/reference/);
    expect(missing.values).toEqual({ reference: 'x', note: '' });
    expect(api.adminCompleteRefund).not.toHaveBeenCalled();

    const done = await completeRefundAction(
      IDLE,
      form({ refundId: REFUND, reference: 'TXN-1234', note: 'bKash' }),
    );
    expect(done).toEqual({
      status: 'success',
      message: 'Payout recorded. The refund is paid out.',
    });
    expect(api.adminCompleteRefund).toHaveBeenCalledWith('access-token', REFUND, {
      reference: 'TXN-1234',
      note: 'bKash',
    });
  });

  it('keeps the typed reference after a refusal, and warns when the outcome is unknown', async () => {
    api.adminCompleteRefund.mockRejectedValue(refusal(409, 'refund_not_completable'));
    const refused = await completeRefundAction(
      IDLE,
      form({ refundId: REFUND, reference: 'TXN-1234' }),
    );
    expect(refused.message).toBe('Approve the refund before recording the payout.');
    expect(refused.values?.reference).toBe('TXN-1234');

    api.adminCompleteRefund.mockRejectedValue(refusal(503, 'service_unavailable'));
    const unknown = await completeRefundAction(
      IDLE,
      form({ refundId: REFUND, reference: 'TXN-1234' }),
    );
    expect(unknown.message).toMatch(/Reload the page and check/);
  });

  it('cancels with a reason', async () => {
    const short = await cancelRefundAction(IDLE, form({ refundId: REFUND, note: 'no' }));
    expect(short.fieldErrors?.note).toMatch(/5 to 300/);
    expect(api.adminCancelRefund).not.toHaveBeenCalled();

    expect(
      await cancelRefundAction(
        IDLE,
        form({ refundId: REFUND, note: 'Customer changed their mind' }),
      ),
    ).toEqual({ status: 'success', message: 'Refund cancelled.' });
    expect(api.adminCancelRefund).toHaveBeenCalledWith(
      'access-token',
      REFUND,
      'Customer changed their mind',
    );
  });

  it('answers a bad id and an untrusted form without reaching the API', async () => {
    expect(
      (await cancelRefundAction(IDLE, form({ refundId: 'nope', note: 'a reason' }))).message,
    ).toMatch(/out of date/);
    act.outcome = 'untrusted';
    await decideRefundAction(IDLE, form({ refundId: REFUND, decision: 'approve' }));
    await completeRefundAction(IDLE, form({ refundId: REFUND, reference: 'TXN-1234' }));
    await cancelRefundAction(IDLE, form({ refundId: REFUND, note: 'a good reason' }));
    expect(api.adminDecideRefund).not.toHaveBeenCalled();
    expect(api.adminCompleteRefund).not.toHaveBeenCalled();
    expect(api.adminCancelRefund).not.toHaveBeenCalled();
  });

  it('marks the fields of a refund request that cannot be sent', async () => {
    const state = await requestRefundAction(
      IDLE,
      form({ orderNumber: '', amount: '', reason: '' }),
    );
    expect(Object.keys(state.fieldErrors ?? {}).sort()).toEqual([
      'amount',
      'orderNumber',
      'reason',
    ]);
    expect(api.adminRequestRefund).not.toHaveBeenCalled();
  });
});

describe('coupon actions', () => {
  const COUPON_FIELDS = {
    code: 'EID25',
    kind: 'percent',
    value: '10',
    minOrderMinor: '',
    maxDiscountMinor: '',
    startsAt: '',
    endsAt: '',
    totalLimit: '',
    perCustomerLimit: '1',
    description: '',
    isActive: 'on',
  };

  it('creates a coupon only for an account holding coupons.create', async () => {
    api.adminCreateCoupon.mockResolvedValue({ coupon: { id: COUPON } });
    act.permissions = ['coupons.update'];
    const refused = await saveCouponAction(IDLE, form(COUPON_FIELDS));
    expect(refused.status).toBe('error');
    expect(refused.message).toMatch(/“Create coupons” permission/);
    expect(api.adminCreateCoupon).not.toHaveBeenCalled();

    act.permissions = ['coupons.update', 'coupons.create'];
    const created = await saveCouponAction(IDLE, form(COUPON_FIELDS));
    expect(created).toEqual({ status: 'success', message: 'Coupon created.' });
    expect(api.adminCreateCoupon).toHaveBeenCalledTimes(1);
  });

  it('saves changes to an existing coupon with coupons.update alone', async () => {
    api.adminUpdateCoupon.mockResolvedValue({ coupon: { id: COUPON } });
    act.permissions = ['coupons.update'];
    const saved = await saveCouponAction(IDLE, form({ ...COUPON_FIELDS, couponId: COUPON }));
    expect(saved).toEqual({ status: 'success', message: 'Coupon saved.' });
    expect(api.adminUpdateCoupon).toHaveBeenCalledWith('access-token', COUPON, expect.any(Object));
    expect(api.adminCreateCoupon).not.toHaveBeenCalled();
  });

  it('turns a coupon on and off and says which', async () => {
    const on = await setCouponActiveAction(IDLE, form({ couponId: COUPON, isActive: 'true' }));
    expect(on).toEqual({
      status: 'success',
      message: 'Coupon activated. Checkout accepts it again.',
    });
    expect(api.adminSetCouponActive).toHaveBeenCalledWith('access-token', COUPON, true);

    const off = await setCouponActiveAction(IDLE, form({ couponId: COUPON, isActive: 'false' }));
    expect(off.message).toBe('Coupon deactivated. Checkout no longer accepts it.');
    expect(api.adminSetCouponActive).toHaveBeenLastCalledWith('access-token', COUPON, false);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/coupons/${COUPON}`);
  });

  it('no longer swallows a refusal of the switch', async () => {
    api.adminSetCouponActive.mockRejectedValue(refusal(403, 'forbidden'));
    const forbidden = await setCouponActiveAction(
      IDLE,
      form({ couponId: COUPON, isActive: 'false' }),
    );
    expect(forbidden).toEqual({ status: 'error', message: 'Your account cannot manage coupons.' });

    api.adminSetCouponActive.mockRejectedValue(refusal(404, 'not_found'));
    const gone = await setCouponActiveAction(IDLE, form({ couponId: COUPON, isActive: 'true' }));
    expect(gone.message).toBe('This coupon no longer exists.');

    api.adminSetCouponActive.mockRejectedValue(refusal(500, 'internal'));
    const unknown = await setCouponActiveAction(IDLE, form({ couponId: COUPON, isActive: 'true' }));
    expect(unknown.status).toBe('error');
    expect(unknown.message).not.toContain(API_TEXT);
  });

  it('refuses a tampered id or value, and an untrusted form, before the API', async () => {
    expect(
      (await setCouponActiveAction(IDLE, form({ couponId: 'x', isActive: 'true' }))).message,
    ).toMatch(/out of date/);
    expect(
      (await setCouponActiveAction(IDLE, form({ couponId: COUPON, isActive: 'maybe' }))).message,
    ).toMatch(/out of date/);
    act.outcome = 'untrusted';
    expect(
      (await setCouponActiveAction(IDLE, form({ couponId: COUPON, isActive: 'true' }))).status,
    ).toBe('error');
    expect(api.adminSetCouponActive).not.toHaveBeenCalled();
  });
});

describe('recordCodCollectionAction return path', () => {
  const base = { orderNumber: 'NZ100042', amount: '2580' };

  it('goes back to the order by default', async () => {
    await expect(redirectOf(recordCodCollectionAction(IDLE, form(base)))).resolves.toBe(
      '/admin/orders/NZ100042?notice=cash_collected',
    );
    expect(api.adminRecordCodCollection).toHaveBeenCalledWith('access-token', 'NZ100042', {
      amountMinor: 258_000,
    });
  });

  it('goes back to the COD collections list it was started from, and nowhere else', async () => {
    await expect(
      redirectOf(
        recordCodCollectionAction(
          IDLE,
          form({ ...base, returnTo: '/admin/cod-collections?q=NZ1&page=2' }),
        ),
      ),
    ).resolves.toBe('/admin/cod-collections?q=NZ1&page=2&notice=cash_collected');

    for (const returnTo of [
      'https://evil.example/admin/cod-collections',
      '//evil.example',
      '/admin/orders',
      '/admin/cod-collections/../orders',
      '/admin/cod-collections?notice=x',
    ]) {
      await expect(
        redirectOf(recordCodCollectionAction(IDLE, form({ ...base, returnTo }))),
      ).resolves.toBe('/admin/orders/NZ100042?notice=cash_collected');
    }
  });

  it('keeps refusing a wrong amount, with the typed value', async () => {
    api.adminRecordCodCollection.mockRejectedValue(refusal(409, 'collection_amount_mismatch'));
    const state = await recordCodCollectionAction(IDLE, form({ ...base, amount: '100' }));
    expect(state.status).toBe('error');
    expect(state.values?.amount).toBe('100');
    expect(state.message).toMatch(/differs from the order total/);
  });
});
