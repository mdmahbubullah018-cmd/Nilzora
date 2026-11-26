import { APP_ROLES, type AppRole } from '@nilzora/contracts';
import type { SessionState } from '@nilzora/web-session';
import { describe, expect, it } from 'vitest';
import { testUser } from '@/test/fixtures';
import {
  canEnterWorkspace,
  defaultWorkspace,
  entryAccess,
  landingPath,
  permittedWorkspaces,
  signInPath,
  switchTarget,
  workspaceAccess,
  workspaceForPath,
  WORKSPACE_PATHS,
  type Workspace,
  type WorkspaceAccess,
} from './workspace-access';

const signedIn = (role: AppRole): SessionState => ({ status: 'signed_in', user: testUser(role) });

describe('workspaceAccess', () => {
  const expected: Record<AppRole, Record<Workspace, WorkspaceAccess>> = {
    super_admin: { admin: 'allowed', moderator: 'allowed' },
    admin: { admin: 'allowed', moderator: 'allowed' },
    staff: { admin: 'allowed', moderator: 'forbidden' },
    moderator: { admin: 'forbidden', moderator: 'allowed' },
    customer: { admin: 'forbidden', moderator: 'forbidden' },
  };

  it.each(
    APP_ROLES.flatMap((role) =>
      (['admin', 'moderator'] as const).map((workspace) => ({
        role,
        workspace,
        access: expected[role][workspace],
      })),
    ),
  )('$role → $workspace workspace: $access', ({ role, workspace, access }) => {
    expect(workspaceAccess(signedIn(role), workspace)).toBe(access);
  });

  it.each(['admin', 'moderator'] as const)('sends signed-out visitors to sign in (%s)', (ws) => {
    expect(workspaceAccess({ status: 'signed_out' }, ws)).toBe('sign_in');
  });

  it.each(['admin', 'moderator'] as const)('refuses suspended accounts (%s)', (ws) => {
    expect(workspaceAccess({ status: 'suspended' }, ws)).toBe('suspended');
  });

  it.each(['admin', 'moderator'] as const)(
    'never treats an unreachable API as access (%s)',
    (ws) => {
      expect(workspaceAccess({ status: 'unavailable' }, ws)).toBe('unavailable');
    },
  );

  it('refuses a verified account whose profile is suspended, whatever it holds', () => {
    const user = testUser('super_admin', {
      profile: { ...testUser('super_admin').profile, status: 'suspended' },
    });
    expect(workspaceAccess({ status: 'signed_in', user }, 'admin')).toBe('suspended');
    expect(workspaceAccess({ status: 'signed_in', user }, 'moderator')).toBe('suspended');
  });

  it('decides from permissions only, never from the role name', () => {
    // A privileged role name without the permission is refused...
    const owner = testUser('super_admin', { permissions: [] });
    expect(workspaceAccess({ status: 'signed_in', user: owner }, 'admin')).toBe('forbidden');
    // ...and the permission alone is what opens a workspace.
    const custom = testUser('customer', { permissions: ['moderator_workspace.access'] });
    expect(workspaceAccess({ status: 'signed_in', user: custom }, 'moderator')).toBe('allowed');
    expect(workspaceAccess({ status: 'signed_in', user: custom }, 'admin')).toBe('forbidden');
  });

  it('does not let another permission stand in for the workspace permission', () => {
    const user = testUser('admin', {
      permissions: testUser('admin').permissions.filter((p) => !p.endsWith('_workspace.access')),
    });
    expect(canEnterWorkspace(user, 'admin')).toBe(false);
    expect(canEnterWorkspace(user, 'moderator')).toBe(false);
  });
});

describe('entryAccess', () => {
  it.each([
    ['super_admin', { access: 'allowed', workspace: 'admin' }],
    ['admin', { access: 'allowed', workspace: 'admin' }],
    ['staff', { access: 'allowed', workspace: 'admin' }],
    ['moderator', { access: 'allowed', workspace: 'moderator' }],
    ['customer', { access: 'forbidden' }],
  ] as const)('%s → %o', (role, decision) => {
    expect(entryAccess(signedIn(role))).toEqual(decision);
  });

  it('maps the other session states', () => {
    expect(entryAccess({ status: 'signed_out' })).toEqual({ access: 'sign_in' });
    expect(entryAccess({ status: 'suspended' })).toEqual({ access: 'suspended' });
    expect(entryAccess({ status: 'unavailable' })).toEqual({ access: 'unavailable' });
  });

  it('refuses a verified account whose profile is suspended', () => {
    const user = testUser('admin', {
      profile: { ...testUser('admin').profile, status: 'suspended' },
    });
    expect(entryAccess({ status: 'signed_in', user })).toEqual({ access: 'suspended' });
  });
});

describe('default workspace and switching', () => {
  it.each([
    ['super_admin', ['admin', 'moderator'], 'admin'],
    ['admin', ['admin', 'moderator'], 'admin'],
    ['staff', ['admin'], 'admin'],
    ['moderator', ['moderator'], 'moderator'],
    ['customer', [], undefined],
  ] as const)('%s may enter %o and starts in %s', (role, permitted, start) => {
    const user = testUser(role);
    expect(permittedWorkspaces(user)).toEqual(permitted);
    expect(defaultWorkspace(user)).toBe(start);
  });

  // The other workspace is offered only when the account may enter it.
  it.each([
    ['super_admin', 'moderator', 'admin'],
    ['admin', 'moderator', 'admin'],
    ['staff', undefined, 'admin'],
    ['moderator', 'moderator', undefined],
    ['customer', undefined, undefined],
  ] as const)('%s: from admin → %s, from moderator → %s', (role, fromAdmin, fromMod) => {
    const user = testUser(role);
    expect(switchTarget(user, 'admin')).toBe(fromAdmin);
    expect(switchTarget(user, 'moderator')).toBe(fromMod);
  });
});

describe('workspaceForPath', () => {
  it('matches workspace homes and their sub-pages only', () => {
    expect(workspaceForPath('/admin')).toBe('admin');
    expect(workspaceForPath('/admin/orders?page=2')).toBe('admin');
    expect(workspaceForPath('/moderator#queue')).toBe('moderator');
    expect(workspaceForPath('/administrator')).toBeUndefined();
    expect(workspaceForPath('/moderators')).toBeUndefined();
    expect(workspaceForPath('/login')).toBeUndefined();
    expect(workspaceForPath('')).toBeUndefined();
  });

  it('lists the workspace homes as redirect prefixes', () => {
    expect(WORKSPACE_PATHS).toEqual(['/admin', '/moderator']);
  });
});

describe('landingPath', () => {
  it('keeps a requested page inside a workspace the account may enter', () => {
    expect(landingPath(testUser('staff'), '/admin/orders?page=2')).toBe('/admin/orders?page=2');
    expect(landingPath(testUser('admin'), '/moderator')).toBe('/moderator');
  });

  it('falls back to the default workspace for a workspace the account may not enter', () => {
    expect(landingPath(testUser('staff'), '/moderator')).toBe('/admin');
    expect(landingPath(testUser('moderator'), '/admin/orders')).toBe('/moderator');
  });

  it('falls back to the default workspace without a usable request', () => {
    expect(landingPath(testUser('moderator'))).toBe('/moderator');
    expect(landingPath(testUser('super_admin'), '')).toBe('/admin');
    expect(landingPath(testUser('staff'), '/login')).toBe('/admin');
  });

  it('has nowhere to send an account without a workspace', () => {
    expect(landingPath(testUser('customer'), '/admin')).toBeUndefined();
    expect(landingPath(testUser('customer'))).toBeUndefined();
  });
});

describe('signInPath', () => {
  it('returns to the page after sign-in', () => {
    expect(signInPath('/admin')).toBe('/login?next=%2Fadmin');
    expect(signInPath('/moderator')).toBe('/login?next=%2Fmoderator');
  });

  it('encodes the path as one query value', () => {
    expect(signInPath('/admin/orders?page=2&x=1')).toBe(
      '/login?next=%2Fadmin%2Forders%3Fpage%3D2%26x%3D1',
    );
  });
});
