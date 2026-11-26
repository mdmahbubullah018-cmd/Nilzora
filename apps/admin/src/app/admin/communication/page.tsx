import { Alert, Card, PageHeader } from '@nilzora/ui';
import { uuidSchema } from '@nilzora/validation';
import { Lock } from 'lucide-react';
import type { Metadata } from 'next';
import { AccessGate } from '@/components/access/access-gate';
import { CommunicationWorkspace } from '@/components/communication/workspace';
import { ForbiddenState } from '@/components/admin-kit/states';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { support } from '@/lib/support';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = {
  title: 'Communication',
  robots: { index: false, follow: false },
};

const PATH = '/admin/communication';

/**
 * The Communication Center
 * ------------------------
 * The first page of the support queue: every conversation this operator may open, the thread
 * itself, the customer and order beside it, replies, and staff-only notes — plus the overview,
 * the message library, automation, the review queue and the team, each behind its permission.
 *
 * Which conversations appear is decided by the API from this account's permissions — its own
 * and unassigned threads for a staff member, the whole queue for an admin — so the page renders
 * the list it is given and nothing more. `?tab=` picks a section and `?c=` opens one thread.
 */
export default async function CommunicationPage({
  searchParams,
}: PageProps<'/admin/communication'>) {
  const gate = await workspaceGate('admin', PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={PATH} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('admin_workspace.access')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <Card>
          <ForbiddenState permission="admin_workspace.access" />
        </Card>
      </WorkspaceShell>
    );
  }

  const params = await searchParams;
  const tab = typeof params.tab === 'string' ? params.tab : undefined;
  const opened = uuidSchema.safeParse(params.c);
  const firstPage = await support.queue({ pageSize: 30 });

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        <PageHeader
          eyebrow="Customer care"
          title="Communication"
          description="Every customer conversation in one place. Reply here, keep internal notes to yourself, and hand a thread to a teammate."
        />

        {!firstPage.ok ? (
          <Alert tone="warning" title="The support queue could not be loaded">
            {firstPage.message}
          </Alert>
        ) : (
          <CommunicationWorkspace
            initial={firstPage.value}
            initialTab={tab}
            initialConversationId={opened.success ? opened.data : null}
            currentUserId={user.id}
            currentUserName={user.profile.fullName?.trim() || user.email || 'You'}
            permissions={user.permissions}
          />
        )}

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock aria-hidden className="size-3.5" /><AutoText>Internal notes and team conversations are never shown to a customer.</AutoText></p>
      </div>
    </WorkspaceShell>
  );
}
