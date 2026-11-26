import { describe, expect, it } from 'vitest';
import {
  adminRefundListQuerySchema,
  refundCancelRequestSchema,
  refundCompletionRequestSchema,
  refundDecisionRequestSchema,
  refundRequestSchema,
} from './refunds';
import {
  adminReturnListQuerySchema,
  returnDecisionRequestSchema,
  returnDetailSchema,
  returnRequestSchema,
} from './returns';

const ORDER = 'NZ100001';

describe('returnRequestSchema', () => {
  it('accepts a request for one line of an order', () => {
    const parsed = returnRequestSchema.parse({
      orderNumber: ORDER,
      items: [{ orderItemId: 12, quantity: 1 }],
      reason: 'Arrived damaged',
    });
    expect(parsed.items).toEqual([{ orderItemId: 12, quantity: 1 }]);
  });

  it('needs at least one line and a real reason', () => {
    expect(() =>
      returnRequestSchema.parse({ orderNumber: ORDER, items: [], reason: 'Damaged' }),
    ).toThrow();
    expect(() =>
      returnRequestSchema.parse({
        orderNumber: ORDER,
        items: [{ orderItemId: 1, quantity: 1 }],
        reason: ' ',
      }),
    ).toThrow();
  });

  it('refuses a quantity that is not a whole number from 1 to 100', () => {
    for (const quantity of [0, -1, 1.5, 101]) {
      expect(() =>
        returnRequestSchema.parse({
          orderNumber: ORDER,
          items: [{ orderItemId: 1, quantity }],
          reason: 'Damaged',
        }),
      ).toThrow();
    }
  });

  it('refuses unknown fields, so a client cannot send its own amounts', () => {
    expect(() =>
      returnRequestSchema.parse({
        orderNumber: ORDER,
        items: [{ orderItemId: 1, quantity: 1, lineTotalMinor: 1 }],
        reason: 'Damaged',
      }),
    ).toThrow();
    expect(() =>
      returnRequestSchema.parse({
        orderNumber: ORDER,
        items: [{ orderItemId: 1, quantity: 1 }],
        reason: 'Damaged',
        refundableMinor: 999,
      }),
    ).toThrow();
  });
});

describe('return decisions and listings', () => {
  it('only allows the decisions staff can take', () => {
    expect(returnDecisionRequestSchema.parse({ status: 'approved' }).status).toBe('approved');
    expect(() => returnDecisionRequestSchema.parse({ status: 'requested' })).toThrow();
    expect(() => returnDecisionRequestSchema.parse({ status: 'shipped' })).toThrow();
  });

  it('defaults a return listing to all decisions, first page', () => {
    expect(adminReturnListQuerySchema.parse({})).toEqual({
      status: 'all',
      q: '',
      page: 1,
      pageSize: 25,
    });
  });

  it('reads a return without its optional staff-only parts', () => {
    const detail = returnDetailSchema.parse({
      id: '4b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f',
      orderNumber: ORDER,
      status: 'requested',
      itemCount: 1,
      refundableMinor: 125_000,
      reason: 'Arrived damaged',
      requestedAt: '2026-11-01T10:00:00.000Z',
      items: [
        {
          orderItemId: 12,
          productName: 'Cotton shirt',
          sku: 'SHIRT-001',
          quantity: 1,
          lineTotalMinor: 125_000,
        },
      ],
      history: [
        {
          fromStatus: null,
          toStatus: 'requested',
          actorKind: 'customer',
          note: null,
          at: '2026-11-01T10:00:00.000Z',
        },
      ],
    });
    expect(detail.items[0]?.variantLabel).toBeNull();
    expect(detail.order).toBeUndefined();
  });
});

describe('refund schemas', () => {
  it('needs a positive amount and a reason', () => {
    expect(
      refundRequestSchema.parse({ orderNumber: ORDER, amountMinor: 5_000, reason: 'Damaged item' })
        .method,
    ).toBe('cod_manual');
    expect(() =>
      refundRequestSchema.parse({ orderNumber: ORDER, amountMinor: 0, reason: 'Damaged' }),
    ).toThrow();
    expect(() =>
      refundRequestSchema.parse({ orderNumber: ORDER, amountMinor: 500, reason: ' ' }),
    ).toThrow();
  });

  it('never completes a refund without a reference', () => {
    expect(() => refundCompletionRequestSchema.parse({})).toThrow();
    expect(() => refundCompletionRequestSchema.parse({ reference: ' ' })).toThrow();
    expect(refundCompletionRequestSchema.parse({ reference: 'CASH-2026-11-001' }).reference).toBe(
      'CASH-2026-11-001',
    );
  });

  it('requires a note to reject a refund and a longer one to cancel it', () => {
    expect(refundDecisionRequestSchema.parse({ approve: true }).approve).toBe(true);
    expect(refundDecisionRequestSchema.parse({ approve: false, note: 'No proof' }).note).toBe(
      'No proof',
    );
    expect(() => refundCancelRequestSchema.parse({ note: 'nope' })).toThrow();
  });

  it('defaults a refund listing to all statuses, first page', () => {
    expect(adminRefundListQuerySchema.parse({})).toEqual({
      status: 'all',
      q: '',
      page: 1,
      pageSize: 25,
    });
  });
});
