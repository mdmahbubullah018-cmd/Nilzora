import { Card } from '@nilzora/ui';
import { Megaphone } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { SectionCard } from '@/components/admin-kit/section-card';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { BroadcastForm, PushSettingsForm } from '@/components/marketing/broadcast-form';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = {
  title: 'Push broadcasts',
  robots: { index: false, follow: false },
};

const PATH = '/admin/broadcasts' as const;
const TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Dhaka',
});

/**
 * Push broadcasts: compose a message for every customer whose device opted in to promotional
 * notifications, and see how earlier ones were delivered. The page checks the permission and
 * the API and database check it again.
 */
export default async function BroadcastsPage() {
  const gate = await workspaceGate('admin', PATH);
  if (gate.access !== 'allowed') return <AccessGate {...gate} workspace="admin" retryHref={PATH} />;
  const { user, csrf } = gate;

  const toolbar = (
    <PageToolbar
      icon={Megaphone}
      title="Push broadcasts"
      description="Send a short message to customers who allowed promotional notifications in the Nilzora app."
    />
  );

  if (!user.permissions.includes('notifications.broadcast')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <div className="grid gap-6">
          {toolbar}
          <Card className="nz-panel rounded-2xl">
            <ForbiddenState permission="notifications.broadcast" />
          </Card>
        </div>
      </WorkspaceShell>
    );
  }

  const [history, products, settings] = await Promise.all([
    adminRead((api, token) => api.adminListBroadcasts(token)),
    adminRead((api, token) =>
      api.adminListProducts(token, { status: 'active', page: 1, pageSize: 100 }),
    ),
    adminRead((api, token) => api.adminPushSettings(token)),
  ]);
  if (history.kind === 'signed_out') redirect(signInPath(PATH));
  const options =
    products.kind === 'ok'
      ? products.value.products.map((product) => ({ id: product.id, name: product.name }))
      : [];

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        {toolbar}
        <SectionCard title="New broadcast" className="nz-panel-strong">
          <BroadcastForm csrf={csrf} products={options} />
        </SectionCard>
        {settings.kind === 'ok' ? (
          <SectionCard
            title="New product announcements"
            description="Announced automatically when a product first goes on sale."
            className="nz-panel-strong"
          >
            <PushSettingsForm csrf={csrf} settings={settings.value} />
          </SectionCard>
        ) : null}
        <SectionCard
          title="Sent broadcasts"
          description="Delivery runs in the background; figures update as it goes."
          flush
        >
          {history.kind !== 'ok' ? (
            <ReadState
              failure={history.kind}
              retryHref={PATH}
              permission="notifications.broadcast"
              compact
            />
          ) : history.value.broadcasts.length === 0 ? (
            <p className="px-5 pb-6 text-sm text-muted-foreground sm:px-6">
              <AutoText>No broadcasts sent yet.</AutoText>
            </p>
          ) : (
            <ul className="divide-y divide-hairline">
              {history.value.broadcasts.map((item) => (
                <li key={item.id} className="grid gap-1 px-5 py-4 sm:px-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold text-foreground">
                      <AutoText value={item.title} />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {TIME.format(new Date(item.createdAt))}
                      {item.author ? ` · ${item.author}` : ''}
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    <AutoText value={item.body} />
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {item.recipients} recipients · {item.sent} delivered · {item.pending} waiting ·{' '}
                    {item.failed} failed · {item.skipped} skipped
                    {item.productSlug ? ` · opens ${item.productSlug}` : ''}
                    {!item.productSlug && item.linkPath ? ` · opens ${item.linkPath}` : ''}
                    {item.imageKey ? ' · with picture' : ''}
                    {item.scheduledFor
                      ? ` · scheduled ${TIME.format(new Date(item.scheduledFor))}`
                      : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </WorkspaceShell>
  );
}
