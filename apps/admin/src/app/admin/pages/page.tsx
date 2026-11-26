import { FileText } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { PAGES_PATH } from '@/components/content/site-page-paths';
import { SitePagesList } from '@/components/content/site-page-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = { title: 'Pages', robots: { index: false, follow: false } };

/** The store's static pages (about, policies, FAQ): which are written and which are live. */
export default async function SitePagesPage() {
  const gate = await workspaceGate('admin', PAGES_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={PAGES_PATH} />;
  }
  const { user, csrf } = gate;

  // The page's own check, before any API call: never rely on the layout alone.
  if (!user.permissions.includes('settings.manage')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={FileText} title="Pages" />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="settings.manage" />
        </section>
      </WorkspaceShell>
    );
  }

  const result = await adminRead((api, token) => api.adminListSitePages(token));
  if (result.kind === 'signed_out') redirect(signInPath(PAGES_PATH));

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={FileText}
          title="Pages"
          description="About, policies and help pages. Visitors see only published pages; until one is written the storefront keeps its built-in text."
        />
        {result.kind === 'ok' ? (
          <SitePagesList pages={result.value.pages} />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState failure={result.kind} retryHref={PAGES_PATH} permission="settings.manage" />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
