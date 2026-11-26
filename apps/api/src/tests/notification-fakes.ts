import type { PushMessage, PushOutcome, PushSender } from '../modules/notifications/fcm';
import type {
  ClaimedNotification,
  DeliverableDevice,
  FinishOutcome,
  NotificationStore,
} from '../modules/notifications/store';

/*
 * In-memory stand-ins for the notification outbox functions and the push service, for unit
 * tests of the worker. The real SQL (claiming, leases, backoff, privileges) is covered by
 * pgTAP and the integration test; these only record what the worker asked for.
 */

export interface FinishCall {
  id: string;
  outcome: FinishOutcome;
  retrySeconds?: number | undefined;
  errorCode?: string | undefined;
}

export class FakeNotificationStore implements NotificationStore {
  /** Handed out by the next claim(), then cleared. */
  queue: ClaimedNotification[] = [];
  devices = new Map<string, DeliverableDevice[]>();
  readonly finished: FinishCall[] = [];
  readonly invalidated: string[] = [];
  claims = 0;
  claimError: Error | undefined;
  devicesError: Error | undefined;
  invalidateError: Error | undefined;
  finishError: Error | undefined;
  /** Accounts that switched order updates off; everyone else is allowed. */
  refusedUsers = new Set<string>();
  preferenceError: Error | undefined;
  readonly preferenceChecks: string[] = [];

  claim(): Promise<ClaimedNotification[]> {
    this.claims += 1;
    if (this.claimError) return Promise.reject(this.claimError);
    const batch = this.queue;
    this.queue = [];
    return Promise.resolve(batch);
  }

  deliverableDevices(userId: string): Promise<DeliverableDevice[]> {
    if (this.devicesError) return Promise.reject(this.devicesError);
    return Promise.resolve(this.devices.get(userId) ?? []);
  }

  notificationAllowed(userId: string): Promise<boolean> {
    this.preferenceChecks.push(userId);
    if (this.preferenceError) return Promise.reject(this.preferenceError);
    return Promise.resolve(!this.refusedUsers.has(userId));
  }

  finish(
    id: string,
    outcome: FinishOutcome,
    options: { retrySeconds?: number; errorCode?: string } = {},
  ): Promise<void> {
    if (this.finishError) return Promise.reject(this.finishError);
    this.finished.push({ id, outcome, ...options });
    return Promise.resolve();
  }

  invalidateDevices(ids: readonly string[]): Promise<void> {
    if (this.invalidateError) return Promise.reject(this.invalidateError);
    this.invalidated.push(...ids);
    return Promise.resolve();
  }
}

/** Answers per device token; anything unlisted is sent. */
export class FakePushSender implements PushSender {
  readonly sent: PushMessage[] = [];
  readonly outcomes = new Map<string, PushOutcome | Error>();

  send(message: PushMessage): Promise<PushOutcome> {
    this.sent.push(message);
    const outcome = this.outcomes.get(message.token) ?? { kind: 'sent' };
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  }
}

let counter = 0;

export function claimed(overrides: Partial<ClaimedNotification> = {}): ClaimedNotification {
  counter += 1;
  const n = String(counter).padStart(12, '0');
  return {
    id: `0a000000-0000-4000-8000-${n}`,
    userId: `0b000000-0000-4000-8000-${n}`,
    orderNumber: 'NZ100001',
    kind: 'order_status',
    toStatus: 'shipped',
    shipmentStatus: null,
    attempts: 1,
    ...overrides,
  };
}
