'use client';

import { cn } from '@nilzora/ui';
import { Bell, BellOff } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRef } from 'react';
import { useDetailsDismiss } from '@/components/admin-kit/use-details-dismiss';
import { notificationKindIcon, notificationKindLabel, unreadBadge } from '@/lib/notifications';
import { AutoText } from '@/components/i18n/translate';
import { RelativeTimeText } from '@/components/i18n/format-text';

export interface NotificationPreview {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  /** The Admin page that acts on it, or null when there is nothing to open. */
  actionPath: string | null;
  unread: boolean;
  createdAt: string;
}

export interface NotificationMenuProps {
  count: number;
  items: readonly NotificationPreview[];
  /** False when the inbox could not be read (the menu then says so instead of "all clear"). */
  available: boolean;
}

const INBOX = '/admin/notifications' as Route;

/**
 * The bell and its dropdown. A native <details>, so it opens without JavaScript; the
 * inbox link inside always works, and Escape or a click outside closes it.
 */
export function NotificationMenu({ count, items, available }: NotificationMenuProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  const { onToggle, close } = useDetailsDismiss(ref);
  const badge = unreadBadge(count);

  return (
    <details ref={ref} className="group relative" onToggle={onToggle}>
      <summary
        aria-label={count === 0 ? 'Notifications' : `Notifications, ${String(count)} unread`}
        className="relative grid size-10 cursor-pointer list-none place-items-center rounded-xl text-muted-foreground transition-colors select-none hover:bg-surface-muted hover:text-foreground [&::-webkit-details-marker]:hidden"
      >
        <Bell aria-hidden="true" className="size-[1.15rem]" strokeWidth={1.75} />
        {badge ? (
          <span
            aria-hidden="true"
            className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary-action px-1 text-[10px] leading-none font-semibold text-primary-action-foreground ring-2 ring-canvas"
          >
            {badge}
          </span>
        ) : null}
      </summary>

      <div className="nz-glass absolute top-full right-0 z-40 mt-2 grid w-88 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-foreground">
            <AutoText>Notifications</AutoText>
          </p>
          {count > 0 ? (
            <span className="rounded-full bg-info-soft px-2 py-0.5 text-xs font-semibold text-info-ink">
              {count} unread
            </span>
          ) : null}
        </div>

        {items.length === 0 ? (
          <div className="grid justify-items-center gap-2 px-6 py-8 text-center">
            <span
              aria-hidden="true"
              className="grid size-11 place-items-center rounded-full bg-neutral-soft text-muted-foreground ring-1 ring-neutral-line"
            >
              {available ? <Bell className="size-5" /> : <BellOff className="size-5" />}
            </span>
            <p className="text-sm font-medium text-foreground">
              {available ? 'All caught up' : 'Notifications could not be loaded'}
            </p>
            <p className="text-xs text-muted-foreground">
              {available
                ? 'New orders, low stock, returns, refunds, reviews and chat messages appear here.'
                : 'Open the inbox to try again.'}
            </p>
          </div>
        ) : (
          <ul className="nz-scroll max-h-96 divide-y divide-border overflow-y-auto">
            {items.map((item) => {
              const Icon = notificationKindIcon(item.kind);
              const content = (
                <>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ring-1',
                      item.unread
                        ? 'bg-info-soft text-info-ink ring-info-line'
                        : 'bg-neutral-soft text-muted-foreground ring-neutral-line',
                    )}
                  >
                    <Icon className="size-4" strokeWidth={1.75} />
                  </span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                      {notificationKindLabel(item.kind)}
                      {item.unread ? (
                        <>
                          <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
                          <span className="sr-only">
                            <AutoText>Unread</AutoText>
                          </span>
                        </>
                      ) : null}
                    </span>
                    <span className="truncate text-sm font-medium text-foreground">
                      {item.title}
                    </span>
                    {item.body ? (
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        <AutoText value={item.body} />
                      </span>
                    ) : null}
                    <span className="text-[11px] text-muted-foreground">
                      <RelativeTimeText value={item.createdAt} />
                    </span>
                  </span>
                </>
              );
              return (
                <li key={item.id}>
                  {item.actionPath ? (
                    <Link
                      href={item.actionPath as Route}
                      onClick={close}
                      className="flex gap-3 px-4 py-3 transition-colors hover:bg-surface-muted"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="flex gap-3 px-4 py-3">
                      <AutoText value={content} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <Link
          href={INBOX}
          onClick={close}
          className="border-t border-border px-4 py-2.5 text-center text-sm font-semibold text-link transition-colors hover:bg-surface-muted"
        >
          <AutoText>Open the inbox</AutoText>
        </Link>
      </div>
    </details>
  );
}
