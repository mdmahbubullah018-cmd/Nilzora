import {
  acceptStaffInvitationRequestSchema,
  staffInvitationListResponseSchema,
  staffInvitationPreviewSchema,
  staffInvitationRequestSchema,
  staffInvitationSchema,
  type InvitableRole,
  type StaffInvitation,
  type StaffInvitationPreview,
  type StaffInvitationSentResponse,
} from '@nilzora/contracts';
import { passwordSchema, uuidSchema } from '@nilzora/validation';
import { randomUUID } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../../auth/passwords';
import type { EmailSender } from '../../auth/sender';
import { randomToken, tokenHash } from '../../auth/tokens';
import { withServiceRole, withUser } from '../../db/user-context';
import { staffInvitationEmail } from '../../email/staff-invitation';
import type { EmailBranding } from '../../email/design';
import { sendError } from '../../http/send-error';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { currentIdentity, requirePermission } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import { StoreUnavailableError, conform, isoTimestamps } from '../commerce/errors';
import { noStore } from '../commerce/http';
import { pgFailure } from '../db-rpc';
import { AdminRefusalError, sendAdminFailure, toAdminStoreError } from './errors';
import { emptyBodySchema } from './shared';

/*
 * Invitations that grant nothing until they are accepted
 * -------------------------------------------------------
 * POST /admin/staff/invitations                 create a pending invitation and email the link
 * GET  /admin/staff/invitations                 list them (pending, accepted, expired, revoked)
 * POST /admin/staff/invitations/:id/resend      a fresh token and expiry; the old link stops
 * POST /admin/staff/invitations/:id/revoke      withdraw a pending invitation
 * GET  /auth/staff-invitations/:token           what the invitee sees before accepting
 * POST /auth/staff-invitations/accept           accept: create or prove the account, then grant
 *
 * Sending an invitation creates no account and assigns no role. The role is the one stored with the
 * invitation (never taken from a request) and is granted by the database, in one transaction,
 * only after the token, its expiry and status, and the invitee's address have been checked. A
 * person who already has a customer account accepts with that account's own password: no second
 * identity is made and the customer's data is untouched. An account that already holds a role is
 * never changed. Tokens are 32 random bytes; the database keeps only their SHA-256.
 */

/** How long an invitation link works. */
export const INVITATION_TTL = '7 days';

export interface InvitedAccount {
  userId: string;
}

export interface StaffInvitationStore {
  create(
    userId: string,
    input: { email: string; fullName: string | null; role: InvitableRole },
    token: string,
  ): Promise<SentInvitation>;
  reissue(userId: string, invitationId: string, token: string): Promise<SentInvitation>;
  list(userId: string): Promise<StaffInvitation[]>;
  revoke(userId: string, invitationId: string): Promise<void>;
  preview(token: string): Promise<StaffInvitationPreview | null>;
  /** Creates the account (or proves the existing one) and accepts; see the module note. */
  accept(input: {
    token: string;
    password: string;
    fullName: string | undefined;
  }): Promise<AcceptOutcome>;
}

export interface SentInvitation {
  id: string;
  email: string;
  fullName: string | null;
  role: InvitableRole;
  expiresAt: string;
  inviterName: string;
}

export type AcceptOutcome =
  | { kind: 'accepted'; role: InvitableRole }
  | { kind: 'invalid' }
  | { kind: 'wrong_password' }
  | { kind: 'weak_password'; message: string }
  | { kind: 'already_has_role' };

interface SentRow {
  id: string;
  email: string;
  fullName: string | null;
  role: InvitableRole;
  expiresAt: string;
  inviterName: string;
}

export function createPostgresStaffInvitationStore(pool: Pool): StaffInvitationStore {
  function failure(error: unknown, operation: string): Error {
    if (error instanceof AdminRefusalError || error instanceof StoreUnavailableError) return error;
    return toAdminStoreError(pgFailure(error), operation);
  }

  return {
    async create(userId, input, token) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{ value: SentRow }>(
            `select public.admin_create_staff_invitation($1, $2, $3::public.app_role, $4, interval '${INVITATION_TTL}') as value`,
            [input.email, input.fullName, input.role, tokenHash(token)],
          );
          return conform(
            sentSchema,
            isoTimestamps(result.rows[0]?.value),
            'admin_create_staff_invitation',
          );
        });
      } catch (error) {
        throw failure(error, 'admin_create_staff_invitation');
      }
    },

    async reissue(userId, invitationId, token) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{ value: SentRow }>(
            `select public.admin_reissue_staff_invitation($1::uuid, $2, interval '${INVITATION_TTL}') as value`,
            [invitationId, tokenHash(token)],
          );
          return conform(
            sentSchema,
            isoTimestamps(result.rows[0]?.value),
            'admin_reissue_staff_invitation',
          );
        });
      } catch (error) {
        throw failure(error, 'admin_reissue_staff_invitation');
      }
    },

    async list(userId) {
      try {
        return await withUser(pool, userId, async (client) => {
          const result = await client.query<{ value: unknown }>(
            'select public.admin_list_staff_invitations() as value',
          );
          return conform(
            z.array(staffInvitationSchema),
            isoTimestamps(result.rows[0]?.value ?? []),
            'admin_list_staff_invitations',
          );
        });
      } catch (error) {
        throw failure(error, 'admin_list_staff_invitations');
      }
    },

    async revoke(userId, invitationId) {
      try {
        await withUser(pool, userId, (client) =>
          client.query('select public.admin_revoke_staff_invitation($1::uuid)', [invitationId]),
        );
      } catch (error) {
        throw failure(error, 'admin_revoke_staff_invitation');
      }
    },

    async preview(token) {
      const row = await withServiceRole(pool, async (client) => {
        const result = await client.query<{ value: unknown }>(
          'select public.staff_invitation_preview($1) as value',
          [tokenHash(token)],
        );
        return result.rows[0]?.value ?? null;
      });
      return row === null ? null : staffInvitationPreviewSchema.parse(isoTimestamps(row));
    },

    async accept({ token, password, fullName }) {
      const hash = tokenHash(token);
      try {
        return await acceptOnce(hash, token, password, fullName);
      } catch (error) {
        // A refusal after the account was made rolls the whole transaction back, so a refused
        // acceptance never leaves a new account behind.
        if (error instanceof AcceptRefused) return error.outcome;
        throw error;
      }
    },
  };

  async function acceptOnce(
    hash: Buffer,
    _token: string,
    password: string,
    fullName: string | undefined,
  ): Promise<AcceptOutcome> {
    {
      return withServiceRole(pool, async (client) => {
        const found = await client.query<{
          value: { email: string; fullName: string | null } | null;
        }>('select public.staff_invitation_preview($1) as value', [hash]);
        const invitation = found.rows[0]?.value ?? null;
        if (invitation === null) return { kind: 'invalid' } as const;

        const existing = await client.query<{ id: string; password_hash: string | null }>(
          'select id, password_hash from public.profiles where lower(email) = $1',
          [invitation.email],
        );
        let accountId: string;
        const profile = existing.rows[0];
        if (profile) {
          // An existing account (a customer) proves itself with its own password; nothing is created.
          if (
            profile.password_hash === null ||
            !(await verifyPassword(profile.password_hash, password))
          ) {
            return { kind: 'wrong_password' } as const;
          }
          accountId = profile.id;
        } else {
          const strong = passwordSchema.safeParse(password);
          if (!strong.success) {
            return {
              kind: 'weak_password',
              message: strong.error.issues[0]?.message ?? 'Choose a stronger password',
            } as const;
          }
          accountId = randomUUID();
          // The invitation reached this address, so it is verified; the role comes only after.
          await client.query('select public.provision_account($1::uuid, $2, $3, null, $4, true)', [
            accountId,
            invitation.email,
            fullName ?? invitation.fullName ?? invitation.email,
            await hashPassword(password),
          ]);
        }

        try {
          const accepted = await client.query<{ value: { role: InvitableRole } }>(
            'select public.accept_staff_invitation($1, $2::uuid) as value',
            [hash, accountId],
          );
          return { kind: 'accepted', role: accepted.rows[0]?.value.role ?? 'staff' } as const;
        } catch (error) {
          const failure = pgFailure(error);
          if (failure.code === 'NZ442') throw new AcceptRefused({ kind: 'already_has_role' });
          // The database's own refusals (a stale token, a different address, an inviter who may no
          // longer hand out the role) are all "this invitation cannot be accepted".
          if (/^NZ\d{3}$/.test(failure.code)) throw new AcceptRefused({ kind: 'invalid' });
          throw toAdminStoreError(failure, 'accept_staff_invitation');
        }
      });
    }
  }
}

/** Carries a refusal out of the transaction so it rolls back before the answer is given. */
class AcceptRefused extends Error {
  constructor(readonly outcome: AcceptOutcome) {
    super('invitation not accepted');
  }
}

const sentSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string().nullable(),
  role: z.enum(['admin', 'staff', 'moderator']),
  expiresAt: z.iso.datetime(),
  inviterName: z.string(),
});

export interface StaffInvitationRouteDependencies extends AuthDependencies {
  invitations: StaffInvitationStore;
  /** Absent when no mail server is configured: invitations are still saved, never sent. */
  email: EmailSender | undefined;
  branding: EmailBranding;
  adminAppOrigin: string;
  /** Shared per-IP limit for administrator changes. */
  limiter: RequestHandler;
  /** The stricter limit for the public accept routes. */
  publicLimiter: RequestHandler;
  onEmailFailure?: ((error: unknown) => void) | undefined;
}

const createSchemas = { body: staffInvitationRequestSchema };
const idParams = { params: z.object({ invitationId: uuidSchema }), body: emptyBodySchema };
const tokenParams = { params: z.object({ token: z.string().min(20).max(200) }) };
const acceptSchemas = { body: acceptStaffInvitationRequestSchema };

export function staffInvitationRoutes(deps: StaffInvitationRouteDependencies): Router {
  const router = Router();
  const { invitations, limiter, publicLimiter } = deps;
  const requireUser = authenticate(deps);
  const guard = [noStore, limiter, requireUser, requirePermission('staff.invite')] as const;

  function acceptUrl(token: string): string {
    return `${deps.adminAppOrigin.replace(/\/$/, '')}/accept-invite?invitation=${encodeURIComponent(token)}`;
  }

  /** Emails the link; a failed send is reported, never thrown: the invitation stays pending. */
  async function deliver(sent: SentInvitation, token: string): Promise<boolean> {
    if (deps.email === undefined) return false;
    const message = staffInvitationEmail(
      {
        inviteeName: sent.fullName,
        role: sent.role,
        inviterName: sent.inviterName,
        acceptUrl: acceptUrl(token),
        expiresAt: new Date(sent.expiresAt),
      },
      deps.branding,
    );
    try {
      await deps.email.send({ to: sent.email, ...message });
      return true;
    } catch (error) {
      deps.onEmailFailure?.(error);
      return false;
    }
  }

  const FAILURES = {
    not_found: [404, 'not_found', 'Invitation not found'],
    invalid_input: [
      409,
      'invitation_invalid',
      'This invitation cannot be changed in its current state',
    ],
    in_use: [
      409,
      'invitation_accepted',
      'This person already has an account with a role, or an invitation is already pending',
    ],
    missing_permission: [403, 'forbidden', 'Only the owner can send invitations'],
  } as const;

  router.post('/admin/staff/invitations', ...guard, validate(createSchemas), async (_req, res) => {
    const identity = currentIdentity(res);
    const { body } = requestInput<typeof createSchemas>(res);
    const token = randomToken();
    try {
      const sent = await invitations.create(
        identity.userId,
        { email: body.email, fullName: body.fullName ?? null, role: body.role },
        token,
      );
      const emailSent = await deliver(sent, token);
      const response: StaffInvitationSentResponse = {
        invitation: { id: sent.id, email: sent.email, role: sent.role, expiresAt: sent.expiresAt },
        emailSent,
      };
      res.status(201).json(response);
    } catch (error) {
      sendAdminFailure(res, error, FAILURES);
    }
  });

  router.get('/admin/staff/invitations', ...guard, async (_req, res) => {
    const identity = currentIdentity(res);
    try {
      const list = await invitations.list(identity.userId);
      res.json(staffInvitationListResponseSchema.parse({ invitations: list }));
    } catch (error) {
      sendAdminFailure(res, error, FAILURES);
    }
  });

  router.post(
    '/admin/staff/invitations/:invitationId/resend',
    ...guard,
    validate(idParams),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof idParams>(res);
      const token = randomToken();
      try {
        const sent = await invitations.reissue(identity.userId, params.invitationId, token);
        const emailSent = await deliver(sent, token);
        const response: StaffInvitationSentResponse = {
          invitation: {
            id: sent.id,
            email: sent.email,
            role: sent.role,
            expiresAt: sent.expiresAt,
          },
          emailSent,
        };
        res.json(response);
      } catch (error) {
        sendAdminFailure(res, error, FAILURES);
      }
    },
  );

  router.post(
    '/admin/staff/invitations/:invitationId/revoke',
    ...guard,
    validate(idParams),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { params } = requestInput<typeof idParams>(res);
      try {
        await invitations.revoke(identity.userId, params.invitationId);
        res.status(204).end();
      } catch (error) {
        sendAdminFailure(res, error, FAILURES);
      }
    },
  );

  // ------------------------------------------------------------------ the invitee (no session)

  router.get(
    '/auth/staff-invitations/:token',
    noStore,
    publicLimiter,
    validate(tokenParams),
    async (_req, res) => {
      const { params } = requestInput<typeof tokenParams>(res);
      const preview = await invitations.preview(params.token);
      if (preview === null) {
        sendError(res, 404, 'invitation_invalid', 'This invitation link is invalid or has expired');
        return;
      }
      res.json(preview);
    },
  );

  router.post(
    '/auth/staff-invitations/accept',
    noStore,
    publicLimiter,
    validate(acceptSchemas),
    async (_req, res) => {
      const { body } = requestInput<typeof acceptSchemas>(res);
      const outcome = await invitations.accept({
        token: body.token,
        password: body.password,
        fullName: body.fullName,
      });
      switch (outcome.kind) {
        case 'accepted':
          res.status(200).json({ role: outcome.role });
          return;
        case 'wrong_password':
          sendError(
            res,
            401,
            'invalid_credentials',
            'That password does not match the existing account for this address',
          );
          return;
        case 'weak_password':
          sendError(res, 400, 'bad_request', outcome.message);
          return;
        case 'already_has_role':
          sendError(
            res,
            409,
            'invitation_invalid',
            'This account already has a role in the workspace',
          );
          return;
        case 'invalid':
          sendError(
            res,
            400,
            'invitation_invalid',
            'This invitation link is invalid or has expired',
          );
      }
    },
  );

  return router;
}
