import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNotificationProcessor,
  retryDelaySeconds,
  startNotificationWorker,
} from '../modules/notifications/worker';
import { claimed, FakeNotificationStore, FakePushSender } from './notification-fakes';
import { captureLogs } from './helpers';

const TOKEN_A = 'fcm-token-A-SECRET-0123456789';
const TOKEN_B = 'fcm-token-B-SECRET-0123456789';

function setup() {
  const store = new FakeNotificationStore();
  const sender = new FakePushSender();
  const logs = captureLogs('debug');
  const processor = createNotificationProcessor({
    store,
    sender,
    logger: logs.logger,
    random: () => 0.5,
  });
  return { store, sender, logs, processor };
}

function withDevices(store: FakeNotificationStore, userId: string, ...tokens: string[]) {
  store.devices.set(
    userId,
    tokens.map((token, index) => ({
      id: `de000000-0000-4000-8000-00000000000${index + 1}`,
      token,
    })),
  );
}

describe('notification processor', () => {
  it('sends the order text to every device and finishes the row as sent', async () => {
    const { store, sender, processor } = setup();
    const n = claimed({ toStatus: 'shipped', orderNumber: 'NZ100777' });
    store.queue = [n];
    withDevices(store, n.userId, TOKEN_A, TOKEN_B);

    await expect(processor.runOnce()).resolves.toEqual({
      claimed: 1,
      sent: 1,
      retried: 0,
      failed: 0,
      skipped: 0,
    });

    expect(sender.sent.map((m) => m.token)).toEqual([TOKEN_A, TOKEN_B]);
    expect(sender.sent[0]).toMatchObject({
      title: 'Order on its way',
      body: 'Order NZ100777 has been shipped.',
      data: { orderNumber: 'NZ100777' },
    });
    expect(store.finished).toEqual([{ id: n.id, outcome: 'sent' }]);
    expect(store.invalidated).toEqual([]);
  });

  it('marks dead tokens and still counts the notification sent when another device got it', async () => {
    const { store, sender, processor } = setup();
    const n = claimed();
    store.queue = [n];
    withDevices(store, n.userId, TOKEN_A, TOKEN_B);
    sender.outcomes.set(TOKEN_A, { kind: 'invalid_token' });

    await processor.runOnce();

    expect(store.invalidated).toEqual(['de000000-0000-4000-8000-000000000001']);
    expect(store.finished).toEqual([{ id: n.id, outcome: 'sent' }]);
  });

  it('skips a notification whose every token is dead, after marking them', async () => {
    const { store, sender, processor } = setup();
    const n = claimed();
    store.queue = [n];
    withDevices(store, n.userId, TOKEN_A);
    sender.outcomes.set(TOKEN_A, { kind: 'invalid_token' });

    await expect(processor.runOnce()).resolves.toMatchObject({ skipped: 1, sent: 0 });

    expect(store.invalidated).toHaveLength(1);
    expect(store.finished).toEqual([{ id: n.id, outcome: 'skipped', errorCode: 'no_device' }]);
  });

  it('skips, without calling FCM, when the account has no deliverable device', async () => {
    const { store, sender, processor } = setup();
    const n = claimed();
    store.queue = [n];

    await expect(processor.runOnce()).resolves.toMatchObject({ skipped: 1 });

    expect(sender.sent).toHaveLength(0);
    expect(store.finished).toEqual([{ id: n.id, outcome: 'skipped', errorCode: 'no_device' }]);
  });

  it('does not send to an account that switched order updates off', async () => {
    const { store, sender, processor } = setup();
    const n = claimed();
    store.queue = [n];
    withDevices(store, n.userId, TOKEN_A);
    store.refusedUsers.add(n.userId);

    await expect(processor.runOnce()).resolves.toMatchObject({ skipped: 1, sent: 0 });

    // Nothing was sent, and the row is closed rather than retried for ever.
    expect(sender.sent).toHaveLength(0);
    expect(store.finished).toEqual([{ id: n.id, outcome: 'skipped', errorCode: 'preference_off' }]);
    // The account's own choice was the only thing consulted.
    expect(store.preferenceChecks).toEqual([n.userId]);
  });

  it('sends when the account has no preference row at all, as before the table existed', async () => {
    const { store, sender, processor } = setup();
    const n = claimed();
    store.queue = [n];
    withDevices(store, n.userId, TOKEN_A);

    await expect(processor.runOnce()).resolves.toMatchObject({ sent: 1 });

    expect(sender.sent).toHaveLength(1);
    expect(store.preferenceChecks).toEqual([n.userId]);
  });

  it('retries when the preference cannot be read, so a database blip does not drop a push', async () => {
    const { store, sender, processor } = setup();
    const n = claimed();
    store.queue = [n];
    withDevices(store, n.userId, TOKEN_A);
    store.preferenceError = new Error('unreachable');

    await expect(processor.runOnce()).resolves.toMatchObject({ retried: 1 });

    expect(sender.sent).toHaveLength(0);
    expect(store.finished[0]).toMatchObject({ id: n.id, outcome: 'retry' });
  });

  it('retries when FCM is unavailable, waiting at least what FCM asked for', async () => {
    const { store, sender, processor } = setup();
    const n = claimed({ attempts: 2 });
    store.queue = [n];
    withDevices(store, n.userId, TOKEN_A);
    sender.outcomes.set(TOKEN_A, {
      kind: 'retry',
      code: 'fcm_rate_limited',
      retryAfterSeconds: 300,
    });

    await expect(processor.runOnce()).resolves.toMatchObject({ retried: 1 });
    expect(store.finished).toEqual([
      { id: n.id, outcome: 'retry', retrySeconds: 300, errorCode: 'fcm_rate_limited' },
    ]);
  });

  it('does not retry a send that may already have been accepted, and records the doubt', async () => {
    const { store, sender, logs, processor } = setup();
    const n = claimed();
    store.queue = [n];
    withDevices(store, n.userId, TOKEN_A);
    sender.outcomes.set(TOKEN_A, { kind: 'uncertain', code: 'fcm_timeout' });

    await expect(processor.runOnce()).resolves.toEqual({
      claimed: 1,
      sent: 0,
      retried: 0,
      failed: 1,
      skipped: 0,
    });
    // Never retried (FCM cannot deduplicate a resend) and never called delivered either.
    expect(store.finished).toEqual([
      { id: n.id, outcome: 'failed', errorCode: 'delivery_uncertain' },
    ]);
    expect(logs.raw()).toContain('delivery outcome is uncertain');
  });

  it('does not repeat a push that already reached one device when another device must retry', async () => {
    const { store, sender, processor } = setup();
    const n = claimed();
    store.queue = [n];
    withDevices(store, n.userId, TOKEN_A, TOKEN_B);
    sender.outcomes.set(TOKEN_B, { kind: 'retry', code: 'fcm_unavailable' });

    await processor.runOnce();
    expect(store.finished).toEqual([{ id: n.id, outcome: 'sent' }]);
  });

  it('does not repeat a push when one device may have received it and another failed', async () => {
    const { store, sender, processor } = setup();
    const n = claimed();
    store.queue = [n];
    withDevices(store, n.userId, TOKEN_A, TOKEN_B);
    sender.outcomes.set(TOKEN_A, { kind: 'uncertain', code: 'fcm_timeout' });
    sender.outcomes.set(TOKEN_B, { kind: 'retry', code: 'fcm_unavailable' });

    // A retry would send to both again, repeating it on the device that may already have it.
    await expect(processor.runOnce()).resolves.toMatchObject({ retried: 0, failed: 1 });
    expect(store.finished).toEqual([
      { id: n.id, outcome: 'failed', errorCode: 'delivery_uncertain' },
    ]);
  });

  it('sends every attempt of one notification under the same identity', async () => {
    const { store, sender, processor } = setup();
    const n = claimed();
    store.queue = [n];
    withDevices(store, n.userId, TOKEN_A, TOKEN_B);

    await processor.runOnce();
    // The same row claimed again, as after a lease expiry or a worker restart.
    store.queue = [{ ...n, attempts: 2 }];
    await processor.runOnce();

    expect(sender.sent.map((message) => message.tag)).toEqual([n.id, n.id, n.id, n.id]);
  });

  it('gives two different notifications two different identities', async () => {
    const { store, sender, processor } = setup();
    const first = claimed();
    const second = claimed();
    store.queue = [first, second];
    withDevices(store, first.userId, TOKEN_A);
    withDevices(store, second.userId, TOKEN_B);

    await processor.runOnce();

    const tags = new Set(sender.sent.map((message) => message.tag));
    expect(tags).toEqual(new Set([first.id, second.id]));
  });

  it('gives up at once on a permanent failure', async () => {
    const { store, sender, processor } = setup();
    const n = claimed();
    store.queue = [n];
    withDevices(store, n.userId, TOKEN_A);
    sender.outcomes.set(TOKEN_A, { kind: 'failed', code: 'fcm_rejected' });

    await expect(processor.runOnce()).resolves.toMatchObject({ failed: 1 });
    expect(store.finished).toEqual([{ id: n.id, outcome: 'failed', errorCode: 'fcm_rejected' }]);
  });

  it('treats a sender that throws as a retry', async () => {
    const { store, sender, processor } = setup();
    const n = claimed();
    store.queue = [n];
    withDevices(store, n.userId, TOKEN_A);
    sender.outcomes.set(TOKEN_A, new Error(`boom ${TOKEN_A}`));

    await expect(processor.runOnce()).resolves.toMatchObject({ retried: 1 });
    expect(store.finished[0]).toMatchObject({ outcome: 'retry', errorCode: 'send_error' });
  });

  it('fails a status that has no text, without sending', async () => {
    const { store, sender, processor } = setup();
    const n = claimed({ toStatus: 'pending' });
    store.queue = [n];
    withDevices(store, n.userId, TOKEN_A);

    await processor.runOnce();
    expect(sender.sent).toHaveLength(0);
    expect(store.finished).toEqual([
      { id: n.id, outcome: 'failed', errorCode: 'unsupported_status' },
    ]);
  });

  it('keeps going when one notification hits a database error', async () => {
    const { store, sender, processor } = setup();
    const first = claimed();
    const second = claimed();
    store.queue = [first, second];
    withDevices(store, second.userId, TOKEN_A);
    const original = store.deliverableDevices.bind(store);
    store.deliverableDevices = (userId) =>
      userId === first.userId ? Promise.reject(new Error('database down')) : original(userId);

    await expect(processor.runOnce()).resolves.toMatchObject({ claimed: 2, sent: 1, retried: 1 });
    expect(store.finished).toContainEqual(
      expect.objectContaining({ id: first.id, outcome: 'retry', errorCode: 'worker_error' }),
    );
    expect(store.finished).toContainEqual({ id: second.id, outcome: 'sent' });
    expect(sender.sent).toHaveLength(1);
  });

  it('leaves the row to its lease when even reporting the failure fails', async () => {
    const { store, processor } = setup();
    store.queue = [claimed()];
    store.devicesError = new Error('database down');
    store.finishError = new Error('database down');

    await expect(processor.runOnce()).resolves.toMatchObject({ claimed: 1, retried: 1 });
    expect(store.finished).toHaveLength(0);
  });

  it('survives a failure to mark dead tokens', async () => {
    const { store, sender, processor } = setup();
    const n = claimed();
    store.queue = [n];
    withDevices(store, n.userId, TOKEN_A, TOKEN_B);
    sender.outcomes.set(TOKEN_A, { kind: 'invalid_token' });
    store.invalidateError = new Error('database down');

    await processor.runOnce();
    expect(store.finished).toEqual([{ id: n.id, outcome: 'sent' }]);
  });

  it('lets a claim failure through to the caller', async () => {
    const { store, processor } = setup();
    store.claimError = new Error('database down');
    await expect(processor.runOnce()).rejects.toThrow('database down');
  });

  it('never writes tokens, message texts or order numbers to the logs', async () => {
    const { store, sender, logs, processor } = setup();
    const n = claimed({ orderNumber: 'NZ100999' });
    store.queue = [n, claimed()];
    withDevices(store, n.userId, TOKEN_A);
    sender.outcomes.set(TOKEN_A, new Error(`boom ${TOKEN_A}`));
    store.devicesError = undefined;
    const original = store.deliverableDevices.bind(store);
    store.deliverableDevices = (userId) =>
      userId === n.userId
        ? original(userId)
        : Promise.reject(new Error(`db error with ${TOKEN_B}`));

    await processor.runOnce();

    const raw = logs.raw();
    expect(raw).toContain('Notification attempt failed');
    expect(raw).not.toContain('SECRET');
    expect(raw).not.toContain('NZ100999');
  });

  it('claims with the configured batch size and lease', async () => {
    const store = new FakeNotificationStore();
    const claim = vi.spyOn(store, 'claim');
    const processor = createNotificationProcessor({
      store,
      sender: new FakePushSender(),
      logger: captureLogs().logger,
      batchSize: 7,
      leaseSeconds: 90,
    });
    await processor.runOnce();
    expect(claim).toHaveBeenCalledWith(7, 90);
  });
});

describe('retryDelaySeconds', () => {
  it('doubles from 30 seconds and stops at 15 minutes', () => {
    const delays = [1, 2, 3, 4, 5, 6, 7].map((attempt) => retryDelaySeconds(attempt, () => 0.5));
    expect(delays).toEqual([30, 60, 120, 240, 480, 900, 900]);
  });

  it('jitters by 20% either way', () => {
    expect(retryDelaySeconds(1, () => 0)).toBe(24);
    expect(retryDelaySeconds(1, () => 0.999)).toBe(36);
  });
});

describe('notification worker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls on a timer, goes straight on after a full batch, and stops cleanly', async () => {
    const store = new FakeNotificationStore();
    const logs = captureLogs('debug');
    const worker = startNotificationWorker({
      store,
      sender: new FakePushSender(),
      logger: logs.logger,
      pollIntervalMs: 5_000,
      batchSize: 2,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(store.claims).toBe(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(store.claims).toBe(2);

    // A full batch is followed by an immediate poll instead of waiting.
    store.queue = [claimed(), claimed()];
    await vi.advanceTimersByTimeAsync(5_000);
    expect(store.claims).toBeGreaterThanOrEqual(4);

    await worker.stop();
    const claimsAtStop = store.claims;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.claims).toBe(claimsAtStop);
  });

  it('backs off with jitter when claiming fails, keeps running, and logs no secrets', async () => {
    const store = new FakeNotificationStore();
    store.claimError = new Error('claim_notifications failed (network)');
    const logs = captureLogs('debug');
    const worker = startNotificationWorker({
      store,
      sender: new FakePushSender(),
      logger: logs.logger,
      pollIntervalMs: 1_000,
      random: () => 0.5,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(store.claims).toBe(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(store.claims).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(store.claims).toBe(2);
    // The second failure waits longer (4 seconds).
    await vi.advanceTimersByTimeAsync(3_998);
    expect(store.claims).toBe(2);
    await vi.advanceTimersByTimeAsync(2);
    expect(store.claims).toBe(3);

    store.claimError = undefined;
    await worker.stop();
    expect(logs.raw()).toContain('Notification worker could not poll');
  });

  it('stop() returns promptly even while sleeping', async () => {
    const store = new FakeNotificationStore();
    const worker = startNotificationWorker({
      store,
      sender: new FakePushSender(),
      logger: captureLogs().logger,
      pollIntervalMs: 3_600_000,
    });
    await vi.advanceTimersByTimeAsync(0);
    await expect(worker.stop()).resolves.toBeUndefined();
  });
});
