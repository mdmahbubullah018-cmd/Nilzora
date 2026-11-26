import {
  assignRoleRequestSchema,
  type ApiErrorCode,
  type AssignRoleResponse,
} from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { sendError } from '../../http/send-error';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { currentIdentity, requirePermission } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { noStore } from '../commerce/http';
import { RoleAssignmentError, type RoleAssignmentRefusal } from '../users/accounts';

const assignRoleSchemas = {
  params: z.object({ userId: uuidSchema }),
  body: assignRoleRequestSchema,
};

/** Answers to the database's role-assignment refusals (also used by staff invitations). */
export const ROLE_REFUSALS: Readonly<
  Record<RoleAssignmentRefusal, readonly [number, ApiErrorCode, string]>
> = {
  own_role: [403, 'forbidden', 'You cannot change your own role'],
  actor_not_permitted: [403, 'forbidden', 'You do not have permission to assign roles'],
  owner_only: [403, 'forbidden', 'Only the owner can create users or assign roles'],
  owner_role_protected: [403, 'forbidden', 'The owner role cannot be assigned'],
  last_owner: [403, 'forbidden', 'The last owner cannot be demoted'],
  target_not_found: [404, 'not_found', 'Account not found'],
};

/**
 * PUT /admin/users/:userId/role — the trusted path for privileged roles.
 * The API checks the caller's permission first; the database function then
 * re-checks the caller's role from its own tables and applies the hierarchy
 * (admins manage staff, moderators and customers; only owners manage admins).
 * Shares the admin changes' rate limit.
 */
export function staffRouter(deps: AuthDependencies & { limiter: RequestHandler }): Router {
  const router = Router();

  router.put(
    '/admin/users/:userId/role',
    noStore,
    deps.limiter,
    authenticate(deps),
    requirePermission('staff.roles.assign'),
    validate(assignRoleSchemas),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params, body } = requestInput<typeof assignRoleSchemas>(res);
      // assign_user_role enforces both rules again; refusing here sends nothing to the database.
      if (body.role === 'super_admin') {
        const [status, code, message] = ROLE_REFUSALS.owner_role_protected;
        sendError(res, status, code, message);
        return;
      }
      if (identity.role !== 'super_admin') {
        const [status, code, message] = ROLE_REFUSALS.owner_only;
        sendError(res, status, code, message);
        return;
      }
      try {
        const assignment = await deps.accounts.assignRole(
          identity.userId,
          params.userId,
          body.role,
        );
        const response: AssignRoleResponse = assignment;
        res.json(response);
      } catch (error) {
        if (!(error instanceof RoleAssignmentError)) throw error;
        const [status, code, message] = ROLE_REFUSALS[error.refusal];
        sendError(res, status, code, message);
      }
    },
  );

  return router;
}
