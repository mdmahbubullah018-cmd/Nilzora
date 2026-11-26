import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { EmailMessage, EmailSender } from '../auth/sender';
import { staffInvitationEmail } from '../email/staff-invitation';
import type {
  AcceptOutcome,
  SentInvitation,
  StaffInvitationStore,
} from '../modules/admin/staff-invitations';
import { AdminRefusalError } from '../modules/admin/errors';
import { FakeIdentity } from './fakes';
import { testApp } from './helpers';

/*
 * The invitation API and its email: who may send, what the request may and may not carry, what the
 * invitee's routes answer without a session, and the message itself. The database rules (token
 * single use, expiry, no role before acceptance) are in the integration test.
 */

const EXPIRES = '2030-01-10T08:00:00.000Z';

function fakeStore() {
  const created: { email: string; role: string; token: string }[] = [];
  const accepted: { token: string; password: string }[] = [];
  let outcome: AcceptOutcome = { kind: 'accepted', role: 'staff' };
  let refuse: AdminRefusalError | null = null;
  const sent = (email: string, role: SentInvitation['role']): SentInvitation => ({
    id: randomUUID(),
    email,
    fullName: 'Rafi Ahmed',
    role,
    expiresAt: EXPIRES,
    inviterName: 'Owner Name',
  });
  const store: StaffInvitationStore = {
    create: (_user, input, token) => {
      if (refuse) return Promise.reject(refuse);
      created.push({ email: input.email, role: input.role, token });
      return Promise.resolve(sent(input.email, input.role));
    },
    reissue: (_user, _id, token) => {
      created.push({ email: 'again@example.com', role: 'staff', token });
      return Promise.resolve(sent('again@example.com', 'staff'));
    },
    list: () => Promise.resolve([]),
    revoke: () => Promise.resolve(),
    preview: (token) =>
      Promise.resolve(
        token === 'valid-token-valid-token-valid'
          ? {
              email: 'rafi@example.com',
              fullName: 'Rafi Ahmed',
              role: 'moderator',
              expiresAt: EXPIRES,
              inviterName: 'Owner Name',
              accountExists: false,
            }
          : null,
      ),
    accept: ({ token, password }) => {
      accepted.push({ token, password });
      return Promise.resolve(outcome);
    },
  };
  return {
    store,
    created,
    accepted,
    setOutcome: (next: AcceptOutcome) => {
      outcome = next;
    },
    refuseWith: (error: AdminRefusalError) => {
      refuse = error;
    },
  };
}

function setup(email?: EmailSender) {
  const identity = new FakeIdentity();
  const owner = identity.addUser({ email: 'owner@example.com', role: 'super_admin' });
  const customer = identity.addUser({ email: 'customer@example.com' });
  const fake = fakeStore();
  const app = testApp({
    auth: identity.deps,
    staffInvitations: { store: fake.store, email, branding: {} },
  });
  const tokens = { owner: identity.tokenFor(owner), customer: identity.tokenFor(customer) };
  const call = (
    method: 'get' | 'post',
    path: string,
    who?: keyof typeof tokens,
    body?: Record<string, unknown>,
  ) => {
    let pending = request(app)[method](`/api/v1${path}`);
    if (who) pending = pending.set('Authorization', `Bearer ${tokens[who]}`);
    return body === undefined ? pending : pending.send(body);
  };
  return { call, fake };
}

function mailbox() {
  const messages: EmailMessage[] = [];
  const sender: EmailSender = {
    send: (message) => {
      messages.push(message);
      return Promise.resolve();
    },
    verify: () => Promise.resolve(),
  };
  return { sender, messages };
}

describe('POST /admin/staff/invitations', () => {
  it('creates a pending invitation and emails the link, the role coming only from the request body of an owner', async () => {
    const { sender, messages } = mailbox();
    const { call, fake } = setup(sender);

    const response = await call('post', '/admin/staff/invitations', 'owner', {
      email: 'rafi@example.com',
      role: 'moderator',
      fullName: 'Rafi Ahmed',
    });

    expect(response.status).toBe(201);
    const sentBody = response.body as { emailSent: boolean; invitation: unknown };
    expect(sentBody.emailSent).toBe(true);
    expect(sentBody.invitation).toMatchObject({
      email: 'rafi@example.com',
      role: 'moderator',
    });
    expect(fake.created).toHaveLength(1);
    // The link carries the one-time token; the response never does.
    expect(JSON.stringify(response.body)).not.toContain(fake.created[0]?.token ?? 'x');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.to).toBe('rafi@example.com');
    expect(messages[0]?.text).toContain(encodeURIComponent(fake.created[0]?.token ?? ''));
    expect(messages[0]?.text).toContain('/accept-invite?invitation=');
  });

  it('keeps the invitation, and says the email did not go, when the mail server refuses', async () => {
    const failing: EmailSender = {
      send: () => Promise.reject(new Error('smtp down')),
      verify: () => Promise.resolve(),
    };
    const { call, fake } = setup(failing);
    const response = await call('post', '/admin/staff/invitations', 'owner', {
      email: 'rafi@example.com',
      role: 'staff',
    });
    expect(response.status).toBe(201);
    expect((response.body as { emailSent: boolean }).emailSent).toBe(false);
    expect(fake.created).toHaveLength(1);
  });

  it('needs a signed-in owner, and refuses a customer', async () => {
    const { call, fake } = setup();
    const body = { email: 'rafi@example.com', role: 'staff' };
    expect((await call('post', '/admin/staff/invitations', undefined, body)).status).toBe(401);
    expect((await call('post', '/admin/staff/invitations', 'customer', body)).status).toBe(403);
    expect(fake.created).toEqual([]);
  });

  it('refuses the owner role, a malformed address and unknown fields before anything is saved', async () => {
    const { call, fake } = setup();
    for (const body of [
      { email: 'rafi@example.com', role: 'super_admin' },
      { email: 'not-an-email', role: 'staff' },
      { email: 'rafi@example.com', role: 'staff', permissions: ['everything'] },
      { email: 'rafi@example.com' },
    ]) {
      expect((await call('post', '/admin/staff/invitations', 'owner', body)).status).toBe(400);
    }
    expect(fake.created).toEqual([]);
  });

  it('answers a refusal from the database with a fixed message', async () => {
    const { call, fake } = setup();
    fake.refuseWith(new AdminRefusalError('in_use'));
    const response = await call('post', '/admin/staff/invitations', 'owner', {
      email: 'rafi@example.com',
      role: 'staff',
    });
    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).not.toMatch(/NZ\d{3}/);
  });
});

describe('the invitee’s routes (no session)', () => {
  it('shows the invitation behind a valid token, and a neutral 404 behind any other', async () => {
    const { call } = setup();
    const ok = await call('get', '/auth/staff-invitations/valid-token-valid-token-valid');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      email: 'rafi@example.com',
      role: 'moderator',
      accountExists: false,
    });

    const none = await call('get', '/auth/staff-invitations/another-token-another-token-xx');
    expect(none.status).toBe(404);
    expect((none.body as { error: { code: string } }).error.code).toBe('invitation_invalid');
  });

  it('accepts with a token and a password, never with a role', async () => {
    const { call, fake } = setup();
    const response = await call('post', '/auth/staff-invitations/accept', undefined, {
      token: 'valid-token-valid-token-valid',
      password: 'Welcome2Nilzora',
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ role: 'staff' });
    expect(fake.accepted).toHaveLength(1);

    // A client cannot name the role it wants: the field does not exist.
    const sneaky = await call('post', '/auth/staff-invitations/accept', undefined, {
      token: 'valid-token-valid-token-valid',
      password: 'Welcome2Nilzora',
      role: 'admin',
    });
    expect(sneaky.status).toBe(400);
    expect(fake.accepted).toHaveLength(1);
  });

  it('answers each refusal with its own status and a fixed message', async () => {
    const { call, fake } = setup();
    const accept = () =>
      call('post', '/auth/staff-invitations/accept', undefined, {
        token: 'valid-token-valid-token-valid',
        password: 'Welcome2Nilzora',
      });

    fake.setOutcome({ kind: 'invalid' });
    expect((await accept()).status).toBe(400);
    fake.setOutcome({ kind: 'wrong_password' });
    expect((await accept()).status).toBe(401);
    fake.setOutcome({ kind: 'already_has_role' });
    expect((await accept()).status).toBe(409);
    fake.setOutcome({ kind: 'weak_password', message: 'Use at least 8 characters' });
    const weak = await accept();
    expect(weak.status).toBe(400);
  });
});

describe('the invitation email', () => {
  const input = {
    inviteeName: 'Rafi Ahmed',
    role: 'moderator' as const,
    inviterName: 'Owner Name',
    acceptUrl: 'https://admin.example.com/accept-invite?invitation=abc123',
    expiresAt: new Date(EXPIRES),
  };

  it('names the role, the inviter and the expiry, with a button and a plain-text address', () => {
    const email = staffInvitationEmail(input, { logoUrl: 'https://cdn.example.com/logo.png' });

    expect(email.subject).toBe('You are invited to join Nilzora as Moderator');
    expect(email.html).toContain('Accept invitation');
    expect(email.html).toContain(
      'href="https://admin.example.com/accept-invite?invitation=abc123"',
    );
    expect(email.html).toContain('Owner Name');
    expect(email.html).toContain('src="https://cdn.example.com/logo.png"');
    expect(email.html).toContain('Nothing is granted yet');
    expect(email.text).toContain(
      'Accept the invitation: https://admin.example.com/accept-invite?invitation=abc123',
    );
    expect(email.text).toContain('Role: Moderator');
    expect(email.text).toMatch(/Link expires: .*2030/);
  });

  it('escapes what the owner typed and never draws a logo it was not given', () => {
    const email = staffInvitationEmail({ ...input, inviterName: '<script>alert(1)</script>' });
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<img');
    expect(email.html).toContain('Nil</span><span');
  });

  it('renders no button for an address that is not https', () => {
    const email = staffInvitationEmail({ ...input, acceptUrl: 'javascript:alert(1)' });
    expect(email.html).not.toContain('javascript:');
    expect(email.text).not.toContain('javascript:');
  });
});
