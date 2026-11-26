import type { DeliveryCharge } from '@nilzora/contracts';
import { Alert } from '@nilzora/ui';
import { Truck } from 'lucide-react';
import { redirect } from 'next/navigation';
import { Chip } from '@/components/admin-kit/chip';
import { adminRead } from '@/components/admin-kit/read';
import { SectionCard } from '@/components/admin-kit/section-card';
import { ReadState } from '@/components/admin-kit/states';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { DELIVERY_ZONE_LABEL } from '@/components/orders/order-query';
import { formatDateTime, formatMoney } from '@/lib/format';
import { signInPath } from '@/lib/workspace-access';
import { DeliveryChargeForm } from './delivery-charge-form';
import { AutoText } from '@/components/i18n/translate';
/* dropped: @/components/i18n/format-text */

export const SETTINGS_PATH = '/admin/settings' as const;

export function DeliveryChargesView({
  charges,
  csrf,
}: {
  charges: readonly DeliveryCharge[];
  csrf: CsrfInput;
}) {
  const unset = charges.filter((charge) => charge.amountMinor === null);
  return (
    <SectionCard
      title="Delivery charges"
      icon={Truck}
      description="Charged once per order by the zone of the delivery address, from 0 to 1,00,000 taka. Checkout uses the new charge at once; placed orders keep theirs."
    >
      <div className="grid gap-5">
        {unset.length > 0 ? (
          <Alert tone="warning" title="Orders are refused until every zone has a charge">
            Not set: {unset.map((charge) => DELIVERY_ZONE_LABEL[charge.zone]).join(', ')}.
          </Alert>
        ) : null}
        <ul className="grid gap-4 md:grid-cols-2">
          {charges.map((charge) => (
            <li key={charge.zone} className="nz-panel-strong grid gap-4 rounded-2xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">
                  {DELIVERY_ZONE_LABEL[charge.zone]}
                </p>
                {charge.amountMinor === null ? (
                  <Chip tone="warning" dot><AutoText>Not set</AutoText></Chip>
                ) : (
                  <Chip tone="success" dot>
                    {formatMoney(charge.amountMinor)}
                  </Chip>
                )}
              </div>
              <DeliveryChargeForm
                zone={charge.zone}
                label={DELIVERY_ZONE_LABEL[charge.zone]}
                amountMinor={charge.amountMinor}
                csrf={csrf}
              />
              <p className="text-xs text-muted-foreground">
                {charge.updatedAt
                  ? `Last changed ${formatDateTime(charge.updatedAt)}`
                  : 'Never set'}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </SectionCard>
  );
}

export async function DeliveryChargesResults({ csrf }: { csrf: CsrfInput }) {
  const result = await adminRead((api, token) => api.adminListDeliveryCharges(token));
  if (result.kind === 'signed_out') redirect(signInPath(SETTINGS_PATH));
  if (result.kind !== 'ok') {
    return (
      <section className="nz-panel rounded-2xl border">
        <ReadState failure={result.kind} retryHref={SETTINGS_PATH} permission="settings.manage" />
      </section>
    );
  }
  return <DeliveryChargesView charges={result.value.charges} csrf={csrf} />;
}
