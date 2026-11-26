import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { DashboardView } from '@/components/dashboard/dashboard-view';
import { loadDashboard, signedOut } from '@/components/dashboard/load-dashboard';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { parseReportRange } from '@/lib/date-range';
import { getServerLanguage } from '@/lib/i18n/server';
import { displayName } from '@/lib/identity';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = { title: 'Dashboard', robots: { index: false, follow: false } };

/**
 * The admin dashboard: headline figures and charts over a chosen range, plus live work
 * (recent orders, stock, reviews, activity), each read from the API only for accounts
 * holding its permission (see load-dashboard.ts). Nothing is estimated or made up: a
 * section the data cannot support shows an honest empty state.
 */
export default async function AdminDashboardPage({ searchParams }: PageProps<'/admin'>) {
  // The page's own check: never rely on the layout alone.
  const gate = await workspaceGate('admin', '/admin');
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref="/admin" />;
  }

  const { user } = gate;
  const range = parseReportRange(await searchParams, new Date(), await getServerLanguage());
  const lang = await getServerLanguage();
  const data = await loadDashboard(user.permissions, range);
  if (signedOut(data)) redirect(signInPath('/admin'));

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={gate.csrf}>
      <DashboardView
        data={data}
        permissions={user.permissions}
        viewerName={displayName(user)}
        lang={lang}
      />
    </WorkspaceShell>
  );
}
