import {
  MODERATION_SCOPES,
  MODERATION_TASK_STATUSES,
  type ModerationScope,
  type ModerationTaskStatus,
} from '@nilzora/contracts';
import type { Route } from 'next';
import { oneOf, pageParam, withQuery } from '@/components/admin-kit/href';
import type { SearchParams } from '@/components/orders/order-query';

export const MODERATION_PATH = '/admin/moderation' satisfies Route;
export const MODERATOR_TASKS_PATH = '/moderator/tasks' satisfies Route;
export const MODERATOR_HISTORY_PATH = '/moderator/history' satisfies Route;
export const MODERATION_PAGE_SIZE = 25;

export const SCOPE_LABEL: Record<ModerationScope, string> = {
  unassigned: 'Unassigned',
  mine: 'Assigned to me',
  all: 'All reviews',
};

export interface ModerationFilters {
  scope: ModerationScope;
  status?: ModerationTaskStatus;
}

export function parseModerationFilters(params: SearchParams): ModerationFilters & { page: number } {
  return {
    scope: oneOf(params.scope, MODERATION_SCOPES) ?? 'all',
    status: oneOf(params.status, MODERATION_TASK_STATUSES),
    page: pageParam(params.page),
  };
}

export function moderationHref(filters: ModerationFilters, page = 1): Route {
  return withQuery(MODERATION_PATH, {
    scope: filters.scope === 'all' ? undefined : filters.scope,
    status: filters.status,
    page: page > 1 ? page : undefined,
  });
}

/** The moderator's own list: an optional status and the page. */
export function moderatorTasksHref(
  path: typeof MODERATOR_TASKS_PATH | typeof MODERATOR_HISTORY_PATH,
  status: ModerationTaskStatus | undefined,
  page = 1,
): Route {
  return withQuery(path, { status, page: page > 1 ? page : undefined });
}

export function moderatorTaskHref(taskId: string): Route {
  return `/moderator/tasks/${taskId}` as Route;
}

/** Decided outcomes, for the moderator's history. */
export const DECIDED_STATUSES = [
  'approved',
  'changes_requested',
  'rejected',
] as const satisfies readonly ModerationTaskStatus[];
export type DecidedStatus = (typeof DECIDED_STATUSES)[number];

/** Notices after an assigner's change (see withNotice in orders/order-query). */
export const MODERATION_NOTICES = {
  assigned: 'The review is assigned. Only that reviewer can decide it.',
  withdrawn: 'The review is withdrawn. The product’s content can be edited and submitted again.',
} as const satisfies Record<string, string>;

/** Notices after a moderator's decision. */
export const DECISION_NOTICES = {
  approved: 'Approved. Staff can now publish the product.',
  changes_requested: 'Changes requested. The submitter sees your note.',
  rejected: 'Rejected. The submitter sees your note.',
} as const satisfies Record<string, string>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where an assigner returns after a change: the review's own page, or the list with
 * its filters rebuilt from known values only. Anything else falls back to the list.
 */
export function moderationReturnPath(value: string): Route {
  let url: URL;
  try {
    url = new URL(value, 'http://nilzora.invalid');
  } catch {
    return MODERATION_PATH;
  }
  if (url.origin !== 'http://nilzora.invalid') return MODERATION_PATH;
  const review = /^\/admin\/moderation\/([^/]+)$/.exec(url.pathname)?.[1];
  if (review && UUID.test(review)) return `/admin/moderation/${review.toLowerCase()}` as Route;
  if (url.pathname !== MODERATION_PATH) return MODERATION_PATH;
  const { page, ...filters } = parseModerationFilters(Object.fromEntries(url.searchParams));
  return moderationHref(filters, page);
}

/** Who may be offered a review: never its submitter, and the caller only if an owner. */
export function assignableReviewers<R extends { id: string }>(
  reviewers: readonly R[],
  task: { submittedBy: { id: string } | null },
  actor: { id: string; role: string },
): R[] {
  return reviewers.filter(
    (reviewer) =>
      reviewer.id !== task.submittedBy?.id &&
      (reviewer.id !== actor.id || actor.role === 'super_admin'),
  );
}
