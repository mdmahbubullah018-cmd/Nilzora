import { emailSchema, fullNameSchema } from '@nilzora/validation';
import { z } from 'zod';
import { adminPageQueryShape, adminSearchSchema, pageInfoShape } from './admin-common';
import { adminOrderSummarySchema } from './admin-orders';
import { appRoleSchema, permissionSchema, PROFILE_STATUSES } from './auth';
import { mediaPictureSchema } from './media';

/*
 * Admin accounts: customers (search, suspension) and the staff team (invitations,
 * roles and per-account permission overrides).
 *
 * Role defaults live in the database. An override grants or denies one permission
 * to one staff account; a denial always wins, customers never hold grants, and a
 * suspended account holds nothing. Nobody manages their own account, nobody grants
 * a permission they do not hold, and only an owner manages admins.
 */

/** Roles a staff invitation can carry. Owners are never invited. */
export const INVITABLE_ROLES = ['admin', 'staff', 'moderator'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const PERMISSION_EFFECTS = ['grant', 'deny'] as const;
export type PermissionEffect = (typeof PERMISSION_EFFECTS)[number];

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

/** GET /admin/customers — newest accounts first. */
export const customerListQuerySchema = z.object({
  /** Matches the email, name or phone number. */
  q: adminSearchSchema.optional(),
  status: z.enum(PROFILE_STATUSES).optional(),
  ...adminPageQueryShape,
});

export const adminCustomerSummarySchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string().nullable(),
  phone: z.string().nullable(),
  status: z.enum(PROFILE_STATUSES),
  createdAt: z.iso.datetime(),
  orderCount: z.number().int().min(0),
  lastOrderAt: z.iso.datetime().nullable(),
  /** The picture the customer uploaded, when they have one. */
  avatar: mediaPictureSchema.nullable().default(null),
  /** The picture their Google account supplied, shown only while there is no upload. */
  googleAvatar: z.url().nullable().default(null),
});

export const adminCustomerDetailSchema = adminCustomerSummarySchema.extend({
  /** The latest orders; null when the caller may not see orders. */
  recentOrders: z.array(adminOrderSummarySchema).nullable(),
});

/**
 * POST /admin/customers/:customerId/status — suspending needs a reason of at least
 * 5 characters. A suspended customer is refused on their very next request.
 */
export const customerStatusRequestSchema = z
  .strictObject({
    status: z.enum(PROFILE_STATUSES),
    reason: z
      .string()
      .trim()
      .max(300, { error: 'Keep the reason under 300 characters' })
      .transform((value) => (value === '' ? undefined : value))
      .optional(),
  })
  .refine((body) => body.status !== 'suspended' || (body.reason?.length ?? 0) >= 5, {
    error: 'Give a reason of at least 5 characters to suspend an account',
    path: ['reason'],
  });

export const customerListResponseSchema = z.object({
  customers: z.array(adminCustomerSummarySchema),
  ...pageInfoShape,
});

export const customerResponseSchema = z.object({ customer: adminCustomerDetailSchema });

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export const permissionOverrideSchema = z.object({
  permission: permissionSchema,
  effect: z.enum(PERMISSION_EFFECTS),
});

export const staffMemberSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string().nullable(),
  role: appRoleSchema.exclude(['customer']),
  status: z.enum(PROFILE_STATUSES),
  grantedAt: z.iso.datetime(),
  overrides: z.array(permissionOverrideSchema),
  /** Effective permissions: role defaults plus grants, minus denials. */
  permissions: z.array(permissionSchema),
  /** Invited but not accepted yet (the address is unconfirmed); the invitation can be re-sent. */
  invitationPending: z.boolean(),
});

/** A permission and what it allows, for the staff screens. */
export const permissionInfoSchema = z.object({
  name: permissionSchema,
  description: z.string(),
});

/** GET /admin/staff — owners first, then admins, staff and moderators. */
export const staffListResponseSchema = z.object({
  staff: z.array(staffMemberSchema),
  permissions: z.array(permissionInfoSchema),
});

export const staffMemberResponseSchema = z.object({ member: staffMemberSchema });

/**
 * POST /admin/staff/invitations — emails a one-time link to the admin workspace's
 * /accept-invite page. Only owners invite admins; admins invite staff and moderators.
 */
export const staffInvitationRequestSchema = z.strictObject({
  email: emailSchema,
  role: z.enum(INVITABLE_ROLES),
  fullName: fullNameSchema.optional(),
});

export const staffInvitationResponseSchema = z.object({
  invitation: z.object({
    userId: z.uuid(),
    email: z.string(),
    role: z.enum(INVITABLE_ROLES),
  }),
});

/**
 * POST /admin/staff/:userId/invitation — emails a pending invitee a new one-time link
 * (the earlier link stops working). Only for invitations not accepted yet, for roles
 * the caller may invite.
 */
export const staffInvitationResendResponseSchema = z.object({
  invitation: z.object({ userId: z.uuid(), email: z.string() }),
});

/**
 * PUT /admin/staff/:userId/permissions — grants or denies one permission to one
 * account; null removes the override so the role default applies again.
 */
export const permissionOverrideRequestSchema = z.strictObject({
  permission: permissionSchema,
  effect: z.enum(PERMISSION_EFFECTS).nullable(),
});

export type CustomerListQuery = z.input<typeof customerListQuerySchema>;
export type AdminCustomerSummary = z.infer<typeof adminCustomerSummarySchema>;
export type AdminCustomerDetail = z.infer<typeof adminCustomerDetailSchema>;
export type CustomerStatusRequest = z.input<typeof customerStatusRequestSchema>;
export type CustomerListResponse = z.infer<typeof customerListResponseSchema>;
export type CustomerResponse = z.infer<typeof customerResponseSchema>;
export type PermissionOverride = z.infer<typeof permissionOverrideSchema>;
export type StaffMember = z.infer<typeof staffMemberSchema>;
export type PermissionInfo = z.infer<typeof permissionInfoSchema>;
export type StaffListResponse = z.infer<typeof staffListResponseSchema>;
export type StaffMemberResponse = z.infer<typeof staffMemberResponseSchema>;
export type StaffInvitationRequest = z.input<typeof staffInvitationRequestSchema>;
export type StaffInvitationResponse = z.infer<typeof staffInvitationResponseSchema>;
export type PermissionOverrideRequest = z.input<typeof permissionOverrideRequestSchema>;
export type StaffInvitationResendResponse = z.infer<typeof staffInvitationResendResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Invitations that grant nothing until they are accepted                      */
/* -------------------------------------------------------------------------- */

export const STAFF_INVITATION_STATUSES = ['pending', 'accepted', 'expired', 'revoked'] as const;
export type StaffInvitationStatus = (typeof STAFF_INVITATION_STATUSES)[number];

/** One invitation as the owner's team page lists it. `expired` is derived from the expiry time. */
export const staffInvitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string().nullable(),
  role: z.enum(INVITABLE_ROLES),
  status: z.enum(STAFF_INVITATION_STATUSES),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  sendCount: z.number().int().min(1),
  invitedBy: z.string(),
});
export type StaffInvitation = z.infer<typeof staffInvitationSchema>;

/** GET /admin/staff/invitations */
export const staffInvitationListResponseSchema = z.object({
  invitations: z.array(staffInvitationSchema),
});
export type StaffInvitationListResponse = z.infer<typeof staffInvitationListResponseSchema>;

/**
 * POST /admin/staff/invitations and POST /admin/staff/invitations/:id/resend. The invitation is
 * saved first; `emailSent` says whether the mail server accepted the message (when it did not,
 * the invitation stays pending and can be sent again).
 */
export const staffInvitationSentResponseSchema = z.object({
  invitation: z.object({
    id: z.uuid(),
    email: z.string(),
    role: z.enum(INVITABLE_ROLES),
    expiresAt: z.iso.datetime(),
  }),
  emailSent: z.boolean(),
});
export type StaffInvitationSentResponse = z.infer<typeof staffInvitationSentResponseSchema>;

/** GET /auth/staff-invitations/:token — what the invitee sees before accepting. */
export const staffInvitationPreviewSchema = z.object({
  email: z.string(),
  fullName: z.string().nullable(),
  role: z.enum(INVITABLE_ROLES),
  expiresAt: z.iso.datetime(),
  inviterName: z.string(),
  /** Whether an account already exists for the address (then its own password is asked for). */
  accountExists: z.boolean(),
});
export type StaffInvitationPreview = z.infer<typeof staffInvitationPreviewSchema>;

/**
 * POST /auth/staff-invitations/accept. A new address chooses its password (and may give a name);
 * an address that already has an account proves itself with that account's password. The role is
 * never part of the request: it is the one stored with the invitation.
 */
export const acceptStaffInvitationRequestSchema = z.strictObject({
  token: z.string().min(20).max(200),
  password: z.string().min(1).max(200),
  fullName: fullNameSchema.optional(),
});
export type AcceptStaffInvitationRequest = z.input<typeof acceptStaffInvitationRequestSchema>;
