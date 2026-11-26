import {
  POPUP_AUDIENCE_LABELS,
  POPUP_PLATFORM_LABELS,
  type AdminPopupSummary,
} from '@nilzora/contracts';
import { Pencil, Plus, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { Chip } from '@/components/admin-kit/chip';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { SectionCard } from '@/components/admin-kit/section-card';
import { EmptyPanel } from '@/components/catalog/catalog-ui';
import { PageFailure, PageForbidden } from '@/components/catalog/page-states';
import { PopupEditPanel, PopupForm } from '@/components/marketing/popup-forms';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = {
  title: 'Promotional popup',
  robots: { index: false, follow: false },
};

function schedule(popup: AdminPopupSummary): string {
  const format = (iso: string) =>
    new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Dhaka',
    }).format(new Date(iso));
  if (popup.startsAt === null && popup.endsAt === null) return 'No schedule';
  return `${popup.startsAt === null ? 'Now' : format(popup.startsAt)} → ${popup.endsAt === null ? 'no end' : format(popup.endsAt)}`;
}

/**
 * One promotional popup, over the storefront and inside the app.
 *
 * The list carries the summaries; each row's panel is built from the whole popup, because the
 * copy and the artwork's facts are not in the list. Only one popup may be live, and the API
 * refuses a second rather than switching the first off behind the administrator's back.
 */
export default async function PopupsPage() {
  const gate = await workspaceGate('admin', '/admin/popups');
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref="/admin/popups" />;
  }
  const { user, csrf } = gate;
  const shell = (children: ReactNode) => (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      {children}
    </WorkspaceShell>
  );
  if (!user.permissions.includes('settings.manage')) {
    return shell(<PageForbidden title="Promotional popup" permission="settings.manage" />);
  }

  const listing = await adminRead((api, token) =>
    api.adminPopups(token).then((response) => response.popups),
  );
  if (listing.kind === 'signed_out') redirect(signInPath('/admin/popups'));
  if (listing.kind !== 'ok') {
    return shell(
      <PageFailure
        title="Promotional popup"
        failure={listing.kind}
        retryHref="/admin/popups"
        permission="settings.manage"
      />,
    );
  }
  // The list is short by design (there is one live popup at most), so reading each in full is
  // cheaper than a second round trip when a row is opened.
  const reads = await Promise.all(
    listing.value.map((summary) =>
      adminRead((api, token) =>
        api.adminPopup(token, summary.id).then((response) => response.popup),
      ),
    ),
  );
  const saved = reads.flatMap((read) => (read.kind === 'ok' ? [read.value] : []));
  const live = saved.filter((popup) => popup.isActive);

  return shell(
    <div className="grid gap-6">
      <PageToolbar
        icon={Sparkles}
        title="Promotional popup"
        description="Popups shown after the store or app opens: on the website, in the Android app, or both. Never on checkout or during sign-in; each device remembers how often it has been seen."
      />

      <SectionCard
        title="New popup"
        icon={Plus}
        description="A designed template combines a picture with your words; complete artwork is one picture, often an animated GIF, shown exactly as uploaded."
        className="nz-panel-strong"
      >
        <details className="group" open={saved.length === 0}>
          <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-xl bg-primary-action px-4 text-sm font-semibold text-primary-action-foreground max-sm:min-h-11 [&::-webkit-details-marker]:hidden">
            <Plus aria-hidden="true" className="size-4" strokeWidth={1.75} />
            <span className="group-open:hidden">
              <AutoText>Create popup</AutoText>
            </span>
            <span className="hidden group-open:inline">
              <AutoText>Close</AutoText>
            </span>
          </summary>
          <div className="mt-5">
            <PopupForm csrf={csrf} />
          </div>
        </details>
      </SectionCard>

      {live.length === 0 ? (
        <p className="rounded-xl border border-dashed border-hairline px-4 py-3 text-sm text-muted-foreground">
          <AutoText>
            Nothing is live: customers see no popup. Switch one on once its artwork is uploaded.
          </AutoText>
        </p>
      ) : (
        <p className="rounded-xl border border-hairline bg-info-soft/40 px-4 py-3 text-sm text-info-ink">
          Live now:{' '}
          <strong className="font-semibold">
            {live.map((popup) => popup.internalName).join(', ')}
          </strong>
          . The highest priority that fits each customer is shown first.
        </p>
      )}

      {saved.length === 0 ? (
        <section className="nz-panel rounded-2xl border border-dashed">
          <EmptyPanel
            icon={Sparkles}
            title="No popups yet"
            description="Without one, the storefront and the app simply have nothing to interrupt."
            className="py-12"
          />
        </section>
      ) : (
        <SectionCard
          title="Saved popups"
          icon={Sparkles}
          description={`${String(saved.length)} ${saved.length === 1 ? 'popup' : 'popups'}. Several can be live; priority decides which is shown first.`}
          className="nz-panel-strong"
          flush
        >
          <ul role="list" className="divide-y divide-hairline border-t border-hairline">
            {saved.map((popup) => (
              <li key={popup.id}>
                <details className="group">
                  <summary className="grid cursor-pointer list-none items-center gap-4 px-5 py-4 transition-colors hover:bg-info-soft/30 sm:grid-cols-[9rem_minmax(0,1fr)_auto] [&::-webkit-details-marker]:hidden">
                    <span className="grid h-20 w-36 place-items-center overflow-hidden rounded-lg border border-hairline bg-surface">
                      {popup.thumbUrl === null ? (
                        <span className="text-xs text-muted-foreground">
                          <AutoText>No artwork</AutoText>
                        </span>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- stored artwork from the media service
                        <img src={popup.thumbUrl} alt="" className="h-full w-full object-cover" />
                      )}
                    </span>
                    <span className="grid min-w-0 gap-1.5">
                      <span className="truncate font-semibold text-foreground">
                        {popup.internalName}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Chip tone={popup.isActive ? 'success' : 'neutral'} dot>
                          {popup.isActive ? 'Live' : 'Off'}
                        </Chip>
                        <Chip tone="primary">
                          {popup.displayMode === 'artwork' ? 'Complete artwork' : 'Template'}
                        </Chip>
                        {popup.imageKind === 'animated' ? (
                          <Chip tone="violet">
                            <AutoText>Animated</AutoText>
                          </Chip>
                        ) : null}
                        <Chip tone="neutral">After {popup.delaySeconds}s</Chip>
                        <Chip tone="neutral">{POPUP_PLATFORM_LABELS[popup.platform]}</Chip>
                        {popup.audience !== 'all' ? (
                          <Chip tone="neutral">{POPUP_AUDIENCE_LABELS[popup.audience]}</Chip>
                        ) : null}
                        <Chip tone="neutral">Priority {popup.priority}</Chip>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {popup.title ?? 'No title'} · {schedule(popup)}
                      </span>
                    </span>
                    <span className="inline-flex h-9 items-center gap-1.5 justify-self-start rounded-xl px-3 text-xs font-semibold text-link ring-1 ring-hairline group-open:bg-info-soft sm:justify-self-end max-sm:h-11">
                      <Pencil aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
                      <AutoText>Edit</AutoText>
                    </span>
                  </summary>
                  <PopupEditPanel popup={popup} csrf={csrf} />
                </details>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>,
  );
}
