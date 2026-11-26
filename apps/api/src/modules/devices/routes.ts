import {
  deviceAnnouncementPreferenceRequestSchema,
  deviceRegistrationRequestSchema,
  deviceRemovalRequestSchema,
  type DeviceAnnouncementPreferenceResponse,
  type DeviceRegistrationResponse,
} from '@nilzora/contracts';
import { Router, type Response } from 'express';
import type { RequestIdentity } from '../../auth/identity';
import { sendError } from '../../http/send-error';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { currentIdentity } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { noStore } from '../commerce/http';
import { DeviceRefusalError } from './errors';
import type { DeviceCaller, DeviceStore } from './store';

const registerSchemas = { body: deviceRegistrationRequestSchema };
const removeSchemas = { body: deviceRemovalRequestSchema };
const preferenceSchemas = { body: deviceAnnouncementPreferenceRequestSchema };

/** The verified caller, in the shape the store needs. Nothing here comes from the request. */
function callerOf(identity: RequestIdentity): DeviceCaller {
  return {
    accessToken: identity.accessToken,
    userId: identity.userId,
    sessionId: identity.sessionId,
  };
}

/** Answers a device refusal with its stable code; anything else is rethrown (a 503). */
function sendDeviceFailure(res: Response, error: unknown): void {
  if (!(error instanceof DeviceRefusalError)) throw error;
  if (error.refusal === 'account_suspended') {
    sendError(res, 403, 'account_suspended', 'This account is suspended');
    return;
  }
  sendError(res, 400, 'bad_request', 'The device could not be registered');
}

/**
 * POST /me/devices (register or refresh the caller's push token) and POST
 * /me/devices/remove (forget it on sign-out). Any signed-in, active account may use
 * them; the owner always comes from the verified token and the database acts for that
 * account only. Tokens are never echoed in a response and never logged (the request
 * logger records no bodies, and a database error's row text, which can quote the token,
 * is dropped before it can reach an error log). Writes share the global per-IP limit:
 * registering is rare, cheap and capped at 10 devices per account, and mobile networks
 * share addresses, so a stricter per-IP limit would punish real users.
 */
export function devicesRouter(deps: AuthDependencies & { devices: DeviceStore }): Router {
  const router = Router();
  const requireUser = authenticate(deps);

  router.post('/me/devices', noStore, requireUser, validate(registerSchemas), async (_req, res) => {
    const identity = currentIdentity(res);
    const { body } = requestInput<typeof registerSchemas>(res);
    try {
      const device = await deps.devices.register(callerOf(identity), body);
      const response: DeviceRegistrationResponse = { device };
      res.json(response);
    } catch (error) {
      sendDeviceFailure(res, error);
    }
  });

  router.post(
    '/me/devices/remove',
    noStore,
    requireUser,
    validate(removeSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof removeSchemas>(res);
      try {
        // Whether or not the caller had the token, the answer is the same.
        await deps.devices.unregister(callerOf(identity), body.token);
        res.status(204).end();
      } catch (error) {
        sendDeviceFailure(res, error);
      }
    },
  );

  // Product announcements: the customer's own choice, per device, and separate from order
  // updates. Nothing here sends anything; it only records what may be sent later.
  router.post(
    '/me/devices/announcements',
    noStore,
    requireUser,
    validate(preferenceSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof preferenceSchemas>(res);
      try {
        const enabled = await deps.devices.setAnnouncements(
          callerOf(identity),
          body.token,
          body.enabled,
        );
        const response: DeviceAnnouncementPreferenceResponse = { enabled };
        res.json(response);
      } catch (error) {
        sendDeviceFailure(res, error);
      }
    },
  );

  return router;
}
