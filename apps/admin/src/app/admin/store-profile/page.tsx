import { Store } from 'lucide-react';
import type { Metadata, Route } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { StoreProfileForm } from '@/components/site/store-profile-form';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = {
  title: 'Store information',
  robots: { index: false, follow: false },
};

const PROFILE_PATH = '/admin/store-profile' as Route;

/**
 * The store's public face. Everything here is shown to customers, so nothing private (the
 * return window, cart inactivity, insight thresholds) appears on this page.
 */
export default async function StoreProfilePage() {
  const gate = await workspaceGate('admin', PROFILE_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={PROFILE_PATH} />;
  }
  const { user, csrf } = gate;

  // The page's own check, before any API call: never rely on the layout alone.
  if (!user.permissions.includes('settings.manage')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Store} title="Store profile" />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="settings.manage" />
        </section>
      </WorkspaceShell>
    );
  }

  const result = await adminRead((api, token) => api.adminStoreProfile(token));
  if (result.kind === 'signed_out') redirect(signInPath(PROFILE_PATH));

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={Store}
          title="Store information"
          description="The details customers can see about the store: its name and logo, how to reach you, where you are and your social links. An empty field is never published, so you can fill this in a little at a time. Saving updates the storefront straight away."
        />
        {result.kind === 'ok' ? (
          <StoreProfileForm profile={result.value.profile} csrf={csrf} />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState
              failure={result.kind}
              retryHref={PROFILE_PATH}
              permission="settings.manage"
            />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
