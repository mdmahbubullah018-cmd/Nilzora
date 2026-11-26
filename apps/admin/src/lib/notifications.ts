import type { StaffNotificationKind } from '@nilzora/contracts';
import { CartIcon } from '@nilzora/ui';
import { createElement, type ReactElement } from 'react';
import {
  Boxes,
  Inbox,
  MessageCircle,
  MessageSquareQuote,
  PackageCheck,
  Banknote,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';

/** How the inbox and the top bar's menu name each kind of staff notification. */
export const NOTIFICATION_KIND_LABELS: Record<StaffNotificationKind, string> = {
  order_new: 'New order',
  stock_low: 'Low stock',
  return_new: 'Return request',
  refund_action: 'Refund',
  moderation_pending: 'Review',
  chat_message: 'Chat message',
  chat_escalation: 'Chat escalation',
};

/** The icon for each kind (decorative; the label carries the meaning). */
export const NOTIFICATION_KIND_ICONS: Record<StaffNotificationKind, LucideIcon> = {
  order_new: CartIcon,
  stock_low: Boxes,
  return_new: PackageCheck,
  refund_action: Banknote,
  moderation_pending: MessageSquareQuote,
  chat_message: MessageCircle,
  chat_escalation: ShieldAlert,
};

/** A kind's label, tolerating kinds a newer API may add. */
export function notificationKindLabel(kind: string): string {
  return (NOTIFICATION_KIND_LABELS as Record<string, string>)[kind] ?? 'Notification';
}

/** A kind's icon, tolerating kinds a newer API may add. */
export function notificationKindIcon(kind: string): LucideIcon {
  return (NOTIFICATION_KIND_ICONS as Record<string, LucideIcon>)[kind] ?? Inbox;
}

/**
 * A kind's icon as an element. A plain function (not a component) so a component can show a
 * kind's icon without creating a component during render.
 */
export function notificationKindIconElement(kind: string, className: string): ReactElement {
  return createElement(notificationKindIcon(kind), {
    className,
    strokeWidth: 1.75,
    'aria-hidden': true,
  });
}

/** The unread count as the bell shows it: nothing at zero, "99+" past 99. */
export function unreadBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}
