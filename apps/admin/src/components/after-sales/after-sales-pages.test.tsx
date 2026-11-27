// @vitest-environment jsdom
import type { RefundDetail, ReturnDetail } from '@nilzora/contracts';
import type { ApiClient } from '@nilzora/web-session';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RefundPage from '@/app/admin/refunds/[refundId]/page';
import RefundsPage from '@/app/admin/refunds/page';
import ReturnPage from '@/app/admin/returns/[returnId]/page';
import ReturnsPage from '@/app/admin/returns/page';
import { testUser } from '@/test/fixtures';

const api = vi.hoisted(() => ({
  adminListReturns: vi.fn(),
  adminGetReturn: vi.fn(),
  adminListRefunds: vi.fn(),
  adminGetRefund: vi.fn(),
}));
const read = vi.hoisted((): { outcome: 'ok' | 'signed_out' | 'unavailable' } => ({
  outcome: 'ok',
}));
const gate = vi.hoisted((): { value: unknown } => ({ value: undefined }));

vi.mock('@/lib/session', () => ({
  session: {
    read: async (call: (client: ApiClient, token: string) => Promise<unknown>) => {
      if (read.outcome !== 'ok') return { kind: read.outcome };
      return { kind: 'ok', value: await call(api as unknown as ApiClient, 'access-token') };
    },
  },
}));
vi.mock('@/lib/access', () => ({ workspaceGate: () => Promise.resolve(gate.value) }));
vi.mock('@/lib/actions', () => ({ signInAction: vi.fn(), signOutAction: vi.fn() }));
vi.mock('@/lib/after-sales-actions', () => ({
  decideReturnAction: vi.fn(),
  restockReturnAction: vi.fn(),
  requestRefundAction: vi.fn(),
  decideRefundAction: vi.fn(),
  completeRefundAction: vi.fn(),
  cancelRefundAction: vi.fn(),
}));
vi.mock('@/components/shell/workspace-shell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('next/navigation', async () => {
  const { throwNotFound, throwRedirect } = await import('@/test/redirect');
  return { redirect: vi.fn(throwRedirect), notFound: vi.fn(throwNotFound), usePathname: () => '/' };
});
vi.mock('next/form', () => ({
  default: ({ action, ...props }: ComponentProps<'form'> & { action: string }) => (
    <form action={action} method="get" {...props} />
  ),
}));

const csrf = { name: 'csrf_token', token: 'signed-test-token' };
const AT = '2026-11-05T10:00:00.000Z';
const RETURN_ID = '4b1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f';
const REFUND_ID = '9d1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f0f';

afterEach(cleanup);

beforeEach(() => {
  read.outcome = 'ok';
  for (const mock of Object.values(api)) mock.mockReset();
});

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
  history: [{ fromStatus: null, toStatus: 'requested', actorKind: 'customer', note: null, at: AT }],
};

const refundDetail: RefundDetail = {
  id: REFUND_ID,
  orderNumber: 'NZ100001',
  customerName: 'Rahima Khatun',
  amountMinor: 50_000,
  method: 'cod_manual',
  status: 'approved',
  reason: 'Goods returned',
  requestedAt: AT,
  completedAt: null,
  reference: null,
  note: null,
  decidedAt: AT,
  returnRequestId: RETURN_ID,
  refundableMinor: 75_000,
  order: {
    number: 'NZ100001',
    totalMinor: 125_000,
    status: 'delivered',
    paymentStatus: 'paid',
    placedAt: AT,
  },
  customer: {
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Rahima Khatun',
    phone: '01712345678',
  },
  history: [{ fromStatus: 'requested', toStatus: 'approved', note: null, at: AT }],
};

describe('ReturnsPage', () => {
  const props = (searchParams: Record<string, string> = {}) => ({
    searchParams: Promise.resolve(searchParams),
  });

  it('refuses an account without orders.read before calling the API', async () => {
    gate.value = { access: 'allowed', user: testUser('moderator'), csrf };
    render(await ReturnsPage(props()));

    expect(screen.getByRole('heading', { level: 1, name: 'Returns' })).toBeTruthy();
    expect(screen.getByText(/“View orders” permission/)).toBeTruthy();
    expect(api.adminListReturns).not.toHaveBeenCalled();
  });

  it('lists the queue with the parsed filters', async () => {
    gate.value = { access: 'allowed', user: testUser('staff'), csrf };
    api.adminListReturns.mockResolvedValue({
      returns: [returnDetail],
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
    });

    render(await ReturnsPage(props({ status: 'requested', q: 'NZ1' })));

    expect(api.adminListReturns).toHaveBeenCalledWith('access-token', {
      status: 'requested',
      q: 'NZ1',
      page: 1,
      pageSize: 25,
    });
    const table = screen.getByRole('table');
    expect(within(table).getByRole('link', { name: 'NZ100001' })).toBeTruthy();
  });

  it('shows the access gate rather than the workspace when access is unconfirmed', async () => {
    gate.value = { access: 'unavailable', csrf };
    render(await ReturnsPage(props()));
    expect(screen.getByText('We could not confirm your access')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Returns' })).toBeNull();
  });
});

describe('ReturnPage', () => {
  const props = (returnId: string) => ({ params: Promise.resolve({ returnId }) });

  it('renders the request with its item and history', async () => {
    gate.value = { access: 'allowed', user: testUser('staff'), csrf };
    api.adminGetReturn.mockResolvedValue({ return: returnDetail });

    render(await ReturnPage(props(RETURN_ID)));

    expect(api.adminGetReturn).toHaveBeenCalledWith('access-token', RETURN_ID);
    expect(screen.getByText('Colour: Red')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Return NZ100001' })).toBeTruthy();
  });

  it('answers 404 for an id that is not a uuid, without calling the API', async () => {
    gate.value = { access: 'allowed', user: testUser('staff'), csrf };
    await expect(ReturnPage(props('nope'))).rejects.toMatchObject({
      digest: 'NEXT_NOT_FOUND',
    });
    expect(api.adminGetReturn).not.toHaveBeenCalled();
  });
});

describe('RefundsPage', () => {
  const props = (searchParams: Record<string, string> = {}) => ({
    searchParams: Promise.resolve(searchParams),
  });

  it('lists the refund queue without offering a decision the caller cannot take', async () => {
    gate.value = { access: 'allowed', user: testUser('staff'), csrf };
    api.adminListRefunds.mockResolvedValue({
      refunds: [refundDetail],
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
    });

    render(await RefundsPage(props()));

    const table = screen.getByRole('table');
    expect(within(table).getByRole('link', { name: 'NZ100001' })).toBeTruthy();
    expect(within(table).getAllByText('Cash paid back by hand').length).toBeGreaterThan(0);
  });

  it('refuses an account without orders.read', async () => {
    gate.value = { access: 'allowed', user: testUser('moderator'), csrf };
    render(await RefundsPage(props()));
    expect(api.adminListRefunds).not.toHaveBeenCalled();
  });
});

describe('RefundPage', () => {
  const props = (refundId: string) => ({ params: Promise.resolve({ refundId }) });

  it('renders the refund with the manual COD explanation and remaining balance', async () => {
    gate.value = { access: 'allowed', user: testUser('admin'), csrf };
    api.adminGetRefund.mockResolvedValue({ refund: refundDetail });

    render(await RefundPage(props(REFUND_ID)));

    expect(api.adminGetRefund).toHaveBeenCalledWith('access-token', REFUND_ID);
    expect(screen.getAllByText('Cash paid back by hand').length).toBeGreaterThan(0);
  });

  it('answers 404 for a refund that is not there', async () => {
    gate.value = { access: 'allowed', user: testUser('admin'), csrf };
    await expect(RefundPage(props('nope'))).rejects.toMatchObject({ digest: 'NEXT_NOT_FOUND' });
  });
});
