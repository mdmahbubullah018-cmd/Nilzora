import { Link2 } from 'lucide-react';
import type { Metadata, Route } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { MenusView } from '@/components/content/menu-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = { title: 'Menus', robots: { index: false, follow: false } };

const MENUS_PATH = '/admin/navigation' as Route;

/** The storefront's header and footer menus: add, edit, hide, remove and reorder links. */
export default async function NavigationPage() {
  const gate = await workspaceGate('admin', MENUS_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={MENUS_PATH} />;
  }
  const { user, csrf } = gate;

  // The page's own check, before any API call: never rely on the layout alone.
  if (!user.permissions.includes('settings.manage')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Link2} title="Menus" />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="settings.manage" />
        </section>
      </WorkspaceShell>
    );
  }

  const result = await adminRead((api, token) => api.adminListMenuItems(token));
  if (result.kind === 'signed_out') redirect(signInPath(MENUS_PATH));

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={Link2}
          title="Menus"
          description="The links in the storefront’s header and footer. A menu with no links keeps the built-in one."
        />
        {result.kind === 'ok' ? (
          <MenusView items={result.value.items} csrf={csrf} />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState failure={result.kind} retryHref={MENUS_PATH} permission="settings.manage" />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
