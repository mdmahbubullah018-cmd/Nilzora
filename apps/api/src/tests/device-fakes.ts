import { randomUUID } from 'node:crypto';
import type { DevicePlatform } from '@nilzora/contracts';
import { toDeviceStoreError } from '../modules/devices/errors';
import type { DeviceCaller, DeviceStore } from '../modules/devices/store';
import type { FakeIdentity } from './fakes';

/*
 * An in-memory stand-in for register_device_token / unregister_device_token and the
 * closed device_tokens table, for unit tests of the device routes. It checks the CALLER
 * (from the token, as auth.uid() would) and refuses with the migration's SQLSTATEs,
 * passed through the same toDeviceStoreError() mapping as the real stores. The real
 * functions are covered by pgTAP and the integration tests.
 *
 * Like the database, it binds each token to the session that registered it and offers
 * deliverable(), which answers only for tokens whose session is still alive. A Supabase
 * JWT carries its own `session_id` claim, so a caller without an explicit session id is
 * bound to the session behind its access token; a first-party caller must present the
 * session the resolver verified, and a session belonging to someone else is refused
 * exactly as register_device_token() refuses it.
 */

/** What a database error looks like, including the token-quoting row text it must not leak. */
export function dbDetail(token: string): string {
  return `Failing row contains (${randomUUID()}, ${randomUUID()}, ${token}, android).`;
}

/** The most devices an account keeps (register_device_token). */
export const MAX_DEVICES = 10;

export interface FakeDevice {
  id: string;
  userId: string;
  token: string;
  platform: DevicePlatform;
  appVersion: string | null;
  /** The access token whose session registered it (a fake session is one access token). */
  session: string;
  /** The session claim the registration was bound to. */
  sessionId: string;
  /** Increases with every registration, so "most recently seen" is deterministic. */
  seen: number;
  /** Product announcements for this device; order updates are not affected by it. */
  promotionalOptIn?: boolean;
}

export class FakeDevices {
  readonly rows: FakeDevice[] = [];
  /** Every call that reached the "database". */
  readonly calls: string[] = [];
  /** The next store call fails with this SQLSTATE; its DETAIL quotes the call's token. */
  nextFailure: string | undefined;
  private clock = 0;

  constructor(private readonly identity: FakeIdentity) {}

  private enter(operation: string, token: string): void {
    this.calls.push(operation);
    const code = this.nextFailure;
    if (code !== undefined) {
      this.nextFailure = undefined;
      throw toDeviceStoreError(
        { code, message: 'internal detail: relation', details: dbDetail(token) },
        'fake',
      );
    }
  }

  private caller(caller: DeviceCaller, token: string) {
    const user = this.identity.userFor(caller.accessToken);
    if (!user || user.id !== caller.userId) {
      throw toDeviceStoreError(
        { code: '42501', message: 'sign in', details: dbDetail(token) },
        'fake',
      );
    }
    // The session a registration is bound to: the verified one for a first-party token, or
    // the session behind the access token when a Supabase JWT carries it itself.
    const sessionId = caller.sessionId ?? this.identity.sessionIdFor(caller.accessToken);
    if (sessionId === undefined || sessionId === null) {
      throw toDeviceStoreError(
        { code: 'NZ412', message: 'a session is required', details: dbDetail(token) },
        'fake',
      );
    }
    const owner = this.identity.ownerOfSession(sessionId);
    if (owner !== undefined && owner !== caller.userId) {
      throw toDeviceStoreError(
        { code: 'NZ412', message: 'a session is required', details: dbDetail(token) },
        'fake',
      );
    }
    return { user, sessionId };
  }

  /** The tokens an account holds, oldest first. */
  tokensOf(userId: string): string[] {
    return this.rows
      .filter((row) => row.userId === userId)
      .sort((a, b) => a.seen - b.seen)
      .map((row) => row.token);
  }

  /**
   * deliverable_device_tokens(): the tokens whose registering session still exists (not
   * signed out, not expired) and belongs to the token's account.
   */
  deliverable(userId?: string): string[] {
    return this.rows
      .filter((row) => {
        const session = this.identity.sessions.get(row.session);
        return (
          (userId === undefined || row.userId === userId) &&
          session !== undefined &&
          !session.revoked &&
          !session.expired &&
          session.userId === row.userId
        );
      })
      .sort((a, b) => b.seen - a.seen)
      .map((row) => row.token);
  }

  readonly stores: DeviceStore = {
    register: (caller, { token, platform, appVersion }) => {
      this.enter('register', token);
      const { user, sessionId } = this.caller(caller, token);
      if (user.status !== 'active') {
        throw toDeviceStoreError({ code: 'NZ403', message: 'suspended' }, 'fake');
      }
      this.clock += 1;
      let row = this.rows.find((candidate) => candidate.token === token);
      if (row) {
        // A token that belonged to another account moves to the caller.
        Object.assign(row, {
          userId: user.id,
          platform,
          appVersion: appVersion ?? null,
          session: caller.accessToken,
          sessionId,
          seen: this.clock,
        });
      } else {
        row = {
          id: randomUUID(),
          userId: user.id,
          token,
          platform,
          appVersion: appVersion ?? null,
          session: caller.accessToken,
          sessionId,
          seen: this.clock,
        };
        this.rows.push(row);
      }
      const current = row;
      const surplus = this.rows
        .filter((candidate) => candidate.userId === user.id && candidate !== current)
        .sort((a, b) => b.seen - a.seen)
        .slice(MAX_DEVICES - 1);
      for (const old of surplus) this.rows.splice(this.rows.indexOf(old), 1);
      return Promise.resolve({ id: current.id });
    },

    unregister: (caller, token) => {
      this.enter('unregister', token);
      const { user } = this.caller(caller, token);
      const index = this.rows.findIndex((row) => row.userId === user.id && row.token === token);
      if (index >= 0) this.rows.splice(index, 1);
      return Promise.resolve(index >= 0);
    },

    setAnnouncements: (caller, token, enabled) => {
      this.enter('setAnnouncements', token);
      const { user } = this.caller(caller, token);
      const row = this.rows.find(
        (candidate) => candidate.userId === user.id && candidate.token === token,
      );
      // Someone else's token is not an error and changes nothing, as in the database.
      if (row !== undefined) row.promotionalOptIn = enabled;
      return Promise.resolve(enabled);
    },
  };
}
