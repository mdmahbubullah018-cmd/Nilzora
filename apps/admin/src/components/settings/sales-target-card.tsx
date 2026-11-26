import type { Permission } from '@nilzora/contracts';
import { Target } from 'lucide-react';
import { adminRead } from '@/components/admin-kit/read';
import { SectionCard } from '@/components/admin-kit/section-card';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { dhakaToday } from '@/lib/date-range';
import { formatMoney } from '@/lib/format';
import { SalesTargetForm } from './sales-target-form';

/**
 * The monthly sales target (settings.manage). The current value is read from the
 * analytics overview when the account may also read finances; otherwise the form starts
 * empty and says so — saving still sets the target, which the API checks and audits.
 */
export async function SalesTargetCard({
  csrf,
  permissions,
}: {
  csrf: CsrfInput;
  permissions: readonly Permission[];
}) {
  const today = dhakaToday();
  const current = permissions.includes('finance.read')
    ? await adminRead((api, token) =>
        api.adminAnalyticsOverview(token, { from: today, to: today, compare: 'false' }),
      )
    : null;
  const target = current?.kind === 'ok' ? current.value.overview.monthTarget : undefined;

  return (
    <SectionCard
      className="nz-panel-strong"
      icon={Target}
      title="Monthly sales target"
      description="The dashboard's target ring measures this calendar month's revenue (orders not cancelled) against it."
    >
      <div className="grid gap-4">
        {target ? (
          <p className="text-sm text-muted-foreground">
            {target.targetMinor === null
              ? 'No target is set.'
              : `Current target ${formatMoney(target.targetMinor)} · ${formatMoney(target.revenueMinor)} so far this month.`}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {current === null
              ? 'Your account cannot read sales figures, so the current target is not shown.'
              : 'The current target could not be read right now.'}
          </p>
        )}
        <SalesTargetForm targetMinor={target?.targetMinor} csrf={csrf} />
      </div>
    </SectionCard>
  );
}
