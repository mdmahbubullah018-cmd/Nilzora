import {
  customerListQuerySchema,
  customerStatusRequestSchema,
  permissionOverrideRequestSchema,
  staffInvitationRequestSchema,
  type AdminRolesResponse,
  type AppRole,
  type CustomerListResponse,
  type CustomerResponse,
  type MediaPicture,
  type InvitableRole,
  type StaffInvitationResendResponse,
  type StaffInvitationResponse,
  type StaffListResponse,
  type StaffMemberResponse,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { RequestIdentity } from '../../auth/identity';
import { customAvatarPicture } from '../users/avatar-directory';
import { sendError } from '../../http/send-error';import {
  currentIdentity,
  requireAnyPermission,
  requirePermission,
} from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { AuthGatewayError } from '../auth/gateway';
import { sendAuthFailure } from '../auth/routes';
import { StoreUnavailableError } from '../commerce/errors';
import { noStore } from '../commerce/http';
import { ROLE_REFUSALS } from '../staff/routes';
import { RoleAssignmentError } from '../users/accounts';
import { sendAdminFailure } from './errors';
import type { AdminRouteDependencies } from './routes';
import { emptyBodySchema, pageInfo, pageOf } from './shared';

const customerParams = z.object({ customerId: uuidSchema });
const staffParams = z.object({ userId: uuidSchema });
const customerListSchemas = { query: customerListQuerySchema };
const customerSchemas = { params: customerParams };
const customerStatusSchemas = { params: customerParams, body: customerStatusRequestSchema };
const invitationSchemas = { body: staffInvitationRequestSchema };
const permissionSchemas = { params: staffParams, body: permissionOverrideRequestSchema };
const resendSchemas = { params: staffParams, body: emptyBodySchema };

/** Latest orders shown on a customer's page. */
const RECENT_ORDERS = 10;

/**
 * Roles each role may hand out through an invitation, mirroring assign_user_role: only
 * the owner creates system users (admins, staff and moderators); nobody else assigns
 * roles, and the owner role is never handed out.
 */
const INVITABLE_BY: Readonly<Partial<Record<AppRole, readonly InvitableRole[]>>> = {
  super_admin: ['admin', 'staff', 'moderator'],
};

/**
 * GET /admin/customers, GET /admin/customers/:customerId and its status change;
 * GET /admin/staff, POST /admin/staff/invitations, POST /admin/staff/:userId/invitation
 * (re-send) and PUT /admin/staff/:userId/permissions.
 * (Role changes are PUT /admin/users/:userId/role.)
 */
export function adminAccountsRouter(deps: AdminRouteDependencies): Router {
  const router = Router();
  const { accounts, orders } = deps.stores;
  const { requireUser, limiter } = deps;

  async function sendCustomer(res: Response, identity: RequestIdentity, customerId: string) {
    const customer = await accounts.getCustomer(identity.accessToken, identity.userId, customerId);
    if (!customer) {
      sendError(res, 404, 'not_found', 'Customer not found');
      return;
    }
    const pictures = await picturesOf([customer.id]);
    const recentOrders = identity.permissions.has('orders.read')
      ? (
          await orders.listOrders(
            identity.accessToken,
            identity.userId,
            { customerId },
            { limit: RECENT_ORDERS, offset: 0 },
          )
        ).orders
      : null;
    const response: CustomerResponse = {
      customer: { ...customer, ...pictures.get(customer.id), recentOrders },
    };
    res.json(response);
  }

  /**
   * The customers' pictures, in one lookup for the whole page. A failure here costs the page
   * its avatars, never the account data the caller asked for.
   */
  async function picturesOf(
    ids: readonly string[],
  ): Promise<Map<string, { avatar: MediaPicture | null; googleAvatar: string | null }>> {
    const source = deps.avatars;
    if (!source) {
      return new Map(ids.map((id) => [id, { avatar: null, googleAvatar: null }] as const));
    }
    try {
      const stored = await source.directory.forUsers(ids);
      return new Map(
        ids.map((id) => {
          const found = stored.get(id);
          return [
            id,
            {
              avatar: customAvatarPicture(found, source.mediaBaseUrl),
              googleAvatar: found?.googleUrl ?? null,
            },
          ] as const;
        }),
      );
    } catch {
      return new Map(ids.map((id) => [id, { avatar: null, googleAvatar: null }] as const));
    }
  }

  router.get(
    '/admin/customers',
    noStore,
    requireUser,
    requirePermission('customers.read'),
    validate(customerListSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { query } = requestInput<typeof customerListSchemas>(res);
      const { customers, total } = await accounts.listCustomers(
        identity.accessToken,
        identity.userId,
        { query: query.q, status: query.status },
        pageOf(query),
      );
      const pictures = await picturesOf(customers.map((customer) => customer.id));
      const response: CustomerListResponse = {
        customers: customers.map((customer) => ({ ...customer, ...pictures.get(customer.id) })),
        ...pageInfo(query, total),
      };
      res.json(response);
    },
  );

  router.get(
    '/admin/customers/:customerId',
    noStore,
    requireUser,
    requirePermission('customers.read'),
    validate(customerSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof customerSchemas>(res);
      await sendCustomer(res, identity, params.customerId);
    },
  );

  router.post(
    '/admin/customers/:customerId/status',
    noStore,
    limiter,
    requireUser,
    requirePermission('customers.read', 'customers.update'),
    validate(customerStatusSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof customerStatusSchemas>(res);
      try {
        await accounts.setCustomerStatus(
          identity.accessToken,
          identity.userId,
          params.customerId,
          body.status,
          body.reason,
        );
      } catch (error) {
        sendAdminFailure(res, error, {
          not_found: [404, 'not_found', 'Customer not found'],
          invalid_input: [400, 'bad_request', 'Give a reason of 5 to 300 characters'],
        });
        return;
      }
      await sendCustomer(res, identity, params.customerId);
    },
  );

  router.get(
    '/admin/staff',
    noStore,
    requireUser,
    requireAnyPermission(['staff.roles.assign', 'staff.permissions.manage']),
    async (_req, res) => {
      const identity = currentIdentity(res);
      try {
        const [staff, permissions] = await Promise.all([
          accounts.listStaff(identity.accessToken, identity.userId),
          accounts.listPermissions(identity.accessToken, identity.userId),
        ]);
        const response: StaffListResponse = { staff, permissions };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  /**
   * The roles matrix: what each role holds by default (the owner: every permission in the
   * catalogue). An account's own grants and denials come on top, per member, in /admin/staff.
   */
  router.get(
    '/admin/roles',
    noStore,
    requireUser,
    requireAnyPermission(['staff.roles.assign', 'staff.permissions.manage']),
    async (_req, res) => {
      const identity = currentIdentity(res);
      try {
        const response: AdminRolesResponse = {
          roles: await accounts.listRoles(identity.accessToken, identity.userId),
        };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error);
      }
    },
  );

  router.post(
    '/admin/staff/invitations',
    noStore,
    limiter,
    requireUser,
    requirePermission('staff.invite'),
    validate(invitationSchemas),
    async (req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<typeof invitationSchemas>(res);
      // The role is assigned by assign_user_role, which re-checks this hierarchy; checking
      // first means no account (and no email) is created for a role that would be refused.
      if (!(INVITABLE_BY[identity.role] ?? []).includes(body.role)) {
        sendError(res, 403, 'forbidden', 'You cannot invite an account with this role');
        return;
      }

      let userId: string;
      try {
        ({ userId } = await deps.gateway.inviteUser({
          email: body.email,
          fullName: body.fullName,
          redirectTo: `${deps.adminAppOrigin}/accept-invite`,
        }));
      } catch (error) {
        sendAuthFailure(res, error);
        return;
      }

      try {
        await deps.accounts.assignRole(identity.userId, userId, body.role);
      } catch (error) {
        // Without its role the invitation must not survive as a customer account; deleting
        // the account (always one this invitation created) also makes the emailed link
        // unusable.
        await deps.gateway.deleteUser(userId).catch((cause: unknown) => {
          req.log.warn({ err: cause }, 'An unassigned invitation could not be removed');
        });
        if (!(error instanceof RoleAssignmentError)) throw error;
        const [status, code, message] = ROLE_REFUSALS[error.refusal];
        sendError(res, status, code, message);
        return;
      }

      const response: StaffInvitationResponse = {
        invitation: { userId, email: body.email, role: body.role },
      };
      res.status(201).json(response);
    },
  );

  router.post(
    '/admin/staff/:userId/invitation',
    noStore,
    limiter,
    requireUser,
    requirePermission('staff.invite'),
    validate(resendSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof resendSchemas>(res);
      // The database decides, as the caller, whether this is a pending invitation the
      // caller may re-send, and records it; only then does the service role send it.
      let email: string;
      try {
        email = await accounts.prepareInvitationResend(
          identity.accessToken,
          identity.userId,
          params.userId,
        );
      } catch (error) {
        sendAdminFailure(res, error, {
          not_found: [404, 'not_found', 'Invitation not found'],
          invalid_input: [409, 'invitation_accepted', 'This invitation was already accepted'],
          missing_permission: [403, 'forbidden', 'You cannot re-send this invitation'],
        });
        return;
      }

      try {
        await deps.gateway.resendInvitation({
          email,
          redirectTo: `${deps.adminAppOrigin}/accept-invite`,
        });
      } catch (error) {
        if (error instanceof AuthGatewayError && error.failure === 'account_exists') {
          sendError(res, 409, 'invitation_accepted', 'This invitation was already accepted');
          return;
        }
        sendAuthFailure(res, error);
        return;
      }

      const response: StaffInvitationResendResponse = {
        invitation: { userId: params.userId, email },
      };
      res.json(response);
    },
  );

  router.put(
    '/admin/staff/:userId/permissions',
    noStore,
    limiter,
    requireUser,
    requirePermission('staff.permissions.manage'),
    validate(permissionSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof permissionSchemas>(res);
      try {
        await accounts.setPermission(
          identity.accessToken,
          identity.userId,
          params.userId,
          body.permission,
          body.effect,
        );
      } catch (error) {
        sendAdminFailure(res, error, {
          missing_permission: [
            403,
            'forbidden',
            'You can only grant or deny permissions you hold yourself',
          ],
          not_found: [404, 'not_found', 'Account not found'],
          not_manageable: [
            403,
            'account_not_manageable',
            'Customers hold no permissions, and only an owner manages admins',
          ],
          cannot_change_self: [403, 'cannot_change_self', 'You cannot change your own permissions'],
        });
        return;
      }
      const member = (await accounts.listStaff(identity.accessToken, identity.userId)).find(
        (candidate) => candidate.id === params.userId,
      );
      if (!member)
        throw new StoreUnavailableError(
          'The permission changed, but the account could not be read back',
        );
      const response: StaffMemberResponse = { member };
      res.json(response);
    },
  );

  return router;
}
