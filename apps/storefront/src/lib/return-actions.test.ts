// @vitest-environment node
import type { ReturnDetail, ReturnResponse } from '@nilzora/contracts';
import type { FormState, SessionAct, SessionCall } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, redirectedTo } from '@/testing/commerce-fixtures';
import { cancelReturnAction, requestReturnAction } from './return-actions';

type Gate = 'ok' | 'untrusted' | 'signed_out' | 'unavailable';

const browser = vi.hoisted(() => {
  const holder: { gate: Gate } = { gate: 'ok' };
  return {
    ...holder,
    requestReturn: vi.fn<(token: string, body: unknown) => Promise<ReturnResponse>>(),
    cancelMyReturn: vi.fn<(token: string, returnId: string) => Promise<void>>(),
  };
});

vi.mock('@/lib/session', () => ({
  session: {
    act: async <T>(_formData: FormData, call: SessionCall<T>): Promise<SessionAct<T>> => {
      if (browser.gate !== 'ok') return { kind: browser.gate };
      return {
        kind: 'ok',
        value: await call(
          {
            requestReturn: browser.requestReturn,
            cancelMyReturn: browser.cancelMyReturn,
          } as never,
          'tok',
        ),
      };
    },
  },
}));

const idle: FormState = { status: 'idle' };
const RETURN_ID = '4b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f';

const returnDetail: ReturnDetail = {
  id: RETURN_ID,
  orderNumber: 'NZ100042',
  status: 'requested',
  itemCount: 1,
  refundableMinor: 125_000,
  reason: 'The item arrived damaged',
  requestedAt: '2026-11-05T10:00:00.000Z',
  decidedAt: null,
  decisionNote: null,
  description: null,
  receivedAt: null,
  restockedAt: null,
  items: [
    {
      orderItemId: 7,
      productName: 'Brass table lamp',
      variantLabel: null,
      sku: 'NZ-LAMP-01',
      quantity: 1,
      orderedQuantity: 2,
      lineTotalMinor: 125_000,
    },
  ],
  history: [
    {
      fromStatus: null,
      toStatus: 'requested',
      actorKind: 'customer',
      note: null,
      at: '2026-11-05T10:00:00.000Z',
    },
  ],
};

function returnForm(fields: Record<string, string> = {}): FormData {
  const data = new FormData();
  const all = {
    csrf_token: 'signed-csrf-value',
    orderNumber: 'NZ100042',
    'quantity-7': '1',
    reason: 'The item arrived damaged',
    description: '',
    ...fields,
  };
  for (const [name, value] of Object.entries(all)) data.append(name, value);
  return data;
}

beforeEach(() => {
  browser.gate = 'ok';
  browser.requestReturn.mockReset();
  browser.requestReturn.mockResolvedValue({ return: returnDetail });
  browser.cancelMyReturn.mockReset();
  browser.cancelMyReturn.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('requestReturnAction', () => {
  it('sends only the lines the customer gave a quantity for', async () => {
    const data = returnForm({ 'quantity-9': '0' });
    data.append('line-0', '7');

    await expect(requestReturnAction(idle, data)).rejects.toMatchObject(
      redirectedTo(`/account/returns/${RETURN_ID}?requested=1`),
    );
    expect(browser.requestReturn).toHaveBeenCalledWith('tok', {
      orderNumber: 'NZ100042',
      items: [{ orderItemId: 7, quantity: 1 }],
      reason: 'The item arrived damaged',
    });
  });

  it('asks for at least one item instead of sending an empty request', async () => {
    const state = await requestReturnAction(idle, returnForm({ 'quantity-7': '0' }));
    expect(state.status).toBe('error');
    expect(state.message).toContain('at least one item');
    expect(browser.requestReturn).not.toHaveBeenCalled();
  });

  it('refuses a request the contract rejects, without calling the API', async () => {
    const state = await requestReturnAction(idle, returnForm({ orderNumber: 'not-an-order' }));
    expect(state.status).toBe('error');
    expect(state.fieldErrors).toBeDefined();
    expect(browser.requestReturn).not.toHaveBeenCalled();
  });

  it('turns the API refusal into a message a customer can act on', async () => {
    browser.requestReturn.mockRejectedValue(apiError(409, 'return_not_eligible'));
    const state = await requestReturnAction(idle, returnForm());
    expect(state.status).toBe('error');
    expect(state.message).toContain('Returns are accepted for delivered orders');
  });

  it('never claims success when the answer was lost', async () => {
    browser.requestReturn.mockRejectedValue(apiError(502, 'invalid_response'));
    const state = await requestReturnAction(idle, returnForm());
    expect(state.status).toBe('error');
    expect(state.message).toContain('could not confirm');
  });

  it('sends a signed-out customer to sign in again', async () => {
    browser.gate = 'signed_out';
    await expect(requestReturnAction(idle, returnForm())).rejects.toBeInstanceOf(Error);
    expect(browser.requestReturn).not.toHaveBeenCalled();
  });

  it('refuses a post that is not this app’s origin', async () => {
    browser.gate = 'untrusted';
    const state = await requestReturnAction(idle, returnForm());
    expect(state.status).toBe('error');
    expect(browser.requestReturn).not.toHaveBeenCalled();
  });
});

describe('cancelReturnAction', () => {
  it('cancels the request and returns to it', async () => {
    const data = new FormData();
    data.append('returnId', RETURN_ID);

    await expect(cancelReturnAction(idle, data)).rejects.toMatchObject(
      redirectedTo(`/account/returns/${RETURN_ID}?cancelled=1`),
    );
    expect(browser.cancelMyReturn).toHaveBeenCalledWith('tok', RETURN_ID);
  });

  it('explains a request that has already moved on', async () => {
    browser.cancelMyReturn.mockRejectedValue(apiError(409, 'return_closed'));
    const data = new FormData();
    data.append('returnId', RETURN_ID);

    const state = await cancelReturnAction(idle, data);
    expect(state.status).toBe('error');
    expect(state.message).toContain('already moved on');
  });

  it('refuses a form without a return id', async () => {
    const state = await cancelReturnAction(idle, new FormData());
    expect(state.status).toBe('error');
    expect(browser.cancelMyReturn).not.toHaveBeenCalled();
  });
});
