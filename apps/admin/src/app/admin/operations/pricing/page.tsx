import {
  COURIER_PROVIDER_IDS,
  type CourierConfigResponse,
  type CourierRateCard,
  type Permission,
} from '@nilzora/contracts';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nilzora/ui';
import { Calculator } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { Chip } from '@/components/admin-kit/chip';
import { DataTable, DataTableEmpty } from '@/components/admin-kit/data-table';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { SectionCard } from '@/components/admin-kit/section-card';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { AddRateCard, RateCardRowActions } from '@/components/shipments/pricing-forms';
import {
  formatWeight,
  OPERATIONS_PATHS,
  providerName,
} from '@/components/shipments/shipment-labels';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { formatMoney } from '@/lib/format';
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = {
  title: 'Courier pricing',
  robots: { index: false, follow: false },
};

const PATH = OPERATIONS_PATHS.pricing;
const ZONES = [
  { value: 'inside_dhaka', label: 'Inside Dhaka' },
  { value: 'outside_dhaka', label: 'Outside Dhaka' },
] as const;

function RateTables({
  rates,
  canManage,
  csrf,
}: {
  rates: readonly CourierRateCard[];
  canManage: boolean;
  csrf: CsrfInput;
}) {
  const providers = [...new Set([...COURIER_PROVIDER_IDS, ...rates.map((rate) => rate.provider)])];
  return (
    <div className="grid gap-6">
      {providers.map((provider) => (
        <SectionCard key={provider} title={providerName(provider)} titleAs="h3" flush>
          <DataTable caption={`${providerName(provider)} negotiated rates`} dense>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead><AutoText>Zone</AutoText></TableHead>
                <TableHead><AutoText>Up to</AutoText></TableHead>
                <TableHead className="text-right"><AutoText>Charge</AutoText></TableHead>
                <TableHead><AutoText>State</AutoText></TableHead>
                {canManage ? (
                  <TableHead>
                    <span className="sr-only"><AutoText>Actions</AutoText></span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            {rates.some((rate) => rate.provider === provider) ? (
              <TableBody>
                {ZONES.flatMap((zone) =>
                  rates
                    .filter((rate) => rate.provider === provider && rate.zone === zone.value)
                    .sort((a, b) => a.weightUpToGrams - b.weightUpToGrams)
                    .map((rate) => (
                      <TableRow key={rate.id}>
                        <TableCell><AutoText value={zone.label} /></TableCell>
                        <TableCell><AutoText value={formatWeight(rate.weightUpToGrams)} /></TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatMoney(rate.chargeMinor)}
                        </TableCell>
                        <TableCell>
                          <Chip tone={rate.isActive ? 'success' : 'neutral'}>
                            {rate.isActive ? 'Active' : 'Inactive'}
                          </Chip>
                        </TableCell>
                        {canManage ? (
                          <TableCell className="align-top whitespace-normal">
                            <RateCardRowActions rate={rate} csrf={csrf} />
                          </TableCell>
                        ) : null}
                      </TableRow>
                    )),
                )}
              </TableBody>
            ) : (
              <DataTableEmpty
                colSpan={canManage ? 5 : 4}
                title="No negotiated rates"
                description="Without rates this courier’s price shows as “No price” unless its API quotes live."
              />
            )}
          </DataTable>
        </SectionCard>
      ))}
    </div>
  );
}

function PricingView({
  config,
  permissions,
  csrf,
}: {
  config: CourierConfigResponse;
  permissions: readonly Permission[];
  csrf: CsrfInput;
}) {
  const canManage = permissions.includes('couriers.pricing.manage');
  return (
    <div className="grid gap-6">
      <p className="text-sm text-muted-foreground">
        The default parcel weight, quote validity and preferred courier are on{' '}
        <Link
          href={OPERATIONS_PATHS.settings}
          className="font-medium text-link underline-offset-4 hover:underline"
        ><AutoText>Courier settings</AutoText></Link>
        .
      </p>

      <section aria-labelledby="rate-cards" className="grid gap-4">
        <div className="grid gap-1">
          <h2 id="rate-cards" className="font-display text-lg font-semibold text-foreground"><AutoText>Negotiated rates (used for Internal Estimates)</AutoText></h2>
          <p className="text-sm text-muted-foreground">
            What each courier charges Nilzora by zone and weight, as agreed with them. Where a
            courier’s API cannot quote, these give the “Internal Estimate” shown when comparing.
            They never change what the customer pays for delivery.
          </p>
        </div>
        {canManage ? <AddRateCard csrf={csrf} /> : null}
        <RateTables rates={config.rateCards} canManage={canManage} csrf={csrf} />
      </section>
    </div>
  );
}

/** Courier settings and negotiated rate cards (couriers.read; changes need their own permissions). */
export default async function PricingPage() {
  const gate = await workspaceGate('admin', PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={PATH} />;
  }
  const { user, csrf } = gate;
  const toolbar = (
    <PageToolbar
      icon={Calculator}
      title="Courier pricing"
      description="The rates negotiated with each courier, used for Internal Estimates when a courier cannot quote live."
    />
  );
  if (!user.permissions.includes('couriers.read')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        {toolbar}
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="couriers.read" />
        </section>
      </WorkspaceShell>
    );
  }
  const config = await adminRead((api, token) => api.adminCourierConfig(token));
  if (config.kind === 'signed_out') redirect(signInPath(PATH));
  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        {toolbar}
        {config.kind === 'ok' ? (
          <PricingView config={config.value} permissions={user.permissions} csrf={csrf} />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState failure={config.kind} retryHref={PATH} permission="couriers.read" />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
