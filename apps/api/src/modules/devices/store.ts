import type { DeviceRegistrationRequest } from '@nilzora/contracts';
import type { Pool } from 'pg';
import { z } from 'zod';
import { postgresRpc } from '../db-rpc';
import type { SupabaseClients } from '../../supabase/clients';
import { conform } from '../commerce/errors';
import { toDeviceStoreError } from './errors';

/** A validated body of POST /me/devices (the token already trimmed). */
export type DeviceRegistration = Omit<DeviceRegistrationRequest, 'appVersion'> & {
  appVersion?: string | undefined;
};

/**
 * The verified caller, as authenticate() established it. Nothing here is taken from the
 * request: `sessionId` is the first-party session behind the token (null for a Supabase
 * JWT, whose claims carry their own), so a device can only ever be bound to the caller's
 * own session.
 */
export interface DeviceCaller {
  /** Forwarded to PostgREST in the Supabase mode. Never logged or returned. */
  accessToken: string;
  userId: string;
  sessionId: string | null;
}

/**
 * The caller's own push devices, written as the user through the database functions
 * (register_device_token / unregister_device_token). The table itself is closed to
 * end users, so nothing here can read a token back; the notification sender reads
 * them with the service role.
 */
export interface DeviceStore {
  /**
   * Registers or refreshes the token for the caller; a token that belonged to another
   * account moves to the caller. Returns the device id.
   */
  register(caller: DeviceCaller, device: DeviceRegistration): Promise<{ id: string }>;
  /** Removes the caller's own token. False when the caller has no such token. */
  unregister(caller: DeviceCaller, token: string): Promise<boolean>;
  /**
   * Turns product announcements on or off for one of the caller's own devices. Returns the
   * stored value. Order updates are unaffected: the two preferences are separate.
   */
  setAnnouncements(caller: DeviceCaller, token: string, enabled: boolean): Promise<boolean>;
}

export function createSupabaseDeviceStore(clients: SupabaseClients): DeviceStore {
  return {
    async register({ accessToken }, { token, platform, appVersion }) {
      const { data, error } = await clients.asUser(accessToken).rpc('register_device_token', {
        p_token: token,
        p_platform: platform,
        ...(appVersion === undefined ? {} : { p_app_version: appVersion }),
      });
      if (error) throw toDeviceStoreError(error, 'register_device_token');
      return { id: conform(z.uuid(), data, 'register_device_token') };
    },

    async unregister({ accessToken }, token) {
      const { data, error } = await clients
        .asUser(accessToken)
        .rpc('unregister_device_token', { p_token: token });
      if (error) throw toDeviceStoreError(error, 'unregister_device_token');
      return conform(z.boolean(), data, 'unregister_device_token');
    },

    async setAnnouncements({ accessToken }, token, enabled) {
      const { data, error } = await clients
        .asUser(accessToken)
        .rpc('set_device_announcements', { p_token: token, p_enabled: enabled });
      if (error) throw toDeviceStoreError(error, 'set_device_announcements');
      return conform(z.boolean(), data, 'set_device_announcements');
    },
  };
}

/**
 * The same three functions over the direct connection, for accounts signed in with a
 * first-party session: their token is opaque, so PostgREST cannot authorise it. `withUser`
 * assumes the caller's identity inside the transaction and carries its verified
 * `session_id`, which register_device_token() stores with the device. Failures are mapped
 * the device way (the two refusals, everything else unavailable) rather than the commerce
 * way, and the database DETAIL never survives: it can quote the token.
 */
export function createPostgresDeviceStore(pool: Pool): DeviceStore {
  const rpcFor = (caller: DeviceCaller) =>
    postgresRpc(pool, toDeviceStoreError)(caller.userId, caller.sessionId);

  return {
    async register(caller, { token, platform, appVersion }) {
      const data = await rpcFor(caller)(
        'register_device_token',
        {
          p_token: token,
          p_platform: platform,
          ...(appVersion === undefined ? {} : { p_app_version: appVersion }),
        },
        false,
      );
      return { id: conform(z.uuid(), data, 'register_device_token') };
    },

    async unregister(caller, token) {
      const data = await rpcFor(caller)('unregister_device_token', { p_token: token }, false);
      return conform(z.boolean(), data, 'unregister_device_token');
    },

    async setAnnouncements(caller, token, enabled) {
      const data = await rpcFor(caller)(
        'set_device_announcements',
        { p_token: token, p_enabled: enabled },
        false,
      );
      return conform(z.boolean(), data, 'set_device_announcements');
    },
  };
}
