import type { Permission } from '@nilzora/contracts';
import type { SessionState, SessionUser } from '@nilzora/web-session';

/*
 * Workspace access
 * ----------------
 * Who may enter the admin and moderator workspaces is decided only from the session
 * the API verified for this request (GET /me): its permission list. Role names,
 * cookies and anything the browser sends are never consulted. These decisions shape
 * what pages render; the API still authorises every request it receives.
 *
 * Kept free of Next.js imports so every decision is unit-tested.
 */

export const WORKSPACES = ['admin', 'moderator'] as const;
export type Workspace = (typeof WORKSPACES)[number];

/** The permission that opens each workspace. */
export const WORKSPACE_PERMISSION = {
  admin: 'admin_workspace.access',
  moderator: 'moderator_workspace.access',
} as const satisfies Record<Workspace, Permission>;

export const WORKSPACE_HOME = {
  admin: '/admin',
  moderator: '/moderator',
} as const satisfies Record<Workspace, `/${string}`>;

/** Path prefixes a post-sign-in redirect may lead to. */
export const WORKSPACE_PATHS: readonly string[] = WORKSPACES.map(
  (workspace) => WORKSPACE_HOME[workspace],
);

export type WorkspaceAccess = 'allowed' | 'sign_in' | 'forbidden' | 'suspended' | 'unavailable';

/** The part of a verified user these decisions read. */
export type PermissionHolder = Pick<SessionUser, 'permissions'>;

export function canEnterWorkspace(user: PermissionHolder, workspace: Workspace): boolean {
  return user.permissions.includes(WORKSPACE_PERMISSION[workspace]);
}

/**
 * What a workspace page shows for this session. Only a verified, active account
 * holding the workspace permission is allowed; an unreachable API is reported as
 * such, never mistaken for "signed out" and never treated as access.
 */
export function workspaceAccess(state: SessionState, workspace: Workspace): WorkspaceAccess {
  switch (state.status) {
    case 'signed_out':
      return 'sign_in';
    case 'suspended':
      return 'suspended';
    case 'unavailable':
      return 'unavailable';
    case 'signed_in':
      // The API refuses suspended accounts itself; this keeps the page closed regardless.
      if (state.user.profile.status !== 'active') return 'suspended';
      return canEnterWorkspace(state.user, workspace) ? 'allowed' : 'forbidden';
  }
}

export type EntryAccess =
  { access: 'allowed'; workspace: Workspace } | { access: Exclude<WorkspaceAccess, 'allowed'> };

/**
 * Where a session may go when no particular workspace was asked for (the app root
 * and the sign-in page): its default workspace, or the reason it has none.
 */
export function entryAccess(state: SessionState): EntryAccess {
  if (state.status === 'signed_out') return { access: 'sign_in' };
  if (state.status !== 'signed_in') return { access: state.status };
  if (state.user.profile.status !== 'active') return { access: 'suspended' };
  const workspace = defaultWorkspace(state.user);
  return workspace ? { access: 'allowed', workspace } : { access: 'forbidden' };
}

/** The workspaces this account may enter, in navigation order. */
export function permittedWorkspaces(user: PermissionHolder): Workspace[] {
  return WORKSPACES.filter((workspace) => canEnterWorkspace(user, workspace));
}

/** Where the account starts: the admin workspace if permitted, else the moderator one. */
export function defaultWorkspace(user: PermissionHolder): Workspace | undefined {
  return permittedWorkspaces(user)[0];
}

/** The other workspace, only when this account may enter it. */
export function switchTarget(user: PermissionHolder, current: Workspace): Workspace | undefined {
  const other: Workspace = current === 'admin' ? 'moderator' : 'admin';
  return canEnterWorkspace(user, other) ? other : undefined;
}

/** The workspace a same-origin path belongs to, if any. */
export function workspaceForPath(path: string): Workspace | undefined {
  const pathname = path.split(/[?#]/, 1)[0] ?? '';
  return WORKSPACES.find((workspace) => {
    const home = WORKSPACE_HOME[workspace];
    return pathname === home || pathname.startsWith(`${home}/`);
  });
}

/**
 * Where a signed-in account goes after sign-in: the requested page when it lies in a
 * workspace the account may enter, otherwise its default workspace. `requestedPath`
 * must already be sanitised with safeRedirectPath. Undefined: no workspace at all.
 */
export function landingPath(user: PermissionHolder, requestedPath?: string): string | undefined {
  if (requestedPath) {
    const workspace = workspaceForPath(requestedPath);
    if (workspace && canEnterWorkspace(user, workspace)) return requestedPath;
  }
  const workspace = defaultWorkspace(user);
  return workspace ? WORKSPACE_HOME[workspace] : undefined;
}

/** The sign-in page, returning to `pagePath` afterwards. Pass a fixed app path only. */
export function signInPath(pagePath: string): `/login?${string}` {
  return `/login?${new URLSearchParams({ next: pagePath }).toString()}`;
}
