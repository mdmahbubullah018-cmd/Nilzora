import { uuidSchema } from '@nilzora/validation';
import { PackageX } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { Route } from 'next';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { CheckoutDetailView } from '@/components/checkouts/checkout-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { storefrontBaseUrl } from '@/lib/storefront-url';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = { title: 'Checkout', robots: { index: false, follow: false } };

const back = { href: '/admin/checkouts' as Route, label: 'Checkouts' };

interface PageParams {
  params: Promise<{ checkoutId: string }>;
}

/** One checkout attempt: the stage, the customer, what the cart held, and the recovery work. */
export default async function CheckoutPage({ params }: PageParams) {
  const { checkoutId } = await params;
  if (!uuidSchema.safeParse(checkoutId).success) notFound();

  const path = `/admin/checkouts/${checkoutId}` as Route;
  const gate = await workspaceGate('admin', path);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={path} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('orders.read')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={PackageX} title="Checkout" back={back} />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="orders.read" />
        </section>
      </WorkspaceShell>
    );
  }

  const result = await adminRead((api, token) => api.adminGetCheckout(token, checkoutId));
  if (result.kind === 'signed_out') redirect(signInPath(path));
  if (result.kind === 'not_found') notFound();

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={PackageX}
          title={
            result.kind === 'ok'
              ? (result.value.checkout.customerName ?? 'Checkout attempt')
              : 'Checkout attempt'
          }
          back={back}
          description="A checkout attempt is not a sale. The order appears once the customer places it."
        />
        {result.kind === 'ok' ? (
          <CheckoutDetailView
            checkout={result.value.checkout}
            csrf={csrf}
            storefrontUrl={storefrontBaseUrl() ?? ''}
            canAct={user.permissions.includes('checkouts.recover')}
          />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState failure={result.kind} retryHref={path} permission="orders.read" />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
