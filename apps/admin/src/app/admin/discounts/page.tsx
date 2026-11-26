import { adminCampaignListQuerySchema } from '@nilzora/contracts';
import { Card, buttonClasses } from '@nilzora/ui';
import { Percent, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import {
  CAMPAIGNS_PATH,
  CampaignListView,
  type CampaignFilters,
} from '@/components/marketing/campaign-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = {
  title: 'Discount campaigns',
  robots: { index: false, follow: false },
};

/** The filters as the API's own schema reads them; anything malformed falls back. */
function parseFilters(params: Record<string, string | string[] | undefined>): CampaignFilters {
  const parsed = adminCampaignListQuerySchema.safeParse(params);
  if (!parsed.success) return {};
  const { q, state, scope } = parsed.data;
  return {
    q: q === undefined || q === '' ? undefined : q,
    state: state === 'all' ? undefined : state,
    scope: scope === 'all' ? undefined : scope,
  };
}

/**
 * Every discount campaign, with its live state and how many products it reprices. The
 * prices themselves are never stored here: a campaign is an overlay the catalog resolves
 * at read time, so this list can never disagree with what a shopper pays.
 */
export default async function CampaignsPage({ searchParams }: PageProps<'/admin/discounts'>) {
  const gate = await workspaceGate('admin', CAMPAIGNS_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={CAMPAIGNS_PATH} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('discounts.view')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Percent} title="Discount campaigns" />
        <Card>
          <ForbiddenState permission="discounts.view" />
        </Card>
      </WorkspaceShell>
    );
  }

  const raw = await searchParams;
  const parsed = adminCampaignListQuerySchema.safeParse(raw);
  const page = parsed.success ? parsed.data.page : 1;
  const pageSize = parsed.success ? parsed.data.pageSize : 25;
  const filters = parseFilters(raw);

  const result = await adminRead((api, token) =>
    api.adminListCampaigns(token, {
      ...(filters.q === undefined ? {} : { q: filters.q }),
      ...(filters.state === undefined ? {} : { state: filters.state }),
      ...(filters.scope === undefined ? {} : { scope: filters.scope }),
      page,
      pageSize,
    }),
  );
  if (result.kind === 'signed_out') redirect(signInPath(CAMPAIGNS_PATH));

  const canCreate = user.permissions.includes('discounts.create');

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={Percent}
          title="Discount campaigns"
          description="Promotional pricing for categories, brands, chosen products or the whole shop. A campaign overrides a product's own sale price while it runs and hands it back automatically when it ends — no product is ever edited."
          actions={
            canCreate ? (
              <Link href="/admin/discounts/new" className={buttonClasses({ size: 'sm' })}>
                <Plus aria-hidden="true" /><AutoText>New campaign</AutoText></Link>
            ) : null
          }
        />

        {result.kind === 'ok' ? (
          <CampaignListView
            campaigns={result.value.campaigns}
            filters={filters}
            page={result.value.page}
            total={result.value.total}
            totalPages={result.value.totalPages}
            pageSize={result.value.pageSize}
          />
        ) : (
          <Card>
            <ReadState
              failure={result.kind}
              retryHref={CAMPAIGNS_PATH}
              permission="discounts.view"
            />
          </Card>
        )}
      </div>
    </WorkspaceShell>
  );
}
