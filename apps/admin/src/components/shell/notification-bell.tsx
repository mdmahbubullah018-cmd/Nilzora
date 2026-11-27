import { cache } from 'react';
import { adminRead } from '@/components/admin-kit/read';
import { unreadBadge } from '@/lib/notifications';
import { NotificationMenu, type NotificationPreview } from './notification-menu';
import { AutoText } from '@/components/i18n/translate';

/** How many of the latest notifications the menu previews. */
export const NOTIFICATION_PREVIEW_COUNT = 5;

/**
 * The inbox preview for this request: the unread count and the latest few notifications,
 * read once and shared by the bell and the rail's badge (React's request cache) — no
 * polling, no socket, no new queue.
 */
const readInboxPreview = cache(() =>
  adminRead((api, token) =>
    api.staffNotifications(token, { pageSize: NOTIFICATION_PREVIEW_COUNT }),
  ),
);

/**
 * The header's inbox menu. A failed read shows the bell without a number or preview
 * rather than anything it cannot vouch for, so a transient API fault never nags staff
 * about notifications that may not exist.
 */
export async function NotificationBell() {
  const inbox = await readInboxPreview();
  const count = inbox.kind === 'ok' ? inbox.value.unread : 0;
  const items: NotificationPreview[] =
    inbox.kind === 'ok'
      ? inbox.value.notifications.map((notification) => ({
          id: notification.id,
          kind: notification.kind,
          title: notification.title,
          body: notification.body,
          actionPath: notification.actionPath,
          unread: notification.readAt === null,
          createdAt: notification.createdAt,
        }))
      : [];

  return <NotificationMenu count={count} items={items} available={inbox.kind === 'ok'} />;
}

/** The unread count beside "Notifications" in the rail; nothing at all when zero or unknown. */
export async function NotificationNavBadge() {
  const inbox = await readInboxPreview();
  const badge = inbox.kind === 'ok' ? unreadBadge(inbox.value.unread) : null;
  if (badge === null) return null;
  return (
    <>
      <span aria-hidden="true">
        <AutoText value={badge} />
      </span>
      <span className="sr-only">{`, ${badge} unread`}</span>
    </>
  );
}
