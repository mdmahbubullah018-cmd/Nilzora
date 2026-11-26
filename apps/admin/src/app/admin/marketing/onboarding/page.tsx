import type { Metadata } from 'next';
import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { Card, buttonClasses } from '@nilzora/ui';
import { AccessGate } from '@/components/access/access-gate';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { SectionCard } from '@/components/admin-kit/section-card';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { formatDateTime } from '@/lib/format';
import { deleteOnboardingCampaignAction, setOnboardingActiveAction } from '@/lib/onboarding-actions';
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = {
  title: 'Onboarding',
  robots: { index: false, follow: false },
};

const LIST_PATH: Route = '/admin/marketing/onboarding';

const KIND_LABELS: Record<string, string> = {
  welcome: 'Welcome',
  promotion: 'Promotion',
};

const FREQUENCY_LABELS: Record<string, string> = {
  first_launch: 'First launch only',
  every_launch: 'Every launch',
  once_per_campaign: 'Once per campaign',
  interval: 'Repeat interval',
};

const AUDIENCE_LABELS: Record<string, string> = {
  all: 'Everyone',
  authenticated: 'Signed-in',
  guest: 'Signed-out',
};

function windowLabel(startsAt: string | null, endsAt: string | null): string {
  if (startsAt === null && endsAt === null) return 'Always available';
  const from = startsAt === null ? 'Any time' : formatDateTime(startsAt);
  const to = endsAt === null ? 'no end' : formatDateTime(endsAt);
  return `${from} → ${to}`;
}

/**
 * The onboarding campaigns.
 *
 * A campaign is either the welcome sequence or a promotion; only one of each can be active,
 * and the database enforces that, so this page shows the state honestly rather than letting
 * two sequences compete.
 */
export default async function OnboardingListPage() {
  const gate = await workspaceGate('admin', LIST_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={LIST_PATH} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('settings.manage')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Sparkles} title="Onboarding" />
        <Card>
          <ForbiddenState permission="settings.manage" />
        </Card>
      </WorkspaceShell>
    );
  }

  const result = await adminRead((api, token) => api.adminOnboardingCampaigns(token));
  if (result.kind === 'signed_out') redirect(signInPath(LIST_PATH));

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={Sparkles}
          title="Onboarding"
          description="The slides a customer sees when the app opens. A promotion always wins over the welcome sequence."
          actions={
            <Link
              href="/admin/marketing/onboarding/new"
              className={buttonClasses({ size: 'sm' })}
            ><AutoText>New campaign</AutoText></Link>
          }
        />

        {result.kind !== 'ok' ? (
          <Card>
            <ReadState failure={result.kind} retryHref={LIST_PATH} permission="settings.manage" />
          </Card>
        ) : result.value.campaigns.length === 0 ? (
          <Card>
            <div className="grid gap-3 p-6">
              <h2 className="text-sm font-semibold text-foreground"><AutoText>No campaigns yet</AutoText></h2>
              <p className="text-sm text-muted-foreground">
                Create the welcome sequence customers see the first time they open the app, or a
                timed promotion for a campaign you are running now.
              </p>
              <Link
                href="/admin/marketing/onboarding/new"
                className={buttonClasses({ variant: 'outline', size: 'sm', className: 'w-fit' })}
              ><AutoText>Create the first campaign</AutoText></Link>
            </div>
          </Card>
        ) : (
          <SectionCard
            title={`Campaigns (${String(result.value.campaigns.length)})`}
            description="Only one welcome sequence and one promotion can be active at a time."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only"><AutoText>Onboarding campaigns</AutoText></caption>
                <thead className="text-xs tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th scope="col" className="py-2 pr-4"><AutoText>Campaign</AutoText></th>
                    <th scope="col" className="py-2 pr-4"><AutoText>Audience</AutoText></th>
                    <th scope="col" className="py-2 pr-4"><AutoText>Frequency</AutoText></th>
                    <th scope="col" className="py-2 pr-4"><AutoText>Window</AutoText></th>
                    <th scope="col" className="py-2 pr-4"><AutoText>Slides</AutoText></th>
                    <th scope="col" className="py-2 pr-4"><AutoText>Status</AutoText></th>
                    <th scope="col" className="py-2"><AutoText>Actions</AutoText></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.value.campaigns.map((campaign) => (
                    <tr key={campaign.id}>
                      <td className="py-3 pr-4">
                        <Link
                          href={`/admin/marketing/onboarding/${campaign.id}`}
                          className="font-medium text-foreground underline-offset-4 hover:underline"
                        >
                          {campaign.internalName}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {KIND_LABELS[campaign.kind] ?? campaign.kind} · {campaign.slideSeconds}s per
                          slide
                        </p>
                      </td>
                      <td className="py-3 pr-4">
                        {AUDIENCE_LABELS[campaign.audience] ?? campaign.audience}
                      </td>
                      <td className="py-3 pr-4">
                        {FREQUENCY_LABELS[campaign.frequency] ?? campaign.frequency}
                        {campaign.repeatDays === null ? '' : ` (${String(campaign.repeatDays)}d)`}
                      </td>
                      <td className="py-3 pr-4 text-xs text-muted-foreground">
                        {windowLabel(campaign.startsAt, campaign.endsAt)}
                      </td>
                      <td className="py-3 pr-4">
                        {campaign.activeSlideCount}/{campaign.slideCount} shown
                      </td>
                      <td className="py-3 pr-4">
                        {campaign.isActive ? (
                          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-foreground"><AutoText>Active</AutoText></span>
                        ) : (
                          <span className="text-muted-foreground"><AutoText>Inactive</AutoText></span>
                        )}
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/admin/marketing/onboarding/${campaign.id}/preview`}
                            className={buttonClasses({ variant: 'ghost', size: 'sm' })}
                          ><AutoText>Preview</AutoText></Link>
                          <form action={setOnboardingActiveAction}>
                            <input type="hidden" name="csrf_token" value={csrf.token} />
                            <input type="hidden" name="campaignId" value={campaign.id} />
                            <input type="hidden" name="active" value={String(!campaign.isActive)} />
                            <button
                              type="submit"
                              className={buttonClasses({ variant: 'outline', size: 'sm' })}
                            >
                              {campaign.isActive ? 'Deactivate' : 'Activate'}
                            </button>
                          </form>
                          <ConfirmForm
                            action={deleteOnboardingCampaignAction}
                            csrf={csrf}
                            trigger="Delete"
                            triggerVariant="ghost"
                            triggerSize="sm"
                            tone="danger"
                            title={`Delete “${campaign.internalName}”?`}
                            description="Its slides and any recorded customer views are deleted with it. A campaign that is still active must be deactivated first."
                            confirmLabel="Delete campaign"
                            hiddenFields={{ campaignId: campaign.id }}
                            align="end"
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}
      </div>
    </WorkspaceShell>
  );
}
