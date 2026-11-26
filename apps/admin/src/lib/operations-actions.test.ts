import { ApiError, type ApiClient, type FormState } from '@nilzora/web-session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedirectSignal, throwRedirect } from '@/test/redirect';
import { setCustomerStatusAction } from './customer-actions';
import { assignReviewAction, decideReviewAction, withdrawReviewAction } from './moderation-actions';
import { changeOrderStatusAction, recordCodCollectionAction } from './order-actions';
import { setDeliveryChargeAction } from './settings-actions';
import {
  changeRoleAction,
  inviteStaffAction,
  resendInvitationAction,
  setPermissionAction,
} from './staff-actions';

type Outcome = 'ok' | 'untrusted' | 'signed_out' | 'unavailable';

const api = vi.hoisted(() => ({
  adminUpdateOrderStatus: vi.fn(),
  adminRecordCodCollection: vi.fn(),
  adminSetCustomerStatus: vi.fn(),
  adminInviteStaff: vi.fn(),
  assignRole: vi.fn(),
  adminSetPermission: vi.fn(),
  resendStaffInvitation: vi.fn(),
  adminAssignModeration: vi.fn(),
  adminWithdrawModeration: vi.fn(),
  moderatorDecide: vi.fn(),
  adminSetDeliveryCharge: vi.fn(),
}));
const act = vi.hoisted((): { outcome: Outcome; calls: number } => ({ outcome: 'ok', calls: 0 }));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('@/lib/session', () => ({
  session: {
    // The real act() checks Origin + CSRF, then runs the call with the session's token.
    act: async (_formData: FormData, call: (client: ApiClient, token: string) => unknown) => {
      act.calls += 1;
      if (act.outcome !== 'ok') return { kind: act.outcome };
      return { kind: 'ok', value: await call(api as unknown as ApiClient, 'access-token') };
    },
  },
}));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(throwRedirect) }));

const IDLE: FormState = { status: 'idle' };
const ORDER = 'NZ100042';
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OTHER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** Where a successful action redirected to (it throws, like next/navigation's redirect). */
async function redirectOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.catch((e: unknown) => e);
  if (!(error instanceof RedirectSignal)) throw new Error('expected a redirect');
  return error.url;
}

function refusal(status: number, code: string): ApiError {
  return new ApiError(status, code, 'API text that must not reach the browser', 'req-1');
}

beforeEach(() => {
  act.outcome = 'ok';
  act.calls = 0;
  revalidatePath.mockReset();
  for (const fn of Object.values(api)) fn.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('every action', () => {
  const cases = [
    [
      'order status',
      () => changeOrderStatusAction(IDLE, form({ orderNumber: ORDER, status: 'confirmed' })),
    ],
    [
      'customer status',
      () => setCustomerStatusAction(IDLE, form({ customerId: ID, status: 'active' })),
    ],
    ['role', () => changeRoleAction(IDLE, form({ userId: ID, role: 'staff' }))],
    ['invitation resend', () => resendInvitationAction(IDLE, form({ userId: ID }))],
    ['assignment', () => assignReviewAction(IDLE, form({ taskId: ID, moderatorId: OTHER_ID }))],
    [
      'delivery charge',
      () => setDeliveryChargeAction(IDLE, form({ zone: 'inside_dhaka', amount: '80' })),
    ],
  ] as const;

  it.each(cases)('%s: an untrusted form reaches no API', async (_name, run) => {
    act.outcome = 'untrusted';
    const state = await run();
    expect(state.status).toBe('error');
    expect(state.message).toMatch(/expired/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each(cases)('%s: a lapsed session goes to sign in', async (_name, run) => {
    act.outcome = 'signed_out';
    const error = await run().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RedirectSignal);
    expect((error as RedirectSignal).url).toMatch(/^\/login\?next=%2F(admin|moderator)/);
  });

  it.each(cases)('%s: an unreachable API is reported as unconfirmed', async (_name, run) => {
    act.outcome = 'unavailable';
    const state = await run();
    expect(state.message).toMatch(/could not be confirmed/);
  });
});

describe('changeOrderStatusAction', () => {
  it('sends the step, refreshes the order and returns to it with a notice', async () => {
    api.adminUpdateOrderStatus.mockResolvedValue({ order: { status: 'confirmed' } });
    const url = await redirectOf(
      changeOrderStatusAction(
        IDLE,
        form({ orderNumber: ORDER, status: 'confirmed', note: ' Called the customer ' }),
      ),
    );
    expect(api.adminUpdateOrderStatus).toHaveBeenCalledWith('access-token', ORDER, {
      status: 'confirmed',
      note: 'Called the customer',
    });
    expect(url).toBe(`/admin/orders/${ORDER}?notice=confirmed`);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/orders/${ORDER}`);
  });

  it('needs a cancellation reason of at least 5 characters before calling the API', async () => {
    const state = await changeOrderStatusAction(
      IDLE,
      form({ orderNumber: ORDER, status: 'cancelled', note: 'no' }),
    );
    expect(state.fieldErrors?.note).toMatch(/5 to 300/);
    expect(act.calls).toBe(0);
  });

  it('refuses a malformed order number and pending as a target', async () => {
    expect(
      (await changeOrderStatusAction(IDLE, form({ orderNumber: '../x', status: 'confirmed' })))
        .status,
    ).toBe('error');
    expect(
      (await changeOrderStatusAction(IDLE, form({ orderNumber: ORDER, status: 'pending' }))).status,
    ).toBe('error');
    expect(act.calls).toBe(0);
  });

  it('maps API refusals to fixed messages', async () => {
    api.adminUpdateOrderStatus.mockRejectedValue(refusal(409, 'invalid_status_transition'));
    const moved = await changeOrderStatusAction(
      IDLE,
      form({ orderNumber: ORDER, status: 'shipped' }),
    );
    expect(moved.message).toMatch(/moved on/);
    // The failure names its step, so only that step's panel shows it.
    expect(moved.values?.status).toBe('shipped');

    api.adminUpdateOrderStatus.mockRejectedValue(refusal(403, 'forbidden'));
    const denied = await changeOrderStatusAction(
      IDLE,
      form({ orderNumber: ORDER, status: 'shipped' }),
    );
    expect(denied.message).toMatch(/permission/);
    expect(denied.message).not.toMatch(/API text/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('recordCodCollectionAction', () => {
  it('sends the typed amount in poisha', async () => {
    api.adminRecordCodCollection.mockResolvedValue({ order: { totalMinor: 125_050 } });
    const url = await redirectOf(
      recordCodCollectionAction(IDLE, form({ orderNumber: ORDER, amount: '1,250.50' })),
    );
    expect(api.adminRecordCodCollection).toHaveBeenCalledWith('access-token', ORDER, {
      amountMinor: 125_050,
    });
    expect(url).toBe(`/admin/orders/${ORDER}?notice=cash_collected`);
  });

  it('refuses a non-amount and explains a mismatch', async () => {
    const bad = await recordCodCollectionAction(IDLE, form({ orderNumber: ORDER, amount: 'lots' }));
    expect(bad.fieldErrors?.amount).toBeDefined();
    expect(act.calls).toBe(0);

    api.adminRecordCodCollection.mockRejectedValue(refusal(409, 'collection_amount_mismatch'));
    const mismatch = await recordCodCollectionAction(
      IDLE,
      form({ orderNumber: ORDER, amount: '10' }),
    );
    expect(mismatch.message).toMatch(/differs from the order total/);
  });
});

describe('setCustomerStatusAction', () => {
  it('needs a reason to suspend', async () => {
    const state = await setCustomerStatusAction(
      IDLE,
      form({ customerId: ID, status: 'suspended', reason: 'x' }),
    );
    expect(state.fieldErrors?.reason).toBeDefined();
    expect(act.calls).toBe(0);
  });

  it('suspends with the reason and maps refusals', async () => {
    api.adminSetCustomerStatus.mockResolvedValue({ customer: { status: 'suspended' } });
    const state = await setCustomerStatusAction(
      IDLE,
      form({ customerId: ID, status: 'suspended', reason: 'Repeated fake orders' }),
    );
    expect(api.adminSetCustomerStatus).toHaveBeenCalledWith('access-token', ID, {
      status: 'suspended',
      reason: 'Repeated fake orders',
    });
    expect(state.status).toBe('success');

    api.adminSetCustomerStatus.mockRejectedValue(refusal(403, 'account_not_manageable'));
    const staff = await setCustomerStatusAction(IDLE, form({ customerId: ID, status: 'active' }));
    expect(staff.message).toMatch(/Only customer accounts/);
  });
});

describe('staff actions', () => {
  it('invites with only the contract fields and reports an existing account on the email', async () => {
    api.adminInviteStaff.mockResolvedValue({
      invitation: {
        id: ID,
        email: 'new@example.test',
        role: 'moderator',
        expiresAt: '2030-01-10T08:00:00.000Z',
      },
      emailSent: true,
    });
    const sent = await inviteStaffAction(
      IDLE,
      form({ email: 'New@Example.test', role: 'moderator', fullName: '', permissions: 'all' }),
    );
    expect(api.adminInviteStaff).toHaveBeenCalledWith('access-token', {
      email: 'new@example.test',
      role: 'moderator',
    });
    expect(sent.status).toBe('success');
    expect(sent.message).toMatch(/Invitation sent to new@example.test as Moderator/);
    // The wording says plainly that nothing is created until it is accepted.
    expect(sent.message).toMatch(/until they accept/);

    api.adminInviteStaff.mockRejectedValue(refusal(409, 'account_exists'));
    const exists = await inviteStaffAction(
      IDLE,
      form({ email: 'old@example.test', role: 'staff' }),
    );
    expect(exists.fieldErrors?.email).toMatch(/already has an account/);
  });

  it('says so, and keeps the invitation, when the email could not be sent', async () => {
    api.adminInviteStaff.mockResolvedValue({
      invitation: {
        id: ID,
        email: 'new@example.test',
        role: 'staff',
        expiresAt: '2030-01-10T08:00:00.000Z',
      },
      emailSent: false,
    });
    const state = await inviteStaffAction(IDLE, form({ email: 'new@example.test', role: 'staff' }));
    expect(state.status).toBe('error');
    expect(state.message).toMatch(/saved, but the email could not be sent/);
  });

  it('reports a duplicate or already-staffed address in the store words', async () => {
    api.adminInviteStaff.mockRejectedValue(refusal(409, 'invitation_accepted'));
    const state = await inviteStaffAction(IDLE, form({ email: 'a@example.test', role: 'staff' }));
    expect(state.status).toBe('error');
    expect(state.message).toMatch(/already has a team account, or an invitation/);
  });

  it('refuses owners as an invitation role before calling the API', async () => {
    const state = await inviteStaffAction(
      IDLE,
      form({ email: 'a@example.test', role: 'super_admin' }),
    );
    expect(state.fieldErrors?.role).toBeDefined();
    expect(act.calls).toBe(0);
  });

  it('changes roles and explains a refused change', async () => {
    api.assignRole.mockResolvedValue({ userId: ID, role: 'moderator' });
    expect((await changeRoleAction(IDLE, form({ userId: ID, role: 'moderator' }))).message).toBe(
      'The role is now Moderator.',
    );
    api.assignRole.mockRejectedValue(refusal(403, 'forbidden'));
    expect((await changeRoleAction(IDLE, form({ userId: ID, role: 'admin' }))).message).toMatch(
      /only an owner manages admins/,
    );
  });

  it('sends a customer-bound member back to the team list with a notice', async () => {
    api.assignRole.mockResolvedValue({ userId: ID, role: 'customer' });
    expect(await redirectOf(changeRoleAction(IDLE, form({ userId: ID, role: 'customer' })))).toBe(
      '/admin/staff?notice=removed',
    );
  });

  it('resends an invitation and returns to the member with a notice', async () => {
    api.resendStaffInvitation.mockResolvedValue({
      invitation: { userId: ID, email: 'new@example.test' },
    });
    expect(await redirectOf(resendInvitationAction(IDLE, form({ userId: ID })))).toBe(
      `/admin/staff/${ID}?notice=invitation_resent`,
    );
    expect(api.resendStaffInvitation).toHaveBeenCalledWith('access-token', ID);
  });

  it.each([
    [409, 'invitation_accepted', /already accepted/],
    [429, 'rate_limited', /Wait a few minutes/],
    [404, 'not_found', /no pending invitation/],
    [403, 'forbidden', /“Invite staff” permission/],
  ] as const)('maps a %d %s resend refusal', async (status, code, message) => {
    api.resendStaffInvitation.mockRejectedValue(refusal(status, code));
    const state = await resendInvitationAction(IDLE, form({ userId: ID }));
    expect(state.status).toBe('error');
    expect(state.message).toMatch(message);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses a malformed account id before any API call', async () => {
    expect((await resendInvitationAction(IDLE, form({ userId: '../me' }))).status).toBe('error');
    expect(act.calls).toBe(0);
  });

  it('turns "default" into clearing the override', async () => {
    api.adminSetPermission.mockResolvedValue({ member: {} });
    await setPermissionAction(
      IDLE,
      form({ userId: ID, permission: 'orders.cancel', effect: 'default' }),
    );
    expect(api.adminSetPermission).toHaveBeenCalledWith('access-token', ID, {
      permission: 'orders.cancel',
      effect: null,
    });

    api.adminSetPermission.mockRejectedValue(refusal(403, 'cannot_change_self'));
    const self = await setPermissionAction(
      IDLE,
      form({ userId: ID, permission: 'orders.cancel', effect: 'grant' }),
    );
    expect(self.message).toMatch(/your own permissions/);

    const unknown = await setPermissionAction(
      IDLE,
      form({ userId: ID, permission: 'root.everything', effect: 'grant' }),
    );
    expect(unknown.status).toBe('error');
  });
});

describe('moderation actions', () => {
  it('assigns, returns to a rebuilt list address, and explains the refusal', async () => {
    api.adminAssignModeration.mockResolvedValue({ task: {} });
    const back = await redirectOf(
      assignReviewAction(
        IDLE,
        form({
          taskId: ID,
          moderatorId: OTHER_ID,
          returnTo: '/admin/moderation?scope=unassigned&status=bogus&evil=1',
        }),
      ),
    );
    expect(back).toBe('/admin/moderation?scope=unassigned&notice=assigned');
    const offsite = await redirectOf(
      assignReviewAction(
        IDLE,
        form({ taskId: ID, moderatorId: OTHER_ID, returnTo: 'https://evil.example/admin' }),
      ),
    );
    expect(offsite).toBe('/admin/moderation?notice=assigned');

    api.adminAssignModeration.mockRejectedValue(refusal(409, 'own_submission'));
    const own = await assignReviewAction(IDLE, form({ taskId: ID, moderatorId: OTHER_ID }));
    expect(own.message).toMatch(/submitted or last edited/);
  });

  it('withdraws to the review page with a notice, and reports refusals', async () => {
    api.adminWithdrawModeration.mockResolvedValue({ task: {} });
    expect(await redirectOf(withdrawReviewAction(IDLE, form({ taskId: ID })))).toBe(
      `/admin/moderation/${ID}?notice=withdrawn`,
    );
    api.adminWithdrawModeration.mockRejectedValue(refusal(403, 'forbidden'));
    expect((await withdrawReviewAction(IDLE, form({ taskId: ID }))).message).toMatch(
      /Only the person who submitted/,
    );
    api.adminWithdrawModeration.mockRejectedValue(refusal(409, 'review_closed'));
    const state = await withdrawReviewAction(IDLE, form({ taskId: ID }));
    expect(state.message).toMatch(/already decided/);
  });

  it('needs a 10-character note unless approving', async () => {
    const short = await decideReviewAction(
      IDLE,
      form({ taskId: ID, decision: 'rejected', note: 'too short' }),
    );
    expect(short.fieldErrors?.note).toMatch(/10 to 1,000/);
    expect(act.calls).toBe(0);

    api.moderatorDecide.mockResolvedValue({ task: { status: 'approved' } });
    const approved = await redirectOf(
      decideReviewAction(IDLE, form({ taskId: ID, decision: 'approved' })),
    );
    expect(api.moderatorDecide).toHaveBeenCalledWith('access-token', ID, { decision: 'approved' });
    expect(approved).toBe(`/moderator/tasks/${ID}?notice=approved`);
    expect(revalidatePath).toHaveBeenCalledWith(`/moderator/tasks/${ID}`);
  });

  it('treats another moderator’s review as not assigned', async () => {
    api.moderatorDecide.mockRejectedValue(refusal(404, 'not_found'));
    const state = await decideReviewAction(IDLE, form({ taskId: ID, decision: 'approved' }));
    expect(state.message).toMatch(/not assigned to you/);
  });
});

describe('setDeliveryChargeAction', () => {
  it('validates the zone and the range', async () => {
    expect((await setDeliveryChargeAction(IDLE, form({ zone: 'mars', amount: '80' }))).status).toBe(
      'error',
    );
    const tooMuch = await setDeliveryChargeAction(
      IDLE,
      form({ zone: 'inside_dhaka', amount: '100001' }),
    );
    expect(tooMuch.fieldErrors?.amount).toBeDefined();
    expect(act.calls).toBe(0);
  });

  it('saves taka as poisha', async () => {
    api.adminSetDeliveryCharge.mockResolvedValue({
      charge: { zone: 'outside_dhaka', amountMinor: 13_000, updatedAt: null },
    });
    const state = await setDeliveryChargeAction(
      IDLE,
      form({ zone: 'outside_dhaka', amount: '130' }),
    );
    expect(api.adminSetDeliveryCharge).toHaveBeenCalledWith('access-token', 'outside_dhaka', {
      amountMinor: 13_000,
    });
    expect(state.message).toBe('Outside Dhaka delivery is now ৳130.');
  });
});
