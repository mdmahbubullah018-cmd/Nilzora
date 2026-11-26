import { randomUUID } from 'node:crypto';
import {
  customerListResponseSchema,
  customerResponseSchema,
  meResponseSchema,
  staffInvitationResendResponseSchema,
  staffInvitationResponseSchema,
  staffListResponseSchema,
  staffMemberResponseSchema,
} from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import { AuthGatewayError } from '../modules/auth/gateway';
import { adminSetup, errorOf, type AdminSetup, type Who } from './admin-helpers';

describe('GET /api/v1/admin/customers', () => {
  it('lists customer accounts only, never staff', async () => {
    const setup = adminSetup();
    const response = await setup.call('get', '/admin/customers', 'staff');

    expect(response.status).toBe(200);
    const page = customerListResponseSchema.parse(response.body);
    expect(page.total).toBe(2);
    expect(page.customers.map((customer) => customer.email).sort()).toEqual([
      'karim@example.com',
      'rahima@example.com',
    ]);
    expect(
      page.customers.find((customer) => customer.email === 'rahima@example.com'),
    ).toMatchObject({
      fullName: 'Rahima Khatun',
      orderCount: 3,
    });
  });

  it('searches and filters by status', async () => {
    const setup = adminSetup();
    setup.users.otherCustomer.status = 'suspended';
    const search = await setup.call('get', '/admin/customers?q=RAHIMA', 'staff');
    const suspended = await setup.call('get', '/admin/customers?status=suspended', 'staff');

    expect(customerListResponseSchema.parse(search.body).customers.map((c) => c.email)).toEqual([
      'rahima@example.com',
    ]);
    expect(customerListResponseSchema.parse(suspended.body).customers.map((c) => c.email)).toEqual([
      'karim@example.com',
    ]);
  });

  it('rejects an unknown status filter', async () => {
    const setup = adminSetup();
    const response = await setup.call('get', '/admin/customers?status=banned', 'staff');

    expect(response.status).toBe(400);
  });
});

describe('GET /api/v1/admin/customers/:customerId', () => {
  it('shows the customer with recent orders for callers who may see orders', async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'get',
      `/admin/customers/${setup.users.customer.id}`,
      'staff',
    );

    const { customer } = customerResponseSchema.parse(response.body);
    expect(customer.email).toBe('rahima@example.com');
    expect(customer.recentOrders?.map((order) => order.status)).toEqual([
      'delivered',
      'shipped',
      'pending',
    ]);
  });

  it('leaves recent orders out (null) without orders.read', async () => {
    const setup = adminSetup();
    setup.deny('staff', 'orders.read');
    const response = await setup.call(
      'get',
      `/admin/customers/${setup.users.customer.id}`,
      'staff',
    );

    expect(customerResponseSchema.parse(response.body).customer.recentOrders).toBeNull();
    expect(setup.admin.calls).not.toContain('listOrders');
  });

  it.each<[string, (setup: AdminSetup) => string]>([
    ['an unknown account', () => randomUUID()],
    ['a staff account', (setup) => setup.users.staff.id],
  ])('answers 404 for %s', async (_label, id) => {
    const setup = adminSetup();
    const response = await setup.call('get', `/admin/customers/${id(setup)}`, 'admin');

    expect(response.status).toBe(404);
    expect(errorOf(response.body).message).toBe('Customer not found');
  });
});

describe('POST /api/v1/admin/customers/:customerId/status', () => {
  it('suspends a customer, whose very next request is refused, and reactivates them', async () => {
    const setup = adminSetup();
    const { customer } = setup.users;
    const before = await setup.call('get', '/me', 'customer');
    const suspended = await setup.call('post', `/admin/customers/${customer.id}/status`, 'admin', {
      status: 'suspended',
      reason: '  Repeated fake orders ',
    });
    const blocked = await setup.call('get', '/me', 'customer');
    const reactivated = await setup.call(
      'post',
      `/admin/customers/${customer.id}/status`,
      'admin',
      {
        status: 'active',
      },
    );
    const after = await setup.call('get', '/me', 'customer');

    expect(before.status).toBe(200);
    expect(suspended.status).toBe(200);
    expect(customerResponseSchema.parse(suspended.body).customer.status).toBe('suspended');
    expect(blocked.status).toBe(403);
    expect(errorOf(blocked.body).code).toBe('account_suspended');
    expect(reactivated.status).toBe(200);
    expect(meResponseSchema.parse(after.body).user.id).toBe(customer.id);
    expect(setup.admin.audit.map((entry) => [entry.action, entry.actorId])).toEqual([
      ['customer.status_changed', setup.users.admin.id],
      ['customer.status_changed', setup.users.admin.id],
    ]);
  });

  it.each([
    ['no reason', { status: 'suspended' }],
    ['a short reason', { status: 'suspended', reason: 'bad' }],
    ['an unknown status', { status: 'banned', reason: 'Repeated fake orders' }],
    ['a role', { status: 'active', role: 'admin' }],
  ])('rejects a suspension with %s', async (_label, body) => {
    const setup = adminSetup();
    const response = await setup.call(
      'post',
      `/admin/customers/${setup.users.customer.id}/status`,
      'admin',
      body,
    );

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(setup.users.customer.status).toBe('active');
  });

  it.each<[string, (setup: AdminSetup) => string, Who, number, string]>([
    ['a staff account (NZ404)', (s) => s.users.staff.id, 'admin', 404, 'not_found'],
    ['an unknown account (NZ404)', () => randomUUID(), 'admin', 404, 'not_found'],
    ['their own account (NZ438)', (s) => s.users.admin.id, 'admin', 403, 'cannot_change_self'],
  ])('refuses %s', async (_label, target, who, status, code) => {
    const setup = adminSetup();
    const response = await setup.call('post', `/admin/customers/${target(setup)}/status`, who, {
      status: 'suspended',
      reason: 'Repeated fake orders',
    });

    expect(response.status).toBe(status);
    expect(errorOf(response.body).code).toBe(code);
  });
});

describe('GET /api/v1/admin/staff', () => {
  it('lists staff accounts (owners first) with overrides and every permission', async () => {
    const setup = adminSetup();
    setup.users.staff.overrides.set('orders.cancel', 'grant');
    setup.deny('staff', 'customers.read');
    const response = await setup.call('get', '/admin/staff', 'admin');

    const { staff, permissions } = staffListResponseSchema.parse(response.body);
    expect(staff.map((member) => member.role)).toEqual([
      'super_admin',
      'admin',
      'staff',
      'moderator',
      'moderator',
    ]);
    const member = staff.find((candidate) => candidate.id === setup.users.staff.id);
    expect(member?.overrides).toEqual([
      { permission: 'orders.cancel', effect: 'grant' },
      { permission: 'customers.read', effect: 'deny' },
    ]);
    expect(member?.permissions).toContain('orders.cancel');
    expect(member?.permissions).not.toContain('customers.read');
    expect(permissions.length).toBeGreaterThan(20);
  });
});

describe('PUT /api/v1/admin/staff/:userId/permissions', () => {
  const put = (setup: AdminSetup, who: Who, target: string, body: object) =>
    setup.call('put', `/admin/staff/${target}/permissions`, who, body);

  it('applies a grant and a denial to the account’s very next request', async () => {
    const setup = adminSetup();
    const { staff } = setup.users;
    const before = await setup.call('get', '/admin/audit-log', 'staff');
    const granted = await put(setup, 'admin', staff.id, {
      permission: 'audit_logs.read',
      effect: 'grant',
    });
    const after = await setup.call('get', '/admin/audit-log', 'staff');
    await put(setup, 'admin', staff.id, { permission: 'orders.read', effect: 'deny' });
    const denied = await setup.call('get', '/admin/orders', 'staff');
    const cleared = await put(setup, 'admin', staff.id, {
      permission: 'orders.read',
      effect: null,
    });
    const restored = await setup.call('get', '/admin/orders', 'staff');

    expect(before.status).toBe(403);
    expect(granted.status).toBe(200);
    expect(staffMemberResponseSchema.parse(granted.body).member).toMatchObject({
      id: staff.id,
      overrides: [{ permission: 'audit_logs.read', effect: 'grant' }],
    });
    expect(after.status).toBe(200);
    expect(denied.status).toBe(403);
    expect(staffMemberResponseSchema.parse(cleared.body).member.overrides).toEqual([
      { permission: 'audit_logs.read', effect: 'grant' },
    ]);
    expect(restored.status).toBe(200);
  });

  it('lets a denial win over the role default and over a grant', async () => {
    const setup = adminSetup();
    const { staff } = setup.users;
    await put(setup, 'admin', staff.id, { permission: 'orders.read', effect: 'grant' });
    await put(setup, 'admin', staff.id, { permission: 'orders.read', effect: 'deny' });
    const me = await setup.call('get', '/me', 'staff');

    expect(meResponseSchema.parse(me.body).user.permissions).not.toContain('orders.read');
    expect((await setup.call('get', '/admin/orders', 'staff')).status).toBe(403);
  });

  it.each<[string, Who, (setup: AdminSetup) => string, object, number, string]>([
    [
      'an admin granting what it does not hold (NZ403)',
      'admin',
      (s) => s.users.staff.id,
      { permission: 'settings.manage', effect: 'grant' },
      403,
      'forbidden',
    ],
    [
      'an admin changing an owner (NZ439)',
      'admin',
      (s) => s.users.owner.id,
      { permission: 'orders.read', effect: 'deny' },
      403,
      'account_not_manageable',
    ],
    [
      'a customer account, which holds no permissions (NZ439)',
      'owner',
      (s) => s.users.customer.id,
      { permission: 'orders.read', effect: 'grant' },
      403,
      'account_not_manageable',
    ],
    [
      'anyone changing themselves (NZ438)',
      'admin',
      (s) => s.users.admin.id,
      { permission: 'orders.read', effect: 'deny' },
      403,
      'cannot_change_self',
    ],
    [
      'an unknown account (NZ404)',
      'admin',
      () => randomUUID(),
      { permission: 'orders.read', effect: 'grant' },
      404,
      'not_found',
    ],
  ])('refuses %s', async (_label, who, target, body, status, code) => {
    const setup = adminSetup();
    const response = await put(setup, who, target(setup), body);

    expect(response.status).toBe(status);
    expect(errorOf(response.body).code).toBe(code);
    expect(setup.admin.audit).toEqual([]);
  });

  it('lets an owner manage an admin', async () => {
    const setup = adminSetup();
    const response = await put(setup, 'owner', setup.users.admin.id, {
      permission: 'finance.read',
      effect: 'deny',
    });

    expect(response.status).toBe(200);
    expect((await setup.call('get', '/admin/analytics/sales', 'admin')).status).toBe(403);
  });

  it.each([
    ['an unknown permission', { permission: 'everything', effect: 'grant' }],
    ['an unknown effect', { permission: 'orders.read', effect: 'allow' }],
    ['a missing effect', { permission: 'orders.read' }],
    ['a role', { permission: 'orders.read', effect: 'grant', role: 'admin' }],
    ['a granting account', { permission: 'orders.read', effect: 'grant', grantedBy: randomUUID() }],
  ])('rejects %s', async (_label, body) => {
    const setup = adminSetup();
    const response = await put(setup, 'admin', setup.users.staff.id, body);

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(setup.admin.calls).toEqual([]);
  });
});

describe('POST /api/v1/admin/staff/invitations', () => {
  const invite = (setup: AdminSetup, who: Who, body: object) =>
    setup.call('post', '/admin/staff/invitations', who, body);

  it('invites through Supabase Auth with the admin app link, then assigns the role as the caller', async () => {
    const setup = adminSetup();
    const response = await invite(setup, 'owner', {
      email: ' New.Staff@Example.com ',
      role: 'moderator',
      fullName: 'Nadia Islam',
    });

    expect(response.status).toBe(201);
    const { invitation } = staffInvitationResponseSchema.parse(response.body);
    expect(invitation).toMatchObject({ email: 'new.staff@example.com', role: 'moderator' });
    expect(setup.identity.invitations).toEqual([
      expect.objectContaining({
        email: 'new.staff@example.com',
        fullName: 'Nadia Islam',
        redirectTo: 'http://localhost:3001/accept-invite',
        userId: invitation.userId,
      }),
    ]);
    expect(setup.identity.roleAssignments).toEqual([
      { actorId: setup.users.owner.id, targetId: invitation.userId, role: 'moderator' },
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(/token|password/i);
  });

  it('links to the configured admin workspace origin', async () => {
    const setup = adminSetup({ ADMIN_APP_ORIGIN: 'https://admin.nilzora.test' });
    await invite(setup, 'owner', { email: 'new.admin@example.com', role: 'admin' });

    expect(setup.identity.invitations[0]?.redirectTo).toBe(
      'https://admin.nilzora.test/accept-invite',
    );
  });

  it.each<[string, Who, string, number]>([
    ['owners inviting admins', 'owner', 'admin', 201],
    ['owners inviting staff', 'owner', 'staff', 201],
    ['admins inviting staff (only the owner creates system users)', 'admin', 'staff', 403],
    ['admins inviting moderators', 'admin', 'moderator', 403],
    ['admins inviting admins', 'admin', 'admin', 403],
  ])('handles %s', async (_label, who, role, status) => {
    const setup = adminSetup();
    const response = await invite(setup, who, { email: 'invitee@example.com', role });

    expect(response.status).toBe(status);
    if (status === 403) {
      expect(errorOf(response.body).code).toBe('forbidden');
      expect(setup.identity.invitations).toEqual([]);
    }
  });

  it('never lets staff invite, even with a staff.invite grant (only owners and admins assign roles)', async () => {
    const setup = adminSetup();
    setup.users.staff.overrides.set('staff.invite', 'grant');
    const response = await invite(setup, 'staff', { email: 'invitee@example.com', role: 'staff' });

    expect(response.status).toBe(403);
    expect(setup.identity.invitations).toEqual([]);
  });

  it.each([
    ['an owner role', { email: 'invitee@example.com', role: 'super_admin' }],
    ['a customer role', { email: 'invitee@example.com', role: 'customer' }],
    ['an invalid email', { email: 'not-an-email', role: 'staff' }],
    ['permissions', { email: 'invitee@example.com', role: 'staff', permissions: ['orders.read'] }],
    ['an inviting account', { email: 'invitee@example.com', role: 'staff', actorId: randomUUID() }],
    [
      'a redirect',
      { email: 'invitee@example.com', role: 'staff', redirectTo: 'https://evil.test' },
    ],
  ])('rejects %s, sending nothing', async (_label, body) => {
    const setup = adminSetup();
    const response = await invite(setup, 'owner', body);

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(setup.identity.invitations).toEqual([]);
  });

  it('refuses an email that already has an account (409)', async () => {
    const setup = adminSetup();
    const response = await invite(setup, 'owner', { email: 'rahima@example.com', role: 'staff' });

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('account_exists');
    expect(setup.users.customer.role).toBe('customer');
  });

  it('removes the invited account when the database refuses the role', async () => {
    const setup = adminSetup();
    setup.identity.refuseRoleAssignment = 'owner_only';
    const response = await invite(setup, 'owner', { email: 'invitee@example.com', role: 'staff' });

    expect(response.status).toBe(403);
    expect(errorOf(response.body).code).toBe('forbidden');
    const invited = setup.identity.invitations[0]?.userId;
    expect(setup.identity.deletedUsers).toEqual([invited]);
    expect(setup.identity.users.has(invited ?? '')).toBe(false);
  });

  it('answers 503 when Supabase Auth cannot send the invitation, assigning nothing', async () => {
    const setup = adminSetup();
    setup.identity.gateway.inviteUser = () => Promise.reject(new AuthGatewayError('unavailable'));
    const response = await invite(setup, 'owner', { email: 'invitee@example.com', role: 'staff' });

    expect(response.status).toBe(503);
    expect(errorOf(response.body).code).toBe('auth_unavailable');
    expect(setup.identity.roleAssignments).toEqual([]);
  });

  it.each<[string, (setup: AdminSetup) => Promise<unknown>]>([
    [
      'a pending invitation',
      (setup) => invite(setup, 'owner', { email: 'invitee@example.com', role: 'admin' }),
    ],
    [
      'an unconfirmed sign-up',
      (setup) =>
        setup.identity.gateway.signUp({ email: 'invitee@example.com', password: 'shopping2026' }),
    ],
  ])('refuses %s with 409, sending nothing and keeping the account', async (_label, before) => {
    const setup = adminSetup();
    await before(setup);
    const existing = [...setup.identity.users.values()].find(
      (user) => user.email === 'invitee@example.com',
    );
    const roleBefore = existing?.role;
    const sentBefore = setup.identity.invitations.length;
    const response = await invite(setup, 'owner', { email: 'invitee@example.com', role: 'staff' });

    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('account_exists');
    expect(setup.identity.invitations).toHaveLength(sentBefore);
    expect(setup.identity.deletedUsers).toEqual([]);
    expect(existing && setup.identity.users.get(existing.id)?.role).toBe(roleBefore);
  });
});

describe('POST /api/v1/admin/staff/:userId/invitation', () => {
  const resend = (setup: AdminSetup, who: Who, userId: string, body?: object) =>
    setup.call('post', `/admin/staff/${userId}/invitation`, who, body ?? {});

  async function invited(setup: AdminSetup, who: Who = 'owner', role = 'moderator') {
    const response = await setup.call('post', '/admin/staff/invitations', who, {
      email: 'invitee@example.com',
      role,
    });
    return staffInvitationResponseSchema.parse(response.body).invitation.userId;
  }

  it('emails a pending invitee a new link that replaces the old one, and audits it', async () => {
    const setup = adminSetup();
    const userId = await invited(setup);
    const firstLink = setup.identity.invitations[0]?.tokenHash ?? '';
    const listed = await setup.call('get', '/admin/staff', 'admin');
    const response = await resend(setup, 'admin', userId);

    expect(
      staffListResponseSchema.parse(listed.body).staff.find((member) => member.id === userId),
    ).toMatchObject({ invitationPending: true });
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(staffInvitationResendResponseSchema.parse(response.body)).toStrictEqual({
      invitation: { userId, email: 'invitee@example.com' },
    });
    expect(setup.identity.invitations.at(-1)).toMatchObject({
      userId,
      redirectTo: 'http://localhost:3001/accept-invite',
    });
    expect(setup.admin.audit.at(-1)).toMatchObject({
      action: 'staff.invitation_resent',
      actorId: setup.users.admin.id,
      targetId: userId,
    });
    const stale = await setup.call('post', '/auth/accept-invite', undefined, {
      tokenHash: firstLink,
      password: 'team-member-2026',
    });
    expect(stale.status).toBe(400);
    const fresh = await setup.call('post', '/auth/accept-invite', undefined, {
      tokenHash: setup.identity.invitations.at(-1)?.tokenHash ?? '',
      password: 'team-member-2026',
    });
    expect(fresh.status).toBe(204);
  });

  it('answers 409 invitation_accepted once the invitation was accepted (NZ412)', async () => {
    const setup = adminSetup();
    const response = await resend(setup, 'admin', setup.users.staff.id);

    expect(response.status).toBe(409);
    expect(errorOf(response.body)).toMatchObject({
      code: 'invitation_accepted',
      message: 'This invitation was already accepted',
    });
    expect(setup.identity.invitations).toEqual([]);
    const listed = await setup.call('get', '/admin/staff', 'admin');
    expect(
      staffListResponseSchema
        .parse(listed.body)
        .staff.find((member) => member.id === setup.users.staff.id),
    ).toMatchObject({ invitationPending: false });
  });

  it.each<[string, (setup: AdminSetup) => string]>([
    ['a customer', (s) => s.users.customer.id],
    ['an unknown account', () => randomUUID()],
  ])('answers 404 for %s (NZ404)', async (_label, target) => {
    const setup = adminSetup();
    const response = await resend(setup, 'admin', target(setup));

    expect(response.status).toBe(404);
    expect(errorOf(response.body).message).toBe('Invitation not found');
    expect(setup.identity.invitations).toEqual([]);
  });

  it("refuses an admin re-sending an owner's pending admin invitation (NZ403)", async () => {
    const setup = adminSetup();
    const userId = await invited(setup, 'owner', 'admin');
    const byAdmin = await resend(setup, 'admin', userId);
    const byOwner = await resend(setup, 'owner', userId);

    expect(byAdmin.status).toBe(403);
    expect(errorOf(byAdmin.body)).toMatchObject({
      code: 'forbidden',
      message: 'You cannot re-send this invitation',
    });
    expect(byOwner.status).toBe(200);
    expect(setup.identity.invitations).toHaveLength(2);
  });

  it('requires staff.invite before asking the database', async () => {
    const setup = adminSetup();
    const userId = await invited(setup);
    setup.deny('admin', 'staff.invite');
    setup.admin.calls.length = 0;
    const response = await resend(setup, 'admin', userId);

    expect(response.status).toBe(403);
    expect(setup.admin.calls).toEqual([]);
  });

  it.each<[string, AuthGatewayError, number, string]>([
    ['the email quota', new AuthGatewayError('rate_limited'), 429, 'rate_limited'],
    ['an outage', new AuthGatewayError('unavailable'), 503, 'auth_unavailable'],
    [
      'an acceptance in between',
      new AuthGatewayError('account_exists'),
      409,
      'invitation_accepted',
    ],
  ])('answers %s from Supabase Auth with %i', async (_label, failure, status, code) => {
    const setup = adminSetup();
    const userId = await invited(setup);
    setup.identity.gateway.resendInvitation = () => Promise.reject(failure);
    const response = await resend(setup, 'admin', userId);

    expect(response.status).toBe(status);
    expect(errorOf(response.body).code).toBe(code);
  });

  it('rejects a body with any field and a malformed id', async () => {
    const setup = adminSetup();
    const userId = await invited(setup);
    const withBody = await resend(setup, 'admin', userId, { email: 'other@example.com' });
    const malformed = await resend(setup, 'admin', 'nadia');

    expect(withBody.status).toBe(400);
    expect(malformed.status).toBe(400);
  });
});
