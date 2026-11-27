import { Card } from '@nilzora/ui';
import { ShieldCheck, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { RolesMatrix } from '@/components/staff/roles-matrix';
import { canManageTeam, STAFF_PATH } from '@/components/staff/staff-rules';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = {
  title: 'Roles & permissions',
  robots: { index: false, follow: false },
};

const ROLES_PATH = '/admin/roles' as const;

/**
 * Roles and permissions: what each role holds by default, read from the database (never a
 * copy kept in the app). A reference for the people who manage the team (the page checks
 * `staff.roles.assign` or `staff.permissions.manage` itself and the API checks it again).
 * Changing an individual account's access happens on its staff page.
 */
export default async function RolesPage() {
  const gate = await workspaceGate('admin', ROLES_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={ROLES_PATH} />;
  }
  const { user, csrf } = gate;

  const toolbar = (
    <PageToolbar
      icon={ShieldCheck}
      title="Roles & permissions"
      description="What each role can do by default. Open a team member to give one account more or less than its role."
      actions={
        <Link
          href={STAFF_PATH}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-border-strong bg-surface px-3 text-sm font-semibold text-foreground hover:bg-surface-muted"
        >
          <Users aria-hidden="true" className="size-4" />
          <AutoText>Team members</AutoText>
        </Link>
      }
    />
  );

  if (!canManageTeam(user)) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        {toolbar}
        <Card className="nz-panel rounded-2xl">
          <ForbiddenState permission="staff.permissions.manage" />
        </Card>
      </WorkspaceShell>
    );
  }

  const result = await adminRead((api, token) => api.adminListRoles(token));
  if (result.kind === 'signed_out') redirect(signInPath(ROLES_PATH));

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        {toolbar}
        {result.kind === 'ok' ? (
          <RolesMatrix roles={result.value.roles} />
        ) : (
          <Card className="nz-panel rounded-2xl">
            <ReadState
              failure={result.kind}
              retryHref={ROLES_PATH}
              permission="staff.permissions.manage"
            />
          </Card>
        )}
      </div>
    </WorkspaceShell>
  );
}
