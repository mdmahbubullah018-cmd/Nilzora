import type {
  AdminRefundListQuery,
  AdminReturnListQuery,
  MyRefund,
  RefundDetail,
  RefundRequest,
  RefundSummary,
  ReturnDetail,
  ReturnRequest,
  ReturnStatus,
  ReturnSummary,
} from '@nilzora/contracts';
import { randomUUID } from 'node:crypto';
import type { AfterSalesStore } from '../modules/after-sales/store';
import { AdminRefusalError, type AdminRefusal } from '../modules/admin/errors';
import { CommerceRefusalError } from '../modules/commerce/errors';

/** One delivered order the fake knows, with the lines a return may name. */
export interface FakeOrderLine {
  orderItemId: number;
  productName: string;
  sku: string;
  quantity: number;
  lineTotalMinor: number;
}

export interface FakeOrder {
  userId: string;
  customerName: string;
  status: string;
  totalMinor: number;
  items: FakeOrderLine[];
}

interface FakeReturn {
  id: string;
  userId: string;
  orderNumber: string;
  status: ReturnStatus;
  reason: string;
  description: string | null;
  items: { orderItemId: number; quantity: number }[];
  history: ReturnDetail['history'];
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  receivedAt: string | null;
  restockedAt: string | null;
  refundableMinor: number;
}

interface FakeRefund {
  id: string;
  userId: string;
  orderNumber: string;
  returnRequestId: string | null;
  amountMinor: number;
  method: string;
  status: string;
  reason: string;
  reference: string | null;
  note: string | null;
  requestedAt: string;
  decidedAt: string | null;
  completedAt: string | null;
  history: RefundDetail['history'];
}

const NOW = '2026-11-06T10:00:00.000Z';

/**
 * An in-memory twin of the returns and refunds SQL, for the API route tests. It enforces the
 * same rules the database does — delivered orders only, no more units than were bought, no
 * second active request for the same line, no restock before the goods arrived, no refund
 * completed without a reference, and never more than the order's remaining balance — but it
 * proves nothing about the migration itself.
 *
 * Customer methods refuse with CommerceRefusalError and staff methods with AdminRefusalError,
 * because that is what each route family maps; the real adapter translates a SQLSTATE into the
 * refusal the call site expects.
 */
export class FakeAfterSales implements AfterSalesStore {
  readonly returns = new Map<string, FakeReturn>();
  readonly refunds = new Map<string, FakeRefund>();
  /** Every call the routes made, so a test can prove a guard stopped it. */
  readonly calls: string[] = [];
  /** How many units the fake "restocked", so a test can see the inventory effect. */
  restockedUnits = 0;

  constructor(readonly orders: Record<string, FakeOrder>) {}

  private record(call: string): void {
    this.calls.push(call);
  }

  private orderOf(orderNumber: string, userId: string): FakeOrder {
    const order = this.orders[orderNumber];
    if (!order || order.userId !== userId) throw new CommerceRefusalError('order_not_found');
    return order;
  }

  private own(returnId: string, userId: string): FakeReturn {
    const request = this.returns.get(returnId);
    if (!request || request.userId !== userId)
      throw new CommerceRefusalError('return_not_eligible');
    return request;
  }

  private refuse(refusal: AdminRefusal): never {
    throw new AdminRefusalError(refusal);
  }

  private summary(request: FakeReturn): ReturnSummary {
    return {
      id: request.id,
      orderNumber: request.orderNumber,
      status: request.status,
      itemCount: request.items.reduce((total, item) => total + item.quantity, 0),
      refundableMinor: request.refundableMinor,
      reason: request.reason,
      requestedAt: request.requestedAt,
      decidedAt: request.decidedAt,
      decisionNote: request.decisionNote,
    };
  }

  private detail(request: FakeReturn): ReturnDetail {
    const order = this.orders[request.orderNumber];
    return {
      ...this.summary(request),
      description: request.description,
      receivedAt: request.receivedAt,
      restockedAt: request.restockedAt,
      items: request.items.map((item) => {
        const line = order?.items.find((candidate) => candidate.orderItemId === item.orderItemId);
        return {
          orderItemId: item.orderItemId,
          productName: line?.productName ?? 'Unknown product',
          variantLabel: null,
          sku: line?.sku ?? 'SKU',
          quantity: item.quantity,
          ...(line === undefined ? {} : { orderedQuantity: line.quantity }),
          lineTotalMinor: line?.lineTotalMinor ?? 0,
        };
      }),
      history: request.history,
      order: {
        number: request.orderNumber,
        totalMinor: order?.totalMinor ?? 0,
        status: order?.status ?? 'delivered',
        paymentStatus: 'paid',
        placedAt: NOW,
        deliveredAt: NOW,
      },
      customer: {
        id: request.userId,
        name: order?.customerName ?? null,
        phone: '01712345678',
      },
      refunds: [...this.refunds.values()]
        .filter((refund) => refund.returnRequestId === request.id)
        .map((refund) => ({
          id: refund.id,
          amountMinor: refund.amountMinor,
          status: refund.status,
          method: refund.method,
          requestedAt: refund.requestedAt,
          completedAt: refund.completedAt,
        })),
    };
  }

  private refundSummary(refund: FakeRefund): RefundSummary {
    return {
      id: refund.id,
      orderNumber: refund.orderNumber,
      customerName: this.orders[refund.orderNumber]?.customerName ?? null,
      amountMinor: refund.amountMinor,
      method: refund.method as RefundSummary['method'],
      status: refund.status as RefundSummary['status'],
      reason: refund.reason,
      requestedAt: refund.requestedAt,
      completedAt: refund.completedAt,
    };
  }

  private refundDetail(refund: FakeRefund): RefundDetail {
    const order = this.orders[refund.orderNumber];
    return {
      ...this.refundSummary(refund),
      reference: refund.reference,
      note: refund.note,
      decidedAt: refund.decidedAt,
      returnRequestId: refund.returnRequestId,
      refundableMinor: this.remainingMinor(refund.orderNumber),
      order: {
        number: refund.orderNumber,
        totalMinor: order?.totalMinor ?? 0,
        status: order?.status ?? 'delivered',
        paymentStatus: 'paid',
        placedAt: NOW,
      },
      customer: {
        id: refund.userId,
        name: order?.customerName ?? null,
        phone: '01712345678',
      },
      history: refund.history,
    };
  }

  /** What an order can still refund: its net total minus every refund not cancelled. */
  private remainingMinor(orderNumber: string): number {
    const order = this.orders[orderNumber];
    const taken = [...this.refunds.values()]
      .filter((refund) => refund.orderNumber === orderNumber && refund.status !== 'cancelled')
      .reduce((total, refund) => total + refund.amountMinor, 0);
    return Math.max(0, (order?.totalMinor ?? 0) - taken);
  }

  // Customer

  requestReturn(_accessToken: string, userId: string, input: ReturnRequest): Promise<string> {
    this.record('requestReturn');
    const order = this.orderOf(input.orderNumber, userId);
    if (order.status !== 'delivered') throw new CommerceRefusalError('return_not_eligible');

    const active = [...this.returns.values()].filter(
      (request) =>
        request.orderNumber === input.orderNumber &&
        request.status !== 'rejected' &&
        request.status !== 'cancelled',
    );
    for (const item of input.items) {
      const line = order.items.find((candidate) => candidate.orderItemId === item.orderItemId);
      if (!line) throw new CommerceRefusalError('return_quantity_exceeded');
      const already = active
        .flatMap((request) => request.items)
        .filter((existing) => existing.orderItemId === item.orderItemId)
        .reduce((total, existing) => total + existing.quantity, 0);
      if (item.quantity + already > line.quantity) {
        throw new CommerceRefusalError('return_quantity_exceeded');
      }
      if (
        active.some((request) =>
          request.items.some((existing) => existing.orderItemId === item.orderItemId),
        )
      ) {
        throw new CommerceRefusalError('return_not_eligible');
      }
    }

    const id = randomUUID();
    this.returns.set(id, {
      id,
      userId,
      orderNumber: input.orderNumber,
      status: 'requested',
      reason: input.reason,
      description: input.description ?? null,
      items: input.items.map((item) => ({ ...item })),
      history: [
        { fromStatus: null, toStatus: 'requested', actorKind: 'customer', note: null, at: NOW },
      ],
      requestedAt: NOW,
      decidedAt: null,
      decisionNote: null,
      receivedAt: null,
      restockedAt: null,
      refundableMinor: order.totalMinor,
    });
    return Promise.resolve(id);
  }

  cancelMyReturn(_accessToken: string, userId: string, returnId: string): Promise<void> {
    this.record('cancelMyReturn');
    const request = this.own(returnId, userId);
    if (request.status !== 'requested') throw new CommerceRefusalError('return_closed');
    request.status = 'cancelled';
    request.history.push({
      fromStatus: 'requested',
      toStatus: 'cancelled',
      actorKind: 'customer',
      note: null,
      at: NOW,
    });
    return Promise.resolve();
  }

  myReturns(_accessToken: string, userId: string): Promise<ReturnSummary[]> {
    this.record('myReturns');
    return Promise.resolve(
      [...this.returns.values()]
        .filter((request) => request.userId === userId)
        .map((request) => this.summary(request)),
    );
  }

  myReturn(_accessToken: string, userId: string, returnId: string): Promise<ReturnDetail | null> {
    this.record('myReturn');
    const request = this.returns.get(returnId);
    // Another customer's request answers exactly like a missing one.
    if (!request || request.userId !== userId) return Promise.resolve(null);
    return Promise.resolve(this.detail(request));
  }

  myRefunds(_accessToken: string, userId: string, orderNumber: string): Promise<MyRefund[]> {
    this.record('myRefunds');
    this.orderOf(orderNumber, userId);
    return Promise.resolve(
      [...this.refunds.values()]
        .filter((refund) => refund.orderNumber === orderNumber && refund.userId === userId)
        .map((refund) => ({
          id: refund.id,
          amountMinor: refund.amountMinor,
          method: refund.method as MyRefund['method'],
          status: refund.status as MyRefund['status'],
          reason: refund.reason,
          reference: refund.reference,
          requestedAt: refund.requestedAt,
          completedAt: refund.completedAt,
        })),
    );
  }

  // Staff

  listReturns(
    _accessToken: string,
    _userId: string,
    query: AdminReturnListQuery,
    page: { limit: number; offset: number },
  ): Promise<{ returns: ReturnSummary[]; total: number }> {
    this.record('listReturns');
    const status = query.status ?? 'all';
    const text = query.q ?? '';
    const all = [...this.returns.values()]
      .filter((request) => status === 'all' || request.status === status)
      .filter((request) => {
        if (text === '') return true;
        const name = this.orders[request.orderNumber]?.customerName ?? '';
        return (
          request.orderNumber.toLowerCase().includes(text.toLowerCase()) ||
          name.toLowerCase().includes(text.toLowerCase())
        );
      });
    return Promise.resolve({
      returns: all
        .slice(page.offset, page.offset + page.limit)
        .map((request) => this.summary(request)),
      total: all.length,
    });
  }

  getReturn(_accessToken: string, _userId: string, returnId: string): Promise<ReturnDetail | null> {
    this.record('getReturn');
    const request = this.returns.get(returnId);
    return Promise.resolve(request ? this.detail(request) : null);
  }

  decideReturn(
    _accessToken: string,
    _userId: string,
    returnId: string,
    status: Exclude<ReturnStatus, 'requested'>,
    note?: string,
  ): Promise<void> {
    this.record('decideReturn');
    const request = this.returns.get(returnId);
    if (!request) this.refuse('not_found');
    const allowed: Record<string, ReturnStatus[]> = {
      approved: ['requested'],
      rejected: ['requested'],
      received: ['approved'],
      completed: ['received'],
      cancelled: ['requested', 'approved'],
    };
    if (!allowed[status]?.includes(request.status)) this.refuse('return_closed');

    const from = request.status;
    request.status = status;
    request.decidedAt = NOW;
    if (note !== undefined) request.decisionNote = note;
    if (status === 'received') request.receivedAt = NOW;
    request.history.push({
      fromStatus: from,
      toStatus: status,
      actorKind: 'staff',
      note: note ?? null,
      at: NOW,
    });
    return Promise.resolve();
  }

  restockReturn(
    _accessToken: string,
    _userId: string,
    returnId: string,
    note?: string,
  ): Promise<number> {
    this.record('restockReturn');
    const request = this.returns.get(returnId);
    if (!request) this.refuse('not_found');
    // The goods must be in hand before anything goes back on the shelf.
    if (request.receivedAt === null) this.refuse('return_not_eligible');
    if (request.restockedAt !== null) this.refuse('return_closed');
    const units = request.items.reduce((total, item) => total + item.quantity, 0);
    this.restockedUnits += units;
    request.restockedAt = NOW;
    request.history.push({
      fromStatus: request.status,
      toStatus: request.status,
      actorKind: 'staff',
      note: note ?? null,
      at: NOW,
    });
    return Promise.resolve(units);
  }

  listRefunds(
    _accessToken: string,
    _userId: string,
    query: AdminRefundListQuery,
    page: { limit: number; offset: number },
  ): Promise<{ refunds: RefundSummary[]; total: number }> {
    this.record('listRefunds');
    const status = query.status ?? 'all';
    const text = query.q ?? '';
    const all = [...this.refunds.values()]
      .filter((refund) => status === 'all' || refund.status === status)
      .filter((refund) => {
        if (text === '') return true;
        const name = this.orders[refund.orderNumber]?.customerName ?? '';
        return (
          refund.orderNumber.toLowerCase().includes(text.toLowerCase()) ||
          name.toLowerCase().includes(text.toLowerCase())
        );
      });
    return Promise.resolve({
      refunds: all
        .slice(page.offset, page.offset + page.limit)
        .map((refund) => this.refundSummary(refund)),
      total: all.length,
    });
  }

  getRefund(_accessToken: string, _userId: string, refundId: string): Promise<RefundDetail | null> {
    this.record('getRefund');
    const refund = this.refunds.get(refundId);
    return Promise.resolve(refund ? this.refundDetail(refund) : null);
  }

  requestRefund(_accessToken: string, userId: string, input: RefundRequest): Promise<string> {
    this.record('requestRefund');
    const order = this.orders[input.orderNumber];
    if (!order) this.refuse('not_found');
    if (input.amountMinor > this.remainingMinor(input.orderNumber)) {
      this.refuse('refund_exceeds_balance');
    }
    const id = randomUUID();
    this.refunds.set(id, {
      id,
      userId: order.userId,
      orderNumber: input.orderNumber,
      returnRequestId: input.returnRequestId ?? null,
      amountMinor: input.amountMinor,
      method: input.method ?? 'cod_manual',
      status: 'requested',
      reason: input.reason,
      reference: null,
      note: null,
      requestedAt: NOW,
      decidedAt: null,
      completedAt: null,
      history: [{ fromStatus: null, toStatus: 'requested', note: null, at: NOW }],
    });
    return Promise.resolve(id);
  }

  decideRefund(
    _accessToken: string,
    _userId: string,
    refundId: string,
    approve: boolean,
    note?: string,
  ): Promise<void> {
    this.record('decideRefund');
    const refund = this.refunds.get(refundId);
    if (!refund) this.refuse('not_found');
    if (refund.status !== 'requested') this.refuse('refund_not_decidable');
    const from = refund.status;
    refund.status = approve ? 'approved' : 'rejected';
    refund.decidedAt = NOW;
    if (note !== undefined) refund.note = note;
    refund.history.push({
      fromStatus: from,
      toStatus: refund.status as RefundDetail['status'],
      note: note ?? null,
      at: NOW,
    });
    return Promise.resolve();
  }

  completeRefund(
    _accessToken: string,
    _userId: string,
    refundId: string,
    reference: string,
    note?: string,
  ): Promise<void> {
    this.record('completeRefund');
    const refund = this.refunds.get(refundId);
    if (!refund) this.refuse('not_found');
    // Approving first is what makes a payout recordable at all.
    if (refund.status !== 'approved') this.refuse('refund_not_completable');
    if (refund.amountMinor > this.remainingMinor(refund.orderNumber)) {
      this.refuse('refund_exceeds_balance');
    }
    const from = refund.status;
    refund.status = 'completed';
    refund.reference = reference;
    refund.completedAt = NOW;
    if (note !== undefined) refund.note = note;
    refund.history.push({ fromStatus: from, toStatus: 'completed', note: note ?? null, at: NOW });
    return Promise.resolve();
  }

  cancelRefund(
    _accessToken: string,
    _userId: string,
    refundId: string,
    note: string,
  ): Promise<void> {
    this.record('cancelRefund');
    const refund = this.refunds.get(refundId);
    if (!refund) this.refuse('not_found');
    if (refund.status === 'completed') this.refuse('refund_not_decidable');
    const from = refund.status;
    refund.status = 'cancelled';
    refund.note = note;
    refund.history.push({
      fromStatus: from as RefundDetail['status'],
      toStatus: 'cancelled',
      note,
      at: NOW,
    });
    return Promise.resolve();
  }

  /** Seeds a return in a chosen state, for the staff queue and refund tests. */
  seedReturn(
    orderNumber: string,
    status: ReturnStatus,
    items: { orderItemId: number; quantity: number }[] = [{ orderItemId: 1, quantity: 1 }],
  ): FakeReturn {
    const order = this.orders[orderNumber];
    if (!order) throw new Error(`unknown order ${orderNumber}`);
    const id = randomUUID();
    const request: FakeReturn = {
      id,
      userId: order.userId,
      orderNumber,
      status,
      reason: 'Arrived damaged',
      description: null,
      items,
      history: [
        { fromStatus: null, toStatus: 'requested', actorKind: 'customer', note: null, at: NOW },
      ],
      requestedAt: NOW,
      decidedAt: status === 'requested' ? null : NOW,
      decisionNote: null,
      receivedAt: status === 'received' || status === 'completed' ? NOW : null,
      restockedAt: null,
      refundableMinor: order.totalMinor,
    };
    this.returns.set(id, request);
    return request;
  }
}
