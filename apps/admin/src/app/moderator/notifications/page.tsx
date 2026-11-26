import { staffNotificationQuerySchema } from '@nilzora/contracts';
import { Inbox } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ReadState } from '@/components/admin-kit/states';
import { INBOX_PATH } from '@/components/site/inbox-paths';
import { InboxView } from '@/components/site/inbox-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = {
  title: 'Notifications',
  robots: { index: false, follow: false },
};

const PATH = '/moderator/notifications';

/**
 * The moderator workspace's inbox.
 *
 * Moderators hold `content.approve`, the permission the moderation notifications are
 * addressed to, but the admin inbox requires the admin workspace and is deliberately closed to
 * them. This page is their surface: the same component and the same API store, reached through
 * the moderator route, so the rows are still chosen in SQL by the permissions the account
 * holds — a moderator sees the review submissions addressed to them and never an order,
 * refund or stock notification addressed to someone else.
 */
export default async function ModeratorNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const gate = await workspaceGate('moderator', PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="moderator" retryHref={PATH} />;
  }
  const { user, csrf } = gate;

  const parsed = staffNotificationQuerySchema.safeParse(await searchParams);
  const query = parsed.success ? parsed.data : staffNotificationQuerySchema.parse({});
  const result = await adminRead((api, token) => api.moderatorNotifications(token, query));
  if (result.kind === 'signed_out') redirect(signInPath(PATH));

  return (
    <WorkspaceShell workspace="moderator" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={Inbox}
          title="Notifications"
          description="Content waiting for your review, and what happened to it. Nothing here is sent by email or push."
        />
        {result.kind === 'ok' ? (
          <InboxView inbox={result.value} csrf={csrf} surface="moderator" />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState failure={result.kind} retryHref={INBOX_PATH} />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
