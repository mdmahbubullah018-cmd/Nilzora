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
import { CampaignForm, SlideForm, SlideList } from '@/components/marketing/onboarding-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = {
  title: 'Onboarding campaign',
  robots: { index: false, follow: false },
};

interface PageParams {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * One campaign: its settings, its slides, and the editor for a new or selected slide.
 *
 * `?slide=new` opens an empty editor; `?slide=<id>` opens that slide; no `slide` shows only
 * the list. Keeping the editor on the same page means the order and the copy being edited
 * are always visible together.
 */
export default async function OnboardingCampaignPage({ params, searchParams }: PageParams) {
  const { campaignId } = await params;
  if (!uuidSchema.safeParse(campaignId).success) notFound();

  const path = `/admin/marketing/onboarding/${campaignId}` as Route;
  const gate = await workspaceGate('admin', path);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={path} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('settings.manage')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Sparkles} title="Onboarding campaign" />
        <Card>
          <ForbiddenState permission="settings.manage" />
        </Card>
      </WorkspaceShell>
    );
  }

  const result = await adminRead((api, token) => api.adminOnboardingCampaign(token, campaignId));
  if (result.kind === 'signed_out') redirect(signInPath(path));
  if (result.kind === 'not_found') notFound();

  if (result.kind !== 'ok') {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Sparkles} title="Onboarding campaign" />
        <Card>
          <ReadState failure={result.kind} retryHref={path} permission="settings.manage" />
        </Card>
      </WorkspaceShell>
    );
  }

  const campaign = result.value.campaign;
  const requested = (await searchParams).slide;
  const slideParam = typeof requested === 'string' ? requested : undefined;
  const editing =
    slideParam === undefined
      ? undefined
      : slideParam === 'new'
        ? { mode: 'new' as const }
        : campaign.slides.find((slide) => slide.id === slideParam) === undefined
          ? { mode: 'new' as const }
          : { mode: 'edit' as const, slide: campaign.slides.find((s) => s.id === slideParam) };

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={Sparkles}
          title={campaign.internalName}
          description={
            campaign.isActive
              ? 'This campaign is active. Customers may see it when it is eligible.'
              : 'This campaign is not active yet, so no customer sees it.'
          }
          actions={
            <div className="flex items-center gap-2">
              <Link
                href={`/admin/marketing/onboarding/${campaign.id}/preview`}
                className={buttonClasses({ variant: 'outline', size: 'sm' })}
              >
                <AutoText>Preview</AutoText>
              </Link>
              <Link
                href="/admin/marketing/onboarding"
                className={buttonClasses({ variant: 'ghost', size: 'sm' })}
              >
                <AutoText>Back to onboarding</AutoText>
              </Link>
            </div>
          }
        />

        <CampaignForm campaign={campaign} csrf={csrf} />
        <SlideList campaign={campaign} csrf={csrf} />
        {editing === undefined ? null : (
          <SlideForm
            campaignId={campaign.id}
            slide={editing.mode === 'edit' ? editing.slide : undefined}
            csrf={csrf}
          />
        )}
      </div>
    </WorkspaceShell>
  );
}
