import { ApiError } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

type Gate = 'ok' | 'signed_out' | 'unavailable';

const session = vi.hoisted(() => {
  const holder: { gate: Gate } = { gate: 'ok' };
  return {
    ...holder,
    receiptPdf: vi.fn<(token: string, orderNumber: string) => Promise<unknown>>(),
  };
});
const ORDER = 'NZ100042';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

vi.mock('@/lib/session', () => ({
  session: {
    read: async (call: (api: unknown, accessToken: string) => Promise<unknown>) => {
      if (session.gate !== 'ok') return { kind: session.gate };
      return { kind: 'ok', value: await call({ orderReceiptPdf: session.receiptPdf }, 'token') };
    },
  },
}));

function call(orderNumber = ORDER): { params: Promise<{ orderNumber: string }> } {
  return { params: Promise.resolve({ orderNumber }) };
}

const url = `http://localhost:3000/account/orders/${ORDER}/receipt/pdf`;

beforeEach(() => {
  session.gate = 'ok';
  session.receiptPdf.mockReset();
  session.receiptPdf.mockResolvedValue({
    bytes: PDF,
    fileName: `Nilzora-Receipt-${ORDER}.pdf`,
    contentType: 'application/pdf',
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('GET /account/orders/[orderNumber]/receipt/pdf', () => {
  it('streams the API PDF of this order as a private attachment', async () => {
    const response = await GET(new Request(url), call());

    expect(session.receiptPdf).toHaveBeenCalledWith('token', ORDER);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="Nilzora-Receipt-${ORDER}.pdf"`,
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(new Uint8Array(await response.arrayBuffer())).toStrictEqual(PDF);
  });

  it('sends a signed-out visitor to sign in and back to the receipt', async () => {
    session.gate = 'signed_out';

    const response = await GET(new Request(url), call());

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `http://localhost:3000/login?next=/account/orders/${ORDER}/receipt`,
    );
  });

  it("answers 404 for another customer's order", async () => {
    session.receiptPdf.mockRejectedValue(new ApiError(404, 'order_not_found', 'no'));

    const response = await GET(new Request(url), call());

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  });

  it('refuses a suspended account', async () => {
    session.receiptPdf.mockRejectedValue(new ApiError(403, 'account_suspended', 'no'));

    const response = await GET(new Request(url), call());

    expect(response.status).toBe(403);
  });

  it('answers 503 when the API cannot be reached', async () => {
    session.gate = 'unavailable';

    const response = await GET(new Request(url), call());

    expect(response.status).toBe(503);
  });

  it('refuses an order number that is not one, without reading anything', async () => {
    const response = await GET(
      new Request('http://localhost:3000/account/orders/abc/receipt/pdf'),
      {
        params: Promise.resolve({ orderNumber: 'abc' }),
      },
    );

    expect(response.status).toBe(404);
    expect(session.receiptPdf).not.toHaveBeenCalled();
  });
});
