'use client';

import type { StaffNotification, StaffNotificationListResponse } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { CheckCheck, Check, Inbox } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useActionState } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { Chip } from '@/components/admin-kit/chip';
import { Pagination } from '@/components/admin-kit/pagination';
import { SectionCard } from '@/components/admin-kit/section-card';
import { STATUS_TONES, type StatusTone } from '@/components/admin-kit/status-tones';
import { SubmitButton } from '@/components/admin-kit/submit-button';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { EmptyPanel } from '@/components/catalog/catalog-ui';
import { formatDateTime } from '@/lib/format';
import { notificationKindIconElement, notificationKindLabel } from '@/lib/notifications';
import { markAllNotificationsReadAction, markNotificationReadAction } from '@/lib/site-actions';
import { INBOX_PATH } from './inbox-paths';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/** Which workspace is rendering the inbox; it decides which read route the actions call. */
export type InboxSurface = 'admin' | 'moderator';

const KIND_TONE: Record<string, StatusTone> = {
  order_new: 'primary',
  stock_low: 'warning',
  return_new: 'violet',
  refund_action: 'offer',
  moderation_pending: 'moderator',
  chat_message: 'primary',
  chat_escalation: 'danger',
};

export function inboxHref(page: number): Route {
  return page <= 1 ? INBOX_PATH : (`${INBOX_PATH}?page=${String(page)}` as Route);
}

function MarkAllRead({ csrf, surface }: { csrf: CsrfInput; surface: InboxSurface }) {
  const [state, action] = useActionState(markAllNotificationsReadAction, IDLE_STATE);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <CsrfField csrf={csrf} />
      {surface === 'moderator' ? <input type="hidden" name="surface" value="moderator" /> : null}
      <ActionFeedback state={state} inline />
      <SubmitButton
        variant="outline"
        size="sm"
        pendingLabel="Marking…"
        className="rounded-xl max-sm:min-h-11"
      >
        <CheckCheck aria-hidden="true" strokeWidth={1.75} />
        <AutoText>Mark all read</AutoText>
      </SubmitButton>
    </form>
  );
}

function MarkRead({ id, csrf, surface }: { id: string; csrf: CsrfInput; surface: InboxSurface }) {
  const [state, action] = useActionState(markNotificationReadAction, IDLE_STATE);
  return (
    <form action={action} className="grid justify-items-end gap-1">
      <CsrfField csrf={csrf} />
      <input type="hidden" name="notificationId" value={id} />
      {surface === 'moderator' ? <input type="hidden" name="surface" value="moderator" /> : null}
      <SubmitButton
        variant="outline"
        size="sm"
        pendingLabel="Marking…"
        className="rounded-xl max-sm:min-h-11"
      >
        <Check aria-hidden="true" strokeWidth={1.75} />
        <AutoText>Mark read</AutoText>
      </SubmitButton>
      {state.status === 'error' ? <ActionFeedback state={state} inline /> : null}
    </form>
  );
}

function Row({
  notification,
  csrf,
  surface,
}: {
  notification: StaffNotification;
  csrf: CsrfInput;
  surface: InboxSurface;
}) {
  const tx = useTx();
  const tone = KIND_TONE[notification.kind] ?? 'neutral';
  const unread = notification.readAt === null;
  return (
    <li
      className={cn(
        'flex flex-wrap items-start gap-4 px-5 py-4 sm:px-6',
        unread && 'bg-info-soft/30',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-xl ring-1',
          STATUS_TONES[tone].well,
        )}
      >
        {notificationKindIconElement(notification.kind, 'size-5')}
      </span>
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {notificationKindLabel(notification.kind)}
        </p>
        <p className="font-medium text-foreground">
          {unread ? (
            <span
              role="img"
              aria-label={tx('Unread')}
              className="mr-2 inline-block size-2 rounded-full bg-chart-1 align-middle"
            />
          ) : null}
          {notification.title}
        </p>
        {notification.body === null ? null : (
          <p className="text-sm text-muted-foreground">
            <AutoText value={notification.body} />
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          <AutoText value={formatDateTime(notification.createdAt)} />
        </p>
      </div>
      <div className="flex items-center gap-3">
        {notification.actionPath === null ? null : (
          <Link
            href={notification.actionPath as Route}
            className="inline-flex min-h-9 items-center text-sm font-medium text-link underline underline-offset-4 max-sm:min-h-11"
          >
            <AutoText>Open</AutoText>
          </Link>
        )}
        {unread ? (
          <MarkRead id={notification.id} csrf={csrf} surface={surface} />
        ) : (
          <Chip tone="neutral">
            <AutoText>Read</AutoText>
          </Chip>
        )}
      </div>
    </li>
  );
}

/** The staff inbox: what needs attention, newest first, with mark-read per row and for all. */
export function InboxView({
  inbox,
  csrf,
  surface = 'admin',
}: {
  inbox: StaffNotificationListResponse;
  csrf: CsrfInput;
  /** Which workspace is showing it; the read actions then use that workspace's route. */
  surface?: InboxSurface;
}) {
  const tx = useTx();
  return (
    <SectionCard
      title={`Inbox (${String(inbox.total)})`}
      icon={Inbox}
      description={`${String(inbox.unread)} unread`}
      className="nz-panel-strong"
      actions={inbox.unread === 0 ? undefined : <MarkAllRead csrf={csrf} surface={surface} />}
      flush
    >
      {inbox.notifications.length === 0 ? (
        <EmptyPanel
          icon={Inbox}
          title={tx('Nothing needs attention right now.')}
          description={tx(
            'New orders, low stock, returns, refunds, review submissions and chat messages appear here.',
          )}
          className="py-14"
        />
      ) : (
        <ul
          aria-label={tx('Notifications')}
          className="divide-y divide-hairline border-t border-hairline"
        >
          {inbox.notifications.map((notification) => (
            <Row key={notification.id} notification={notification} csrf={csrf} surface={surface} />
          ))}
        </ul>
      )}
      {inbox.total > 0 ? (
        <div className="border-t border-hairline px-4 py-3 sm:px-5">
          <Pagination
            page={inbox.page}
            totalPages={inbox.totalPages}
            total={inbox.total}
            pageSize={inbox.pageSize}
            noun="notifications"
            hrefFor={inboxHref}
          />
        </div>
      ) : null}
    </SectionCard>
  );
}
