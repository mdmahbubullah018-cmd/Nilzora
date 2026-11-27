import { Card, buttonClasses } from '@nilzora/ui';
import { ArrowLeft, Pencil, Percent } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { ForbiddenState, NotFoundState, ReadState } from '@/components/admin-kit/states';
import {
  CampaignDetailView,
  campaignHref,
  CAMPAIGNS_PATH,
  editCampaignHref,
} from '@/components/marketing/campaign-views';
import { loadCampaignDetail } from '@/components/marketing/load-campaigns';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = {
  title: 'Campaign',
  robots: { index: false, follow: false },
};

/**
 * One campaign: the real products it prices, what it overlaps with, how to move it through
 * its states, and every recorded change.
 */
export default async function CampaignPage({ params }: PageProps<'/admin/discounts/[campaignId]'>) {
  const { campaignId } = await params;
  const path = campaignHref(campaignId);
  const gate = await workspaceGate('admin', path);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={path} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('discounts.view')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Percent} title="Discount campaign" />
        <Card>
          <ForbiddenState permission="discounts.view" />
        </Card>
      </WorkspaceShell>
    );
  }

  const result = await loadCampaignDetail(campaignId);
  if (result.kind === 'signed_out') redirect(signInPath(path));

  if (result.kind === 'not_found') {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Percent} title="Discount campaign" />
        <Card>
          <NotFoundState
            title="Campaign not found"
            description="It does not exist, or another account archived it away."
            action={
              <Link href={CAMPAIGNS_PATH} className={buttonClasses({ variant: 'outline' })}>
                <AutoText>All campaigns</AutoText>
              </Link>
            }
          />
        </Card>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={Percent}
          title={result.kind === 'ok' ? result.value.campaign.name : 'Discount campaign'}
          description={
            result.kind === 'ok' && result.value.campaign.customerTitle.trim() !== ''
              ? result.value.campaign.customerTitle
              : undefined
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={CAMPAIGNS_PATH}
                className={buttonClasses({ variant: 'ghost', size: 'sm' })}
              >
                <ArrowLeft aria-hidden="true" />
                <AutoText>All campaigns</AutoText>
              </Link>
              {result.kind === 'ok' && user.permissions.includes('discounts.edit') ? (
                <Link
                  href={editCampaignHref(result.value.campaign.id)}
                  className={buttonClasses({ variant: 'outline', size: 'sm' })}
                >
                  <Pencil aria-hidden="true" />
                  <AutoText>Edit</AutoText>
                </Link>
              ) : null}
            </div>
          }
        />

        {result.kind === 'ok' ? (
          <CampaignDetailView
            campaign={result.value.campaign}
            preview={result.value.preview}
            conflicts={result.value.conflicts}
            history={result.value.history}
            permissions={user.permissions}
            csrf={csrf}
          />
        ) : (
          <Card>
            <ReadState failure={result.kind} retryHref={path} permission="discounts.view" />
          </Card>
        )}
      </div>
    </WorkspaceShell>
  );
}
