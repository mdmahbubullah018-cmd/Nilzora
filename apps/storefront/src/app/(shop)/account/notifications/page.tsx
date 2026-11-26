import type { CustomerNotification, CustomerNotificationKind } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import {
  Banknote,
  BellOff,
  Check,
  CheckCheck,
  Package,
  RotateCcw,
  Truck,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccountNav } from '@/components/account/account-nav';
import { session } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Notifications',
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 20;

/** The categories the API accepts, in the order the tabs show them. */
const KINDS: readonly { id: CustomerNotificationKind | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'order_update', label: 'Orders' },
  { id: 'shipment_update', label: 'Shipping' },
  { id: 'payment_update', label: 'Payments' },
  { id: 'return_update', label: 'Returns' },
  { id: 'refund_update', label: 'Refunds' },
];

const KIND_ICON: Record<CustomerNotificationKind, LucideIcon> = {
  order_update: Package,
  payment_update: Wallet,
  return_update: RotateCcw,
  refund_update: Banknote,
  shipment_update: Truck,
};

const KIND_LABEL: Record<CustomerNotificationKind, string> = {
  order_update: 'Order',
  payment_update: 'Payment',
  return_update: 'Return',
  refund_update: 'Refund',
  shipment_update: 'Shipping',
};

function kindOr(value: string | undefined): CustomerNotificationKind | null {
  return KINDS.some((entry) => entry.id === value && entry.id !== 'all')
    ? (value as CustomerNotificationKind)
    : null;
}

function pageHref(page: number, kind: CustomerNotificationKind | null): Route {
  const query = new URLSearchParams();
  if (kind !== null) query.set('kind', kind);
  if (page > 1) query.set('page', String(page));
  const suffix = query.toString();
  return `/account/notifications${suffix === '' ? '' : `?${suffix}`}` as Route;
}

function shownAt(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dhaka',
  });
}

/**
 * The signed-in customer's own notification history.
 *
 * This is the readable record behind the push messages: an order status change, a recorded
 * cash payment, a return or a refund decision is written by a database trigger and shown here
 * whether or not a push ever reached the phone. Ownership is the API's decision — it answers
 * the session's own account and accepts no customer id — so a guessed URL can never show
 * another person's history.
 */
export default async function AccountNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await session.getSession();
  if (current.status !== 'signed_in') redirect('/login?next=/account/notifications');

  const params = await searchParams;
  const kind = kindOr(typeof params.kind === 'string' ? params.kind : undefined);
  const rawPage = typeof params.page === 'string' ? Number(params.page) : 1;
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;

  const read = await session.read((api, accessToken) =>
    api.myNotifications(accessToken, {
      page,
      pageSize: PAGE_SIZE,
      ...(kind === null ? {} : { kind }),
    }),
  );
  if (read.kind === 'signed_out') redirect('/login?next=/account/notifications');

  const inbox = read.kind === 'ok' ? read.value : null;
  const rows: readonly CustomerNotification[] = inbox?.notifications ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <AccountNav current="/account/notifications" />
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Order, shipping, payment, return and refund updates for your account.
          </p>
        </div>
        {inbox !== null && inbox.unread > 0 ? (
          <form action="/api/notifications/read-all" method="post">
            <button
              type="submit"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-surface px-4 text-sm font-semibold text-foreground ring-1 ring-border transition-colors hover:bg-surface-muted"
            >
              <CheckCheck aria-hidden="true" className="size-4" />
              Mark all read
            </button>
          </form>
        ) : null}
      </div>

      <div
        role="tablist"
        aria-label="Notification category"
        className="nz-tab-rail mt-6 flex min-w-0 gap-1 overflow-x-auto rounded-full bg-surface-muted p-1 sm:w-fit sm:overflow-visible"
      >
        {KINDS.map((entry) => {
          const active = entry.id === 'all' ? kind === null : entry.id === kind;
          return (
            <Link
              key={entry.id}
              role="tab"
              aria-selected={active}
              href={pageHref(1, entry.id === 'all' ? null : entry.id)}
              className={cn(
                'flex min-h-10 shrink-0 items-center justify-center rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition-colors sm:px-4',
                active
                  ? 'bg-surface text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {entry.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-6">
        {inbox === null ? (
          <p className="rounded-2xl bg-surface-muted px-5 py-4 text-sm text-muted-foreground">
            Your notifications could not be loaded just now. Reload the page to try again.
          </p>
        ) : rows.length === 0 ? (
          <div className="grid justify-items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-14 text-center">
            <BellOff aria-hidden="true" className="size-10 text-muted-foreground" />
            <p className="font-semibold text-foreground">Nothing here yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {kind === null
                ? 'Updates about your orders, deliveries, payments, returns and refunds will appear here.'
                : `No ${KIND_LABEL[kind].toLowerCase()} updates yet.`}
            </p>
            <Link
              href="/account/orders"
              className="text-sm font-semibold text-link underline-offset-4 hover:underline"
            >
              View your orders
            </Link>
          </div>
        ) : (
          <ul aria-label="Notifications" className="grid gap-2">
            {rows.map((notification) => {
              const Icon = KIND_ICON[notification.kind];
              const unread = notification.readAt === null;
              const content = (
                <span className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl ring-1',
                      unread
                        ? 'bg-info-soft text-info-ink ring-info-line'
                        : 'bg-surface-muted text-muted-foreground ring-border',
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                      {KIND_LABEL[notification.kind]}
                      {unread ? (
                        <>
                          <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
                          <span className="sr-only">Unread</span>
                        </>
                      ) : null}
                    </span>
                    <span className="font-medium text-foreground">{notification.title}</span>
                    {notification.body === null ? null : (
                      <span className="text-sm text-muted-foreground">{notification.body}</span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {shownAt(notification.createdAt)}
                    </span>
                  </span>
                </span>
              );

              return (
                <li
                  key={notification.id}
                  className={cn(
                    'rounded-2xl border border-border px-4 py-3.5',
                    unread ? 'bg-info-soft/25' : 'bg-surface',
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {notification.actionPath === null ? (
                      <div className="min-w-0 flex-1">{content}</div>
                    ) : (
                      <Link
                        href={notification.actionPath as Route}
                        className="min-w-0 flex-1 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-action"
                      >
                        {content}
                      </Link>
                    )}
                    {unread ? (
                      <form action={`/api/notifications/${notification.id}/read`} method="post">
                        <button
                          type="submit"
                          className="inline-flex min-h-9 items-center gap-1 rounded-full px-3 text-xs font-semibold text-link ring-1 ring-border transition-colors hover:bg-surface-muted"
                        >
                          <Check aria-hidden="true" className="size-3.5" />
                          Mark read
                        </button>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {inbox !== null && inbox.totalPages > 1 ? (
        <nav aria-label="Pages" className="mt-6 flex items-center justify-between gap-3">
          {inbox.page > 1 ? (
            <Link
              href={pageHref(inbox.page - 1, kind)}
              className="inline-flex min-h-10 items-center rounded-full px-4 text-sm font-medium text-foreground ring-1 ring-border hover:bg-surface-muted"
            >
              Newer
            </Link>
          ) : (
            <span />
          )}
          <p className="text-xs text-muted-foreground">
            Page {inbox.page} of {inbox.totalPages}
          </p>
          {inbox.page < inbox.totalPages ? (
            <Link
              href={pageHref(inbox.page + 1, kind)}
              className="inline-flex min-h-10 items-center rounded-full px-4 text-sm font-medium text-foreground ring-1 ring-border hover:bg-surface-muted"
            >
              Older
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
