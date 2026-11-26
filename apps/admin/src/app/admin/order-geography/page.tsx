import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { adminRead } from '@/components/admin-kit/read';
import { PageFailure, PageForbidden } from '@/components/catalog/page-states';
import { GeographyView } from '@/components/geography/geography-view';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { dhakaToday } from '@/lib/date-range';
import { GEOGRAPHY_PATH, parseGeographySelection } from '@/lib/order-geography';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = {
  title: 'Bangladesh order analytics',
  robots: { index: false, follow: false },
};

const TITLE = 'Bangladesh Order Analytics';

/**
 * Where orders come from, over the chosen range (finance.read). One aggregate read from
 * the API feeds the map, the cards and every chart; the page checks the permission itself
 * first, and the database checks it again inside the function.
 */
export default async function OrderGeographyPage({
  searchParams,
}: PageProps<'/admin/order-geography'>) {
  const gate = await workspaceGate('admin', GEOGRAPHY_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={GEOGRAPHY_PATH} />;
  }
  const { user, csrf } = gate;
  const shell = (children: ReactNode) => (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      {children}
    </WorkspaceShell>
  );

  // Display check only: the database refuses sales figures without finance.read regardless.
  if (!user.permissions.includes('finance.read')) {
    return shell(<PageForbidden title={TITLE} permission="finance.read" />);
  }

  const selection = parseGeographySelection(await searchParams);
  const result = await adminRead((api, token) =>
    api.adminOrderGeography(token, {
      from: selection.range.from,
      to: selection.range.to,
      // A district decides its own division, so the pair can never be impossible.
      ...(selection.district === null && selection.division !== null
        ? { division: selection.division }
        : {}),
      ...(selection.district === null ? {} : { district: selection.district }),
      ...(selection.status === null ? {} : { status: selection.status }),
      metric: selection.metric,
    }),
  );
  if (result.kind === 'signed_out') redirect(signInPath(GEOGRAPHY_PATH));
  if (result.kind !== 'ok') {
    return shell(
      <PageFailure
        title={TITLE}
        failure={result.kind}
        retryHref={GEOGRAPHY_PATH}
        permission="finance.read"
      />,
    );
  }

  return shell(
    <GeographyView
      geography={result.value.geography}
      // The API fills in the division a district implies; the chips show what it decided.
      selection={{ ...selection, division: result.value.geography.filters.division }}
      today={dhakaToday()}
    />,
  );
}
