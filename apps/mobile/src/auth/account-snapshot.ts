import { meResponseSchema } from '@nilzora/contracts';
import * as SecureStore from 'expo-secure-store';
import { SECURE_STORE_OPTIONS } from './token-store';
import type { SessionUser } from './session-manager';

/*
 * The account's own details, kept so My Account opens without a connection
 * -----------------------------------------------------------------------
 * After the server confirms who is signed in, that profile (name, email, phone, picture) is
 * saved to SecureStore: the same encrypted, device-only, backup-excluded store the session uses,
 * not plain storage. It is read only when the saved session cannot be checked because the server
 * is unreachable, shown clearly as saved information, and never used to authorize anything: every
 * server action still needs the live session.
 *
 * It holds one account. It is removed on sign-out, on a session that ended, and replaced when a
 * different account signs in; an entry that does not validate is dropped rather than shown.
 * No order, address or payment detail is ever written here.
 */

export const ACCOUNT_SNAPSHOT_KEY = 'nilzora.account-snapshot.v1';

const userSchema = meResponseSchema.shape.user;

export async function saveAccountSnapshot(user: SessionUser): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      ACCOUNT_SNAPSHOT_KEY,
      JSON.stringify(user),
      SECURE_STORE_OPTIONS,
    );
  } catch {
    // The device may refuse the write; the account then simply has no offline copy.
  }
}

/** The saved profile, or null when there is none or it is not a valid account. */
export async function loadAccountSnapshot(): Promise<SessionUser | null> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(ACCOUNT_SNAPSHOT_KEY, SECURE_STORE_OPTIONS);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = userSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // Falls through to dropping it.
  }
  await clearAccountSnapshot();
  return null;
}

export async function clearAccountSnapshot(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(ACCOUNT_SNAPSHOT_KEY, SECURE_STORE_OPTIONS);
  } catch {
    // Nothing to remove, or the store cannot be reached right now.
  }
}
