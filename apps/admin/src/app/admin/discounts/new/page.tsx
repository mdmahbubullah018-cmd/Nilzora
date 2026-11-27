import { Card } from '@nilzora/ui';
import { Percent } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { CampaignForm } from '@/components/marketing/campaign-form';
import { loadCampaignTargets } from '@/components/marketing/load-campaigns';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = {
  title: 'New discount campaign',
  robots: { index: false, follow: false },
};

const NEW_PATH = '/admin/discounts/new' as const;

/**
 * The campaign builder. It saves a draft: nothing is repriced until the campaign is
 * activated on its own page, where the real affected products and their final prices are
 * shown first.
 */
export default async function NewCampaignPage({ searchParams }: PageProps<'/admin/discounts/new'>) {
  const gate = await workspaceGate('admin', NEW_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={NEW_PATH} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('discounts.create')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Percent} title="New discount campaign" />
        <Card>
          <ForbiddenState permission="discounts.create" />
        </Card>
      </WorkspaceShell>
    );
  }

  const targets = await loadCampaignTargets();
  if (targets.kind === 'signed_out') redirect(signInPath(NEW_PATH));

  // A category screen can hand over its own id, so the sale starts with it already chosen.
  const requested = (await searchParams).category;
  const defaultCategoryIds =
    typeof requested === 'string' &&
    targets.kind === 'ok' &&
    targets.value.categories.some((category) => category.id === requested)
      ? [requested]
      : [];

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={Percent}
          title="New discount campaign"
          description="Choose what the promotion covers, how deep it cuts and when it runs. It is saved as a draft, so nothing changes in the shop until you activate it."
        />
        {targets.kind === 'ok' ? (
          <Card className="p-4 sm:p-6">
            <CampaignForm
              categories={targets.value.categories}
              brands={targets.value.brands}
              products={targets.value.products}
              productsTruncated={targets.value.productsTruncated}
              defaultCategoryIds={defaultCategoryIds}
              csrf={csrf}
            />
          </Card>
        ) : (
          <Card>
            <ReadState failure={targets.kind} retryHref={NEW_PATH} permission="discounts.create" />
          </Card>
        )}
      </div>
    </WorkspaceShell>
  );
}
