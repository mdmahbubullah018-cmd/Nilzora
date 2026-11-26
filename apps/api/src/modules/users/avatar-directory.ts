import type { Pool } from 'pg';
import type { MediaPicture } from '@nilzora/contracts';
import { ownedPicture } from '../media/public-url';

/*
 * Where a customer's picture comes from
 * -------------------------------------
 * One lookup for the three sources, in the order they are shown:
 *
 *   1. the picture the customer uploaded        profiles.avatar_key   (an object in R2)
 *   2. the picture their Google account gave us  auth.users metadata   (a URL at Google)
 *   3. nothing                                   the client draws their initials
 *
 * Google's picture is read from the account's *provider* metadata rather than its user
 * metadata alone, and only an https URL on a Google picture host is accepted: metadata is
 * user-editable, so trusting it blindly would let an account point an avatar at any server,
 * and the admin panel would then load it for staff. Nothing here decides what an account may
 * do — it only decides what picture to show.
 *
 * The lookup is one statement for a whole page of customers, so a list of 100 costs one extra
 * query rather than 100.
 */

/** A customer's pictures: the stored key (null when none) and Google's URL (null when none). */
export interface StoredAvatars {
  customKey: string | null;
  googleUrl: string | null;
}

export interface AvatarDirectory {
  /** Pictures for these accounts; an account with neither source is simply absent. */
  forUsers(ids: readonly string[]): Promise<Map<string, StoredAvatars>>;
}

/** The hosts Google serves profile pictures from. */
const GOOGLE_PICTURE_HOSTS = [
  'lh3.googleusercontent.com',
  'lh4.googleusercontent.com',
  'lh5.googleusercontent.com',
  'lh6.googleusercontent.com',
];

/** Google's picture URL, or null when it is not one (or not Google's at all). */
export function googlePictureUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (!GOOGLE_PICTURE_HOSTS.includes(url.hostname.toLowerCase())) return null;
  return url.toString();
}

/** A directory that never answers: used when the API runs without a direct connection. */
export const NO_AVATAR_DIRECTORY: AvatarDirectory = {
  forUsers: () => Promise.resolve(new Map()),
};

interface Row {
  id: string;
  avatar_key: string | null;
  google_picture: string | null;
}

/**
 * Reads the pictures of many accounts at once. `auth.users` is joined here rather than in the
 * customer functions so that no migration is needed to show a Google picture in the admin.
 */
export function createPostgresAvatarDirectory(pool: Pool): AvatarDirectory {
  return {
    async forUsers(ids) {
      if (ids.length === 0) return new Map();
      const { rows } = await pool.query<Row>(
        `select p.id,
                p.avatar_key,
                case
                  when coalesce(u.raw_app_meta_data ->> 'provider', '') = 'google'
                    or (u.raw_app_meta_data -> 'providers') ? 'google'
                  then nullif(u.raw_user_meta_data ->> 'avatar_url', '')
                end as google_picture
           from public.profiles p
           left join auth.users u on u.id = p.id
          where p.id = any($1::uuid[])`,
        [ids],
      );
      const found = new Map<string, StoredAvatars>();
      for (const row of rows) {
        const googleUrl = googlePictureUrl(row.google_picture);
        if (row.avatar_key === null && googleUrl === null) continue;
        found.set(row.id, { customKey: row.avatar_key, googleUrl });
      }
      return found;
    },
  };
}

/** The customer's own uploaded picture as URLs, or null when there is none. */
export function customAvatarPicture(
  stored: StoredAvatars | undefined,
  mediaBaseUrl: string | undefined,
): MediaPicture | null {
  return stored === undefined ? null : ownedPicture(stored.customKey, mediaBaseUrl);
}
