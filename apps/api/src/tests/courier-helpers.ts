import type { AppRole, CourierMode, Permission } from '@nilzora/contracts';
import request from 'supertest';
import { createCourierProcessor } from '../modules/couriers/processor';
import { createCourierRegistry, type CourierRegistry } from '../modules/couriers/registry';
import { createCourierRuntime } from '../modules/couriers/runtime';
import { createCourierService } from '../modules/couriers/service';
import type { CourierCaller } from '../modules/couriers/store';
import type { CourierProvider } from '../modules/couriers/types';
import { FakeAdmin } from './admin-fakes';
import { FakeCouriers } from './courier-fakes';
import { FakeIdentity } from './fakes';
import { captureLogs, testApp, testConfig } from './helpers';

/** A mock webhook secret for tests only (never a real value). */
export const TEST_MOCK_SECRET = 'test-mock-webhook-secret-not-real-0123456789';

export type CourierWho = 'owner' | 'admin' | 'staff' | 'customer' | 'otherCustomer';

const ACCOUNTS: Readonly<Record<CourierWho, { email: string; role: AppRole }>> = {
  owner: { email: 'owner@example.com', role: 'super_admin' },
  admin: { email: 'admin@example.com', role: 'admin' },
  staff: { email: 'staff@example.com', role: 'staff' },
  customer: { email: 'rahima@example.com', role: 'customer' },
  otherCustomer: { email: 'karim@example.com', role: 'customer' },
};

export interface CourierSetupOptions {
  /** The SAVED mode in the (fake) database; the effective one may be stricter. */
  mode?: CourierMode;
  bookingEnabled?: boolean;
  trackingSyncEnabled?: boolean;
  trackingSyncIntervalSeconds?: number;
  /** Environment (bootstrap secrets, fallbacks, the database target). */
  env?: Record<string, string>;
}

/** Counts every courier adapter call, so a test can prove a call did (not) happen. */
function spyOn(registry: CourierRegistry) {
  const calls = { quote: 0, book: 0, track: 0, cancel: 0, check: 0 };
  const wrap = (provider: CourierProvider | undefined): CourierProvider | undefined =>
    provider && {
      ...provider,
      quote: (...args) => {
        calls.quote += 1;
        return provider.quote(...args);
      },
      book: (...args) => {
        calls.book += 1;
        return provider.book(...args);
      },
      track: (...args) => {
        calls.track += 1;
        return provider.track(...args);
      },
      cancel: (...args) => {
        calls.cancel += 1;
        return provider.cancel(...args);
      },
      checkConnection: (...args) => {
        calls.check += 1;
        return provider.checkConnection(...args);
      },
    };
  const spied: CourierRegistry = {
    ...registry,
    provider: (id, mode) => wrap(registry.provider(id, mode)),
    forShipment: (id, isMock, mode) => wrap(registry.forShipment(id, isMock, mode)),
  };
  return { registry: spied, calls };
}

/**
 * The courier routes over the in-memory fake: one account per role, a confirmed COD order
 * for the customer, the operating settings seeded into the fake database, and a spy on every
 * courier adapter call. The settings cache is off (ttl 0) so a test may change the fake's
 * settings directly; caching itself is unit-tested.
 */
export function courierSetup(options: CourierSetupOptions = {}) {
  const env = options.env ?? {};
  const identity = new FakeIdentity();
  const store = new FakeCouriers(identity);
  store.operations.mode = options.mode ?? 'off';
  store.operations.bookingEnabled = options.bookingEnabled ?? false;
  store.operations.trackingSyncEnabled = options.trackingSyncEnabled ?? false;
  store.operations.trackingSyncIntervalSeconds = options.trackingSyncIntervalSeconds ?? 300;
  const users = Object.fromEntries(
    Object.entries(ACCOUNTS).map(([who, account]) => [who, identity.addUser(account)]),
  ) as Record<CourierWho, ReturnType<FakeIdentity['addUser']>>;
  const tokens = Object.fromEntries(
    (Object.keys(ACCOUNTS) as CourierWho[]).map((who) => [who, identity.tokenFor(users[who])]),
  ) as Record<CourierWho, string>;

  const config = testConfig(env);
  const now = () => store.clock;
  const { registry, calls } = spyOn(
    createCourierRegistry({ mockWebhookSecret: config.couriers.mockWebhookSecret, now }),
  );
  const logs = captureLogs('debug');
  const runtime = createCourierRuntime({ store, config: config.couriers, ttlMs: 0, now });
  const service = createCourierService({
    store,
    registry,
    config: config.couriers,
    runtime,
    logger: logs.logger,
    now,
  });
  const processor = createCourierProcessor({
    store,
    registry,
    runtime,
    logger: logs.logger,
    now,
  });
  const admin = new FakeAdmin(identity);
  const app = testApp({
    auth: identity.deps,
    admin: admin.stores,
    env,
    couriers: { service, processor },
    logger: logs.logger,
  });
  const order = store.addOrder(users.customer.id);

  function call(
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    who?: CourierWho,
    body?: object,
  ): request.Test {
    let pending = request(app)[method](`/api/v1${path}`);
    if (who) pending = pending.set('Authorization', `Bearer ${tokens[who]}`);
    return body === undefined ? pending : pending.send(body);
  }

  function caller(who: CourierWho): CourierCaller {
    return { accessToken: tokens[who], userId: users[who].id };
  }

  function grant(who: CourierWho, ...permissions: Permission[]): void {
    for (const permission of permissions) users[who].overrides.set(permission, 'grant');
  }

  return {
    identity,
    store,
    admin,
    users,
    tokens,
    config,
    runtime,
    service,
    processor,
    app,
    order,
    calls,
    logs,
    call,
    caller,
    grant,
  };
}

export type CourierSetup = ReturnType<typeof courierSetup>;
