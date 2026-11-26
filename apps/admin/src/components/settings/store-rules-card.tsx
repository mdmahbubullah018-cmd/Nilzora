import { SlidersHorizontal } from 'lucide-react';
import { redirect } from 'next/navigation';
import { adminRead } from '@/components/admin-kit/read';
import { SectionCard } from '@/components/admin-kit/section-card';
import { ReadState } from '@/components/admin-kit/states';
import type { CsrfInput } from '@/components/auth/csrf-field';
/* @/lib/format */
import { signInPath } from '@/lib/workspace-access';
import { SETTINGS_PATH } from './settings-view';
import { StoreRulesForm } from './store-rules-form';
import { storeRuleTexts } from './store-rules';
import { DateTimeText } from '@/components/i18n/format-text';

/**
 * The store rules (settings.manage): the return window, cart inactivity and the customer
 * insight thresholds. The current values are read from the API; when that fails the page
 * says so instead of showing a form that could overwrite them with guesses.
 */
export async function StoreRulesCard({ csrf }: { csrf: CsrfInput }) {
  const result = await adminRead((api, token) => api.adminGetStoreSettings(token));
  if (result.kind === 'signed_out') redirect(signInPath(SETTINGS_PATH));
  if (result.kind !== 'ok') {
    return (
      <section className="nz-panel rounded-2xl border">
        <ReadState failure={result.kind} retryHref={SETTINGS_PATH} permission="settings.manage" />
      </section>
    );
  }
  const { settings } = result.value;

  return (
    <SectionCard
      className="nz-panel-strong"
      icon={SlidersHorizontal}
      title="Store rules"
      description="How long customers have to return an item, when an unfinished cart stops counting as a checkout, and the thresholds behind the customer segments."
      footer={
        <p className="text-xs text-muted-foreground">
          Last updated <DateTimeText value={settings.updatedAt} style="datetime" />. Every change is recorded in the audit log.
        </p>
      }
    >
      <StoreRulesForm initial={storeRuleTexts(settings)} csrf={csrf} />
    </SectionCard>
  );
}
