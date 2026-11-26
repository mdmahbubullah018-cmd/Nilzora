import { updateProfileRequestSchema, type MediaPicture, type MeResponse } from '@nilzora/contracts';
import { Router, type Response } from 'express';
import type { RequestIdentity } from '../../auth/identity';
import { sendError } from '../../http/send-error';
import { authenticate, type AuthDependencies } from '../../middleware/authenticate';
import { currentIdentity } from '../../middleware/authorize';
import { requestInput, validate } from '../../middleware/validate';
import type { AttachmentStore } from '../attachments/store';
import { ownedPicture } from '../media/public-url';
import type { ProfileRecord } from './accounts';
import type { AvatarDirectory } from './avatar-directory';

/** Where the profile picture comes from; optional so the account routes work without it. */
export interface AvatarSource {
  store: AttachmentStore;
  /** Public address of the media bucket (undefined when media is not configured). */
  mediaBaseUrl: string | undefined;
  /** The Google picture and the stored key, for the caller only. */
  directory?: AvatarDirectory | undefined;
}

function meBody(
  identity: RequestIdentity,
  profile: ProfileRecord,
  avatar: MediaPicture | null,
  googleAvatar: string | null = null,
): MeResponse {
  return {
    user: {
      id: identity.userId,
      email: identity.email,
      role: identity.role,
      permissions: [...identity.permissions].sort(),
      profile: { ...profile, avatar, googleAvatar },
      // Only for accounts that must use 2FA: tells the workspace to send the owner to the
      // two-factor page. Display only; the API refuses every other request until it passes.
      ...(identity.twoFactor ? { twoFactor: identity.twoFactor } : {}),
    },
  };
}

/**
 * The caller's profile picture. It is read separately and never allowed to break the account
 * response: if the avatar cannot be read (for instance its database function is not installed
 * yet), the profile is still returned, with no picture.
 */
async function readAvatar(
  identity: RequestIdentity,
  source: AvatarSource | undefined,
): Promise<{ custom: MediaPicture | null; google: string | null }> {
  if (!source) return { custom: null, google: null };
  let google: string | null = null;
  if (source.directory) {
    try {
      const stored = await source.directory.forUsers([identity.userId]);
      google = stored.get(identity.userId)?.googleUrl ?? null;
    } catch {
      // A picture is decoration: an unreadable directory leaves the profile without one.
      google = null;
    }
  }
  try {
    const key = await source.store.avatarKey({
      accessToken: identity.accessToken,
      userId: identity.userId,
    });
    return { custom: ownedPicture(key, source.mediaBaseUrl), google };
  } catch {
    return { custom: null, google };
  }
}

async function sendProfile(
  res: Response,
  identity: RequestIdentity,
  profile: ProfileRecord | null,
  avatars: AvatarSource | undefined,
) {
  if (!profile) {
    sendError(res, 403, 'account_unavailable', 'This account cannot be used right now');
    return;
  }
  const avatar = await readAvatar(identity, avatars);
  res
    .set('Cache-Control', 'no-store')
    .json(meBody(identity, profile, avatar.custom, avatar.google));
}

/**
 * GET /me and PATCH /me. Both act only on the caller's own profile: the user id
 * comes from the verified token, and the database enforces the same rule (RLS
 * plus column privileges), so no other account or protected field can be touched.
 */
export function usersRouter(deps: AuthDependencies, avatars?: AvatarSource): Router {
  const router = Router();
  const requireUser = authenticate(deps);
  // GET /me answers a session that has not passed 2FA yet, so the workspace can show the
  // two-factor page; it returns only the caller's own profile and their 2FA state.
  const requireUserPendingTwoFactor = authenticate({ ...deps, allowPendingTwoFactor: true });

  router.get('/me', requireUserPendingTwoFactor, async (_req, res) => {
    const identity = currentIdentity(res);
    const profile = await deps.accounts.getProfile(identity.accessToken, identity.userId);
    await sendProfile(res, identity, profile, avatars);
  });

  router.patch(
    '/me',
    requireUser,
    validate({ body: updateProfileRequestSchema }),
    async (_req, res) => {
      const identity = currentIdentity(res);
      const { body } = requestInput<{ body: typeof updateProfileRequestSchema }>(res);
      const profile = await deps.accounts.updateProfile(
        identity.accessToken,
        identity.userId,
        body,
      );
      await sendProfile(res, identity, profile, avatars);
    },
  );

  return router;
}
