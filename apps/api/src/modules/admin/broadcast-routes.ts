import {
  broadcastCreatedResponseSchema,
  broadcastListResponseSchema,
  broadcastRequestSchema,
  pushSettingsSchema,
  savePushSettingsSchema,
  type BroadcastCreatedResponse,
  type PushSettings,
  type BroadcastListResponse,
} from '@nilzora/contracts';
import { Router, type RequestHandler } from 'express';
import type { Pool } from 'pg';
import { withUser } from '../../db/user-context';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { currentIdentity, requirePermission } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import type { SupabaseClients } from '../../supabase/clients';
import { conform, isoTimestamps } from '../commerce/errors';
import { noStore } from '../commerce/http';
import { pgFailure } from '../db-rpc';
import { sendAdminFailure, toAdminStoreError } from './errors';
import { sqlNull } from './shared';

/*
 * Push broadcasts
 * ---------------
 * GET  /admin/broadcasts  the latest broadcasts with delivery figures
 * POST /admin/broadcasts  queue one for every customer whose device opted in
 *
 * Both need notifications.broadcast, checked here and again by the database functions,
 * which also hold the store to one broadcast per 10 minutes and audit each one. Sending is
 * the announcement worker's job; this request only queues.
 */

export interface BroadcastStore {
  list(accessToken: string, userId: string): Promise<BroadcastListResponse>;
  create(
    accessToken: string,
    userId: string,
    input: {
      title: string;
      body: string;
      productId: string | null;
      imageKey: string | null;
      linkPath: string | null;
      scheduledFor: string | null;
    },
  ): Promise<BroadcastCreatedResponse>;
  getSettings(accessToken: string, userId: string): Promise<PushSettings>;
  saveSettings(
    accessToken: string,
    userId: string,
    input: {
      autoAnnounceProducts: boolean;
      productTitleTemplate: string;
      productBodyTemplate: string;
    },
  ): Promise<PushSettings>;
}

function listOf(value: unknown): BroadcastListResponse {
  return conform(
    broadcastListResponseSchema,
    { broadcasts: isoTimestamps(value ?? []) },
    'admin_list_broadcasts',
  );
}

export function createPostgresBroadcastStore(pool: Pool): BroadcastStore {
  return {
    async list(_token, userId) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{ value: unknown }>(
            'select public.admin_list_broadcasts() as value',
          );
          return listOf(result.rows[0]?.value);
        });
      } catch (error) {
        throw toAdminStoreError(pgFailure(error), 'admin_list_broadcasts');
      }
    },
    async create(_token, userId, input) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{ value: unknown }>(
            'select public.admin_create_broadcast($1, $2, $3::uuid, $4, $5, $6::timestamptz) as value',
            [
              input.title,
              input.body,
              input.productId,
              input.imageKey,
              input.linkPath,
              input.scheduledFor,
            ],
          );
          return conform(
            broadcastCreatedResponseSchema,
            result.rows[0]?.value,
            'admin_create_broadcast',
          );
        });
      } catch (error) {
        throw toAdminStoreError(pgFailure(error), 'admin_create_broadcast');
      }
    },
    async getSettings(_token, userId) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{ value: unknown }>(
            'select public.admin_get_push_settings() as value',
          );
          return conform(
            pushSettingsSchema,
            isoTimestamps(result.rows[0]?.value),
            'admin_get_push_settings',
          );
        });
      } catch (error) {
        throw toAdminStoreError(pgFailure(error), 'admin_get_push_settings');
      }
    },
    async saveSettings(_token, userId, input) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{ value: unknown }>(
            'select public.admin_save_push_settings($1, $2, $3) as value',
            [input.autoAnnounceProducts, input.productTitleTemplate, input.productBodyTemplate],
          );
          return conform(
            pushSettingsSchema,
            isoTimestamps(result.rows[0]?.value),
            'admin_save_push_settings',
          );
        });
      } catch (error) {
        throw toAdminStoreError(pgFailure(error), 'admin_save_push_settings');
      }
    },
  };
}

export function createSupabaseBroadcastStore(clients: SupabaseClients): BroadcastStore {
  return {
    async list(accessToken) {
      const { data, error } = await clients.asUser(accessToken).rpc('admin_list_broadcasts');
      if (error) throw toAdminStoreError(error, 'admin_list_broadcasts');
      return listOf(data);
    },
    async create(accessToken, _userId, input) {
      const { data, error } = await clients.asUser(accessToken).rpc('admin_create_broadcast', {
        p_title: input.title,
        p_body: input.body,
        p_product_id: sqlNull(input.productId),
        p_image_key: sqlNull(input.imageKey),
        p_link_path: sqlNull(input.linkPath),
        p_scheduled_for: sqlNull(input.scheduledFor),
      });
      if (error) throw toAdminStoreError(error, 'admin_create_broadcast');
      return conform(broadcastCreatedResponseSchema, data, 'admin_create_broadcast');
    },
    async getSettings(accessToken) {
      const { data, error } = await clients.asUser(accessToken).rpc('admin_get_push_settings');
      if (error) throw toAdminStoreError(error, 'admin_get_push_settings');
      return conform(pushSettingsSchema, isoTimestamps(data), 'admin_get_push_settings');
    },
    async saveSettings(accessToken, _userId, input) {
      const { data, error } = await clients.asUser(accessToken).rpc('admin_save_push_settings', {
        p_auto_announce: input.autoAnnounceProducts,
        p_title_template: input.productTitleTemplate,
        p_body_template: input.productBodyTemplate,
      });
      if (error) throw toAdminStoreError(error, 'admin_save_push_settings');
      return conform(pushSettingsSchema, isoTimestamps(data), 'admin_save_push_settings');
    },
  };
}

const createSchemas = { body: broadcastRequestSchema };
const settingsSchemas = { body: savePushSettingsSchema };

export function broadcastRoutes(
  deps: AuthDependencies & { broadcasts: BroadcastStore; limiter: RequestHandler },
): Router {
  const router = Router();
  const requireUser = authenticate(deps);
  const canBroadcast = requirePermission('notifications.broadcast');

  router.get('/admin/broadcasts', noStore, requireUser, canBroadcast, async (_req, res) => {
    const identity = currentIdentity(res);
    res.json(await deps.broadcasts.list(identity.accessToken, identity.userId));
  });

  router.post(
    '/admin/broadcasts',
    noStore,
    deps.limiter,
    requireUser,
    canBroadcast,
    validate(createSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof createSchemas>(res);
      try {
        const created = await deps.broadcasts.create(identity.accessToken, identity.userId, {
          title: body.title,
          body: body.body,
          productId: body.productId ?? null,
          imageKey: body.imageKey ?? null,
          linkPath: body.linkPath ?? null,
          scheduledFor: body.scheduledFor ?? null,
        });
        res.status(201).json(created);
      } catch (error) {
        sendAdminFailure(res, error, {
          in_use: [
            409,
            'in_use',
            'Another broadcast went out less than 10 minutes ago. Wait, then send again.',
          ],
          invalid_input: [
            400,
            'bad_request',
            'Check the title, the message and the linked product (it must be on sale).',
          ],
        });
      }
    },
  );

  // Automatic announcements of new products: the switch and the words.
  router.get('/admin/push-settings', noStore, requireUser, canBroadcast, async (_req, res) => {
    const identity = currentIdentity(res);
    try {
      res.json(await deps.broadcasts.getSettings(identity.accessToken, identity.userId));
    } catch (error) {
      sendAdminFailure(res, error);
    }
  });

  router.put(
    '/admin/push-settings',
    noStore,
    deps.limiter,
    requireUser,
    canBroadcast,
    validate(settingsSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof settingsSchemas>(res);
      try {
        res.json(await deps.broadcasts.saveSettings(identity.accessToken, identity.userId, body));
      } catch (error) {
        sendAdminFailure(res, error, {
          invalid_input: [400, 'bad_request', 'Check the title and the message.'],
        });
      }
    },
  );

  return router;
}
