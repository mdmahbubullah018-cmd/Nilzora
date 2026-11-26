import type { DomainEvent } from '@nilzora/contracts';
import { QueryClient } from '@tanstack/react-query';
import { createEventCursor, invalidateFor } from '@/features/events/live-events';
import { queryKeys } from '@/query/query-keys';

const USER = '00000000-0000-4000-8000-0000000000c1';

function event(seq: number, type: string): DomainEvent {
  return {
    seq,
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    type,
    version: 1,
    aggregateType: 'order',
    aggregateId: 'NZ-1001',
    payload: {},
    occurredAt: new Date().toISOString(),
  };
}

describe('the event cursor', () => {
  it('processes each seq once, whether it arrives live, in a catch-up read or both', () => {
    const cursor = createEventCursor(10);
    expect(cursor.accept(11)).toBe(true);
    expect(cursor.accept(11)).toBe(false); // the same event again (live + catch-up)
    expect(cursor.accept(9)).toBe(false); // older than where this app started
    expect(cursor.accept(14)).toBe(true);
    expect(cursor.value).toBe(14);
  });
});

describe('what an event refreshes', () => {
  it('refreshes orders for order and payment events, and notifications for a new notification', async () => {
    const client = new QueryClient();
    const orders = queryKeys.orders.all(USER);
    const notifications = queryKeys.notifications.all(USER);
    client.setQueryData(orders, 'orders');
    client.setQueryData(notifications, 'notifications');

    invalidateFor(client, USER, event(1, 'order.shipped'));
    await Promise.resolve();
    expect(client.getQueryState(orders)?.isInvalidated).toBe(true);
    expect(client.getQueryState(notifications)?.isInvalidated).toBe(false);

    invalidateFor(client, USER, event(2, 'customer_notification.created'));
    await Promise.resolve();
    expect(client.getQueryState(notifications)?.isInvalidated).toBe(true);
    client.clear();
  });

  it('ignores an event type this app does not know', () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.orders.all(USER), 'orders');
    invalidateFor(client, USER, event(3, 'inventory.recounted'));
    expect(client.getQueryState(queryKeys.orders.all(USER))?.isInvalidated).toBe(false);
    client.clear();
  });
});
