import { ShieldCheck, UserRound } from 'lucide-react';
import type { Metadata } from 'next';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { SectionCard } from '@/components/admin-kit/section-card';
import { AvatarForm } from '@/components/account/avatar-form';
import { ReplaceRecoveryCodesForm, ResetTwoFactorForm } from '@/components/auth/two-factor-forms';
import { session } from '@/lib/session';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { displayName } from '@/lib/identity';

export const metadata: Metadata = {
  title: 'Profile picture',
  robots: { index: false, follow: false },
};

/**
 * The signed-in account's own picture. Any account that may use the admin workspace can change
 * its own; the page names no account and the API only ever changes the session's.
 */
export default async function ProfilePage() {
  const gate = await workspaceGate('admin', '/admin/profile');
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref="/admin/profile" />;
  }
  const { user, csrf } = gate;
  // Owner accounts only: how many recovery codes are left (read for this account's session).
  const twoFactor = user.twoFactor?.required
    ? await session.read((api, token) => api.twoFactorStatus(token)).catch(() => null)
    : null;
  const status = twoFactor?.kind === 'ok' ? twoFactor.value : null;
  return (
    <WorkspaceShell
      workspace="admin"
      user={user}
      csrf={csrf}
      breadcrumbs={[{ label: 'Profile picture' }]}
    >
      <div className="grid gap-6">
        <PageToolbar
          icon={UserRound}
          title="Profile picture"
          description="The picture shown next to your name in the top bar."
        />
        <SectionCard
          title="Your picture"
          icon={UserRound}
          description="Only you can change it; it never names another account."
          className="nz-panel-strong max-w-3xl"
        >
          <AvatarForm
            name={displayName(user)}
            avatarUrl={user.profile.avatar?.thumbUrl ?? null}
            csrf={csrf}
          />
        </SectionCard>
        {user.twoFactor?.required ? (
          <SectionCard
            title="Two-factor authentication"
            icon={ShieldCheck}
            description={
              status
                ? `On. ${String(status.recoveryCodesLeft)} of 10 recovery codes left.`
                : 'On for this owner account.'
            }
            className="nz-panel-strong max-w-3xl"
          >
            <div className="grid gap-8 md:grid-cols-2">
              <div className="grid content-start gap-2">
                <h3 className="text-sm font-semibold text-foreground">New recovery codes</h3>
                <p className="text-sm text-muted-foreground">
                  Creates ten new codes. The old ones stop working at once.
                </p>
                <ReplaceRecoveryCodesForm csrf={csrf} />
              </div>
              <div className="grid content-start gap-2">
                <h3 className="text-sm font-semibold text-foreground">New phone</h3>
                <p className="text-sm text-muted-foreground">
                  Removes the current authenticator. You will set up the new one straight away; the
                  workspace stays closed until you do.
                </p>
                <ResetTwoFactorForm csrf={csrf} />
              </div>
            </div>
          </SectionCard>
        ) : null}
      </div>
    </WorkspaceShell>
  );
}
