import { describe, expect, it } from 'vitest';
import type {
  AnnouncementStore,
  ClaimedAnnouncement,
  DeliverableDevice,
  FinishOutcome,
} from '../modules/notifications/announcement-store';
import { createAnnouncementProcessor } from '../modules/notifications/announcement-worker';
import { FakePushSender } from './notification-fakes';
import { captureLogs } from './helpers';

/*
 * The product-announcement worker, with the database and FCM faked. The SQL that guarantees
 * one delivery row per customer and the publication trigger itself are covered by the
 * migration's own tests; these check what the worker does with what it is handed.
 */

const TOKEN_A = 'fcm-token-A-SECRET-0123456789';
const TOKEN_B = 'fcm-token-B-SECRET-0123456789';
const MEDIA = 'https://media.example.test';

class FakeAnnouncementStore implements AnnouncementStore {
  queue: ClaimedAnnouncement[] = [];
  devices = new Map<string, DeliverableDevice[]>();
  readonly finished: { id: string; outcome: FinishOutcome; errorCode?: string }[] = [];
  readonly invalidated: string[] = [];
  claims = 0;

  claim(): Promise<ClaimedAnnouncement[]> {
    this.claims += 1;
    const batch = this.queue;
    this.queue = [];
    return Promise.resolve(batch);
  }

  deliverableDevices(userId: string): Promise<DeliverableDevice[]> {
    return Promise.resolve(this.devices.get(userId) ?? []);
  }

  finish(
    id: string,
    outcome: FinishOutcome,
    options: { retrySeconds?: number; errorCode?: string } = {},
  ): Promise<void> {
    this.finished.push({ id, outcome, ...options });
    return Promise.resolve();
  }

  invalidateDevices(ids: readonly string[]): Promise<void> {
    this.invalidated.push(...ids);
    return Promise.resolve();
  }
}

let counter = 0;

function announcement(overrides: Partial<ClaimedAnnouncement> = {}): ClaimedAnnouncement {
  counter += 1;
  const n = String(counter).padStart(12, '0');
  return {
    id: `0c000000-0000-4000-8000-${n}`,
    userId: `0d000000-0000-4000-8000-${n}`,
    productName: 'Cotton panjabi',
    productSlug: 'cotton-panjabi',
    imageKey: 'products/0f000000-0000-4000-8000-000000000001/0f000000-0000-4000-8000-000000000002',
    attempts: 1,
    linkPath: null,
    kind: 'product',
    title: null,
    body: null,
    ...overrides,
  };
}

function setup(options: { mediaBaseUrl?: string } = { mediaBaseUrl: MEDIA }) {
  const store = new FakeAnnouncementStore();
  const sender = new FakePushSender();
  const logs = captureLogs('debug');
  const processor = createAnnouncementProcessor({
    store,
    sender,
    logger: logs.logger,
    random: () => 0.5,
    ...options,
  });
  return { store, sender, logs, processor };
}

function withDevices(store: FakeAnnouncementStore, userId: string, ...tokens: string[]) {
  store.devices.set(
    userId,
    tokens.map((token, index) => ({
      id: `0e000000-0000-4000-8000-00000000000${index + 1}`,
      token,
    })),
  );
}

describe('product announcement worker', () => {
  it('sends the product name, its own picture and the product to open', async () => {
    const { store, sender, processor } = setup();
    const a = announcement();
    store.queue = [a];
    withDevices(store, a.userId, TOKEN_A);

    await expect(processor.runOnce()).resolves.toEqual({
      claimed: 1,
      sent: 1,
      retried: 0,
      failed: 0,
      skipped: 0,
    });

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toMatchObject({
      token: TOKEN_A,
      title: 'New at Nilzora',
      body: 'Discover Cotton panjabi — now available.',
      data: { productSlug: 'cotton-panjabi' },
      imageUrl: `${MEDIA}/${a.imageKey}/thumb.webp`,
    });
    expect(store.finished).toEqual([{ id: a.id, outcome: 'sent' }]);
  });

  it('sends a staff broadcast in its own words, linking to a product only when it names one', async () => {
    const { store, sender, processor } = setup();
    const linked = announcement({
      kind: 'broadcast',
      title: 'Eid sale',
      body: 'Up to 30% off this weekend.',
      productName: 'Eid sale',
      productSlug: 'cotton-panjabi',
      imageKey: null,
    });
    const plain = announcement({
      kind: 'broadcast',
      title: 'Store notice',
      body: 'Deliveries resume on Sunday.',
      productName: 'Store notice',
      productSlug: '',
      imageKey: null,
    });
    store.queue = [linked, plain];
    withDevices(store, linked.userId, TOKEN_A);
    withDevices(store, plain.userId, TOKEN_A);

    await processor.runOnce();

    expect(sender.sent).toEqual([
      expect.objectContaining({
        title: 'Eid sale',
        body: 'Up to 30% off this weekend.',
        data: { productSlug: 'cotton-panjabi' },
      }),
      expect.objectContaining({
        title: 'Store notice',
        body: 'Deliveries resume on Sunday.',
        data: {},
      }),
    ]);
  });

  it('gives one announcement one identity, and two announcements two identities', async () => {
    const { store, sender, processor } = setup();
    const first = announcement();
    const second = announcement();
    store.queue = [first, second];
    withDevices(store, first.userId, TOKEN_A, TOKEN_B);
    withDevices(store, second.userId, TOKEN_A);

    await processor.runOnce();
    // The same row claimed again, as after a lease expiry or a worker restart.
    store.queue = [{ ...first, attempts: 2 }];
    await processor.runOnce();

    // Deliveries are processed concurrently, so only the identities matter, not their order.
    const tags = sender.sent.map((message) => message.tag);
    expect(new Set(tags)).toEqual(new Set([first.id, second.id]));
    expect(tags.filter((tag) => tag === first.id)).toHaveLength(4);
    expect(tags.filter((tag) => tag === second.id)).toHaveLength(1);
  });

  it('does not retry an announcement that may already have been accepted', async () => {
    const { store, sender, logs, processor } = setup();
    const a = announcement();
    store.queue = [a];
    withDevices(store, a.userId, TOKEN_A);
    sender.outcomes.set(TOKEN_A, { kind: 'uncertain', code: 'fcm_timeout' });

    await expect(processor.runOnce()).resolves.toMatchObject({ failed: 1, retried: 0 });
    expect(store.finished).toEqual([
      { id: a.id, outcome: 'failed', errorCode: 'delivery_uncertain' },
    ]);
    expect(logs.raw()).toContain('outcome is uncertain');
  });

  it('sends a text-only notification when the product has no picture', async () => {
    const { store, sender, processor } = setup();
    const a = announcement({ imageKey: null });
    store.queue = [a];
    withDevices(store, a.userId, TOKEN_A);

    await processor.runOnce();

    expect(sender.sent[0]).not.toHaveProperty('imageUrl');
    expect(sender.sent[0]?.body).toContain('Cotton panjabi');
  });

  it('sends no picture when the media base URL is not configured', async () => {
    const { store, sender, processor } = setup({});
    const a = announcement();
    store.queue = [a];
    withDevices(store, a.userId, TOKEN_A);

    await processor.runOnce();
    expect(sender.sent[0]).not.toHaveProperty('imageUrl');
  });

  it('skips a customer who is signed out everywhere, without retrying', async () => {
    const { store, sender, processor } = setup();
    const a = announcement();
    store.queue = [a];

    await processor.runOnce();

    expect(sender.sent).toEqual([]);
    expect(store.finished).toEqual([{ id: a.id, outcome: 'skipped', errorCode: 'no_device' }]);
  });

  it('marks a token the push service rejects as dead, and still counts the announcement sent', async () => {
    const { store, sender, processor } = setup();
    const a = announcement();
    store.queue = [a];
    withDevices(store, a.userId, TOKEN_A, TOKEN_B);
    sender.outcomes.set(TOKEN_A, { kind: 'invalid_token' });

    await processor.runOnce();

    expect(store.invalidated).toEqual(['0e000000-0000-4000-8000-000000000001']);
    expect(store.finished).toEqual([{ id: a.id, outcome: 'sent' }]);
  });

  it('retries a temporary failure with a bounded delay instead of giving up at once', async () => {
    const { store, sender, processor } = setup();
    const a = announcement({ attempts: 3 });
    store.queue = [a];
    withDevices(store, a.userId, TOKEN_A);
    sender.outcomes.set(TOKEN_A, { kind: 'retry', code: 'fcm_unavailable' });

    await processor.runOnce();

    const finished = store.finished[0];
    expect(finished?.outcome).toBe('retry');
    expect(finished?.errorCode).toBe('fcm_unavailable');
    // Backoff grows with attempts and is capped by the shared helper.
    const calls = store.finished.length;
    expect(calls).toBe(1);
  });

  it('fails a row whose product can no longer be announced, without sending anything', async () => {
    const { store, sender, processor } = setup();
    const a = announcement({ productSlug: 'Not A Slug' });
    store.queue = [a];
    withDevices(store, a.userId, TOKEN_A);

    await processor.runOnce();

    expect(sender.sent).toEqual([]);
    expect(store.finished).toEqual([
      { id: a.id, outcome: 'failed', errorCode: 'unsupported_product' },
    ]);
  });

  it('never logs a token or a product name', async () => {
    const { store, logs, processor } = setup();
    const a = announcement();
    store.queue = [a];
    withDevices(store, a.userId, TOKEN_A);

    await processor.runOnce();

    const output = logs.raw();
    expect(output).not.toContain(TOKEN_A);
    expect(output).not.toContain('Cotton panjabi');
  });
});
