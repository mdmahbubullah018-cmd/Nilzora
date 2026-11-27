import type { Metadata } from 'next';
import type { Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { Card, buttonClasses } from '@nilzora/ui';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { SectionCard } from '@/components/admin-kit/section-card';
import { ForbiddenState } from '@/components/admin-kit/states';
import { CampaignForm } from '@/components/marketing/onboarding-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = {
  title: 'New onboarding campaign',
  robots: { index: false, follow: false },
};

const NEW_PATH: Route = '/admin/marketing/onboarding/new';

/** A new campaign starts as the welcome sequence, inactive, with 5-second slides. */
export default async function NewOnboardingCampaignPage() {
  const gate = await workspaceGate('admin', NEW_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={NEW_PATH} />;
  }
  const { user, csrf } = gate;
  if (!user.permissions.includes('settings.manage')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Sparkles} title="New campaign" />
        <Card>
          <ForbiddenState permission="settings.manage" />
        </Card>
      </WorkspaceShell>
    );
  }
  if (!user) redirect(signInPath(NEW_PATH));

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={Sparkles}
          title="New campaign"
          description="Set the campaign up first; slides can be added as soon as it exists."
          actions={
            <Link
              href="/admin/marketing/onboarding"
              className={buttonClasses({ variant: 'ghost', size: 'sm' })}
            >
              <AutoText>Back to onboarding</AutoText>
            </Link>
          }
        />
        <CampaignForm csrf={csrf} />
        <SectionCard
          title="Slides"
          description="Add slides after saving: they belong to a campaign, so the campaign must exist first."
        >
          <p className="text-sm text-muted-foreground">
            A campaign with no enabled slide cannot be activated, and nothing is shown to a customer
            until it is active.
          </p>
        </SectionCard>
      </div>
    </WorkspaceShell>
  );
}
