import {
  moderationAssignmentRequestSchema,
  moderationDecisionRequestSchema,
  moderationListQuerySchema,
  moderatorQueueQuerySchema,
  type ModerationReviewerListResponse,
  type ModerationTaskDetail,
  type ModerationTaskListResponse,
  type ModerationTaskResponse,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { RequestIdentity } from '../../auth/identity';
import { sendError } from '../../http/send-error';
import { currentIdentity, requirePermission } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { StoreUnavailableError } from '../commerce/errors';
import { noStore } from '../commerce/http';
import { sendAdminFailure, type AdminRefusal, type RefusalAnswer } from './errors';
import type { ModerationTaskRecord } from './moderation-store';
import type { AdminRouteDependencies } from './routes';
import { emptyBodySchema, pageInfo, pageOf } from './shared';

const taskParams = z.object({ taskId: uuidSchema });
const queueSchemas = { query: moderatorQueueQuerySchema };
const listSchemas = { query: moderationListQuerySchema };
const taskSchemas = { params: taskParams };
const decisionSchemas = { params: taskParams, body: moderationDecisionRequestSchema };
const assignmentSchemas = { params: taskParams, body: moderationAssignmentRequestSchema };
const withdrawSchemas = { params: taskParams, body: emptyBodySchema };

const TASK_ANSWERS: Partial<Record<AdminRefusal, RefusalAnswer>> = {
  not_found: [404, 'not_found', 'Review not found'],
  invalid_input: [400, 'bad_request', 'Explain the decision in 10 to 1,000 characters'],
};

/** NZ437 from assign_moderation_task and decide_moderation_task. */
const OWN_CONTENT: RefusalAnswer = [
  409,
  'own_submission',
  'Reviews go to someone who neither submitted nor last edited the content, and only an owner can take a review themselves',
];

function withActions(task: ModerationTaskRecord, identity: RequestIdentity): ModerationTaskDetail {
  return {
    ...task,
    canDecide:
      task.status === 'pending' &&
      task.assignedTo?.id === identity.userId &&
      task.submittedBy?.id !== identity.userId &&
      identity.permissions.has('content.approve'),
  };
}

/**
 * The moderator workspace (GET /moderator/queue, GET /moderator/tasks/:taskId, POST
 * /moderator/tasks/:taskId/decision) and the assigners' side (GET /admin/moderation,
 * GET /admin/moderation/reviewers, GET /admin/moderation/:taskId, POST
 * /admin/moderation/:taskId/assignment and /withdraw).
 *
 * A moderator sees and decides only the reviews assigned to them: anyone else's
 * review answers 404, here and in the database (decide_moderation_task).
 */
export function moderationRouter(deps: AdminRouteDependencies): Router {
  const router = Router();
  const { moderation } = deps.stores;
  const { requireUser, limiter } = deps;
  const canReview = requirePermission('content.approve');
  const canAssign = requirePermission('moderation.assign');

  async function sendTask(
    res: Response,
    identity: RequestIdentity,
    taskId: string,
    options: { assignedToCaller: boolean },
  ) {
    const task = await moderation.getTask(identity.accessToken, identity.userId, taskId);
    if (!task || (options.assignedToCaller && task.assignedTo?.id !== identity.userId)) {
      sendError(res, 404, 'not_found', 'Review not found');
      return;
    }
    const response: ModerationTaskResponse = { task: withActions(task, identity) };
    res.json(response);
  }

  /** After a change: the review must be readable, or the answer would claim it vanished. */
  async function sendChangedTask(res: Response, identity: RequestIdentity, taskId: string) {
    const task = await moderation.getTask(identity.accessToken, identity.userId, taskId);
    if (!task) throw new StoreUnavailableError('The review changed, but it could not be read back');
    const response: ModerationTaskResponse = { task: withActions(task, identity) };
    res.json(response);
  }

  router.get(
    '/moderator/queue',
    noStore,
    requireUser,
    canReview,
    validate(queueSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof queueSchemas>(res);
      const { tasks, total } = await moderation.listTasks(
        identity.accessToken,
        identity.userId,
        { scope: 'mine', status: query.status },
        pageOf(query),
      );
      const response: ModerationTaskListResponse = { tasks, ...pageInfo(query, total) };
      res.json(response);
    },
  );

  router.get(
    '/moderator/tasks/:taskId',
    noStore,
    requireUser,
    canReview,
    validate(taskSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof taskSchemas>(res);
      await sendTask(res, identity, params.taskId, { assignedToCaller: true });
    },
  );

  router.post(
    '/moderator/tasks/:taskId/decision',
    noStore,
    limiter,
    requireUser,
    canReview,
    validate(decisionSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof decisionSchemas>(res);
      try {
        await moderation.decide(
          identity.accessToken,
          identity.userId,
          params.taskId,
          body.decision,
          body.note,
        );
      } catch (error) {
        sendAdminFailure(res, error, { ...TASK_ANSWERS, own_submission: OWN_CONTENT });
        return;
      }
      await sendChangedTask(res, identity, params.taskId);
    },
  );

  router.get(
    '/admin/moderation',
    noStore,
    requireUser,
    canAssign,
    validate(listSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof listSchemas>(res);
      const { tasks, total } = await moderation.listTasks(
        identity.accessToken,
        identity.userId,
        { scope: query.scope, status: query.status },
        pageOf(query),
      );
      const response: ModerationTaskListResponse = { tasks, ...pageInfo(query, total) };
      res.json(response);
    },
  );

  router.get('/admin/moderation/reviewers', noStore, requireUser, canAssign, async (_req, res) => {
    const identity = currentIdentity(res);
    try {
      const response: ModerationReviewerListResponse = {
        reviewers: await moderation.listReviewers(identity.accessToken, identity.userId),
      };
      res.json(response);
    } catch (error) {
      sendAdminFailure(res, error);
    }
  });

  router.get(
    '/admin/moderation/:taskId',
    noStore,
    requireUser,
    canAssign,
    validate(taskSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof taskSchemas>(res);
      await sendTask(res, identity, params.taskId, { assignedToCaller: false });
    },
  );

  router.post(
    '/admin/moderation/:taskId/assignment',
    noStore,
    limiter,
    requireUser,
    canAssign,
    validate(assignmentSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof assignmentSchemas>(res);
      try {
        await moderation.assign(
          identity.accessToken,
          identity.userId,
          params.taskId,
          body.moderatorId,
        );
      } catch (error) {
        sendAdminFailure(res, error, {
          ...TASK_ANSWERS,
          review_closed: [
            409,
            'review_not_assignable',
            'This review is closed, or the account cannot review content',
          ],
          own_submission: OWN_CONTENT,
        });
        return;
      }
      await sendChangedTask(res, identity, params.taskId);
    },
  );

  router.post(
    '/admin/moderation/:taskId/withdraw',
    noStore,
    limiter,
    requireUser,
    requirePermission('products.update'),
    validate(withdrawSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof withdrawSchemas>(res);
      try {
        await moderation.withdraw(identity.accessToken, identity.userId, params.taskId);
      } catch (error) {
        sendAdminFailure(res, error, {
          ...TASK_ANSWERS,
          missing_permission: [
            403,
            'forbidden',
            'Only the submitter or a review assigner can withdraw this review',
          ],
        });
        return;
      }
      await sendChangedTask(res, identity, params.taskId);
    },
  );

  return router;
}
