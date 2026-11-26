import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createSupabaseNotificationStore } from '../../modules/notifications/store';
import { createNotificationProcessor } from '../../modules/notifications/worker';
import { createSupabaseClients } from '../../supabase/clients';
import { captureLogs, testConfig } from '../helpers';
import { FakePushSender } from '../notification-fakes';

/*
 * The notification outbox against the local Supabase stack: the real trigger on
 * order_status_history, the real claim / finish / invalidate functions, the real
 * deliverable_device_tokens (which needs a live Auth session) and the real store the
 * worker uses. FCM is replaced by a fake sender: no network call leaves this machine. Each
 * run creates its own accounts (@example.com), orders and tokens and removes them afterwards.
 * Status changes are written to order_status_history directly (as the order functions
 * do), since the trigger on that table is what is under test.
 */

const local = inject('supabase');
const config = testConfig({
  SUPABASE_URL: local.url,
  SUPABASE_PUBLISHABLE_KEY: local.publishableKey,
  SUPABASE_SECRET_KEY: local.secretKey,
});
const clients = createSupabaseClients(config.supabase);
const store = createSupabaseNotificationStore(clients);

const run = randomUUID().slice(0, 8);
const PASSWORD = 'shopping2026';
const tokenFor = (label: string) => `it-${run}-${label}-push-token-0000`;

interface Customer {
  id: string;
  email: string;
  accessToken: string;
  orderId: string;
  orderNumber: string;
}

type Label = 'amy' | 'ben' | 'cal' | 'dan';
const customers = {} as Record<Label, Customer>;

async function must<T>(
  result: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<NonNullable<T>> {
  const { data, error } = await result;
  if (error) throw new Error(error.message);
  if (data === null || data === undefined) throw new Error('the query returned no data');
  return data;
}

async function createCustomer(label: Label): Promise<void> {
  const email = `it-${run}-${label}@example.com`;
  const { data, error } = await clients.admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;

  const login = await clients.public().auth.signInWithPassword({ email, password: PASSWORD });
  if (login.error) throw login.error;

  const order = await must(
    clients.admin
      .from('orders')
      .insert({
        user_id: data.user.id,
        item_count: 1,
        subtotal_minor: 100_000,
        shipping_fee_minor: 6_000,
        total_minor: 106_000,
        delivery_zone: 'inside_dhaka',
        ship_recipient_name: 'Integration Test',
        ship_phone: '01700000000',
        ship_division: 'Dhaka',
        ship_district: 'Dhaka',
        ship_area: 'Area',
        ship_address_line: 'Line',
        idempotency_key: randomUUID(),
        request_fingerprint: 'it',
      })
      .select('id, order_number')
      .single(),
  );
  customers[label] = {
    id: data.user.id,
    email,
    accessToken: login.data.session.access_token,
    orderId: order.id,
    orderNumber: order.order_number,
  };
}

async function registerDevice(who: Customer, token: string): Promise<void> {
  const { error } = await clients
    .asUser(who.accessToken)
    .rpc('register_device_token', { p_token: token, p_platform: 'android' });
  if (error) throw new Error(error.message);
}

/** Staff confirm/ship/...: the history row whose trigger queues the notification. */
async function changeStatus(
  who: Customer,
  to: 'confirmed' | 'shipped' | 'delivered' | 'cancelled',
) {
  await must(
    clients.admin
      .from('order_status_history')
      .insert({ order_id: who.orderId, from_status: 'pending', to_status: to, actor_kind: 'staff' })
      .select('id')
      .single(),
  );
}

async function outboxOf(who: Customer) {
  return must(
    clients.admin
      .from('notification_outbox')
      .select('id, status, attempts, to_status, last_error, sent_at, order_number')
      .eq('user_id', who.id)
      .order('created_at'),
  );
}

function processor(sender: FakePushSender, batchSize = 100) {
  return createNotificationProcessor({
    store,
    sender,
    logger: captureLogs().logger,
    batchSize,
    random: () => 0.5,
  });
}

beforeAll(async () => {
  await createCustomer('amy');
  await createCustomer('ben');
  await createCustomer('cal');
  await createCustomer('dan');
});

afterAll(async () => {
  const ids = Object.values(customers).map((c) => c.id);
  if (ids.length > 0) {
    // Orders are protected from deleting their customer; removing them also removes
    // the status history and the outbox rows.
    await clients.admin.from('orders').delete().in('user_id', ids);
    for (const id of ids) await clients.admin.auth.admin.deleteUser(id);
  }
});

describe('order status changes queue notifications', () => {
  it('queues one pending notification per customer-facing change, in the same write', async () => {
    const { ben } = customers;
    await changeStatus(ben, 'confirmed');
    await changeStatus(ben, 'shipped');

    const rows = await outboxOf(ben);
    expect(rows.map((r) => [r.to_status, r.status, r.attempts, r.order_number])).toEqual([
      ['confirmed', 'pending', 0, ben.orderNumber],
      ['shipped', 'pending', 0, ben.orderNumber],
    ]);
  });
});

describe('the worker against the real database', () => {
  it('sends to the live device, records it as sent, and never sends it twice', async () => {
    const { amy } = customers;
    await registerDevice(amy, tokenFor('amy-1'));
    await changeStatus(amy, 'shipped');

    const sender = new FakePushSender();
    const first = await processor(sender).runOnce();
    expect(first.sent).toBeGreaterThanOrEqual(1);

    const mine = sender.sent.filter((m) => m.token === tokenFor('amy-1'));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      title: 'Order on its way',
      data: { orderNumber: amy.orderNumber },
    });

    const [row] = await outboxOf(amy);
    expect(row).toMatchObject({ status: 'sent', attempts: 1, last_error: null });
    expect(row?.sent_at).not.toBeNull();

    const sender2 = new FakePushSender();
    await processor(sender2).runOnce();
    expect(sender2.sent.filter((m) => m.token === tokenFor('amy-1'))).toHaveLength(0);
  });

  it('marks a token the push service calls dead, so it is not deliverable any more', async () => {
    const { cal } = customers;
    await registerDevice(cal, tokenFor('cal-dead'));
    await changeStatus(cal, 'confirmed');

    const sender = new FakePushSender();
    sender.outcomes.set(tokenFor('cal-dead'), { kind: 'invalid_token' });
    await processor(sender).runOnce();

    const [row] = await outboxOf(cal);
    expect(row).toMatchObject({ status: 'skipped', last_error: 'no_device' });
    const deliverable = await must(
      clients.admin.rpc('deliverable_device_tokens', { p_user_id: cal.id }),
    );
    expect(deliverable).toEqual([]);
    const stored = await must(
      clients.admin
        .from('device_tokens')
        .select('invalidated_at')
        .eq('token', tokenFor('cal-dead')),
    );
    expect(stored[0]?.invalidated_at).not.toBeNull();
  });

  it('retries a temporary failure later and does not claim it again before then', async () => {
    const { ben } = customers;
    await registerDevice(ben, tokenFor('ben-1'));
    await changeStatus(ben, 'delivered');

    const sender = new FakePushSender();
    sender.outcomes.set(tokenFor('ben-1'), {
      kind: 'retry',
      code: 'fcm_unavailable',
      retryAfterSeconds: 600,
    });
    const result = await processor(sender).runOnce();
    expect(result.retried).toBeGreaterThanOrEqual(1);

    const row = (await outboxOf(ben)).at(-1);
    expect(row).toMatchObject({
      to_status: 'delivered',
      status: 'pending',
      attempts: 1,
      last_error: 'fcm_unavailable',
    });

    const again = new FakePushSender();
    await processor(again).runOnce();
    expect(again.sent.filter((m) => m.token === tokenFor('ben-1'))).toHaveLength(0);
  });

  it('skips a customer whose only session has ended (their token is no longer deliverable)', async () => {
    const { cal } = customers;
    const login = await clients
      .public()
      .auth.signInWithPassword({ email: cal.email, password: PASSWORD });
    if (login.error) throw login.error;
    const session = { ...cal, accessToken: login.data.session.access_token };
    await registerDevice(session, tokenFor('cal-2'));
    await clients.admin.auth.admin.signOut(login.data.session.access_token, 'global');

    await changeStatus(cal, 'delivered');
    const sender = new FakePushSender();
    await processor(sender).runOnce();

    expect(sender.sent.filter((m) => m.token === tokenFor('cal-2'))).toHaveLength(0);
    const rows = await outboxOf(cal);
    expect(rows.at(-1)).toMatchObject({
      to_status: 'delivered',
      status: 'skipped',
      last_error: 'no_device',
    });
  });

  it('skips a suspended account without an attempt', async () => {
    const { amy } = customers;
    await must(
      clients.admin.from('profiles').update({ status: 'suspended' }).eq('id', amy.id).select('id'),
    );
    try {
      await changeStatus(amy, 'cancelled');
      const sender = new FakePushSender();
      await processor(sender).runOnce();

      expect(sender.sent.filter((m) => m.token === tokenFor('amy-1'))).toHaveLength(0);
      const rows = await outboxOf(amy);
      expect(rows.at(-1)).toMatchObject({
        status: 'skipped',
        attempts: 0,
        last_error: 'account_inactive',
      });
    } finally {
      await must(
        clients.admin.from('profiles').update({ status: 'active' }).eq('id', amy.id).select('id'),
      );
    }
  });
});

describe('the account’s own choice', () => {
  /** The customer switches order updates from Settings, through the function the app uses. */
  async function setOrderUpdates(who: Customer, enabled: boolean): Promise<void> {
    const client = clients.asUser(who.accessToken) as unknown as {
      rpc: (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ error: { message: string } | null }>;
    };
    const { error } = await client.rpc('save_my_notification_preferences', {
      p_preferences: { orderUpdates: enabled },
    });
    if (error) throw new Error(error.message);
  }

  it('sends nothing while order updates are off, and records why', async () => {
    const { dan } = customers;
    await registerDevice(dan, tokenFor('dan-1'));
    await setOrderUpdates(dan, false);

    await changeStatus(dan, 'shipped');
    const sender = new FakePushSender();
    await processor(sender).runOnce();

    expect(sender.sent.filter((m) => m.token === tokenFor('dan-1'))).toHaveLength(0);
    const [row] = await outboxOf(dan);
    expect(row).toMatchObject({
      to_status: 'shipped',
      status: 'skipped',
      attempts: 1,
      last_error: 'preference_off',
    });
  });

  it('sends again once the account switches them back on', async () => {
    const { dan } = customers;
    await setOrderUpdates(dan, true);

    await changeStatus(dan, 'delivered');
    const sender = new FakePushSender();
    await processor(sender).runOnce();

    expect(sender.sent.filter((m) => m.token === tokenFor('dan-1'))).toHaveLength(1);
    const rows = await outboxOf(dan);
    expect(rows.at(-1)).toMatchObject({ to_status: 'delivered', status: 'sent' });
  });

  it('still sends to an account that never opened Settings', async () => {
    // amy registered before the preference table existed, so she has no row: the sender's
    // question must answer "yes" rather than silence her.
    const { amy } = customers;
    const answer = await clients.admin.rpc('notification_allowed', { p_user_id: amy.id });
    if (answer.error) throw answer.error;
    expect(answer.data).toBe(true);

    await changeStatus(amy, 'delivered');
    const sender = new FakePushSender();
    await processor(sender).runOnce();

    expect(sender.sent.filter((m) => m.token === tokenFor('amy-1'))).toHaveLength(1);
  });
});

describe('simultaneous workers', () => {
  it('never claim the same notification twice', async () => {
    const { ben } = customers;
    for (let i = 0; i < 8; i += 1) await changeStatus(ben, 'shipped');
    // Due now, whatever earlier tests scheduled.
    await must(
      clients.admin
        .from('notification_outbox')
        .update({ status: 'pending', next_attempt_at: new Date(Date.now() - 60_000).toISOString() })
        .eq('user_id', ben.id)
        .select('id'),
    );

    const [a, b, c] = await Promise.all([
      store.claim(5, 60),
      store.claim(5, 60),
      store.claim(5, 60),
    ]);
    const ids = [...(a ?? []), ...(b ?? []), ...(c ?? [])].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);

    const mine = (await outboxOf(ben)).map((r) => r.id);
    expect(ids.filter((id) => mine.includes(id)).length).toBeGreaterThan(0);
  });
});

describe('closed to end users', () => {
  it('lets a signed-in customer neither read the outbox nor call the worker functions', async () => {
    const { amy } = customers;
    const asAmy = clients.asUser(amy.accessToken);

    const read = await asAmy.from('notification_outbox').select('id');
    expect(read.error?.code).toBe('42501');
    expect((await asAmy.rpc('claim_notifications', {})).error?.code).toBe('42501');
    expect((await asAmy.rpc('invalidate_device_tokens', { p_ids: [] })).error?.code).toBe('42501');
    expect(
      (await asAmy.rpc('finish_notification', { p_id: randomUUID(), p_outcome: 'sent' })).error
        ?.code,
    ).toBe('42501');
  });
});
