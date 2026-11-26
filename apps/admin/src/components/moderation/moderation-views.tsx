import type {
  ModerationReviewer,
  ModerationTaskListResponse,
  ModerationTaskSummary,
} from '@nilzora/contracts';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nilzora/ui';
import { ShieldCheck } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DataTable, DataTableEmpty } from '@/components/admin-kit/data-table';
import { Pagination } from '@/components/admin-kit/pagination';
import { adminRead, type AdminRead } from '@/components/admin-kit/read';
import { ReadState } from '@/components/admin-kit/states';
import { ModerationTaskStatusBadge } from '@/components/admin-kit/status-badge';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { GlassTable } from '@/components/catalog/catalog-ui';
import { formatDateTime } from '@/lib/format';
import { signInPath } from '@/lib/workspace-access';
import { AssignReviewForm } from './moderation-forms';
import {
  assignableReviewers,
  moderationHref,
  MODERATION_PAGE_SIZE,
  MODERATION_PATH,
  type ModerationFilters,
} from './moderation-query';
import { AutoText } from '@/components/i18n/translate';
import { RelativeTimeText } from '@/components/i18n/format-text';

export function accountName(
  account: { name: string | null; email: string | null } | null,
  fallback = 'Unknown account',
): string {
  return account?.name ?? account?.email ?? fallback;
}

export function adminReviewHref(taskId: string): Route {
  return `/admin/moderation/${taskId}` as Route;
}

export function productHref(productId: string): Route {
  return `/admin/products/${productId}` as Route;
}

function When({ at, now }: { at: string; now: Date }) {
  return (
    <time dateTime={at} title={formatDateTime(at)}>
      <RelativeTimeText value={at} now={now} />
    </time>
  );
}

export interface ModerationTableProps {
  data: ModerationTaskListResponse;
  filters: ModerationFilters;
  reviewers: AdminRead<{ reviewers: ModerationReviewer[] }>;
  /** The signed-in assigner (only an owner may take a review themselves). */
  actor: ReviewActor;
  csrf: CsrfInput;
  now: Date;
}

export interface ReviewActor {
  id: string;
  role: string;
}

function AssignCell({
  task,
  reviewers,
  actor,
  returnTo,
  csrf,
}: {
  task: ModerationTaskSummary;
  reviewers: ModerationTableProps['reviewers'];
  actor: ReviewActor;
  returnTo: string;
  csrf: CsrfInput;
}) {
  if (task.status !== 'pending') return <span className="text-muted-foreground">—</span>;
  if (reviewers.kind !== 'ok') {
    return (
      <span className="text-xs whitespace-normal text-muted-foreground">
        <AutoText>Reviewers could not be loaded.</AutoText>
      </span>
    );
  }
  return (
    <AssignReviewForm
      taskId={task.id}
      productName={task.productName}
      reviewers={assignableReviewers(reviewers.value.reviewers, task, actor)}
      assignedToId={task.assignedTo?.id}
      returnTo={returnTo}
      csrf={csrf}
    />
  );
}

export function ModerationTable({
  data,
  filters,
  reviewers,
  actor,
  csrf,
  now,
}: ModerationTableProps) {
  const returnTo = moderationHref(filters, data.page);
  const filtered = filters.scope !== 'all' || filters.status !== undefined;

  return (
    <GlassTable
      label="Content reviews"
      footer={
        data.total > 0 ? (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            pageSize={data.pageSize}
            noun="reviews"
            hrefFor={(page) => moderationHref(filters, page)}
          />
        ) : undefined
      }
    >
      <DataTable caption="Content reviews" dense>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>
              <AutoText>Product</AutoText>
            </TableHead>
            <TableHead>
              <AutoText>Status</AutoText>
            </TableHead>
            <TableHead>
              <AutoText>Submitted</AutoText>
            </TableHead>
            <TableHead>
              <AutoText>Reviewer</AutoText>
            </TableHead>
            <TableHead>
              <AutoText>Assign</AutoText>
            </TableHead>
          </TableRow>
        </TableHeader>
        {data.tasks.length > 0 ? (
          <TableBody>
            {data.tasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell>
                  <div className="grid">
                    <Link
                      href={adminReviewHref(task.id)}
                      className="max-w-64 truncate font-medium text-link underline-offset-4 hover:underline max-sm:inline-flex max-sm:min-h-11 max-sm:items-center"
                    >
                      {task.productName}
                    </Link>
                    <span className="font-mono text-xs text-muted-foreground">
                      {task.productSku}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <ModerationTaskStatusBadge status={task.status} />
                </TableCell>
                <TableCell>
                  <div className="grid">
                    <span className="text-foreground">
                      {accountName(task.submittedBy, 'A removed account')}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      <When at={task.submittedAt} now={now} />
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  {task.assignedTo ? (
                    <div className="grid">
                      <span className="text-foreground">
                        <AutoText value={accountName(task.assignedTo)} />
                      </span>
                      {task.assignedAt ? (
                        <span className="text-xs text-muted-foreground">
                          Assigned <When at={task.assignedAt} now={now} />
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">
                      <AutoText>Unassigned</AutoText>
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <AssignCell
                    task={task}
                    reviewers={reviewers}
                    actor={actor}
                    returnTo={returnTo}
                    csrf={csrf}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        ) : (
          <DataTableEmpty
            colSpan={5}
            icon={ShieldCheck}
            title={filtered ? 'No reviews match these filters' : 'No content reviews yet'}
            description={
              filtered
                ? 'Nothing here right now. Try another scope or status.'
                : 'Reviews appear here when staff submit a product’s content.'
            }
          />
        )}
      </DataTable>
    </GlassTable>
  );
}

export async function ModerationResults({
  filters,
  page,
  actor,
  csrf,
  now,
}: {
  filters: ModerationFilters;
  page: number;
  actor: ReviewActor;
  csrf: CsrfInput;
  now: Date;
}) {
  const [tasks, reviewers] = await Promise.all([
    adminRead((api, token) =>
      api.adminListModeration(token, { ...filters, page, pageSize: MODERATION_PAGE_SIZE }),
    ),
    adminRead((api, token) => api.adminListReviewers(token)),
  ]);
  if (tasks.kind === 'signed_out' || reviewers.kind === 'signed_out') {
    redirect(signInPath(MODERATION_PATH));
  }
  if (tasks.kind !== 'ok') {
    return (
      <section className="nz-panel rounded-2xl border">
        <ReadState
          failure={tasks.kind}
          retryHref={moderationHref(filters, page)}
          resetHref={MODERATION_PATH}
          permission="moderation.assign"
        />
      </section>
    );
  }
  return (
    <ModerationTable
      data={tasks.value}
      filters={filters}
      reviewers={reviewers}
      actor={actor}
      csrf={csrf}
      now={now}
    />
  );
}
