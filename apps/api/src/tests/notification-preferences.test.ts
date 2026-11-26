import type {
  CustomerNotificationQuery,
  NotificationPreferences,
  NotificationPreferencesPatch,
} from '@nilzora/contracts';
import { notificationPreferencesResponseSchema } from '@nilzora/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { CustomerNotificationStore } from '../modules/inbox/customer-store';
import type { NotificationPreferenceStore } from '../modules/inbox/preference-store';
import { FakeIdentity } from './fakes';
import { testApp } from './helpers';

/*
 * The account's notification choices over HTTP.
 *
 * The row is written by
 * supabase/migrations/20261214090000_notification_preferences.sql and belongs to auth.uid();
 * these tests cover the surface: the shape, that only the switch that moved is forwarded, the
 * strictness of the patch, the session requirement, and that one account's choices are never
 * another's.
 */

const AT = '2026-12-14T09:00:00.000Z';

function row(overrides: Partial<NotificationPreferences> = {}): NotificationPreferences {
  return {
    orderUpdates: true,
    paymentUpdates: true,
    returnUpdates: true,
    refundUpdates: true,
    promotions: true,
    inApp: true,
    updatedAt: AT,
    ...overrides,
  };
}

function fakePreferenceStore() {
  const rows = new Map<string, NotificationPreferences>();
  const saves: { userId: string; patch: NotificationPreferencesPatch }[] = [];

  const store: NotificationPreferenceStore = {
    read: (_token, userId) => Promise.resolve(rows.get(userId) ?? row()),
    save: (_token, userId, patch) => {
      saves.push({ userId, patch });
      const next = { ...(rows.get(userId) ?? row()), ...patch, updatedAt: AT };
      rows.set(userId, next);
      return Promise.resolve(next);
    },
  };

  return { store, rows, saves };
}

const emptyNotifications: CustomerNotificationStore = {
  list: (_t, _u, _q: CustomerNotificationQuery) => Promise.resolve({ notifications: [], total: 0 }),
  unreadCount: () => Promise.resolve(0),
  markRead: () => Promise.resolve(),
  markAllRead: () => Promise.resolve(0),
  remove: () => Promise.resolve(0),
  clear: () => Promise.resolve(0),
};

function setup(withStore = true) {
  const identity = new FakeIdentity();
  const first = identity.addUser({ email: 'rahima@example.com' });
  const second = identity.addUser({ email: 'karim@example.com' });
  const preferences = fakePreferenceStore();

  const app = testApp({
    auth: identity.deps,
    notifications: emptyNotifications,
    ...(withStore ? { notificationPreferences: preferences.store } : {}),
  });

  const tokens = { first: identity.tokenFor(first), second: identity.tokenFor(second) };

  function call(method: 'get' | 'patch', who?: keyof typeof tokens) {
    let pending = request(app)[method]('/api/v1/me/notification-preferences');
    if (who) pending = pending.set('Authorization', `Bearer ${tokens[who]}`);
    return pending;
  }

  return { call, preferences, userIds: { first: first.id, second: second.id } };
}

describe('GET /api/v1/me/notification-preferences', () => {
  it('answers the caller’s own choices in the contract shape', async () => {
    const { call } = setup();
    const response = await call('get', 'first');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = notificationPreferencesResponseSchema.parse(response.body);
    expect(body.preferences.orderUpdates).toBe(true);
    expect(body.preferences.inApp).toBe(true);
  });

  it('needs a session', async () => {
    const { call } = setup();
    expect((await call('get')).status).toBe(401);
    expect((await call('patch')).status).toBe(401);
  });

  it('is not mounted at all when the store is missing', async () => {
    const { call } = setup(false);
    expect((await call('get', 'first')).status).toBe(404);
  });
});

describe('PATCH /api/v1/me/notification-preferences', () => {
  it('forwards only the switch that moved and answers with the server row', async () => {
    const { call, preferences, userIds } = setup();
    const response = await call('patch', 'first').send({ promotions: false });

    expect(response.status).toBe(200);
    const body = notificationPreferencesResponseSchema.parse(response.body);
    expect(body.preferences.promotions).toBe(false);
    // Every other choice keeps its value.
    expect(body.preferences.orderUpdates).toBe(true);
    // The patch was exactly what the customer moved, and it carried no customer id.
    expect(preferences.saves).toEqual([{ userId: userIds.first, patch: { promotions: false } }]);
  });

  it('refuses an unknown switch and a non-boolean value', async () => {
    const { call, preferences } = setup();

    expect((await call('patch', 'first').send({ marketing: true })).status).toBe(400);
    expect((await call('patch', 'first').send({ orderUpdates: 'yes' })).status).toBe(400);
    // Nothing was written for a rejected body.
    expect(preferences.saves).toHaveLength(0);
  });

  it('keeps one account’s choice out of another account', async () => {
    const { call, userIds } = setup();

    await call('patch', 'first').send({ refundUpdates: false });

    const mine = notificationPreferencesResponseSchema.parse((await call('get', 'first')).body);
    const theirs = notificationPreferencesResponseSchema.parse((await call('get', 'second')).body);
    expect(mine.preferences.refundUpdates).toBe(false);
    expect(theirs.preferences.refundUpdates).toBe(true);
    // Each write was recorded against the caller's own account.
    expect(userIds.first).not.toBe(userIds.second);
  });

  it('saves the record switch on its own, without touching the categories', async () => {
    const { call, preferences } = setup();
    const response = await call('patch', 'first').send({ inApp: false });

    expect(notificationPreferencesResponseSchema.parse(response.body).preferences.inApp).toBe(
      false,
    );
    expect(preferences.saves[0]?.patch).toEqual({ inApp: false });
  });
});
