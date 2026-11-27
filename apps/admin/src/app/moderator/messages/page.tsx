import { Alert } from '@nilzora/ui';
import { uuidSchema } from '@nilzora/validation';
import { Lock, MessagesSquare } from 'lucide-react';
import type { Metadata } from 'next';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { CommunicationWorkspace } from '@/components/communication/workspace';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { support } from '@/lib/support';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = {
  title: 'Messages',
  robots: { index: false, follow: false },
};

const PATH = '/moderator/messages';

/**
 * The moderator's messaging: the review queue for reported messages, the team threads, and the
 * moderation conversations this account may work. The same components as the admin
 * Communication Center, limited to what a moderator does; the API decides every list again
 * (a moderator never receives a customer support thread).
 */
export default async function ModeratorMessagesPage({
  searchParams,
}: PageProps<'/moderator/messages'>) {
  // The page's own check: never rely on the layout alone.
  const gate = await workspaceGate('moderator', PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="moderator" retryHref={PATH} />;
  }
  const { user, csrf } = gate;
  const params = await searchParams;
  const tab = typeof params.tab === 'string' ? params.tab : undefined;
  const opened = uuidSchema.safeParse(params.c);
  const queue = await support.queue({ pageSize: 30 });

  return (
    <WorkspaceShell workspace="moderator" user={user} csrf={csrf}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        <PageToolbar
          icon={MessagesSquare}
          title="Messages"
          description="Reported messages waiting for a decision, team threads, and moderation conversations."
        />
        {queue.ok ? null : (
          <Alert tone="warning" title="Moderation conversations could not be loaded">
            {queue.message}
          </Alert>
        )}
        <CommunicationWorkspace
          initial={queue.ok ? queue.value : null}
          initialTab={tab}
          initialConversationId={opened.success ? opened.data : null}
          currentUserId={user.id}
          currentUserName={user.profile.fullName?.trim() || user.email || 'You'}
          permissions={user.permissions}
          sections={['reports', 'inbox', 'team']}
        />
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock aria-hidden className="size-3.5" />
          <AutoText>Team threads and internal notes are never shown to a customer.</AutoText>
        </p>
      </div>
    </WorkspaceShell>
  );
}
