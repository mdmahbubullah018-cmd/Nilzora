import {
  bdMobilePhoneSchema,
  emailSchema,
  fullNameSchema,
  passwordSchema,
} from '@nilzora/validation';
import { z } from 'zod';
import { mediaPictureSchema } from './media';

/*
 * Authentication contract
 * -----------------------
 * Nilzora uses Supabase Auth through the Nilzora API with bearer tokens:
 *   - POST /auth/register, /auth/login and /auth/refresh return or accept tokens;
 *   - every protected call sends `Authorization: Bearer <accessToken>`;
 *   - the API never sets cookies, so its CORS policy sends no credentials.
 * Clients must keep tokens out of script-readable browser storage: the web apps keep
 * them server-side (HttpOnly cookies set by the Next.js server), and the mobile app
 * keeps them in the device keychain (Expo SecureStore).
 */

/** Application roles, from most to least privileged. */
export const APP_ROLES = ['super_admin', 'admin', 'staff', 'moderator', 'customer'] as const;
export type AppRole = (typeof APP_ROLES)[number];
export const appRoleSchema = z.enum(APP_ROLES);

/**
 * Permission names, the same as the database's `permissions` table. Which account
 * holds which permission is decided by the database (role defaults plus per-account
 * grants and denials, a denial always winning); clients receive the effective list
 * from GET /me and may use it only to shape the interface, never as a security boundary.
 */
export const PERMISSIONS = [
  'products.read',
  'products.create',
  'products.update',
  'products.publish',
  /** Adjust stock with a recorded reason. */
  'inventory.adjust',
  'orders.read',
  /** Contact an abandoned-checkout customer, record the attempt and manage recovery links. */
  'checkouts.recover',
  'orders.update_status',
  'orders.cancel',
  /** Record that a Cash-on-Delivery order's cash was collected. */
  'payments.collect',
  'customers.read',
  'customers.update',
  'coupons.create',
  'coupons.update',
  'reviews.moderate',
  /** Read customer reviews and their photos in the workspace. */
  'reviews.view',
  /** Answer a customer review in public. */
  'reviews.reply',
  /** Create and manage shopping zones (storefront collections), their banners and products. */
  'zones.manage',
  /** Decide the product content reviews assigned to the account. */
  'content.approve',
  /** Assign content reviews to moderators. */
  'moderation.assign',
  'finance.read',
  'refunds.request',
  'refunds.approve',
  'staff.invite',
  'staff.roles.assign',
  'staff.permissions.manage',
  'settings.manage',
  'audit_logs.read',
  /** Enter the admin workspace (store operations). */
  'admin_workspace.access',
  /** Enter the moderator workspace (content review). */
  'moderator_workspace.access',
  /** Write and archive approved customer-facing message templates. */
  'chat.templates.manage',
  /** Write, test and disable the automation rules behind the support queue. */
  'chat.automation.manage',
  /** Read conversation volume, response times and satisfaction reports. */
  'chat.analytics.read',
  /** Decide reported messages in the moderator review queue. */
  'chat.reports.review',
  /** Send a push message to every customer who opted in. */
  'notifications.broadcast',
  /** Open and take part in internal staff conversations. */
  'chat.internal.use',
  /** See discount campaigns and their pricing. */
  'discounts.view',
  /** Create a discount campaign as a draft. */
  'discounts.create',
  /** Edit a campaign and its targets. */
  'discounts.edit',
  /** Put a campaign on the calendar. */
  'discounts.schedule',
  /** Start a campaign, or resume a paused one. */
  'discounts.activate',
  /** Pause a running campaign. */
  'discounts.pause',
  /** End a campaign early. */
  'discounts.end',
  /** Archive a campaign. */
  'discounts.archive',
  /** Change a campaign's conflict priority. */
  'discounts.manage_priority',
  /** Decide whether coupons stack with a campaign. */
  'discounts.manage_coupon_policy',
  /** See courier providers, rate cards and the courier overview. */
  'couriers.read',
  /** Enable courier providers and change their settings (owner by default). */
  'couriers.configure',
  /** Manage negotiated courier rate cards. */
  'couriers.pricing.manage',
  /** See courier shipments and their tracking. */
  'shipments.read',
  /** Compare couriers and book shipments for orders. */
  'shipments.create',
  /** Cancel courier shipments. */
  'shipments.cancel',
  /** Refresh tracking and record a courier status by hand. */
  'shipments.track',
  /** Book return pickups and exchange shipments. */
  'shipments.returns.manage',
  /** See courier cash-on-delivery positions and settlements. */
  'couriers.cod.read',
  /** Record courier settlements and reconcile cash on delivery. */
  'couriers.cod.reconcile',
  /** Manage image search settings, indexing and search activity. */
  'image_search.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export const permissionSchema = z.enum(PERMISSIONS);

export const PROFILE_STATUSES = ['active', 'suspended'] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Requests. Strict objects: unknown fields such as `role`, `status` or
// `permissions` are rejected rather than silently ignored.
// ---------------------------------------------------------------------------

/** POST /auth/register — creates a customer account (never a privileged one). */
export const registerRequestSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  fullName: fullNameSchema.optional(),
  phone: bdMobilePhoneSchema.optional(),
});

/** POST /auth/login — existing passwords are not re-checked against the creation policy. */
export const loginRequestSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(1024),
});

/** POST /auth/refresh */
export const refreshRequestSchema = z.strictObject({
  refreshToken: z.string().min(1).max(4096),
});

/**
 * POST /auth/confirm-email — the one-time token hash from a confirmation email.
 * Confirms the address only: 204, no session. The owner then signs in with their password.
 */
export const confirmEmailRequestSchema = z.strictObject({
  tokenHash: z
    .string()
    .min(16)
    .max(256)
    .regex(/^[A-Za-z0-9_-]+$/),
});

/** The six digits from a verification or password-reset email. */
export const emailCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the six-digit code from your email');

/** POST /auth/verify-otp — redeems a code and, once verified, signs the account in. */
export const verifyOtpRequestSchema = z.strictObject({
  email: emailSchema,
  code: emailCodeSchema,
});

/** POST /auth/resend-otp — answers 202 whether or not the address has an account. */
export const resendOtpRequestSchema = z.strictObject({ email: emailSchema });

/** POST /auth/forgot-password — answers 202 whether or not the address has an account. */
export const forgotPasswordRequestSchema = z.strictObject({ email: emailSchema });

/** POST /auth/reset-password — sets a new password and revokes every session. */
export const resetPasswordRequestSchema = z.strictObject({
  email: emailSchema,
  code: emailCodeSchema,
  password: passwordSchema,
});

/**
 * POST /auth/accept-invite — the one-time token hash from a staff invitation email and
 * the password the invitee chooses. 204, no session: the invitee then signs in with it.
 */
export const acceptInvitationRequestSchema = z.strictObject({
  tokenHash: confirmEmailRequestSchema.shape.tokenHash,
  password: passwordSchema,
});

/** PATCH /me — only customer-editable profile fields; null clears a field. */
export const updateProfileRequestSchema = z
  .strictObject({
    fullName: fullNameSchema.nullable().optional(),
    phone: bdMobilePhoneSchema.nullable().optional(),
  })
  .refine((value) => value.fullName !== undefined || value.phone !== undefined, {
    error: 'Provide at least one field to update',
  });

/** PUT /admin/users/:userId/role — privileged; the server enforces who may assign what. */
export const assignRoleRequestSchema = z.strictObject({ role: appRoleSchema });

export type RegisterRequest = z.input<typeof registerRequestSchema>;
export type LoginRequest = z.input<typeof loginRequestSchema>;
export type RefreshRequest = z.input<typeof refreshRequestSchema>;
export type ConfirmEmailRequest = z.input<typeof confirmEmailRequestSchema>;
export type AcceptInvitationRequest = z.input<typeof acceptInvitationRequestSchema>;
export type UpdateProfileRequest = z.input<typeof updateProfileRequestSchema>;
export type AssignRoleRequest = z.input<typeof assignRoleRequestSchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * POST /auth/register always answers 202 with the same body, whether or not the
 * address already has an account, so the endpoint cannot be used to discover
 * registered emails.
 */
export const registerResponseSchema = z.object({
  status: z.literal('accepted'),
  message: z.string(),
});

export const authSessionSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  tokenType: z.literal('bearer'),
  /** Lifetime of the access token in seconds. */
  expiresIn: z.number().int().positive(),
  /** Unix time (seconds) at which the access token expires. */
  expiresAt: z.number().int().positive(),
});

/** GET /auth/providers — which social providers this deployment can actually offer. */
export const authProvidersSchema = z.object({ google: z.boolean() });

/** GET /auth/google/start — the Google URL to send the browser to. */
export const googleStartResponseSchema = z.object({ url: z.string().url() });

/** POST /auth/google/callback — the code and state a callback received, relayed server-side. */
export const googleCallbackRequestSchema = z.strictObject({
  code: z.string().min(1).max(4096),
  state: z.string().min(1).max(4096),
  /**
   * The `iss` parameter of the authorization response (RFC 9207). Google always sends it
   * and the API's OIDC client requires it, so a relay must pass it through unchanged.
   */
  iss: z.string().max(2048).optional(),
});

/**
 * The session a completed Google sign-in returns, plus the return path the flow started
 * with (a path inside the calling app, never another origin).
 */
export const googleSignInResponseSchema = authSessionSchema.extend({
  returnTo: z.string().optional(),
});

/**
 * POST /auth/google/id-token — for native apps: the ID token Google Identity Services
 * issued to the app. The API verifies it and answers a first-party session.
 */
export const googleIdTokenRequestSchema = z.strictObject({
  idToken: z.string().min(20).max(8192),
});

export const profileSchema = z.object({
  fullName: z.string().nullable(),
  /** The profile picture, as public URLs; null when none is set (or media is not configured). */
  avatar: mediaPictureSchema.nullable().default(null),
  /**
   * The picture the account's Google profile supplied, when it signed in with Google. Shown
   * only while `avatar` is null: an upload always wins. Never used for authorization.
   */
  googleAvatar: z.url().nullable().default(null),
  /** Customer-provided number in E.164 form; not verified. */
  phone: z.string().nullable(),
  status: z.enum(PROFILE_STATUSES),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/**
 * An account's two-factor state on GET /me. Present only for accounts that must use 2FA
 * (super_admin): until `verified`, every API request except the two-factor routes, GET /me and
 * sign-out is refused with 403 `two_factor_required`.
 */
export const twoFactorSummarySchema = z.object({
  required: z.boolean(),
  enrolled: z.boolean(),
  verified: z.boolean(),
});

/** GET /me and PATCH /me */
export const meResponseSchema = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.string().nullable(),
    role: appRoleSchema,
    permissions: z.array(permissionSchema),
    profile: profileSchema,
    twoFactor: twoFactorSummarySchema.optional(),
  }),
});

/** Six digits from an authenticator app. */
export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{3}\s?\d{3}$/, 'Enter the 6-digit code from your authenticator app')
  .transform((value) => value.replace(/\s/g, ''));

/** A recovery code as printed (XXXX-XXXX-XXXX); case, spaces and dashes are ignored. */
export const recoveryCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{4}[-\s]?[A-Za-z0-9]{4}[-\s]?[A-Za-z0-9]{4}$/, 'Enter a recovery code');

/** GET /auth/two-factor */
export const twoFactorStatusResponseSchema = z.object({
  required: z.boolean(),
  enrolled: z.boolean(),
  pending: z.boolean(),
  verified: z.boolean(),
  lockedUntil: z.iso.datetime().nullable(),
  recoveryCodesLeft: z.number().int().nonnegative(),
});

/** POST /auth/two-factor/enroll: re-authentication (absent only for password-less accounts). */
export const twoFactorEnrollRequestSchema = z.object({
  password: z.string().min(1).max(200).optional(),
});

/** The secret is shown once, during enrollment, to the account's own session. */
export const twoFactorEnrollResponseSchema = z.object({
  otpauthUri: z.string().startsWith('otpauth://totp/'),
  secret: z.string().min(16).max(80),
});

/** POST /auth/two-factor/activate and /verify */
export const twoFactorCodeRequestSchema = z.object({ code: totpCodeSchema });

/** POST /auth/two-factor/recovery */
export const twoFactorRecoveryRequestSchema = z.object({ recoveryCode: recoveryCodeSchema });

/** Ten single-use codes, shown once. */
export const twoFactorRecoveryCodesResponseSchema = z.object({
  recoveryCodes: z.array(z.string()).length(10),
});

export const twoFactorRecoveryUsedResponseSchema = z.object({
  recoveryCodesLeft: z.number().int().nonnegative(),
});

/** POST /auth/two-factor/reset: password plus a current code or a recovery code. */
export const twoFactorResetRequestSchema = z.object({
  password: z.string().min(1).max(200).optional(),
  code: z.union([totpCodeSchema, recoveryCodeSchema]),
});

export type TwoFactorSummary = z.infer<typeof twoFactorSummarySchema>;
export type TwoFactorStatusResponse = z.infer<typeof twoFactorStatusResponseSchema>;
export type TwoFactorEnrollResponse = z.infer<typeof twoFactorEnrollResponseSchema>;
export type TwoFactorRecoveryCodesResponse = z.infer<typeof twoFactorRecoveryCodesResponseSchema>;

export const assignRoleResponseSchema = z.object({
  userId: z.uuid(),
  role: appRoleSchema,
  grantedAt: z.iso.datetime(),
});

export type RegisterResponse = z.infer<typeof registerResponseSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
export type VerifyOtpRequest = z.input<typeof verifyOtpRequestSchema>;
export type ResendOtpRequest = z.input<typeof resendOtpRequestSchema>;
export type ForgotPasswordRequest = z.input<typeof forgotPasswordRequestSchema>;
export type ResetPasswordRequest = z.input<typeof resetPasswordRequestSchema>;
/** GET /auth/providers — which social providers this deployment can actually offer. */
export type AuthProviders = z.infer<typeof authProvidersSchema>;
export type GoogleStartResponse = z.infer<typeof googleStartResponseSchema>;
export type GoogleCallbackRequest = z.input<typeof googleCallbackRequestSchema>;
export type GoogleSignInResponse = z.infer<typeof googleSignInResponseSchema>;
export type GoogleIdTokenRequest = z.input<typeof googleIdTokenRequestSchema>;

export type Profile = z.infer<typeof profileSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type AssignRoleResponse = z.infer<typeof assignRoleResponseSchema>;
