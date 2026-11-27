import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { adminRead } from '@/components/admin-kit/read';
import { ANALYTICS_PATH, AnalyticsView } from '@/components/analytics/analytics-view';
import { PageFailure, PageForbidden } from '@/components/catalog/page-states';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { parseReportRange } from '@/lib/date-range';
import { getServerLanguage } from '@/lib/i18n/server';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = { title: 'Analytics', robots: { index: false, follow: false } };

const TITLE = 'Analytics';

/**
 * Sales analytics over a chosen range (finance.read). One aggregate read from the API;
 * the page checks the permission itself first, and the API checks it again.
 */
export default async function AnalyticsPage({ searchParams }: PageProps<'/admin/analytics'>) {
  const gate = await workspaceGate('admin', ANALYTICS_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={ANALYTICS_PATH} />;
  }
  const { user, csrf } = gate;
  const shell = (children: ReactNode) => (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      {children}
    </WorkspaceShell>
  );

  // Display check only: the API refuses sales figures without finance.read regardless.
  if (!user.permissions.includes('finance.read')) {
    return shell(<PageForbidden title={TITLE} permission="finance.read" />);
  }

  const range = parseReportRange(await searchParams, new Date(), await getServerLanguage());
  const result = await adminRead((api, token) =>
    api.adminAnalyticsOverview(token, {
      from: range.from,
      to: range.to,
      compare: range.compare ? 'true' : 'false',
    }),
  );
  if (result.kind === 'signed_out') redirect(signInPath(ANALYTICS_PATH));
  if (result.kind !== 'ok') {
    return shell(
      <PageFailure
        title={TITLE}
        failure={result.kind}
        retryHref={ANALYTICS_PATH}
        permission="finance.read"
      />,
    );
  }
  return shell(
    <AnalyticsView overview={result.value.overview} range={range} permissions={user.permissions} />,
  );
}
