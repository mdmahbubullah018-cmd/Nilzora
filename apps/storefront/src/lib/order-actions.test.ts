// @vitest-environment node
import type { CancelOrderRequest, OrderResponse } from '@nilzora/contracts';
import type { FormState, SessionAct, SessionCall } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, orderDetail, redirectedTo } from '@/testing/commerce-fixtures';
import { cancelOrderAction } from './order-actions';

type Gate = 'ok' | 'untrusted' | 'signed_out' | 'unavailable';

const browser = vi.hoisted(() => {
  const holder: { gate: Gate } = { gate: 'ok' };
  return {
    ...holder,
    cancelOrder:
      vi.fn<
        (token: string, orderNumber: string, body: CancelOrderRequest) => Promise<OrderResponse>
      >(),
  };
});
const cache = vi.hoisted(() => ({ updateTag: vi.fn() }));

vi.mock('next/cache', () => cache);
vi.mock('@/lib/session', () => ({
  session: {
    act: async <T>(_formData: FormData, call: SessionCall<T>): Promise<SessionAct<T>> => {
      if (browser.gate !== 'ok') return { kind: browser.gate };
      return {
        kind: 'ok',
        value: await call({ cancelOrder: browser.cancelOrder } as never, 'tok'),
      };
    },
  },
}));

const idle: FormState = { status: 'idle' };

function cancelForm(fields: Record<string, string> = {}): FormData {
  const data = new FormData();
  const all = { csrf_token: 'signed-csrf-value', orderNumber: 'NZ100042', reason: '', ...fields };
  for (const [name, value] of Object.entries(all)) data.append(name, value);
  return data;
}

beforeEach(() => {
  browser.gate = 'ok';
  browser.cancelOrder.mockReset();
  browser.cancelOrder.mockResolvedValue({
    order: orderDetail({ status: 'cancelled', paymentStatus: 'cancelled', canCancel: false }),
  });
  cache.updateTag.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('cancelOrderAction', () => {
  it('cancels the order, refreshes its products and shows the cancelled order', async () => {
    await expect(
      cancelOrderAction(idle, cancelForm({ reason: '  Ordered by mistake ' })),
    ).rejects.toMatchObject(redirectedTo('/account/orders/NZ100042?cancelled=1'));

    expect(browser.cancelOrder).toHaveBeenCalledWith('tok', 'NZ100042', {
      reason: 'Ordered by mistake',
    });
    expect(cache.updateTag.mock.calls).toEqual([
      ['product:brass-table-lamp'],
      ['product:ceramic-mug'],
    ]);
  });

  it('sends no reason when none was given', async () => {
    await expect(cancelOrderAction(idle, cancelForm())).rejects.toMatchObject(
      redirectedTo('/account/orders/NZ100042?cancelled=1'),
    );
    expect(browser.cancelOrder.mock.calls[0]?.[2]).toStrictEqual({ reason: undefined });
  });

  it.each([
    ['a malformed order number', { orderNumber: 'NZ1' }],
    ['a path in the order number', { orderNumber: 'NZ100042/../x' }],
    ['no order number', { orderNumber: '' }],
  ])('refuses %s without calling the API', async (_label, fields) => {
    const result = await cancelOrderAction(idle, cancelForm(fields));

    expect(result.status).toBe('error');
    expect(browser.cancelOrder).not.toHaveBeenCalled();
  });

  it('marks a reason that is too long', async () => {
    const result = await cancelOrderAction(idle, cancelForm({ reason: 'r'.repeat(301) }));

    expect(result.fieldErrors).toStrictEqual({ reason: 'Keep the reason under 300 characters.' });
    expect(browser.cancelOrder).not.toHaveBeenCalled();
  });

  it('reports an expired or cross-site form', async () => {
    browser.gate = 'untrusted';

    const result = await cancelOrderAction(idle, cancelForm({ reason: 'Changed my mind' }));

    expect(result.message).toContain('This form has expired');
    expect(result.values).toStrictEqual({ reason: 'Changed my mind' });
  });

  it('sends a signed-out customer to sign in and back to the order', async () => {
    browser.gate = 'signed_out';

    await expect(cancelOrderAction(idle, cancelForm())).rejects.toMatchObject(
      redirectedTo('/login?next=/account/orders/NZ100042&session=expired'),
    );
  });

  it.each([
    ['the session could not be checked', undefined],
    ['the network failed', apiError(0, 'network_error')],
    ['the store was unavailable', apiError(503, 'service_unavailable')],
  ])('asks to check the order when %s', async (_label, error) => {
    if (error === undefined) browser.gate = 'unavailable';
    else browser.cancelOrder.mockRejectedValue(error);

    const result = await cancelOrderAction(idle, cancelForm());

    expect(result.message).toContain('We could not confirm the cancellation.');
    expect(cache.updateTag).not.toHaveBeenCalled();
  });

  it.each([
    ['order_not_cancellable', 409, 'This order can no longer be cancelled.'],
    ['not_found', 404, 'This order could not be found.'],
    ['rate_limited', 429, 'Too many attempts.'],
    ['account_suspended', 403, 'This account is suspended'],
    ['forbidden', 403, 'This order could not be cancelled. Please try again.'],
  ])('maps %s to a fixed message', async (code, status, message) => {
    browser.cancelOrder.mockRejectedValue(apiError(status, code));

    const result = await cancelOrderAction(idle, cancelForm());

    expect(result.message).toContain(message);
    expect(result.message).not.toContain('API says');
  });

  it('marks the reason when the API refuses it', async () => {
    browser.cancelOrder.mockRejectedValue(
      apiError(400, 'validation_failed', {
        issues: [{ location: 'body', path: 'reason', message: 'Too long' }],
      }),
    );

    const result = await cancelOrderAction(idle, cancelForm());

    expect(result.fieldErrors).toStrictEqual({ reason: 'Keep the reason under 300 characters.' });
  });
});
