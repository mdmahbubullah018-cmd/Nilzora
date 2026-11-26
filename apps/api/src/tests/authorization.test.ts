import {
  apiErrorBodySchema,
  assignRoleResponseSchema,
  PERMISSIONS,
  type AppRole,
  type Permission,
} from '@nilzora/contracts';
import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { permissionsFor } from './role-permissions';
import { authenticate } from '../middleware/authenticate';
import { currentIdentity, requirePermission } from '../middleware/authorize';
import { FakeIdentity } from './fakes';
import { testApp } from './helpers';

function errorCode(body: unknown): string {
  return apiErrorBodySchema.parse(body).error.code;
}

/**
 * Test-only module: one probe route per permission, plus an identity echo, all
 * behind the real authenticate/authorize middleware. No production route is added.
 */
function probeModule(identity: FakeIdentity): Router {
  const router = Router();
  router.all('/probe/identity', authenticate(identity.deps), (_req, res) => {
    const { userId, role, email } = currentIdentity(res);
    res.json({ userId, role, email });
  });
  for (const permission of PERMISSIONS) {
    router.get(
      `/probe/permission/${permission}`,
      authenticate(identity.deps),
      requirePermission(permission),
      (_req, res) => {
        res.json({ allowed: permission });
      },
    );
  }
  router.get('/probe/unauthenticated-guard', requirePermission('orders.read'), (_req, res) => {
    res.json({ reached: true });
  });
  return router;
}

function setup() {
  const identity = new FakeIdentity();
  return { identity, app: testApp({ auth: identity.deps, modules: [probeModule(identity)] }) };
}

describe('authenticate', () => {
  it.each([
    ['no header', undefined],
    ['a non-bearer scheme', 'Basic dXNlcjpwYXNz'],
    ['a bare scheme', 'Bearer'],
    ['two tokens', 'Bearer abc def'],
    ['an oversized header', `Bearer ${'a'.repeat(9000)}`],
  ])('refuses %s with 401 and a bearer challenge', async (_, header) => {
    const { app } = setup();
    const call = request(app).get('/api/v1/probe/identity');
    const response = await (header === undefined ? call : call.set('Authorization', header));

    expect(response.status).toBe(401);
    expect(errorCode(response.body)).toBe('unauthenticated');
    expect(response.headers['www-authenticate']).toMatch(/^Bearer/);
  });

  it.each([
    ['unknown', () => 'at.unknown-token'],
    [
      'expired',
      (identity: FakeIdentity) => {
        const token = identity.tokenFor(identity.addUser({ email: 'expired@example.com' }));
        const session = identity.sessions.get(token);
        if (session) session.expired = true;
        return token;
      },
    ],
    [
      'revoked',
      (identity: FakeIdentity) => {
        const token = identity.tokenFor(identity.addUser({ email: 'revoked@example.com' }));
        const session = identity.sessions.get(token);
        if (session) session.revoked = true;
        return token;
      },
    ],
  ])('refuses an %s token', async (_, makeToken) => {
    const { identity, app } = setup();
    const response = await request(app)
      .get('/api/v1/probe/identity')
      .set('Authorization', `Bearer ${makeToken(identity)}`);

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toContain('invalid_token');
  });

  it('fails closed (503) when Supabase Auth is unreachable', async () => {
    const { identity, app } = setup();
    const token = identity.tokenFor(identity.addUser({ email: 'c@example.com' }));
    identity.gatewayFailure = 'unavailable';
    const response = await request(app)
      .get('/api/v1/probe/identity')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(503);
    expect(errorCode(response.body)).toBe('auth_unavailable');
  });

  it('fails closed (503) when the role cannot be read', async () => {
    const { identity, app } = setup();
    const token = identity.tokenFor(identity.addUser({ email: 'c@example.com' }));
    identity.storeUnavailable = true;
    const response = await request(app)
      .get('/api/v1/probe/identity')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(503);
  });

  it.each([
    ['without a profile or role', { profile: null }, 'account_unavailable'],
    ['that are suspended', { status: 'suspended' as const }, 'account_suspended'],
  ])('refuses accounts %s with 403', async (_, overrides, code) => {
    const { identity, app } = setup();
    const token = identity.tokenFor(identity.addUser({ email: 'x@example.com', ...overrides }));
    const response = await request(app)
      .get('/api/v1/probe/identity')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(errorCode(response.body)).toBe(code);
  });

  it('derives the identity from the token, never from caller-supplied ids', async () => {
    const { identity, app } = setup();
    const caller = identity.addUser({ email: 'caller@example.com' });
    const victim = identity.addUser({ email: 'victim@example.com', role: 'super_admin' });
    const response = await request(app)
      .post(`/api/v1/probe/identity?userId=${victim.id}`)
      .set('Authorization', `Bearer ${identity.tokenFor(caller)}`)
      .set('X-User-Id', victim.id)
      .send({ userId: victim.id, role: 'super_admin' });

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({
      userId: caller.id,
      role: 'customer',
      email: 'caller@example.com',
    });
  });

  it('takes the role from the store, not from anything the client controls', async () => {
    const { identity, app } = setup();
    const moderator = identity.addUser({ email: 'mod@example.com', role: 'moderator' });
    const response = await request(app)
      .get('/api/v1/probe/identity')
      .set('Authorization', `Bearer ${identity.tokenFor(moderator)}`);

    expect(response.body).toMatchObject({ role: 'moderator' });
  });
});

describe('role permissions', () => {
  it('gives customers no permissions and owners all of them', () => {
    expect(permissionsFor('customer').size).toBe(0);
    expect([...permissionsFor('super_admin')].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('keeps store-wide settings for owners only', () => {
    expect(permissionsFor('admin').has('settings.manage')).toBe(false);
    expect(permissionsFor('admin').has('staff.roles.assign')).toBe(true);
  });

  it('gives each role a different, limited set', () => {
    const roles: AppRole[] = ['super_admin', 'admin', 'staff', 'moderator', 'customer'];
    const sizes = roles.map((role) => permissionsFor(role).size);
    expect(new Set(sizes).size).toBe(roles.length);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
  });

  it.each<[AppRole, Permission[], Permission[]]>([
    ['super_admin', ['admin_workspace.access', 'moderator_workspace.access'], []],
    ['admin', ['admin_workspace.access', 'moderator_workspace.access'], []],
    ['staff', ['admin_workspace.access'], ['moderator_workspace.access']],
    ['moderator', ['moderator_workspace.access'], ['admin_workspace.access']],
    ['customer', [], ['admin_workspace.access', 'moderator_workspace.access']],
  ])('grants %s only its own workspaces', (role, granted, denied) => {
    for (const permission of granted) expect(permissionsFor(role).has(permission)).toBe(true);
    for (const permission of denied) expect(permissionsFor(role).has(permission)).toBe(false);
  });

  it.each<[AppRole, Permission[]]>([
    [
      'moderator',
      ['orders.read', 'customers.read', 'staff.roles.assign', 'settings.manage', 'finance.read'],
    ],
    [
      'staff',
      [
        'staff.roles.assign',
        'staff.invite',
        'settings.manage',
        'refunds.approve',
        'audit_logs.read',
      ],
    ],
    ['customer', ['products.read', 'orders.read', 'staff.roles.assign']],
  ])('denies %s unrelated privileged permissions', (role, denied) => {
    for (const permission of denied) expect(permissionsFor(role).has(permission)).toBe(false);
  });
});

describe('requirePermission', () => {
  it('returns 403 to signed-in roles without the permission and lets others through', async () => {
    const { identity, app } = setup();
    const roles: AppRole[] = ['super_admin', 'admin', 'staff', 'moderator', 'customer'];
    for (const role of roles) {
      const token = identity.tokenFor(identity.addUser({ email: `${role}@example.com`, role }));
      for (const permission of PERMISSIONS) {
        const response = await request(app)
          .get(`/api/v1/probe/permission/${permission}`)
          .set('Authorization', `Bearer ${token}`);
        const expected = permissionsFor(role).has(permission) ? 200 : 403;
        expect(response.status, `${role} → ${permission}`).toBe(expected);
        if (expected === 403) expect(errorCode(response.body)).toBe('forbidden');
      }
    }
  });

  it('refuses (401) when mounted without authenticate', async () => {
    const { app } = setup();
    const response = await request(app).get('/api/v1/probe/unauthenticated-guard');

    expect(response.status).toBe(401);
  });
});

describe('PUT /api/v1/admin/users/:userId/role', () => {
  const target = '3f8e2a52-7b1c-4d3e-9f0a-1b2c3d4e5f60';

  it.each<AppRole>(['customer', 'moderator', 'staff'])(
    'is forbidden to a %s and never reaches the database',
    async (role) => {
      const { identity, app } = setup();
      const token = identity.tokenFor(identity.addUser({ email: `${role}@example.com`, role }));
      const response = await request(app)
        .put(`/api/v1/admin/users/${target}/role`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: 'admin' });

      expect(response.status).toBe(403);
      expect(errorCode(response.body)).toBe('forbidden');
      expect(identity.roleAssignments).toHaveLength(0);
    },
  );

  it('requires authentication', async () => {
    const { identity, app } = setup();
    const response = await request(app)
      .put(`/api/v1/admin/users/${target}/role`)
      .send({ role: 'admin' });

    expect(response.status).toBe(401);
    expect(identity.roleAssignments).toHaveLength(0);
  });

  it('refuses an admin: only the owner assigns roles', async () => {
    const { identity, app } = setup();
    const admin = identity.addUser({ email: 'admin@example.com', role: 'admin' });
    const response = await request(app)
      .put(`/api/v1/admin/users/${target}/role`)
      .set('Authorization', `Bearer ${identity.tokenFor(admin)}`)
      .send({ role: 'staff' });

    expect(response.status).toBe(403);
    expect(identity.roleAssignments).toHaveLength(0);
  });

  it('never hands out the owner role, even when the owner asks', async () => {
    const { identity, app } = setup();
    const owner = identity.addUser({ email: 'owner@example.com', role: 'super_admin' });
    const response = await request(app)
      .put(`/api/v1/admin/users/${target}/role`)
      .set('Authorization', `Bearer ${identity.tokenFor(owner)}`)
      .send({ role: 'super_admin' });

    expect(response.status).toBe(403);
    expect(identity.roleAssignments).toHaveLength(0);
  });

  it('passes the verified caller (not request data) as the acting account', async () => {
    const { identity, app } = setup();
    const admin = identity.addUser({ email: 'owner@example.com', role: 'super_admin' });
    const response = await request(app)
      .put(`/api/v1/admin/users/${target}/role`)
      .set('Authorization', `Bearer ${identity.tokenFor(admin)}`)
      .send({ role: 'staff' });

    expect(response.status).toBe(200);
    expect(assignRoleResponseSchema.parse(response.body)).toMatchObject({
      userId: target,
      role: 'staff',
    });
    expect(identity.roleAssignments).toEqual([
      { actorId: admin.id, targetId: target, role: 'staff' },
    ]);
  });

  it.each([
    ['an unknown role', { role: 'root' }],
    ['extra fields', { role: 'staff', grantedBy: '00000000-0000-4000-8000-000000000000' }],
    ['a missing role', {}],
  ])('rejects %s', async (_, body) => {
    const { identity, app } = setup();
    const admin = identity.addUser({ email: 'admin@example.com', role: 'admin' });
    const response = await request(app)
      .put(`/api/v1/admin/users/${target}/role`)
      .set('Authorization', `Bearer ${identity.tokenFor(admin)}`)
      .send(body);

    expect(response.status).toBe(400);
    expect(identity.roleAssignments).toHaveLength(0);
  });

  it('rejects a malformed account id', async () => {
    const { identity, app } = setup();
    const admin = identity.addUser({ email: 'admin@example.com', role: 'admin' });
    const response = await request(app)
      .put('/api/v1/admin/users/not-a-uuid/role')
      .set('Authorization', `Bearer ${identity.tokenFor(admin)}`)
      .send({ role: 'staff' });

    expect(response.status).toBe(400);
  });

  it.each([
    ['own_role', 403, 'forbidden'],
    ['actor_not_permitted', 403, 'forbidden'],
    ['owner_only', 403, 'forbidden'],
    ['last_owner', 403, 'forbidden'],
    ['target_not_found', 404, 'not_found'],
  ] as const)('maps the database refusal %s to %i', async (refusal, status, code) => {
    const { identity, app } = setup();
    const admin = identity.addUser({ email: 'owner@example.com', role: 'super_admin' });
    identity.refuseRoleAssignment = refusal;
    const response = await request(app)
      .put(`/api/v1/admin/users/${target}/role`)
      .set('Authorization', `Bearer ${identity.tokenFor(admin)}`)
      .send({ role: 'staff' });

    expect(response.status).toBe(status);
    expect(errorCode(response.body)).toBe(code);
  });
});
