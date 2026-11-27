import type { Metadata } from 'next';
import Link from 'next/link';
import type { Route } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { uuidSchema } from '@nilzora/validation';
import { Card, buttonClasses } from '@nilzora/ui';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { CampaignPreview } from '@/components/marketing/onboarding-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = {
  title: 'Onboarding preview',
  robots: { index: false, follow: false },
};

interface PageParams {
  params: Promise<{ campaignId: string }>;
}

/**
 * The campaign exactly as the app receives it: resolved image URLs, enabled slides in order,
 * and no internal field. It works for a campaign that is not active yet, which is the point —
 * an admin can look at it before publishing.
 */
export default async function OnboardingPreviewPage({ params }: PageParams) {
  const { campaignId } = await params;
  if (!uuidSchema.safeParse(campaignId).success) notFound();

  const path = `/admin/marketing/onboarding/${campaignId}/preview` as Route;
  const gate = await workspaceGate('admin', path);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={path} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('settings.manage')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Sparkles} title="Onboarding preview" />
        <Card>
          <ForbiddenState permission="settings.manage" />
        </Card>
      </WorkspaceShell>
    );
  }

  const result = await adminRead((api, token) => api.previewOnboardingCampaign(token, campaignId));
  if (result.kind === 'signed_out') redirect(signInPath(path));
  if (result.kind === 'not_found') notFound();

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={Sparkles}
          title="Preview"
          description="What a customer sees: enabled slides, in order, with the image the media service serves."
          actions={
            <Link
              href={`/admin/marketing/onboarding/${campaignId}` as Route}
              className={buttonClasses({ variant: 'ghost', size: 'sm' })}
            >
              <AutoText>Back to the campaign</AutoText>
            </Link>
          }
        />
        {result.kind === 'ok' ? (
          <CampaignPreview campaign={result.value.campaign} />
        ) : (
          <Card>
            <ReadState failure={result.kind} retryHref={path} permission="settings.manage" />
          </Card>
        )}
      </div>
    </WorkspaceShell>
  );
}
