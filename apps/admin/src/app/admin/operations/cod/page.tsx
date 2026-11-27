import { COURIER_PROVIDER_IDS } from '@nilzora/contracts';
import { HandCoins, Landmark } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { SectionCard } from '@/components/admin-kit/section-card';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import {
  CodPositionsView,
  settlementCandidates,
  SettlementList,
} from '@/components/shipments/cod-reconciliation';
import { SettlementForm } from '@/components/shipments/settlement-form';
import {
  codHref,
  COD_POSITIONS_PAGE_SIZE,
  OPERATIONS_PATHS,
  parseCodFilters,
} from '@/components/shipments/shipment-labels';
import { TestDataSwitch } from '@/components/shipments/test-data-switch';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { dhakaToday } from '@/lib/date-range';
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = {
  title: 'COD reconciliation',
  robots: { index: false, follow: false },
};

const PATH = OPERATIONS_PATHS.cod;

/**
 * Courier cash on delivery: what each courier collected, what it deducted and what it paid
 * out (couriers.cod.read). Recording payouts needs couriers.cod.reconcile. The order's own
 * cash collection stays on the order and COD collections pages.
 */
export default async function CodReconciliationPage({
  searchParams,
}: PageProps<'/admin/operations/cod'>) {
  const gate = await workspaceGate('admin', PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={PATH} />;
  }
  const { user, csrf } = gate;
  if (!user.permissions.includes('couriers.cod.read')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={HandCoins} title="COD reconciliation" />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="couriers.cod.read" />
        </section>
      </WorkspaceShell>
    );
  }

  const { page, ...filters } = parseCodFilters(await searchParams);
  const includeMock = filters.test ?? false;
  const canReconcile = user.permissions.includes('couriers.cod.reconcile');
  const [positions, settlements, candidates] = await Promise.all([
    adminRead((api, token) =>
      api.adminCodPositions(token, {
        provider: filters.provider ?? 'all',
        status: filters.status ?? 'all',
        includeMock,
        page,
        pageSize: COD_POSITIONS_PAGE_SIZE,
      }),
    ),
    adminRead((api, token) =>
      api.adminListCourierSettlements(token, { provider: 'all', includeMock, pageSize: 20 }),
    ),
    canReconcile
      ? adminRead((api, token) =>
          Promise.all(
            COURIER_PROVIDER_IDS.map((provider) =>
              api.adminCodPositions(token, { provider, status: 'all', includeMock, pageSize: 100 }),
            ),
          ).then((lists) => settlementCandidates(lists.flatMap((list) => list.positions))),
        )
      : Promise.resolve(null),
  ]);
  if (
    positions.kind === 'signed_out' ||
    settlements.kind === 'signed_out' ||
    candidates?.kind === 'signed_out'
  ) {
    redirect(signInPath(PATH));
  }

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={HandCoins}
          title="COD reconciliation"
          description="Cash the couriers collect for Nilzora: expected, collected, their deductions and what they paid out. Customer shipping charges are on the orders and never mixed in here."
          actions={
            <TestDataSwitch
              path={PATH}
              includeTest={includeMock}
              params={{ courier: filters.provider, status: filters.status }}
            />
          }
        />
        {positions.kind === 'ok' ? (
          <CodPositionsView filters={filters} list={positions.value} />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState
              failure={positions.kind}
              retryHref={codHref(filters, page)}
              resetHref={PATH}
              permission="couriers.cod.read"
            />
          </section>
        )}

        {canReconcile ? (
          <SectionCard
            title="Record a settlement"
            icon={Landmark}
            description="One courier payout, split over the shipments it covers. The settled amounts must add up to the money received."
          >
            {candidates?.kind === 'ok' ? (
              <SettlementForm
                csrf={csrf}
                candidates={candidates.value}
                allowTest={includeMock}
                today={dhakaToday()}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                The shipments awaiting settlement could not be loaded just now. Reload the page to
                try again.
              </p>
            )}
          </SectionCard>
        ) : null}

        {settlements.kind === 'ok' ? (
          <SettlementList settlements={settlements.value.settlements} />
        ) : (
          <p className="text-sm text-muted-foreground">
            <AutoText>Recorded settlements could not be loaded just now.</AutoText>
          </p>
        )}
      </div>
    </WorkspaceShell>
  );
}
