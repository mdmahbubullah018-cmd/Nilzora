import { describe, expect, it } from 'vitest';
import {
  ADMIN_PRODUCT_SORTS,
  adminOrderListQuerySchema,
  adminProductListQuerySchema,
  API_ERROR_CODES,
  auditLogQuerySchema,
  codCollectionRequestSchema,
  createProductRequestSchema,
  customerStatusRequestSchema,
  INVITABLE_ROLES,
  moderationDecisionRequestSchema,
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  orderStatusChangeRequestSchema,
  permissionOverrideRequestSchema,
  staffInvitationRequestSchema,
  staffInvitationResendResponseSchema,
  stockAdjustmentRequestSchema,
  updateProductRequestSchema,
} from './index';

const CATEGORY = 'ca000000-0000-4000-8000-000000000001';
const product = {
  categoryId: CATEGORY,
  slug: 'desk-lamp',
  sku: 'desk-lamp',
  name: ' Desk Lamp ',
  priceMinor: 10_000,
};

describe('admin product requests', () => {
  it('normalises a new product and applies defaults', () => {
    expect(createProductRequestSchema.parse({ ...product, summary: '  ' })).toStrictEqual({
      ...product,
      sku: 'DESK-LAMP',
      name: 'Desk Lamp',
      summary: null,
      maxOrderQuantity: 10,
      isFeatured: false,
      initialStock: 0,
    });
  });

  it.each([
    ['status', { status: 'active' }],
    ['moderationStatus', { moderationStatus: 'approved' }],
    ['stockQuantity', { stockQuantity: 5 }],
    ['createdBy', { createdBy: CATEGORY }],
    ['publishedAt', { publishedAt: '2026-10-25T08:00:00.000Z' }],
  ])('refuses a client-set %s', (_label, extra) => {
    expect(createProductRequestSchema.safeParse({ ...product, ...extra }).success).toBe(false);
    const { sku: _sku, ...update } = product;
    expect(updateProductRequestSchema.safeParse({ ...update, ...extra }).success).toBe(false);
  });

  it('never changes the SKU on update', () => {
    expect(updateProductRequestSchema.safeParse(product).success).toBe(false);
  });

  it('requires a former price above the price', () => {
    expect(
      createProductRequestSchema.safeParse({ ...product, compareAtPriceMinor: 10_000 }).success,
    ).toBe(false);
    expect(
      createProductRequestSchema.safeParse({ ...product, compareAtPriceMinor: 10_001 }).success,
    ).toBe(true);
  });

  it('takes stock changes only as signed, explained adjustments', () => {
    expect(stockAdjustmentRequestSchema.safeParse({ change: 0, note: 'Recount' }).success).toBe(
      false,
    );
    expect(stockAdjustmentRequestSchema.safeParse({ change: -3, note: 'ok' }).success).toBe(false);
    expect(stockAdjustmentRequestSchema.parse({ change: -3, note: ' Recount ' })).toStrictEqual({
      change: -3,
      note: 'Recount',
    });
  });
});

describe('admin order requests', () => {
  it('lists a transition table covering every status', () => {
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...ORDER_STATUSES].sort());
    expect(ORDER_TRANSITIONS.shipped).not.toContain('cancelled');
  });

  it('needs a reason to cancel and never moves an order back to pending', () => {
    expect(orderStatusChangeRequestSchema.safeParse({ status: 'cancelled' }).success).toBe(false);
    expect(orderStatusChangeRequestSchema.safeParse({ status: 'pending' }).success).toBe(false);
    expect(
      orderStatusChangeRequestSchema.parse({ status: 'cancelled', note: ' Asked by phone ' }),
    ).toStrictEqual({ status: 'cancelled', note: 'Asked by phone' });
    expect(orderStatusChangeRequestSchema.parse({ status: 'shipped', note: '' })).toStrictEqual({
      status: 'shipped',
      note: undefined,
    });
  });

  it('takes only the collected amount for COD collection', () => {
    expect(codCollectionRequestSchema.safeParse({ amountMinor: 16_000 }).success).toBe(true);
    expect(
      codCollectionRequestSchema.safeParse({ amountMinor: 16_000, paymentStatus: 'collected' })
        .success,
    ).toBe(false);
  });
});

describe('admin account requests', () => {
  it('never invites owners or customers', () => {
    expect(INVITABLE_ROLES).toEqual(['admin', 'staff', 'moderator']);
    for (const role of ['super_admin', 'customer']) {
      expect(staffInvitationRequestSchema.safeParse({ email: 'a@example.com', role }).success).toBe(
        false,
      );
    }
  });

  it('refuses extra invitation fields such as permissions or a redirect', () => {
    for (const extra of [{ permissions: ['orders.read'] }, { redirectTo: 'https://evil.test' }]) {
      expect(
        staffInvitationRequestSchema.safeParse({ email: 'a@example.com', role: 'staff', ...extra })
          .success,
      ).toBe(false);
    }
  });

  it('takes known permissions only, with null clearing an override', () => {
    expect(
      permissionOverrideRequestSchema.safeParse({ permission: 'orders.read', effect: null })
        .success,
    ).toBe(true);
    expect(
      permissionOverrideRequestSchema.safeParse({ permission: 'root', effect: 'grant' }).success,
    ).toBe(false);
  });

  it('needs a reason to suspend a customer', () => {
    expect(customerStatusRequestSchema.safeParse({ status: 'suspended' }).success).toBe(false);
    expect(customerStatusRequestSchema.safeParse({ status: 'active' }).success).toBe(true);
  });
});

describe('moderation and audit requests', () => {
  it('needs an explanation for anything but an approval', () => {
    expect(moderationDecisionRequestSchema.safeParse({ decision: 'approved' }).success).toBe(true);
    expect(moderationDecisionRequestSchema.safeParse({ decision: 'rejected' }).success).toBe(false);
    expect(moderationDecisionRequestSchema.safeParse({ decision: 'withdrawn' }).success).toBe(
      false,
    );
  });

  it('filters the audit log by a plain action prefix only', () => {
    expect(auditLogQuerySchema.safeParse({ action: 'order.' }).success).toBe(true);
    expect(auditLogQuerySchema.safeParse({ action: 'order%' }).success).toBe(false);
  });

  it('declares every admin error code the API answers with', () => {
    for (const code of [
      'product_content_locked',
      'product_under_review',
      'product_not_approved',
      'stock_below_zero',
      'invalid_status_transition',
      'payment_not_collectable',
      'collection_amount_mismatch',
      'review_closed',
      'review_not_assignable',
      'own_submission',
      'cannot_change_self',
      'account_not_manageable',
      'slug_taken',
      'sku_taken',
      'account_exists',
      'invitation_invalid',
    ]) {
      expect(API_ERROR_CODES).toContain(code);
    }
  });
});

describe('admin list queries', () => {
  it('sorts products by recent change unless asked, accepting only known orders', () => {
    expect(adminProductListQuerySchema.parse({}).sort).toBe('updated_desc');
    for (const sort of ADMIN_PRODUCT_SORTS) {
      expect(adminProductListQuerySchema.parse({ sort }).sort).toBe(sort);
    }
    expect(adminProductListQuerySchema.safeParse({ sort: 'price' }).success).toBe(false);
    expect(adminProductListQuerySchema.safeParse({ sort: 'id; drop' }).success).toBe(false);
  });

  it("filters orders by one customer's id", () => {
    expect(adminOrderListQuerySchema.parse({ customerId: CATEGORY }).customerId).toBe(CATEGORY);
    expect(adminOrderListQuerySchema.safeParse({ customerId: 'rahima' }).success).toBe(false);
  });
});

describe('staff invitations', () => {
  it('describes a re-sent invitation by account and address only', () => {
    const resent = { invitation: { userId: CATEGORY, email: 'nadia@example.com' } };
    expect(staffInvitationResendResponseSchema.parse(resent)).toStrictEqual(resent);
    expect(API_ERROR_CODES).toContain('invitation_accepted');
  });
});
