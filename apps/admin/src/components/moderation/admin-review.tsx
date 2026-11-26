import type { ModerationReviewer, ModerationTaskDetail, Permission } from '@nilzora/contracts';
import { ExternalLink, Settings2 } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminRead, type AdminRead } from '@/components/admin-kit/read';
import { SectionCard } from '@/components/admin-kit/section-card';
import { NotFoundState, ReadState } from '@/components/admin-kit/states';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { uuidParam } from '@/components/customers/customer-query';
import { signInPath } from '@/lib/workspace-access';
import { AssignReviewForm, WithdrawReviewForm } from './moderation-forms';
import { assignableReviewers, MODERATION_PATH } from './moderation-query';
import { accountName, adminReviewHref, productHref, type ReviewActor } from './moderation-views';
import { TaskDetailView } from './moderator-views';
import { AutoText } from '@/components/i18n/translate';

export interface ManageReviewProps {
  task: ModerationTaskDetail;
  reviewers: AdminRead<{ reviewers: ModerationReviewer[] }>;
  permissions: readonly Permission[];
  actor: ReviewActor;
  csrf: CsrfInput;
}

/** The assigner's controls for an open review: (re)assign and withdraw. */
export function ManageReview({ task, reviewers, permissions, actor, csrf }: ManageReviewProps) {
  return (
    <SectionCard title="Manage review" icon={Settings2}>
      <div className="grid gap-5">
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">
            {task.assignedTo
              ? `Assigned to ${accountName(task.assignedTo)}. Reassign it if they cannot review it.`
              : 'Nobody is reviewing this yet. Choose a reviewer.'}
          </p>
          {reviewers.kind === 'ok' ? (
            <AssignReviewForm
              taskId={task.id}
              productName={task.content.name}
              reviewers={assignableReviewers(reviewers.value.reviewers, task, actor)}
              assignedToId={task.assignedTo?.id}
              returnTo={adminReviewHref(task.id)}
              csrf={csrf}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              <AutoText>Reviewers could not be loaded.</AutoText>
            </p>
          )}
        </div>
        {/* Assigners may withdraw any open review (the submitter may withdraw their own). */}
        <div className="grid gap-2 border-t border-hairline pt-4">
          <p className="text-sm text-muted-foreground">
            Withdrawing closes the review without a decision, so the content can be edited and
            submitted again.
          </p>
          <div className="flex">
            <WithdrawReviewForm taskId={task.id} productName={task.content.name} csrf={csrf} />
          </div>
        </div>
        {permissions.includes('products.read') ? (
          <Link
            href={productHref(task.productId)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-link underline-offset-4 hover:underline"
          >
            Open the product
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </Link>
        ) : null}
      </div>
    </SectionCard>
  );
}

/** One review as an assigner sees it: the content, its history and the controls. */
export async function AdminReviewContent({
  taskId,
  permissions,
  actor,
  csrf,
  notice,
}: {
  taskId: string;
  permissions: readonly Permission[];
  actor: ReviewActor;
  csrf: CsrfInput;
  notice?: string | undefined;
}) {
  const id = uuidParam(taskId);
  const notFound = (
    <section className="nz-panel rounded-2xl border">
      <NotFoundState title="Review not found" titleAs="h1" />
    </section>
  );
  if (!id) return notFound;
  const path = adminReviewHref(id);
  const [task, reviewers] = await Promise.all([
    adminRead((api, token) => api.adminGetModerationTask(token, id)),
    adminRead((api, token) => api.adminListReviewers(token)),
  ]);
  if (task.kind === 'signed_out' || reviewers.kind === 'signed_out') redirect(signInPath(path));
  if (task.kind === 'not_found') return notFound;
  if (task.kind !== 'ok') {
    return (
      <section className="nz-panel rounded-2xl border">
        <ReadState
          failure={task.kind}
          retryHref={path}
          permission="moderation.assign"
          titleAs="h1"
        />
      </section>
    );
  }
  return (
    <TaskDetailView
      task={task.value.task}
      csrf={csrf}
      back={{ href: MODERATION_PATH, label: 'Moderation' }}
      notice={notice}
      manage={
        <ManageReview
          task={task.value.task}
          reviewers={reviewers}
          permissions={permissions}
          actor={actor}
          csrf={csrf}
        />
      }
    />
  );
}
