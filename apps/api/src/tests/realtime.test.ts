import { describe, expect, it } from 'vitest';
import { createPresenceRegistry } from '../realtime/presence';
import {
  CHAT_TICKET_TTL_SECONDS,
  createChatTicketSigner,
  deriveChatTicketSecret,
} from '../realtime/ticket';

const SECRET = 'test-chat-socket-secret-that-is-long-enough-01';
const USER = '11111111-1111-4111-8111-111111111111';
const CONVERSATION = '44444444-4444-4444-8444-444444444444';

describe('chat socket tickets', () => {
  it('names the account it was issued for', () => {
    const signer = createChatTicketSigner(SECRET);
    const issued = signer.issue(USER);
    expect(signer.verify(issued.ticket)).toBe(USER);
    expect(issued.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('expires after the short lifetime', () => {
    const signer = createChatTicketSigner(SECRET);
    const now = 1_800_000_000;
    const issued = signer.issue(USER, now);
    expect(signer.verify(issued.ticket, now + CHAT_TICKET_TTL_SECONDS - 1)).toBe(USER);
    expect(signer.verify(issued.ticket, now + CHAT_TICKET_TTL_SECONDS)).toBeNull();
  });

  it('refuses a tampered payload', () => {
    const signer = createChatTicketSigner(SECRET);
    const issued = signer.issue(USER);
    const [prefix, payload, mac = ''] = issued.ticket.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: '22222222-2222-4222-8222-222222222222', exp: 9_999_999_999 }),
    ).toString('base64url');
    expect(signer.verify(`${prefix}.${forgedPayload}.${mac}`)).toBeNull();

    /*
     * The MAC must actually change. Flipping the last character to a fixed letter silently
     * produced the *original* ticket whenever the signature already ended in that letter (about
     * one run in sixty-four), which made this test fail intermittently for reasons that had
     * nothing to do with the signer. The replacement is now guaranteed to differ.
     */
    const last = mac.at(-1) ?? '';
    const flipped = `${mac.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
    expect(flipped).not.toBe(mac);
    expect(signer.verify(`${prefix}.${payload}.${flipped}`)).toBeNull();
  });

  it('refuses a ticket signed with another key', () => {
    const mine = createChatTicketSigner(SECRET);
    const theirs = createChatTicketSigner(`${SECRET}-different`);
    expect(mine.verify(theirs.issue(USER).ticket)).toBeNull();
  });

  it('refuses a malformed ticket and a key that is too short', () => {
    const signer = createChatTicketSigner(SECRET);
    expect(signer.verify('')).toBeNull();
    expect(signer.verify('v1.not-base64.not-base64')).toBeNull();
    expect(() => createChatTicketSigner('short')).toThrow(TypeError);
  });

  it('refuses to issue a ticket for something that is not an account id', () => {
    const signer = createChatTicketSigner(SECRET);
    expect(() => signer.issue('not-a-uuid')).toThrow(TypeError);
  });

  it('derives a distinct key from the authentication secret', () => {
    const source = 'a-first-party-authentication-secret-32-plus';
    expect(deriveChatTicketSecret(source)).not.toBe(source);
    expect(deriveChatTicketSecret(source)).toBe(deriveChatTicketSecret(source));
    // A ticket signed with the derived key is not accepted by the raw one.
    const derived = createChatTicketSigner(deriveChatTicketSecret(source));
    const raw = createChatTicketSigner(source);
    expect(raw.verify(derived.issue(USER).ticket)).toBeNull();
  });
});

describe('chat presence', () => {
  it('counts an account as present only while it heartbeats', () => {
    let now = 1_000;
    const presence = createPresenceRegistry({ ttlMs: 60_000, now: () => now });
    presence.add('socket-1', USER, CONVERSATION);

    expect(presence.isOnline(CONVERSATION, USER)).toBe(true);
    now += 59_000;
    expect(presence.isOnline(CONVERSATION, USER)).toBe(true);

    now += 2_000;
    expect(presence.isOnline(CONVERSATION, USER)).toBe(false);
    expect(presence.expired()).toEqual(['socket-1']);
  });

  it('keeps an account present while any of its sockets heartbeats', () => {
    let now = 1_000;
    const presence = createPresenceRegistry({ ttlMs: 60_000, now: () => now });
    presence.add('phone', USER, CONVERSATION);
    presence.add('laptop', USER, CONVERSATION);

    now += 50_000;
    expect(presence.touch('laptop')).toBe(true);
    now += 20_000;
    // The phone lapsed but the laptop heartbeat at 51s, still inside the window.
    expect(presence.isOnline(CONVERSATION, USER)).toBe(true);
    expect(presence.expired()).toEqual(['phone']);
  });

  it('forgets a socket when it leaves or disconnects', () => {
    const presence = createPresenceRegistry();
    presence.add('socket-1', USER, CONVERSATION);

    expect(presence.remove('socket-1', CONVERSATION)).toBe(USER);
    expect(presence.isOnline(CONVERSATION, USER)).toBe(false);
    expect(presence.size(CONVERSATION)).toBe(0);

    presence.add('socket-1', USER, CONVERSATION);
    expect(presence.removeAll('socket-1')).toEqual({
      userId: USER,
      conversationIds: [CONVERSATION],
    });
    expect(presence.size(CONVERSATION)).toBe(0);
  });

  it('reports an unknown socket rather than pretending it is present', () => {
    const presence = createPresenceRegistry();
    expect(presence.touch('never-connected')).toBe(false);
    expect(presence.remove('never-connected', CONVERSATION)).toBeUndefined();
  });

  it('lists the present accounts among the participants of a conversation', () => {
    const presence = createPresenceRegistry();
    presence.add('customer', USER, CONVERSATION);
    const other = '22222222-2222-4222-8222-222222222222';
    expect(presence.onlineIn(CONVERSATION, [USER, other])).toEqual([USER]);
  });
});
