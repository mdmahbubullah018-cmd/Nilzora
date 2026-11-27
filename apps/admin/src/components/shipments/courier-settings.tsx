import type { CourierConfigResponse, Permission } from '@nilzora/contracts';
import { Alert, buttonClasses } from '@nilzora/ui';
import { Database, MapPinned, Plug, Settings2, SlidersHorizontal, Calculator } from 'lucide-react';
import Link from 'next/link';
import { Chip } from '@/components/admin-kit/chip';
import { DetailList } from '@/components/admin-kit/detail-list';
import { SectionCard } from '@/components/admin-kit/section-card';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { formatDateTime } from '@/lib/format';
import { MODE_CHOICES, MOCK_REFUSED_REASON } from './courier-modes';
import { OperationsForm } from './operations-form';
import { CourierSettingsForm } from './pricing-forms';
import { CourierModeBanner } from './shipment-chips';
import { formatWeight, OPERATIONS_PATHS, providerName } from './shipment-labels';
import { AutoText } from '@/components/i18n/translate';

const DATABASE_LABEL: Record<CourierConfigResponse['databaseTarget'], string> = {
  local: 'Local database',
  hosted: 'Hosted database',
  other: 'Other database',
};

function modeLabel(mode: CourierConfigResponse['mode']): string {
  return MODE_CHOICES.find((choice) => choice.value === mode)?.label ?? mode;
}

/** Where the database lives: test mode is only allowed against a local one. */
export function DatabaseTargetChip({
  target,
}: {
  target: CourierConfigResponse['databaseTarget'];
}) {
  return (
    <Chip tone={target === 'local' ? 'neutral' : 'warning'}>
      <Database aria-hidden="true" className="size-3.5" />
      {DATABASE_LABEL[target]}
    </Chip>
  );
}

/**
 * Courier settings: how Nilzora talks to couriers (mode, real bookings, tracking sync,
 * timeout) and the booking defaults. Everyone with couriers.read sees the settings; only
 * couriers.configure changes them, and turning on live couriers needs a typed confirmation.
 */
export function CourierSettingsView({
  config,
  permissions,
  csrf,
}: {
  config: CourierConfigResponse;
  permissions: readonly Permission[];
  csrf: CsrfInput;
}) {
  const canConfigure = permissions.includes('couriers.configure');
  const { operations, settings } = config;
  return (
    <div className="grid gap-6">
      {config.modeNotice ? (
        <Alert tone="warning" title={`Saved mode (${modeLabel(operations.mode)}) is not in effect`}>
          {config.modeNotice} Couriers are running in {modeLabel(config.mode)} mode until this is
          resolved.
        </Alert>
      ) : null}
      <CourierModeBanner mode={config.mode} bookingEnabled={config.bookingEnabled} />

      <SectionCard
        title="Operations"
        icon={SlidersHorizontal}
        description="Managed here, not in server files. Changes apply to the API within a minute."
        actions={<DatabaseTargetChip target={config.databaseTarget} />}
      >
        {canConfigure ? (
          <OperationsForm config={config} csrf={csrf} />
        ) : (
          <div className="grid gap-3">
            <DetailList
              items={[
                { label: 'Saved mode', value: modeLabel(operations.mode) },
                { label: 'In effect now', value: modeLabel(config.mode) },
                { label: 'Real bookings', value: operations.bookingEnabled ? 'On' : 'Off' },
                {
                  label: 'Automatic tracking sync',
                  value: operations.trackingSyncEnabled
                    ? `Every ${String(Math.round(operations.trackingSyncIntervalSeconds / 60))} minutes`
                    : 'Off',
                },
                {
                  label: 'Request timeout',
                  value: `${String(Math.round(operations.httpTimeoutMs / 1000))} seconds`,
                },
                {
                  label: 'Live bookings confirmed',
                  value: operations.liveBookingConfirmedAt
                    ? formatDateTime(operations.liveBookingConfirmedAt)
                    : null,
                },
              ]}
            />
            {!config.mockAllowed ? (
              <p className="text-xs text-muted-foreground">
                <AutoText value={MOCK_REFUSED_REASON} />
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              <AutoText>
                Only the store owner (Enable and configure couriers) can change these.
              </AutoText>
            </p>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Booking defaults"
        icon={Settings2}
        description="Used when comparing couriers and booking parcels."
      >
        {canConfigure ? (
          <CourierSettingsForm settings={settings} csrf={csrf} />
        ) : (
          <DetailList
            items={[
              {
                label: 'Default parcel weight',
                value: formatWeight(settings.defaultParcelWeightGrams),
              },
              {
                label: 'Quote validity',
                value: `${String(settings.quoteValidityMinutes)} minutes`,
              },
              {
                label: 'Preferred courier',
                value: settings.preferredProvider
                  ? providerName(settings.preferredProvider)
                  : 'No preference',
              },
              {
                label: 'Minimum delivery history',
                value: `${String(settings.minHistorySample)} shipments`,
              },
            ]}
          />
        )}
      </SectionCard>

      <nav aria-label="More courier setup" className="flex flex-wrap gap-2">
        <Link
          href={OPERATIONS_PATHS.providers}
          className={buttonClasses({ variant: 'outline', size: 'sm' })}
        >
          <Plug aria-hidden="true" />
          <AutoText>Providers and credentials</AutoText>
        </Link>
        <Link
          href={OPERATIONS_PATHS.pricing}
          className={buttonClasses({ variant: 'outline', size: 'sm' })}
        >
          <Calculator aria-hidden="true" />
          <AutoText>Negotiated rates</AutoText>
        </Link>
        <Link
          href={OPERATIONS_PATHS.locations}
          className={buttonClasses({ variant: 'outline', size: 'sm' })}
        >
          <MapPinned aria-hidden="true" />
          <AutoText>Location mappings</AutoText>
        </Link>
      </nav>
    </div>
  );
}
