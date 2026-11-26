import type {
  CustomerNotification,
  CustomerNotificationQuery,
  StaffNotification,
  StaffNotificationQuery,
} from '@nilzora/contracts';
import {
  customerNotificationListResponseSchema,
  staffNotificationListResponseSchema,
} from '@nilzora/contracts';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { CustomerNotificationStore } from '../modules/inbox/customer-store';
import type { InboxStore } from '../modules/inbox/store';
import { FakeIdentity } from './fakes';
import { testApp } from './helpers';

/*
 * The customer notification history, and the moderator doorway into the staff inbox.
 *
 * The rows are written and filtered by PostgreSQL (see
 * supabase/migrations/20261213092000_customer_notifications.sql). These tests cover the API
 * surface: the shapes, the bounds, the session requirement, and the fact that the moderator
 * route is gated by its own permission rather than by the admin one — so neither door
 * widens the other.
 */

const AT = '2026-11-11T10:00:00.000Z';

const customerNotification: CustomerNotification = {
  id: randomUUID(),
  kind: 'order_update',
  title: 'Order confirmed',
  body: 'Order NZ100001 has been confirmed.',
  entityType: 'order',
  entityId: randomUUID(),
  actionPath: '/account/orders/NZ100001',
  readAt: null,
  createdAt: AT,
};

const staffNotification: StaffNotification = {
  id: randomUUID(),
  kind: 'moderation_pending',
  title: 'Product awaiting review',
  body: null,
  entityType: 'product',
  entityId: randomUUID(),
  actionPath: '/admin/products/0d000000-0000-4000-8000-000000000001',
  readAt: null,
  createdAt: AT,
};

function fakeCustomerStore() {
  const queries: CustomerNotificationQuery[] = [];
  const readIds: string[] = [];
  let allRead = 0;
  const removed: string[][] = [];
  const cleared: string[] = [];
  const store: CustomerNotificationStore = {
    list: (_t, _u, query: CustomerNotificationQuery) => {
      queries.push(query);
      return Promise.resolve({ notifications: [customerNotification], total: 1 });
    },
    unreadCount: () => Promise.resolve(1),
    markRead: (_t, _u, id) => {
      readIds.push(id);
      return Promise.resolve();
    },
    markAllRead: () => {
      allRead += 1;
      return Promise.resolve(1);
    },
    remove: (_t, _u, ids) => {
      removed.push([...ids]);
      return Promise.resolve(ids.length);
    },
    clear: (_t, _u, before) => {
      cleared.push(before);
      return Promise.resolve(3);
    },
  };
  return { store, queries, readIds, removed, cleared, allRead: () => allRead };
}

function fakeStaffStore() {
  const store: InboxStore = {
    list: (_t, _u, _q: StaffNotificationQuery) =>
      Promise.resolve({ notifications: [staffNotification], total: 1 }),
    unreadCount: () => Promise.resolve(1),
    markRead: () => Promise.resolve(),
    markAllRead: () => Promise.resolve(0),
  };
  return store;
}

function setup() {
  const identity = new FakeIdentity();
  const customer = identity.addUser({ email: 'rahima@example.com' });
  const moderator = identity.addUser({ email: 'moderator@example.com', role: 'moderator' });
  const manager = identity.addUser({ email: 'manager@example.com', role: 'admin' });

  const notices = fakeCustomerStore();
  const app = testApp({
    auth: identity.deps,
    notifications: notices.store,
    phase3: { site: {} as never, inbox: fakeStaffStore(), insights: {} as never },
  });

  const tokens = {
    customer: identity.tokenFor(customer),
    moderator: identity.tokenFor(moderator),
    manager: identity.tokenFor(manager),
  };

  function call(
    method: 'get' | 'post',
    path: string,
    who?: keyof typeof tokens,
    body?: Record<string, unknown>,
  ) {
    let pending = request(app)[method](`/api/v1${path}`);
    if (who) pending = pending.set('Authorization', `Bearer ${tokens[who]}`);
    return body === undefined ? pending : pending.send(body);
  }

  return { call, notices };
}

describe('GET /api/v1/me/notifications', () => {
  it('answers the caller’s own page in the contract shape', async () => {
    const { call } = setup();
    const response = await call('get', '/me/notifications', 'customer');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = customerNotificationListResponseSchema.parse(response.body);
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0]?.actionPath).toBe('/account/orders/NZ100001');
    expect(body.unread).toBe(1);
    expect(body.totalPages).toBe(1);
  });

  it('passes the category through and bounds the page size', async () => {
    const { call, notices } = setup();
    await call('get', '/me/notifications?kind=refund_update&pageSize=10', 'customer');
    expect(notices.queries[0]).toMatchObject({ kind: 'refund_update', pageSize: 10 });

    expect((await call('get', '/me/notifications?pageSize=51', 'customer')).status).toBe(400);
    expect((await call('get', '/me/notifications?kind=staff_only', 'customer')).status).toBe(400);
    expect((await call('get', '/me/notifications?page=0', 'customer')).status).toBe(400);
  });

  it('needs a session', async () => {
    const { call } = setup();
    expect((await call('get', '/me/notifications')).status).toBe(401);
    expect((await call('post', '/me/notifications/read-all')).status).toBe(401);
  });

  it('marks one notification read and all of them', async () => {
    const { call, notices } = setup();
    const id = randomUUID();
    expect((await call('post', `/me/notifications/${id}/read`, 'customer')).status).toBe(204);
    expect(notices.readIds).toEqual([id]);

    const all = await call('post', '/me/notifications/read-all', 'customer');
    expect(all.status).toBe(200);
    expect(all.body).toEqual({ unread: 0 });
    expect(notices.allRead()).toBe(1);

    expect((await call('post', '/me/notifications/not-a-uuid/read', 'customer')).status).toBe(400);
  });

  it('answers the unread count the account badge uses', async () => {
    const { call } = setup();
    const response = await call('get', '/me/notifications/unread-count', 'customer');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ unread: 1 });
  });
});

describe('deleting from the notification centre', () => {
  it('deletes the caller’s chosen entries and says how many', async () => {
    const { call, notices } = setup();
    const ids = [randomUUID(), randomUUID()];
    const response = await call('post', '/me/notifications/delete', 'customer', { ids });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ deleted: 2 });
    expect(notices.removed).toEqual([ids]);
  });

  it('clears everything up to the moment Clear all was pressed', async () => {
    const { call, notices } = setup();
    const before = '2026-11-22T10:00:00.000Z';
    const response = await call('post', '/me/notifications/clear', 'customer', { before });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ deleted: 3 });
    expect(notices.cleared).toEqual([before]);
  });

  it('needs a session, and refuses a malformed request before it reaches the store', async () => {
    const { call, notices } = setup();
    expect(
      (await call('post', '/me/notifications/delete', undefined, { ids: [randomUUID()] })).status,
    ).toBe(401);
    expect((await call('post', '/me/notifications/clear', undefined, { before: AT })).status).toBe(
      401,
    );

    expect((await call('post', '/me/notifications/delete', 'customer', { ids: [] })).status).toBe(
      400,
    );
    expect(
      (await call('post', '/me/notifications/delete', 'customer', { ids: ['nope'] })).status,
    ).toBe(400);
    expect(
      (
        await call('post', '/me/notifications/delete', 'customer', {
          ids: Array.from({ length: 101 }, () => randomUUID()),
        })
      ).status,
    ).toBe(400);
    // A customer id in the body is not part of the contract at all.
    expect(
      (
        await call('post', '/me/notifications/delete', 'customer', {
          ids: [randomUUID()],
          userId: randomUUID(),
        })
      ).status,
    ).toBe(400);
    expect(
      (await call('post', '/me/notifications/clear', 'customer', { before: 'yesterday' })).status,
    ).toBe(400);
    expect(notices.removed).toEqual([]);
    expect(notices.cleared).toEqual([]);
  });
});

describe('the moderator inbox', () => {
  it('answers the moderator workspace with the same rows', async () => {
    const { call } = setup();
    const response = await call('get', '/moderator/notifications', 'moderator');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = staffNotificationListResponseSchema.parse(response.body);
    expect(body.notifications[0]).toMatchObject({
      kind: 'moderation_pending',
      entityType: 'product',
    });
  });

  it('is closed to an account without the moderator workspace', async () => {
    const { call } = setup();
    expect((await call('get', '/moderator/notifications', 'customer')).status).toBe(403);
    expect((await call('get', '/moderator/notifications')).status).toBe(401);
  });

  it('keeps the admin inbox closed to a moderator, so neither door widens the other', async () => {
    const { call } = setup();
    expect((await call('get', '/staff/notifications', 'moderator')).status).toBe(403);
    expect((await call('get', '/staff/notifications', 'manager')).status).toBe(200);
  });
});
