import type { RefundDetail, ReturnDetail } from '@nilzora/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';

const TOKEN = 'staff-access-token';
const RETURN_ID = '4b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f';
const REFUND_ID = '9d1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f';
const AT = '2026-11-01T10:00:00.000Z';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(response: () => Response) {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(response()));
  const client = createApiClient({ baseUrl: 'http://localhost:4000/', fetch: fetchMock });
  const sent = () => {
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    return {
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
  };
  return { client, sent };
}

const returnDetail: ReturnDetail = {
  id: RETURN_ID,
  orderNumber: 'NZ100001',
  status: 'requested',
  itemCount: 1,
  refundableMinor: 125_000,
  reason: 'Arrived damaged',
  requestedAt: AT,
  decidedAt: null,
  decisionNote: null,
  description: null,
  receivedAt: null,
  restockedAt: null,
  items: [
    {
      orderItemId: 12,
      productName: 'Cotton shirt',
      variantLabel: 'Colour: Red',
      sku: 'SHIRT-RED',
      quantity: 1,
      orderedQuantity: 2,
      lineTotalMinor: 125_000,
    },
  ],
  history: [
    { fromStatus: null, toStatus: 'requested', actorKind: 'customer', note: null, at: AT },
  ],
};

const refundDetail: RefundDetail = {
  id: REFUND_ID,
  orderNumber: 'NZ100001',
  customerName: 'Rahim Uddin',
  amountMinor: 125_000,
  method: 'cod_manual',
  status: 'approved',
  reason: 'Returned shirt',
  requestedAt: AT,
  completedAt: null,
  reference: null,
  note: null,
  decidedAt: AT,
  returnRequestId: RETURN_ID,
  refundableMinor: 125_000,
  order: {
    number: 'NZ100001',
    totalMinor: 250_000,
    status: 'delivered',
    paymentStatus: 'collected',
    placedAt: AT,
  },
  customer: { id: 'c0000000-0000-4000-8000-000000000001', name: 'Rahim Uddin', phone: '+8801712345678' },
  history: [
    { fromStatus: null, toStatus: 'requested', note: null, at: AT },
    { fromStatus: 'requested', toStatus: 'approved', note: null, at: AT },
  ],
};

describe('after-sales reads', () => {
  it('lists the staff return queue with filters and paging', async () => {
    const { client, sent } = setup(() =>
      jsonResponse({ returns: [], page: 2, pageSize: 10, total: 12, totalPages: 2 }),
    );

    const result = await client.adminListReturns(TOKEN, {
      status: 'requested',
      q: 'NZ10',
      page: 2,
      pageSize: 10,
    });

    expect(sent().method).toBe('GET');
    expect(sent().url).toContain('/admin/returns?');
    expect(sent().url).toContain('status=requested');
    expect(sent().url).toContain('q=NZ10');
    expect(sent().headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(result.total).toBe(12);
  });

  it('reads one return with its items and history', async () => {
    const { client, sent } = setup(() => jsonResponse({ return: returnDetail }));

    const result = await client.adminGetReturn(TOKEN, RETURN_ID);

    expect(sent().url).toContain(`/admin/returns/${RETURN_ID}`);
    expect(result.return.items[0]?.variantLabel).toBe('Colour: Red');
    expect(result.return.history).toHaveLength(1);
  });

  it('refuses a return payload that is missing its order', async () => {
    const broken: Record<string, unknown> = { ...returnDetail };
    delete broken['orderNumber'];
    const { client } = setup(() => jsonResponse({ return: broken }));

    await expect(client.adminGetReturn(TOKEN, RETURN_ID)).rejects.toBeInstanceOf(Error);
  });

  it('reads one refund with its order, customer and balance', async () => {
    const { client } = setup(() => jsonResponse({ refund: refundDetail }));

    const result = await client.adminGetRefund(TOKEN, REFUND_ID);

    expect(result.refund.amountMinor).toBe(125_000);
    expect(result.refund.refundableMinor).toBe(125_000);
    expect(result.refund.order.paymentStatus).toBe('collected');
  });
});

describe('after-sales writes', () => {
  it('sends a return decision with its note', async () => {
    const { client, sent } = setup(() => jsonResponse({ return: { ...returnDetail, status: 'approved' } }));

    const result = await client.adminDecideReturn(TOKEN, RETURN_ID, {
      status: 'approved',
      note: 'Send it back',
    });

    expect(sent().method).toBe('POST');
    expect(sent().url).toContain(`/admin/returns/${RETURN_ID}/status`);
    expect(sent().body).toEqual({ status: 'approved', note: 'Send it back' });
    expect(result.return.status).toBe('approved');
  });

  it('restocks only with the note it was given', async () => {
    const { client, sent } = setup(() => jsonResponse({ return: { ...returnDetail, status: 'completed' } }));

    await client.adminRestockReturn(TOKEN, RETURN_ID, 'Back in the stockroom');

    expect(sent().url).toContain(`/admin/returns/${RETURN_ID}/restock`);
    expect(sent().body).toEqual({ note: 'Back in the stockroom' });
  });

  it('requests a refund without ever sending a total of its own', async () => {
    const { client, sent } = setup(() => jsonResponse({ refund: refundDetail }, 201));

    await client.adminRequestRefund(TOKEN, {
      orderNumber: 'NZ100001',
      amountMinor: 125_000,
      reason: 'Returned shirt',
      method: 'cod_manual',
    });

    expect(sent().method).toBe('POST');
    expect(sent().url).toContain('/admin/refunds');
    expect(sent().body).toEqual({
      orderNumber: 'NZ100001',
      amountMinor: 125_000,
      reason: 'Returned shirt',
      method: 'cod_manual',
    });
  });

  it('completes a refund with the payout reference', async () => {
    const { client, sent } = setup(() =>
      jsonResponse({ refund: { ...refundDetail, status: 'completed', reference: 'CASH-2026-11-001' } }),
    );

    const result = await client.adminCompleteRefund(TOKEN, REFUND_ID, {
      reference: 'CASH-2026-11-001',
    });

    expect(sent().url).toContain(`/admin/refunds/${REFUND_ID}/completion`);
    expect(sent().body).toEqual({ reference: 'CASH-2026-11-001' });
    expect(result.refund.reference).toBe('CASH-2026-11-001');
  });

  it('shows the refusal code the API answered with', async () => {
    const { client } = setup(() =>
      jsonResponse(
        { error: { code: 'refund_not_completable', message: 'Approve the refund first' } },
        409,
      ),
    );

    await expect(
      client.adminCompleteRefund(TOKEN, REFUND_ID, { reference: 'CASH-1' }),
    ).rejects.toMatchObject({ code: 'refund_not_completable', status: 409 });
  });
});
