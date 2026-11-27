import {
  clearCustomerNotificationsRequestSchema,
  customerNotificationListResponseSchema,
  customerNotificationQuerySchema,
  customerNotificationsDeletedSchema,
  customerUnreadCountSchema,
  deleteCustomerNotificationsRequestSchema,
  notificationPreferencesPatchSchema,
  notificationPreferencesResponseSchema,
  type CustomerNotificationListResponse,
  type CustomerUnreadCount,
  type NotificationPreferencesResponse,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router } from 'express';
import { z } from 'zod';
import { currentIdentity } from '../../middleware/authorize';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { requestInput, validate } from '../../middleware/validate';
import { noStore, sendCommerceFailure } from '../commerce/http';
import type { CustomerNotificationStore } from './customer-store';
import type { NotificationPreferenceStore } from './preference-store';

const listSchemas = { query: customerNotificationQuerySchema };
const readSchemas = { params: z.object({ notificationId: uuidSchema }) };
const preferenceSchemas = { body: notificationPreferencesPatchSchema };
const deleteSchemas = { body: deleteCustomerNotificationsRequestSchema };
const clearSchemas = { body: clearCustomerNotificationsRequestSchema };

export interface CustomerInboxRouteDependencies extends AuthDependencies {
  notifications: CustomerNotificationStore;
  preferences?: NotificationPreferenceStore | undefined;
}

/**
 * The signed-in customer's own notification history.
 *
 * Every route requires a session, exactly like the other /me endpoints (vouchers, addresses,
 * devices). That is the outer bound only: the database answers `auth.uid()` for each read and
 * each mark, so a token for one account can never see or change another's rows, and no
 * customer id is accepted from the request at all.
 */
export function customerInboxRoutes(deps: CustomerInboxRouteDependencies): Router {
  const { notifications, preferences } = deps;
  const requireUser = authenticate(deps);
  const router = Router();

  router.get(
    '/me/notifications',
    noStore,
    requireUser,
    validate(listSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof listSchemas>(res);
      try {
        const { notifications: rows, total } = await notifications.list(
          identity.accessToken,
          identity.userId,
          query,
          { limit: query.pageSize, offset: (query.page - 1) * query.pageSize },
        );
        const unread = await notifications.unreadCount(identity.accessToken, identity.userId);
        const response: CustomerNotificationListResponse =
          customerNotificationListResponseSchema.parse({
            notifications: rows,
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

  router.get('/me/notifications/unread-count', noStore, requireUser, async (_req, res) => {
    const identity = currentIdentity(res);
    try {
      const unread = await notifications.unreadCount(identity.accessToken, identity.userId);
      const response: CustomerUnreadCount = customerUnreadCountSchema.parse({ unread });
      res.json(response);
    } catch (error) {
      sendCommerceFailure(res, error);
    }
  });

  router.post(
    '/me/notifications/:notificationId/read',
    noStore,
    requireUser,
    validate(readSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof readSchemas>(res);
      try {
        await notifications.markRead(identity.accessToken, identity.userId, params.notificationId);
        res.status(204).end();
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  // Removes entries from the caller's own notification centre only. The database function answers
  // auth.uid(), so another customer's id in the list is simply not deleted.
  router.post(
    '/me/notifications/delete',
    noStore,
    requireUser,
    validate(deleteSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof deleteSchemas>(res);
      try {
        const deleted = await notifications.remove(identity.accessToken, identity.userId, body.ids);
        res.json(customerNotificationsDeletedSchema.parse({ deleted }));
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  router.post(
    '/me/notifications/clear',
    noStore,
    requireUser,
    validate(clearSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof clearSchemas>(res);
      try {
        const deleted = await notifications.clear(
          identity.accessToken,
          identity.userId,
          body.before,
        );
        res.json(customerNotificationsDeletedSchema.parse({ deleted }));
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    },
  );

  router.post('/me/notifications/read-all', noStore, requireUser, async (_req, res) => {
    const identity = currentIdentity(res);
    try {
      await notifications.markAllRead(identity.accessToken, identity.userId);
      const response: CustomerUnreadCount = customerUnreadCountSchema.parse({ unread: 0 });
      res.json(response);
    } catch (error) {
      sendCommerceFailure(res, error);
    }
  });

  /**
   * What the account wants to be told. The store answers the caller's own row — no customer
   * id is accepted — and the database refuses an unknown key or a non-boolean outright.
   */
  if (preferences) {
    router.get('/me/notification-preferences', noStore, requireUser, async (_req, res) => {
      const identity = currentIdentity(res);
      try {
        const response: NotificationPreferencesResponse =
          notificationPreferencesResponseSchema.parse({
            preferences: await preferences.read(identity.accessToken, identity.userId),
          });
        res.json(response);
      } catch (error) {
        sendCommerceFailure(res, error);
      }
    });

    router.patch(
      '/me/notification-preferences',
      noStore,
      requireUser,
      validate(preferenceSchemas),
      async (_req, res) => {
        const identity = currentIdentity(res);
        const { body } = requestInput<typeof preferenceSchemas>(res);
        try {
          const response: NotificationPreferencesResponse =
            notificationPreferencesResponseSchema.parse({
              preferences: await preferences.save(identity.accessToken, identity.userId, body),
            });
          res.json(response);
        } catch (error) {
          sendCommerceFailure(res, error);
        }
      },
    );
  }

  return router;
}
