import { CreditCard } from 'lucide-react';
import { redirect } from 'next/navigation';
import { adminRead } from '@/components/admin-kit/read';
import { SectionCard } from '@/components/admin-kit/section-card';
import { ReadState } from '@/components/admin-kit/states';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { signInPath } from '@/lib/workspace-access';
import { PaymentMethodsForm } from './payment-methods-form';
import { SETTINGS_PATH } from './settings-view';

/**
 * Payment methods (settings.manage).
 *
 * The saved value is read from the API, so the switch always shows what the order function
 * will actually do. Cash on delivery is the only method with a control; bKash and Nagad are
 * listed as coming soon and cannot be turned on before their integrations exist.
 */
export async function PaymentMethodsCard({ csrf }: { csrf: CsrfInput }) {
  const result = await adminRead((api, token) => api.adminGetStoreSettings(token));
  if (result.kind === 'signed_out') redirect(signInPath(SETTINGS_PATH));
  if (result.kind !== 'ok') {
    return (
      <section className="nz-panel rounded-2xl border">
        <ReadState failure={result.kind} retryHref={SETTINGS_PATH} permission="settings.manage" />
      </section>
    );
  }

  return (
    <SectionCard
      className="nz-panel-strong"
      icon={CreditCard}
      title="Payment methods"
      description="What a customer can choose at checkout. Cash on delivery is live; bKash and Nagad arrive with their own integrations."
    >
      <PaymentMethodsForm codEnabled={result.value.settings.codEnabled} csrf={csrf} />
    </SectionCard>
  );
}
