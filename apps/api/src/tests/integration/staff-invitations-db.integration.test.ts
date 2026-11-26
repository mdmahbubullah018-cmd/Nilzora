import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { hashPassword } from '../../auth/passwords';
import { randomToken, tokenHash } from '../../auth/tokens';
import { createDatabasePool } from '../../db/pool';
import { AdminRefusalError } from '../../modules/admin/errors';
import { createPostgresStaffInvitationStore } from '../../modules/admin/staff-invitations';

/*
 * The invitation lifecycle against the local database (migration 20261231097000): an invitation
 * grants nothing until it is accepted, a token works once, expired / revoked / replaced links are
 * refused, only the owner invites, and an account that already has a role is never overwritten.
 */

const { dbUrl } = inject('supabase');
const pool = createDatabasePool({ connectionString: dbUrl, max: 4 });
const store = createPostgresStaffInvitationStore(pool);
const run = randomUUID().slice(0, 8);
const users: string[] = [];
const emails: string[] = [];
let owner: string;
let admin: string;

const address = (label: string) => {
  const email = `it-invite-${run}-${label}@example.com`;
  emails.push(email);
  return email;
};

async function addUser(
  label: string,
  role = 'customer',
  password: string | null = null,
): Promise<string> {
  const id = randomUUID();
  await pool.query('select public.provision_account($1::uuid, $2, $3, null, $4, true)', [
    id,
    address(label),
    `Invite ${label}`,
    password === null ? null : await hashPassword(password),
  ]);
  if (role !== 'customer') {
    await pool.query('update public.user_roles set role = $1::public.app_role where user_id = $2', [
      role,
      id,
    ]);
  }
  users.push(id);
  return id;
}

const roleOf = async (email: string): Promise<string | null> =>
  (
    await pool.query<{ role: string }>(
      'select r.role from public.profiles p join public.user_roles r on r.user_id = p.id where lower(p.email) = $1',
      [email],
    )
  ).rows[0]?.role ?? null;

const profileCount = async (email: string): Promise<number> =>
  (await pool.query('select 1 from public.profiles where lower(email) = $1', [email])).rowCount ??
  0;

async function invite(email: string, role: 'staff' | 'moderator' | 'admin' = 'staff', by = owner) {
  const token = randomToken();
  const sent = await store.create(by, { email, fullName: 'Test Invitee', role }, token);
  return { token, sent };
}

beforeAll(async () => {
  owner = await addUser('owner', 'super_admin');
  admin = await addUser('admin', 'admin');
});

afterAll(async () => {
  await pool.query('delete from public.staff_invitations where email = any($1::text[])', [emails]);
  await pool.query('delete from public.profiles where lower(email) = any($1::text[])', [emails]);
  await pool.end();
});

describe('sending an invitation', () => {
  it('creates a pending invitation and nothing else: no account, no role', async () => {
    const email = address('fresh');
    const { sent } = await invite(email, 'moderator');

    expect(sent.role).toBe('moderator');
    expect(await profileCount(email)).toBe(0);
    expect(await roleOf(email)).toBeNull();
    const listed = (await store.list(owner)).find((row) => row.id === sent.id);
    expect(listed).toMatchObject({ email, role: 'moderator', status: 'pending', acceptedAt: null });
  });

  it('refuses a second live invitation for the same address and role', async () => {
    const email = address('dup');
    await invite(email, 'staff');
    await expect(invite(email, 'staff')).rejects.toMatchObject({ refusal: 'in_use' });
    // A different role is a different invitation.
    await expect(invite(email, 'moderator')).resolves.toBeTruthy();
  });

  it('lets only the owner invite', async () => {
    await expect(invite(address('byadmin'), 'staff', admin)).rejects.toBeInstanceOf(
      AdminRefusalError,
    );
    const customer = await addUser('plain');
    await expect(invite(address('bycustomer'), 'staff', customer)).rejects.toBeInstanceOf(
      AdminRefusalError,
    );
  });

  it('never invites the owner role, and refuses an address that already holds a role', async () => {
    await expect(
      store.create(
        owner,
        { email: address('owner2'), fullName: null, role: 'super_admin' as never },
        randomToken(),
      ),
    ).rejects.toBeTruthy();
    const existing = await addUser('staffer', 'staff');
    const taken = (
      await pool.query<{ email: string }>('select email from public.profiles where id = $1', [
        existing,
      ])
    ).rows[0];
    await expect(invite(taken?.email ?? '', 'admin')).rejects.toMatchObject({ refusal: 'in_use' });
  });
});

describe('accepting an invitation', () => {
  it('creates the account for a new address and grants only the invited role, once', async () => {
    const email = address('newhire');
    const { token } = await invite(email, 'moderator');

    const preview = await store.preview(token);
    expect(preview).toMatchObject({ email, role: 'moderator', accountExists: false });
    expect(await profileCount(email)).toBe(0);

    const outcome = await store.accept({
      token,
      password: 'Welcome2Nilzora',
      fullName: 'New Hire',
    });
    expect(outcome).toEqual({ kind: 'accepted', role: 'moderator' });
    expect(await roleOf(email)).toBe('moderator');

    // The same link cannot be used again, by anyone.
    expect(
      await store.accept({ token, password: 'Another1Password', fullName: undefined }),
    ).toEqual({ kind: 'invalid' });
    expect(await store.preview(token)).toBeNull();
    const row = (await store.list(owner)).find((item) => item.email === email);
    expect(row?.status).toBe('accepted');
    expect(row?.acceptedAt).not.toBeNull();
  });

  it('refuses a weak password for a new account and creates nothing', async () => {
    const email = address('weak');
    const { token } = await invite(email, 'staff');
    const outcome = await store.accept({ token, password: 'short', fullName: undefined });
    expect(outcome.kind).toBe('weak_password');
    expect(await profileCount(email)).toBe(0);
    expect(await store.preview(token)).not.toBeNull();
  });

  it('upgrades an existing customer account in place after its own password is proven', async () => {
    const customer = await addUser('customer', 'customer', 'CustomerPass99');
    const email =
      (
        await pool.query<{ email: string }>('select email from public.profiles where id = $1', [
          customer,
        ])
      ).rows[0]?.email ?? '';
    const { token } = await invite(email, 'staff');

    expect((await store.preview(token))?.accountExists).toBe(true);
    expect(await store.accept({ token, password: 'WrongPassword11', fullName: undefined })).toEqual(
      { kind: 'wrong_password' },
    );
    expect(await roleOf(email)).toBe('customer');

    expect(await store.accept({ token, password: 'CustomerPass99', fullName: undefined })).toEqual({
      kind: 'accepted',
      role: 'staff',
    });
    expect(await roleOf(email)).toBe('staff');
    // The same identity: no duplicate account, and the customer's profile is untouched.
    expect(await profileCount(email)).toBe(1);
    const profile = (
      await pool.query<{ id: string; full_name: string }>(
        'select id, full_name from public.profiles where lower(email) = $1',
        [email],
      )
    ).rows[0];
    expect(profile?.id).toBe(customer);
    expect(profile?.full_name).toBe('Invite customer');
  });

  it('refuses an expired link, a revoked link and a replaced link', async () => {
    const expiredEmail = address('expired');
    const expired = await invite(expiredEmail, 'staff');
    await pool.query(
      "update public.staff_invitations set expires_at = now() - interval '1 minute' where id = $1",
      [expired.sent.id],
    );
    expect(
      await store.accept({
        token: expired.token,
        password: 'Welcome2Nilzora',
        fullName: undefined,
      }),
    ).toEqual({ kind: 'invalid' });
    expect((await store.list(owner)).find((row) => row.id === expired.sent.id)?.status).toBe(
      'expired',
    );

    const revokedEmail = address('revoked');
    const revoked = await invite(revokedEmail, 'staff');
    await store.revoke(owner, revoked.sent.id);
    expect(
      await store.accept({
        token: revoked.token,
        password: 'Welcome2Nilzora',
        fullName: undefined,
      }),
    ).toEqual({ kind: 'invalid' });
    await expect(store.revoke(owner, revoked.sent.id)).rejects.toBeInstanceOf(AdminRefusalError);
    expect(await profileCount(revokedEmail)).toBe(0);

    // Sending it again replaces the token: the old link stops working, the new one works.
    const resentEmail = address('resent');
    const first = await invite(resentEmail, 'staff');
    const secondToken = randomToken();
    await store.reissue(owner, first.sent.id, secondToken);
    expect(
      await store.accept({ token: first.token, password: 'Welcome2Nilzora', fullName: undefined }),
    ).toEqual({ kind: 'invalid' });
    expect(
      await store.accept({ token: secondToken, password: 'Welcome2Nilzora', fullName: undefined }),
    ).toEqual({ kind: 'accepted', role: 'staff' });
    // An accepted invitation cannot be sent again.
    await expect(store.reissue(owner, first.sent.id, randomToken())).rejects.toBeInstanceOf(
      AdminRefusalError,
    );
  });

  it('brings an expired invitation back to life when it is sent again', async () => {
    const email = address('revive');
    const { sent } = await invite(email, 'staff');
    await pool.query(
      "update public.staff_invitations set expires_at = now() - interval '1 hour' where id = $1",
      [sent.id],
    );
    const token = randomToken();
    const again = await store.reissue(owner, sent.id, token);
    expect(new Date(again.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect((await store.list(owner)).find((row) => row.id === sent.id)?.status).toBe('pending');
  });

  it('is refused when the inviting owner no longer holds the role', async () => {
    const temporaryOwner = await addUser('temp-owner', 'super_admin');
    const email = address('orphan');
    const { token } = await invite(email, 'staff', temporaryOwner);
    await pool.query("update public.user_roles set role = 'customer' where user_id = $1", [
      temporaryOwner,
    ]);

    expect(await store.accept({ token, password: 'Welcome2Nilzora', fullName: undefined })).toEqual(
      { kind: 'invalid' },
    );
    expect(await roleOf(email)).not.toBe('staff');
    // Nothing was left behind: the refused acceptance did not create the account either.
    expect(await profileCount(email)).toBe(0);
  });

  it('keeps the database functions out of reach of a signed-out connection', async () => {
    await expect(
      pool.query('select public.accept_staff_invitation($1, $2::uuid)', [
        tokenHash('x'),
        randomUUID(),
      ]),
    ).rejects.toBeTruthy();
    await expect(pool.query('select public.admin_list_staff_invitations()')).rejects.toBeTruthy();
  });
});
