import { staffNotificationQuerySchema } from '@nilzora/contracts';
import { Inbox } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { INBOX_PATH } from '@/components/site/inbox-paths';
import { InboxView } from '@/components/site/inbox-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = {
  title: 'Notifications',
  robots: { index: false, follow: false },
};

interface PageParams {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The staff inbox: order, stock, return, refund and review events, written by the database
 * when the business event happens. Who may see a notification is decided there too, so this
 * page shows exactly what the signed-in account is entitled to.
 */
export default async function NotificationsPage({ searchParams }: PageParams) {
  const gate = await workspaceGate('admin', INBOX_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={INBOX_PATH} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('admin_workspace.access')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Inbox} title="Notifications" />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="admin_workspace.access" />
        </section>
      </WorkspaceShell>
    );
  }

  const parsed = staffNotificationQuerySchema.safeParse(await searchParams);
  const query = parsed.success ? parsed.data : staffNotificationQuerySchema.parse({});
  const result = await adminRead((api, token) => api.staffNotifications(token, query));
  if (result.kind === 'signed_out') redirect(signInPath(INBOX_PATH));

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={Inbox}
          title="Notifications"
          description="What needs attention: orders, stock, returns, refunds, reviews and customer chat. Nothing here is sent by email or push."
        />
        {result.kind === 'ok' ? (
          <InboxView inbox={result.value} csrf={csrf} />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState failure={result.kind} retryHref={INBOX_PATH} />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
