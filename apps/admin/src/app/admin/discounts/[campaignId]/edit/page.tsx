import { Card, buttonClasses } from '@nilzora/ui';
import { ArrowLeft, Percent } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { ForbiddenState, NotFoundState, ReadState } from '@/components/admin-kit/states';
import { CampaignForm } from '@/components/marketing/campaign-form';
import { campaignHref, editCampaignHref } from '@/components/marketing/campaign-views';
import { loadCampaignDetail, loadCampaignTargets } from '@/components/marketing/load-campaigns';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = {
  title: 'Edit campaign',
  robots: { index: false, follow: false },
};

/**
 * Editing a campaign. The version it was read at travels with the form, so a change another
 * administrator made in the meantime is refused instead of silently overwritten.
 */
export default async function EditCampaignPage({
  params,
}: PageProps<'/admin/discounts/[campaignId]/edit'>) {
  const { campaignId } = await params;
  const path = campaignHref(campaignId);
  const editPath = editCampaignHref(campaignId);
  const gate = await workspaceGate('admin', editPath);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={editPath} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('discounts.edit')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Percent} title="Edit campaign" />
        <Card>
          <ForbiddenState permission="discounts.edit" />
        </Card>
      </WorkspaceShell>
    );
  }

  const [campaign, targets] = await Promise.all([
    loadCampaignDetail(campaignId),
    loadCampaignTargets(),
  ]);
  if (campaign.kind === 'signed_out' || targets.kind === 'signed_out') {
    redirect(signInPath(editPath));
  }

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={Percent}
          title="Edit campaign"
          description="Changing a live campaign reprices its products the moment it is saved."
          actions={
            <Link href={path} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
              <ArrowLeft aria-hidden="true" />
              <AutoText>Back to the campaign</AutoText>
            </Link>
          }
        />

        {campaign.kind === 'not_found' ? (
          <Card>
            <NotFoundState
              title="Campaign not found"
              description="It does not exist, or another account archived it away."
              action={
                <Link href="/admin/discounts" className={buttonClasses({ variant: 'outline' })}>
                  <AutoText>All campaigns</AutoText>
                </Link>
              }
            />
          </Card>
        ) : campaign.kind === 'ok' && targets.kind === 'ok' ? (
          <Card className="p-4 sm:p-6">
            <CampaignForm
              campaign={campaign.value.campaign}
              categories={targets.value.categories}
              brands={targets.value.brands}
              products={targets.value.products}
              productsTruncated={targets.value.productsTruncated}
              csrf={csrf}
            />
          </Card>
        ) : targets.kind !== 'ok' ? (
          <Card>
            <ReadState failure={targets.kind} retryHref={editPath} permission="discounts.edit" />
          </Card>
        ) : (
          <Card>
            <ReadState
              failure={campaign.kind === 'ok' ? 'unavailable' : campaign.kind}
              retryHref={editPath}
              permission="discounts.edit"
            />
          </Card>
        )}
      </div>
    </WorkspaceShell>
  );
}
