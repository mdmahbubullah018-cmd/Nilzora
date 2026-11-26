import {
  COURIER_CAPABILITIES,
  type CourierConfigResponse,
  type CourierProvider,
  type Permission,
} from '@nilzora/contracts';
import { buttonClasses, cn } from '@nilzora/ui';
import { CircleCheck, CircleX, KeyRound, ListChecks, ShieldCheck, Truck } from 'lucide-react';
import Link from 'next/link';
import { Chip } from '@/components/admin-kit/chip';
import { DetailList } from '@/components/admin-kit/detail-list';
import { SectionCard } from '@/components/admin-kit/section-card';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { formatDateTime, formatMoney } from '@/lib/format';
import { CheckConnectionForm, ProviderForm } from './provider-form';
import { credentialLabel, credentialStatus } from './provider-readiness';
import { BaseUrlForm, CredentialRow, LiveVerificationControls } from './provider-setup';
import { CapabilityChip, CourierModeBanner } from './shipment-chips';
import { CAPABILITY_LABELS, formatBasisPoints, OPERATIONS_PATHS } from './shipment-labels';
import { AutoText } from '@/components/i18n/translate';
import { DateTimeText } from '@/components/i18n/format-text';

/** What each operation can do now: available, awaiting API documentation, or portal only. */
export function CapabilityMatrix({ provider }: { provider: CourierProvider }) {
  return (
    <ul
      aria-label={`What Nilzora can do with ${provider.displayName}`}
      className="grid gap-1.5 sm:grid-cols-2"
    >
      {COURIER_CAPABILITIES.map((capability) => (
        <li
          key={capability}
          className="flex items-center justify-between gap-2 rounded-lg border border-hairline px-3 py-2 text-sm"
        >
          <span className="text-foreground">{CAPABILITY_LABELS[capability]}</span>
          <CapabilityChip state={provider.capabilities[capability]} />
        </li>
      ))}
    </ul>
  );
}

/** The readiness steps, in the order they are done. */
export const READINESS_STEPS = [
  ['adapterVerified', 'Adapter verified against the courier’s API documentation'],
  ['credentialsComplete', 'Credentials complete'],
  ['baseUrlValid', 'API address valid'],
  ['liveCheckPassed', 'Live connection check passed (last 24 hours)'],
  ['liveVerified', 'Verified for live use by the owner'],
  ['enabled', 'Enabled for real bookings'],
] as const;

/** Every step to real bookings, passed or not, and what is still missing. */
export function ReadinessChecklist({ provider }: { provider: CourierProvider }) {
  const { readiness } = provider;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground"><AutoText>Live readiness</AutoText></h3>
        {readiness.ready ? (
          <Chip tone="success" dot><AutoText>Ready for live bookings</AutoText></Chip>
        ) : (
          <Chip tone="neutral" dot><AutoText>Not ready for live bookings</AutoText></Chip>
        )}
      </div>
      <ul aria-label={`Live readiness of ${provider.displayName}`} className="grid gap-1.5">
        {READINESS_STEPS.map(([key, label]) => {
          const passed = readiness[key];
          const Icon = passed ? CircleCheck : CircleX;
          return (
            <li key={key} className="flex items-start gap-2 text-sm">
              <Icon
                aria-hidden="true"
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  passed ? 'text-success-ink' : 'text-muted-foreground',
                )}
              />
              <span className={passed ? 'text-foreground' : 'text-muted-foreground'}>
                {label}
                <span className="sr-only">{passed ? ': done' : ': not yet'}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {readiness.blockers.length > 0 ? (
        <div className="grid gap-1 rounded-xl border border-warning-line bg-warning-soft/40 p-3 text-sm">
          <p className="font-semibold text-warning-ink"><AutoText>Still missing</AutoText></p>
          <ul className="list-disc pl-5 text-body">
            {readiness.blockers.map((blocker) => (
              <li key={blocker}><AutoText value={blocker} /></li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function lastCheck(provider: CourierProvider): string | null {
  if (!provider.lastCheckAt) return null;
  const result = provider.lastCheckOk ? 'passed' : 'did not pass';
  const where = provider.lastCheckMode === 'mock' ? ' (test courier)' : '';
  return `${formatDateTime(provider.lastCheckAt)}: ${result}${where}`;
}

/**
 * One courier: readiness, credentials (status only, never values), API address, connection
 * check, live verification, switch and settings.
 */
export function ProviderCard({
  provider,
  canConfigure,
  csrf,
}: {
  provider: CourierProvider;
  canConfigure: boolean;
  csrf: CsrfInput;
}) {
  const settings = Object.entries(provider.settings);
  return (
    <SectionCard
      title={provider.displayName}
      icon={Truck}
      actions={
        <Chip tone={provider.isEnabled ? 'success' : 'neutral'} dot>
          {provider.isEnabled ? 'Enabled' : 'Not enabled'}
        </Chip>
      }
    >
      <div className="grid gap-6">
        <ReadinessChecklist provider={provider} />

        {provider.blockedReason ? (
          <div className="grid gap-1 rounded-xl border border-hairline bg-surface-muted/50 p-3 text-sm">
            <p className="flex items-center gap-2 font-semibold text-foreground">
              <ShieldCheck aria-hidden="true" className="size-4 text-muted-foreground" /><AutoText>Real calls are blocked</AutoText></p>
            <p className="text-body"><AutoText value={provider.blockedReason} /></p>
          </div>
        ) : null}

        <section aria-label={`${provider.displayName} credentials`} className="grid gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <KeyRound aria-hidden="true" className="size-4 text-muted-foreground" /><AutoText>Credentials</AutoText></h3>
          <p className="text-xs text-muted-foreground">
            Write-only: values are stored encrypted on the server and never shown again. Saving or
            clearing one removes the courier’s live verification.
          </p>
          {provider.credentialFields.length === 0 ? (
            <p className="text-sm text-muted-foreground"><AutoText>This courier needs no credentials.</AutoText></p>
          ) : (
            <ul className="grid gap-2">
              {provider.credentialFields.map((field) => {
                const status = credentialStatus(provider, field);
                return canConfigure ? (
                  <CredentialRow
                    key={field}
                    provider={provider.provider}
                    field={field}
                    status={status.text}
                    stored={status.stored}
                    csrf={csrf}
                  />
                ) : (
                  <li
                    key={field}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hairline px-3 py-2 text-sm"
                  >
                    <span className="font-medium text-foreground"><AutoText value={credentialLabel(field)} /></span>
                    <span className="text-xs text-muted-foreground"><AutoText value={status.text} /></span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-label={`${provider.displayName} connection`} className="grid gap-3">
          <h3 className="text-sm font-semibold text-foreground"><AutoText>Connection</AutoText></h3>
          {canConfigure ? (
            <BaseUrlForm
              provider={provider.provider}
              apiBaseUrl={provider.apiBaseUrl}
              csrf={csrf}
            />
          ) : null}
          <DetailList
            columns={1}
            items={[
              ...(canConfigure ? [] : [{ label: 'API base URL', value: provider.apiBaseUrl }]),
              { label: 'Last connection check', value: lastCheck(provider) },
              ...(provider.lastCheckMessage
                ? [{ label: 'Check details', value: provider.lastCheckMessage }]
                : []),
            ]}
          />
          {canConfigure ? (
            <div className="flex flex-wrap items-start gap-4">
              <CheckConnectionForm provider={provider.provider} csrf={csrf} />
              <LiveVerificationControls provider={provider} csrf={csrf} />
            </div>
          ) : provider.liveVerifiedAt ? (
            <p className="text-sm text-success-ink">
              Verified for live use <DateTimeText value={provider.liveVerifiedAt} style="datetime" />
            </p>
          ) : null}
        </section>

        <div className="grid gap-2">
          <h3 className="text-sm font-semibold text-foreground"><AutoText>What Nilzora can do</AutoText></h3>
          <CapabilityMatrix provider={provider} />
        </div>

        {canConfigure ? (
          <div className="border-t border-hairline pt-5">
            <ProviderForm provider={provider} csrf={csrf} />
          </div>
        ) : (
          <>
            <DetailList
              items={[
                {
                  label: 'COD fee',
                  value: provider.codFeeBp === null ? null : formatBasisPoints(provider.codFeeBp),
                },
                {
                  label: 'Return charge',
                  value:
                    provider.returnChargeMinor === null
                      ? null
                      : formatMoney(provider.returnChargeMinor),
                },
                {
                  key: 'settings',
                  label: 'Settings',
                  value:
                    settings.length === 0 ? null : (
                      <ul className="grid gap-0.5">
                        {settings.map(([key, value]) => (
                          <li key={key}>
                            <span className="font-mono text-xs"><AutoText value={key} /></span>: {String(value)}
                          </li>
                        ))}
                      </ul>
                    ),
                  wide: true,
                },
              ]}
            />
            <p className="text-xs text-muted-foreground">
              Only the store owner (Enable and configure couriers) can change a courier, its
              credentials or its verification.
            </p>
          </>
        )}
      </div>
    </SectionCard>
  );
}

/** Every courier, with the courier mode on top. */
export function ProvidersView({
  config,
  permissions,
  csrf,
}: {
  config: CourierConfigResponse;
  permissions: readonly Permission[];
  csrf: CsrfInput;
}) {
  const canConfigure = permissions.includes('couriers.configure');
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <CourierModeBanner mode={config.mode} bookingEnabled={config.bookingEnabled} />
        <Link
          href={OPERATIONS_PATHS.settings}
          className={cn(buttonClasses({ variant: 'outline', size: 'sm' }), 'w-fit')}
        >
          <ListChecks aria-hidden="true" /><AutoText>Courier settings</AutoText></Link>
      </div>
      {config.providers.length === 0 ? (
        <p className="text-sm text-muted-foreground"><AutoText>No couriers are set up yet.</AutoText></p>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {config.providers.map((provider) => (
            <ProviderCard
              key={provider.provider}
              provider={provider}
              canConfigure={canConfigure}
              csrf={csrf}
            />
          ))}
        </div>
      )}
    </div>
  );
}
