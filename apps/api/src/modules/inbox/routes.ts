import {
  staffNotificationListResponseSchema,
  staffNotificationQuerySchema,
  unreadNotificationCountSchema,
  type StaffNotificationListResponse,
  type UnreadNotificationCount,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router } from 'express';
import { z } from 'zod';
import { currentIdentity, requirePermission } from '../../middleware/authorize';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { requestInput, validate } from '../../middleware/validate';
import { noStore, sendCommerceFailure } from '../commerce/http';
import type { InboxStore } from './store';

const listSchemas = { query: staffNotificationQuerySchema };
const readSchemas = { params: z.object({ notificationId: uuidSchema }) };

export interface InboxRouteDependencies extends AuthDependencies {
  inbox: InboxStore;
}

/**
 * The signed-in account's own inbox.
 *
 * The route requires `admin_workspace.access`, the same permission the Admin inbox page and
 * its header link require: an account that cannot open the page has no way to read what the
 * endpoint would return, so answering it would widen the surface for nothing. That is the
 * outer bound only — the database still decides which rows each caller may see (addressed to
 * them, or to a permission they hold), so a staff member never sees another's inbox and an
 * account holding the permission but no matching rows gets an empty list.
 *
 * Moderators keep their own workspace and are refused here, exactly as the Admin navigation
 * and the page already refuse them.
 */
export function inboxRoutes(deps: InboxRouteDependencies): Router {
  const { inbox } = deps;
  const requireUser = authenticate(deps);
  const canUseInbox = requirePermission('admin_workspace.access');
  const router = Router();

  router.get(
    '/staff/notifications',
    noStore,
    requireUser,
    canUseInbox,
    validate(listSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof listSchemas>(res);
      try {
        const { notifications, total } = await inbox.list(
          identity.accessToken,
          identity.userId,
          query,
          { limit: query.pageSize, offset: (query.page - 1) * query.pageSize },
        );
        const unread = await inbox.unreadCount(identity.accessToken, identity.userId);
        const response: StaffNotificationListResponse = staffNotificationListResponseSchema.parse({
          notifications,
          unread,
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
        });
        res.json(response);
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  router.get(
    '/staff/notifications/unread-count',
    noStore,
    requireUser,
    canUseInbox,
    async (_req, res) => {
      const identity = currentIdentity(res);
      try {
        const unread = await inbox.unreadCount(identity.accessToken, identity.userId);
        const response: UnreadNotificationCount = unreadNotificationCountSchema.parse({ unread });
        res.json(response);
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  router.post(
    '/staff/notifications/:notificationId/read',
    noStore,
    requireUser,
    canUseInbox,
    validate(readSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof readSchemas>(res);
      try {
        await inbox.markRead(identity.accessToken, identity.userId, params.notificationId);
        res.status(204).end();
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  router.post(
    '/staff/notifications/read-all',
    noStore,
    requireUser,
    canUseInbox,
    async (_req, res) => {
      const identity = currentIdentity(res);
      try {
        const unread = await inbox.markAllRead(identity.accessToken, identity.userId);
        const response: UnreadNotificationCount = unreadNotificationCountSchema.parse({ unread });
        res.json(response);
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  return router;
}

/**
 * The moderator workspace's inbox: the same store and the same rows-as-permission visibility,
 * reached through a different door — `moderator_workspace.access` instead of the admin
 * workspace's permission.
 *
 * This is not a widening of the admin inbox, which keeps its own gate. It exists because a
 * moderator holds `content.approve`, the permission the moderation notifications are
 * addressed to, and until now had no surface on which to see them. Which rows appear is still
 * decided in SQL: a moderator sees the rows addressed to a permission they hold, so only the
 * moderation ones, never an order, refund or stock notification addressed to someone else.
 *
 * The paths are distinct (`/moderator/notifications…`) so an admin client and a moderator
 * client can never confuse the two, and so each route's permission stays exactly as it is.
 */
export function moderatorInboxRoutes(deps: InboxRouteDependencies): Router {
  const { inbox } = deps;
  const requireUser = authenticate(deps);
  const canUseModeratorInbox = requirePermission('moderator_workspace.access');
  const router = Router();

  router.get(
    '/moderator/notifications',
    noStore,
    requireUser,
    canUseModeratorInbox,
    validate(listSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof listSchemas>(res);
      try {
        const { notifications, total } = await inbox.list(
          identity.accessToken,
          identity.userId,
          query,
          { limit: query.pageSize, offset: (query.page - 1) * query.pageSize },
        );
        const unread = await inbox.unreadCount(identity.accessToken, identity.userId);
        const response: StaffNotificationListResponse = staffNotificationListResponseSchema.parse({
          notifications,
          unread,
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
        });
        res.json(response);
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  router.get(
    '/moderator/notifications/unread-count',
    noStore,
    requireUser,
    canUseModeratorInbox,
    async (_req, res) => {
      const identity = currentIdentity(res);
      try {
        const unread = await inbox.unreadCount(identity.accessToken, identity.userId);
        const response: UnreadNotificationCount = unreadNotificationCountSchema.parse({ unread });
        res.json(response);
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  router.post(
    '/moderator/notifications/:notificationId/read',
    noStore,
    requireUser,
    canUseModeratorInbox,
    validate(readSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof readSchemas>(res);
      try {
        await inbox.markRead(identity.accessToken, identity.userId, params.notificationId);
        res.status(204).end();
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  router.post(
    '/moderator/notifications/read-all',
    noStore,
    requireUser,
    canUseModeratorInbox,
    async (_req, res) => {
      const identity = currentIdentity(res);
      try {
        const unread = await inbox.markAllRead(identity.accessToken, identity.userId);
        const response: UnreadNotificationCount = unreadNotificationCountSchema.parse({ unread });
        res.json(response);
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  return router;
}
