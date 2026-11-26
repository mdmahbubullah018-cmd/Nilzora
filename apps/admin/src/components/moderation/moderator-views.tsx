import type {
  ModerationEvent,
  ModerationTaskDetail,
  ModerationTaskListResponse,
  ModerationTaskStatus,
  ModerationTaskSummary,
} from '@nilzora/contracts';
import { buttonClasses, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nilzora/ui';
import type { SessionUser } from '@nilzora/web-session';
import {
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  History,
  Inbox,
  KeyRound,
  MessageSquareWarning,
  PackageSearch,
  UserRound,
} from 'lucide-react';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionFeedback } from '@/components/admin-kit/action-feedback';
import { BarChart, type ChartPoint } from '@/components/admin-kit/charts/cartesian';
import { Chip } from '@/components/admin-kit/chip';
import { KpiCard } from '@/components/admin-kit/kpi-card';
import { DataTable, DataTableEmpty } from '@/components/admin-kit/data-table';
import { DetailList } from '@/components/admin-kit/detail-list';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { Pagination } from '@/components/admin-kit/pagination';
import { adminRead, type AdminRead } from '@/components/admin-kit/read';
import { SectionCard } from '@/components/admin-kit/section-card';
import { NotFoundState, ReadState } from '@/components/admin-kit/states';
import {
  ModerationStatusBadge,
  ModerationTaskStatusBadge,
  ProductStatusBadge,
} from '@/components/admin-kit/status-badge';
import { Timeline, type TimelineItem, type TimelineTone } from '@/components/admin-kit/timeline';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { GlassTable } from '@/components/catalog/catalog-ui';
import { uuidParam } from '@/components/customers/customer-query';
import { formatCount, formatDateTime, formatMoney, formatRelativeTime } from '@/lib/format';
import { displayName, permissionLabel, roleLabel } from '@/lib/identity';
import { signInPath } from '@/lib/workspace-access';
import { DecisionActions } from './decision-actions';
import { accountName } from './moderation-views';
import {
  moderatorTaskHref,
  moderatorTasksHref,
  MODERATION_PAGE_SIZE,
  MODERATOR_HISTORY_PATH,
  MODERATOR_TASKS_PATH,
} from './moderation-query';
import { AutoText } from '@/components/i18n/translate';
import { RelativeTimeText } from '@/components/i18n/format-text';

export const MODERATOR_HOME = '/moderator' satisfies Route;

const linkClass = 'font-medium text-link underline-offset-4 hover:underline';

function When({ at, now }: { at: string; now: Date }) {
  return (
    <time dateTime={at} title={formatDateTime(at)}>
      <RelativeTimeText value={at} now={now} />
    </time>
  );
}

/** The moderator's own reviews as a table. */
export function TaskTable({
  tasks,
  now,
  caption,
  empty,
  showDecided = false,
  notes,
}: {
  tasks: readonly ModerationTaskSummary[];
  now: Date;
  caption: string;
  empty: { title: string; description: string };
  showDecided?: boolean;
  /** Decision notes by task id, for the history. */
  notes?: ReadonlyMap<string, string | null | undefined>;
}) {
  const columns = 4 + (showDecided ? 1 : 0) + (notes ? 1 : 0);
  return (
    <DataTable caption={caption} dense>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>
            <AutoText>Product</AutoText>
          </TableHead>
          <TableHead>
            <AutoText>Status</AutoText>
          </TableHead>
          <TableHead>
            <AutoText>Submitted by</AutoText>
          </TableHead>
          <TableHead>{showDecided ? 'Submitted' : 'Waiting since'}</TableHead>
          {showDecided ? (
            <TableHead>
              <AutoText>Decided</AutoText>
            </TableHead>
          ) : null}
          {notes ? (
            <TableHead>
              <AutoText>Note</AutoText>
            </TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      {tasks.length > 0 ? (
        <TableBody>
          {tasks.map((task) => (
            <TableRow key={task.id} className={notes ? 'align-top' : undefined}>
              <TableCell>
                <div className="grid">
                  <Link href={moderatorTaskHref(task.id)} className={linkClass}>
                    <span className="block max-w-64 truncate">
                      <AutoText value={task.productName} />
                    </span>
                  </Link>
                  <span className="font-mono text-xs text-muted-foreground">
                    <AutoText value={task.productSku} />
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <ModerationTaskStatusBadge status={task.status} />
              </TableCell>
              <TableCell>
                <AutoText value={accountName(task.submittedBy, 'A removed account')} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                <When at={task.submittedAt} now={now} />
              </TableCell>
              {showDecided ? (
                <TableCell className="text-muted-foreground">
                  {task.decidedAt ? <When at={task.decidedAt} now={now} /> : '—'}
                </TableCell>
              ) : null}
              {notes ? (
                <TableCell className="max-w-sm text-sm whitespace-pre-line text-body">
                  {notes.has(task.id) ? (
                    (notes.get(task.id) ?? (
                      <span className="text-muted-foreground">
                        <AutoText>No note</AutoText>
                      </span>
                    ))
                  ) : (
                    <span className="text-muted-foreground">
                      <AutoText>Could not be loaded</AutoText>
                    </span>
                  )}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      ) : (
        <DataTableEmpty colSpan={columns} icon={Inbox} {...empty} />
      )}
    </DataTable>
  );
}

/** Who is signed in and what they may do (display only; the API checks every action). */
export function IdentityCard({
  user,
}: {
  user: Pick<SessionUser, 'email' | 'profile' | 'role' | 'permissions'>;
}) {
  const name = displayName(user);
  return (
    <SectionCard
      title="Your access"
      icon={KeyRound}
      description="Identity and permissions for this session."
    >
      <div className="grid gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-teal-soft text-teal-ink ring-1 ring-teal-line"
          >
            <UserRound className="size-5" strokeWidth={1.75} />
          </span>
          <div className="grid min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              <AutoText value={name} />
            </p>
            {user.email && user.email !== name ? (
              <p className="truncate text-xs text-muted-foreground">
                <AutoText value={user.email} />
              </p>
            ) : null}
          </div>
          <Chip tone="moderator" className="ml-auto">
            {roleLabel(user.role)}
          </Chip>
        </div>
        <div className="grid gap-2 rounded-xl bg-neutral-soft p-3">
          <p className="text-xs font-semibold text-foreground">
            <AutoText>Effective permissions</AutoText>
          </p>
          <ul className="grid gap-1 text-xs text-body">
            {user.permissions.map((permission) => (
              <li key={permission} className="flex flex-wrap items-baseline gap-x-2">
                <span>
                  <AutoText value={permissionLabel(permission)} />
                </span>
                <code className="font-mono text-[11px] text-muted-foreground">{permission}</code>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SectionCard>
  );
}

export interface QueueData {
  pending: AdminRead<ModerationTaskListResponse>;
  /** Totals per decided outcome; null when any could not be read. */
  decided: number | null;
  /** Totals for the three outcomes, for the breakdown; null for one that could not be read. */
  approved: number | null;
  changesRequested: number | null;
  rejected: number | null;
  /** The most recently decided reviews, newest first (at most 30 per outcome, merged). */
  recent: readonly ModerationTaskSummary[];
  /** Customer reviews waiting for a moderator; null when the account may not see them. */
  reviewsWaiting: number | null;
}

export async function readQueue(canModerateReviews = false): Promise<QueueData> {
  const decidedIn = (status: ModerationTaskStatus) =>
    adminRead((api, token) => api.moderatorQueue(token, { status, pageSize: 30 }));
  const [pending, approved, changes, rejected, reviews] = await Promise.all([
    adminRead((api, token) => api.moderatorQueue(token, { status: 'pending', pageSize: 10 })),
    decidedIn('approved'),
    decidedIn('changes_requested'),
    decidedIn('rejected'),
    canModerateReviews
      ? adminRead((api, token) => api.adminListReviews(token, { status: 'pending', pageSize: 1 }))
      : Promise.resolve(null),
  ]);
  const decided = [approved, changes, rejected];
  if (
    pending.kind === 'signed_out' ||
    decided.some((read) => read.kind === 'signed_out') ||
    reviews?.kind === 'signed_out'
  ) {
    redirect(signInPath(MODERATOR_HOME));
  }
  const total = (read: AdminRead<ModerationTaskListResponse>) =>
    read.kind === 'ok' ? read.value.total : null;
  const totals = decided.map(total);
  const recent = decided
    .flatMap((read) => (read.kind === 'ok' ? read.value.tasks : []))
    .filter((task) => task.decidedAt !== null)
    .sort((x, y) => (y.decidedAt ?? '').localeCompare(x.decidedAt ?? ''));
  return {
    pending,
    decided: totals.every((value) => value !== null)
      ? totals.reduce<number>((sum, value) => sum + (value ?? 0), 0)
      : null,
    approved: totals[0] ?? null,
    changesRequested: totals[1] ?? null,
    rejected: totals[2] ?? null,
    recent,
    reviewsWaiting: reviews?.kind === 'ok' ? reviews.value.total : null,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_LABEL = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Dhaka',
});

/** Reviews decided on each of the last 14 days (Bangladesh days), oldest first. */
export function decisionsPerDay(tasks: readonly ModerationTaskSummary[], now: Date): ChartPoint[] {
  const key = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(date);
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (task.decidedAt === null) continue;
    const day = key(new Date(task.decidedAt));
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(now.getTime() - (13 - index) * DAY_MS);
    return {
      label: DAY_LABEL.format(date),
      value: counts.get(key(date)) ?? 0,
    };
  });
}

/**
 * The moderator's home. What needs action comes first (the queue, with its oldest item named),
 * then the figures that frame the work, the last two weeks of decisions and the most recent
 * activity. Every block has its own empty state, so a new moderator sees guidance, not blanks.
 */
export function QueueView({ data, now }: { data: QueueData; now: Date }) {
  const { pending } = data;
  const oldest = pending.kind === 'ok' ? pending.value.tasks[0] : undefined;
  const waiting = pending.kind === 'ok' ? pending.value.total : null;
  const trend = decisionsPerDay(data.recent, now);
  const decidedRecently = trend.reduce((sum, point) => sum + point.value, 0);
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Waiting for you"
          value={waiting === null ? '—' : formatCount(waiting)}
          icon={Inbox}
          tone={waiting !== null && waiting > 0 ? 'warning' : 'success'}
          footnote={waiting === 0 ? 'You are all caught up' : 'Reviews assigned to you'}
          href={MODERATOR_TASKS_PATH}
        />
        <KpiCard
          label="Oldest submission"
          value={oldest ? formatRelativeTime(oldest.submittedAt, now) : '—'}
          icon={Clock}
          tone="primary"
          footnote={oldest ? oldest.productName : 'Nothing waiting'}
        />
        <KpiCard
          label="Decided by you"
          value={data.decided === null ? '—' : formatCount(data.decided)}
          icon={CheckCircle2}
          tone="moderator"
          footnote={
            data.approved === null
              ? 'Approved, changes requested or rejected'
              : `${formatCount(data.approved)} approved · ${formatCount(data.changesRequested ?? 0)} changes · ${formatCount(data.rejected ?? 0)} rejected`
          }
          href={MODERATOR_HISTORY_PATH}
        />
        <KpiCard
          label="Customer reviews waiting"
          value={data.reviewsWaiting === null ? '—' : formatCount(data.reviewsWaiting)}
          icon={MessageSquareWarning}
          tone={data.reviewsWaiting !== null && data.reviewsWaiting > 0 ? 'warning' : 'neutral'}
          footnote={
            data.reviewsWaiting === null ? 'Not part of your permissions' : 'Awaiting moderation'
          }
        />
      </div>

      <SectionCard
        title="Needs your action"
        className="nz-panel-strong"
        icon={Inbox}
        description="Pending reviews, oldest first"
        flush={pending.kind === 'ok'}
        actions={
          <Link
            href={MODERATOR_TASKS_PATH}
            className={buttonClasses({
              variant: 'ghost',
              size: 'sm',
              className: 'max-sm:min-h-11',
            })}
          >
            <AutoText>All reviews</AutoText>
          </Link>
        }
      >
        {pending.kind === 'ok' ? (
          <TaskTable
            tasks={pending.value.tasks}
            now={now}
            caption="Pending reviews assigned to you"
            empty={{
              title: 'Nothing is waiting for you',
              description: 'New reviews appear here when an admin assigns them to you.',
            }}
          />
        ) : (
          <ReadState
            failure={pending.kind === 'signed_out' ? 'unavailable' : pending.kind}
            retryHref={MODERATOR_HOME}
            permission="content.approve"
            compact
          />
        )}
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <SectionCard
          title="Decisions, last 14 days"
          className="nz-panel-strong"
          icon={ClipboardCheck}
          description={
            decidedRecently === 0
              ? 'Your decisions will chart here.'
              : `${formatCount(decidedRecently)} ${decidedRecently === 1 ? 'review' : 'reviews'} decided`
          }
        >
          <BarChart
            data={trend}
            title="Reviews decided per day, last 14 days"
            columns={['Day', 'Decided']}
            formatValue={(value) => formatCount(value)}
            integerAxis
            tone="moderator"
            heightClass="h-48"
            summary={`${String(decidedRecently)} reviews decided in the last 14 days.`}
          />
        </SectionCard>

        <SectionCard
          title="Recent activity"
          className="nz-panel-strong"
          icon={History}
          description="Your latest decisions"
          flush
          actions={
            <Link
              href={MODERATOR_HISTORY_PATH}
              className={buttonClasses({
                variant: 'ghost',
                size: 'sm',
                className: 'max-sm:min-h-11',
              })}
            >
              <AutoText>History</AutoText>
            </Link>
          }
        >
          {data.recent.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              <AutoText>
                No decisions yet. Reviews you approve, reject or send back appear here.
              </AutoText>
            </p>
          ) : (
            <ul role="list" className="divide-y divide-hairline">
              {data.recent.slice(0, 6).map((task) => (
                <li key={task.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <Link href={moderatorTaskHref(task.id)} className={linkClass}>
                      <span className="block truncate">
                        <AutoText value={task.productName} />
                      </span>
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {task.decidedAt ? <When at={task.decidedAt} now={now} /> : null}
                    </span>
                  </div>
                  <ModerationTaskStatusBadge status={task.status} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

/** One page of the moderator's reviews (optionally of one status). */
export async function TaskListResults({
  path,
  status,
  page,
  now,
}: {
  path: typeof MODERATOR_TASKS_PATH | typeof MODERATOR_HISTORY_PATH;
  status: ModerationTaskStatus | undefined;
  page: number;
  now: Date;
}) {
  const history = path === MODERATOR_HISTORY_PATH;
  const result = await adminRead((api, token) =>
    api.moderatorQueue(token, {
      status,
      page,
      pageSize: history ? 10 : MODERATION_PAGE_SIZE,
    }),
  );
  if (result.kind === 'signed_out') redirect(signInPath(path));
  if (result.kind !== 'ok') {
    return (
      <section className="nz-panel rounded-2xl border">
        <ReadState
          failure={result.kind}
          retryHref={moderatorTasksHref(path, status, page)}
          resetHref={path}
          permission="content.approve"
        />
      </section>
    );
  }

  // The list carries no notes; the history reads each shown review's decision note.
  let notes: Map<string, string | null> | undefined;
  if (history) {
    const details = await Promise.all(
      result.value.tasks.map((task) =>
        adminRead((api, token) => api.moderatorGetTask(token, task.id)),
      ),
    );
    notes = new Map();
    for (const detail of details) {
      if (detail.kind === 'ok') notes.set(detail.value.task.id, detail.value.task.decisionNote);
    }
  }

  return (
    <GlassTable
      label={history ? 'Decided reviews' : 'Your reviews'}
      footer={
        result.value.total > 0 ? (
          <Pagination
            page={result.value.page}
            totalPages={result.value.totalPages}
            total={result.value.total}
            pageSize={result.value.pageSize}
            noun="reviews"
            hrefFor={(next) => moderatorTasksHref(path, status, next)}
          />
        ) : undefined
      }
    >
      <TaskTable
        tasks={result.value.tasks}
        now={now}
        caption={history ? 'Decided reviews' : 'Your reviews'}
        showDecided={history || status !== 'pending'}
        notes={notes}
        empty={
          history
            ? {
                title: 'No decided reviews here yet',
                description: 'Reviews you decide appear here with your notes.',
              }
            : {
                title: status ? 'No reviews with this status' : 'No reviews assigned to you yet',
                description: 'Reviews appear here when an admin assigns them to you.',
              }
        }
      />
    </GlassTable>
  );
}

const EVENT_TITLE: Record<ModerationEvent['kind'], string> = {
  submitted: 'Submitted for review',
  assigned: 'Assigned',
  approved: 'Approved',
  rejected: 'Rejected',
  changes_requested: 'Changes requested',
  withdrawn: 'Withdrawn',
};

const EVENT_TONE: Record<ModerationEvent['kind'], TimelineTone> = {
  submitted: 'primary',
  assigned: 'moderator',
  approved: 'success',
  rejected: 'danger',
  changes_requested: 'violet',
  withdrawn: 'neutral',
};

function eventItems(task: ModerationTaskDetail): TimelineItem[] {
  return [...task.events]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((event, index) => ({
      key: `${event.at}-${String(index)}`,
      title: EVENT_TITLE[event.kind],
      at: event.at,
      actor: event.actor ? `By ${accountName(event.actor)}` : undefined,
      note: event.note,
      tone: EVENT_TONE[event.kind],
    }));
}

/** One review: the content exactly as submitted, its history and the decision. */
export interface TaskDetailViewProps {
  task: ModerationTaskDetail;
  csrf: CsrfInput;
  /** Where the back link leads; the moderator's own list by default. */
  back?: { href: Route; label: string };
  /** The assigner's controls (assign, withdraw) for an open review, in place of the decision. */
  manage?: ReactNode;
  /** A confirmation chosen from an allow-listed notice key after a change. */
  notice?: string | undefined;
}

export function TaskDetailView({
  task,
  csrf,
  back = { href: MODERATOR_TASKS_PATH, label: 'Product content' },
  manage,
  notice,
}: TaskDetailViewProps) {
  const { content } = task;
  return (
    <div className="grid gap-6">
      <PageToolbar
        back={back}
        eyebrow={<ModerationTaskStatusBadge status={task.status} />}
        title={content.name}
        meta={
          <>
            <span className="font-mono">
              <AutoText value={content.sku} />
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Submitted by {accountName(task.submittedBy, 'a removed account')},{' '}
              <time dateTime={task.submittedAt}>
                <AutoText value={formatDateTime(task.submittedAt)} />
              </time>
            </span>
          </>
        }
      />

      {notice ? <ActionFeedback state={{ status: 'success', message: notice }} /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-6">
          <SectionCard
            title="Submitted content"
            icon={FileText}
            description="Exactly what was submitted; later edits to the product are not part of this review."
          >
            <div className="grid gap-5">
              <DetailList
                items={[
                  { label: 'Name', value: content.name, wide: true },
                  { label: 'Summary', value: content.summary, wide: true },
                  { label: 'Category', value: content.categoryName },
                  {
                    label: 'Address (slug)',
                    value: (
                      <span className="font-mono">
                        <AutoText value={content.slug} />
                      </span>
                    ),
                  },
                  {
                    label: 'SKU',
                    value: (
                      <span className="font-mono">
                        <AutoText value={content.sku} />
                      </span>
                    ),
                  },
                  { label: 'Price', value: formatMoney(content.priceMinor) },
                  {
                    label: 'Compare-at price',
                    value:
                      content.compareAtPriceMinor === null
                        ? null
                        : formatMoney(content.compareAtPriceMinor),
                  },
                ]}
              />
              <div className="grid gap-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  <AutoText>Description</AutoText>
                </p>
                {content.description ? (
                  <p className="rounded-xl border border-hairline bg-neutral-soft p-4 text-sm leading-relaxed whitespace-pre-line text-body">
                    {content.description}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    <AutoText>No description was submitted.</AutoText>
                  </p>
                )}
              </div>
            </div>
          </SectionCard>

          <SectionCard title="History" icon={History}>
            {task.events.length > 0 ? (
              <Timeline label="Review history" items={eventItems(task)} />
            ) : (
              <p className="text-sm text-muted-foreground">
                <AutoText>No history recorded.</AutoText>
              </p>
            )}
          </SectionCard>
        </div>

        <div className="grid min-w-0 content-start gap-6">
          {manage && task.status === 'pending' ? manage : null}
          <SectionCard title="Decision" icon={ClipboardCheck}>
            {task.canDecide && !manage ? (
              <div className="grid gap-3">
                <p className="text-sm text-muted-foreground">
                  Approve, request changes or reject. Requesting changes and rejecting need a note
                  of at least 10 characters for the submitter.
                </p>
                <DecisionActions taskId={task.id} csrf={csrf} />
              </div>
            ) : task.status === 'pending' ? (
              <p className="text-sm text-muted-foreground">
                {manage
                  ? task.assignedTo
                    ? `Waiting for ${accountName(task.assignedTo)} to decide.`
                    : 'Waiting to be assigned to a reviewer.'
                  : 'This review is open, but your account cannot decide it.'}
              </p>
            ) : (
              <DetailList
                columns={1}
                items={[
                  { label: 'Outcome', value: <ModerationTaskStatusBadge status={task.status} /> },
                  {
                    label: 'Decided by',
                    value: task.decidedBy ? accountName(task.decidedBy) : null,
                  },
                  {
                    label: 'Decided',
                    value: task.decidedAt ? formatDateTime(task.decidedAt) : null,
                  },
                  {
                    label: 'Note',
                    value: task.decisionNote ? (
                      <span className="whitespace-pre-line">
                        <AutoText value={task.decisionNote} />
                      </span>
                    ) : null,
                  },
                ]}
              />
            )}
          </SectionCard>

          <SectionCard title="Product now" icon={PackageSearch}>
            {task.product ? (
              <DetailList
                columns={1}
                items={[
                  {
                    label: 'Sale status',
                    value: <ProductStatusBadge status={task.product.status} />,
                  },
                  {
                    label: 'Content review',
                    value: <ModerationStatusBadge status={task.product.moderationStatus} />,
                  },
                ]}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                <AutoText>The product no longer exists.</AutoText>
              </p>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

export async function TaskDetailContent({
  taskId,
  csrf,
  notice,
}: {
  taskId: string;
  csrf: CsrfInput;
  notice?: string | undefined;
}) {
  const id = uuidParam(taskId);
  const notFound = (
    <section className="nz-panel rounded-2xl border">
      <NotFoundState
        title="Review not found"
        description="This review does not exist or is not assigned to you."
        titleAs="h1"
        action={
          <Link
            href={MODERATOR_TASKS_PATH}
            className={buttonClasses({
              variant: 'outline',
              size: 'sm',
              className: 'max-sm:min-h-11',
            })}
          >
            <AutoText>Your reviews</AutoText>
          </Link>
        }
      />
    </section>
  );
  if (!id) return notFound;
  const path = moderatorTaskHref(id);
  const result = await adminRead((api, token) => api.moderatorGetTask(token, id));
  if (result.kind === 'signed_out') redirect(signInPath(path));
  if (result.kind === 'not_found') return notFound;
  if (result.kind !== 'ok') {
    return (
      <section className="nz-panel rounded-2xl border">
        <ReadState
          failure={result.kind}
          retryHref={path}
          permission="content.approve"
          titleAs="h1"
        />
      </section>
    );
  }
  return <TaskDetailView task={result.value.task} csrf={csrf} notice={notice} />;
}
