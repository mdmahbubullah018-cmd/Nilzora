// @vitest-environment jsdom
import { PERMISSIONS } from '@nilzora/contracts';
import type { ApiClient, SessionUser } from '@nilzora/web-session';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RolesPage from '@/app/admin/roles/page';
import { testUser } from '@/test/fixtures';
import { RedirectSignal } from '@/test/redirect';
import { groupPermissions, RolesMatrix } from './roles-matrix';

const gate = vi.hoisted(() => ({ user: null as SessionUser | null }));
type ReadOutcome = 'ok' | 'signed_out' | 'unavailable';
const read = vi.hoisted((): { outcome: ReadOutcome } => ({ outcome: 'ok' }));
const api = vi.hoisted(() => ({ adminListRoles: vi.fn() }));

vi.mock('@/lib/access', () => ({
  workspaceGate: () =>
    Promise.resolve({ access: 'allowed', user: gate.user, csrf: { name: 'csrf_token', token: 't' } }),
}));
vi.mock('@/lib/session', () => ({
  session: {
    read: async (call: (client: ApiClient, token: string) => Promise<unknown>) => {
      if (read.outcome !== 'ok') return { kind: read.outcome };
      return { kind: 'ok', value: await call(api as unknown as ApiClient, 'access-token') };
    },
  },
}));
vi.mock('@/components/shell/workspace-shell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('next/navigation', async () => {
  const { throwRedirect } = await import('@/test/redirect');
  return { redirect: vi.fn(throwRedirect) };
});

afterEach(cleanup);

const ROLES = [
  { role: 'super_admin', permissions: [...PERMISSIONS] },
  { role: 'admin', permissions: ['products.read', 'orders.read'] },
  { role: 'staff', permissions: ['products.read'] },
  { role: 'moderator', permissions: [] },
  { role: 'customer', permissions: [] },
] as const;

beforeEach(() => {
  gate.user = testUser('admin');
  read.outcome = 'ok';
  api.adminListRoles.mockReset().mockResolvedValue({ roles: ROLES });
});

describe('groupPermissions', () => {
  it('places every permission in the catalogue in exactly one group', () => {
    const grouped = groupPermissions().flatMap((group) => group.permissions);
    expect([...grouped].sort()).toEqual([...PERMISSIONS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it('puts a permission no group names under "Other" instead of dropping it', () => {
    const groups = groupPermissions([...PERMISSIONS, 'warehouse.open' as never]);
    expect(groups.at(-1)).toMatchObject({ id: 'other', permissions: ['warehouse.open'] });
  });

  it('leaves out groups that have no permissions', () => {
    expect(groupPermissions(['products.read']).map((group) => group.id)).toEqual(['catalog']);
  });
});

describe('RolesMatrix', () => {
  it('shows, per role, which permissions it holds — in words as well as symbols', () => {
    render(<RolesMatrix roles={ROLES} />);
    const table = screen.getByRole('table', { name: 'Permissions held by each role' });
    const row = within(table).getByText('products.read').closest('tr');
    if (!row) throw new Error('row missing');
    expect(within(row).getByText('Owner has this')).toBeTruthy();
    expect(within(row).getByText('Admin has this')).toBeTruthy();
    expect(within(row).getByText('Staff has this')).toBeTruthy();
    expect(within(row).getByText('Moderator does not have this')).toBeTruthy();
    expect(within(row).getByText('Customer does not have this')).toBeTruthy();
  });

  it('counts each role’s permissions in its column heading', () => {
    render(<RolesMatrix roles={ROLES} />);
    expect(screen.getByText(`${String(PERMISSIONS.length)} permissions`)).toBeTruthy();
    expect(screen.getByText('1 permission')).toBeTruthy();
  });
});

describe('roles page', () => {
  it('shows the matrix to an account that manages the team', async () => {
    render(await RolesPage());
    expect(api.adminListRoles).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('table', { name: 'Permissions held by each role' })).toBeTruthy();
  });

  it('is forbidden without a team permission, without asking the API', async () => {
    gate.user = testUser('staff');
    render(await RolesPage());
    expect(screen.queryByRole('table')).toBeNull();
    expect(api.adminListRoles).not.toHaveBeenCalled();
  });

  it('says so when the roles cannot be read, instead of an empty matrix', async () => {
    read.outcome = 'unavailable';
    render(await RolesPage());
    expect(screen.getByText('This information is unavailable right now')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('sends a lapsed session to sign in', async () => {
    read.outcome = 'signed_out';
    await expect(RolesPage()).rejects.toBeInstanceOf(RedirectSignal);
  });
});
