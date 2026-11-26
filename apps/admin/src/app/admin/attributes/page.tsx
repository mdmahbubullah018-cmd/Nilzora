import { Shapes } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { AttributeManager } from '@/components/catalog/variant-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = {
  title: 'Attributes',
  robots: { index: false, follow: false },
};

const ATTRIBUTES_PATH = '/admin/attributes' as Route;

/** Attributes and the values variants are built from. */
export default async function AttributesPage() {
  const gate = await workspaceGate('admin', ATTRIBUTES_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={ATTRIBUTES_PATH} />;
  }
  const { user, csrf } = gate;
  const toolbar = (
    <PageToolbar
      icon={Shapes}
      title="Attributes"
      description="The options products are sold in, such as Size or Colour. Each product then sells as a combination of one value per attribute."
    />
  );

  // The page's own check, before any API call: never rely on the layout alone.
  if (!user.permissions.includes('products.read')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <div className="grid gap-6">
          {toolbar}
          <section className="nz-panel rounded-2xl border">
            <ForbiddenState permission="products.read" />
          </section>
        </div>
      </WorkspaceShell>
    );
  }

  const result = await adminRead((api, token) => api.adminListAttributes(token));
  if (result.kind === 'signed_out') redirect(signInPath(ATTRIBUTES_PATH));

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        {toolbar}
        {result.kind === 'ok' ? (
          <AttributeManager
            attributes={result.value.attributes}
            csrf={csrf}
            canEdit={user.permissions.includes('products.update')}
          />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState
              failure={result.kind}
              retryHref={ATTRIBUTES_PATH}
              permission="products.read"
            />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
