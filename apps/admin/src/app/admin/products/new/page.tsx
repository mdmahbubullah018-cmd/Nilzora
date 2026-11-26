import { buttonClasses } from '@nilzora/ui';
import { FolderPlus, PackagePlus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { readCategories } from '@/components/catalog/load-catalog';
import { PageFailure, PageForbidden } from '@/components/catalog/page-states';
import { EmptyPanel } from '@/components/catalog/catalog-ui';
import { ProductCreateForm } from '@/components/catalog/product-create-form';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = {
  title: 'New product',
  robots: { index: false, follow: false },
};

const back = { href: '/admin/products', label: 'Products' } as const;
const TITLE = 'New product';

/** Creates a draft product; it goes on sale only after its content is approved. */
export default async function NewProductPage() {
  const gate = await workspaceGate('admin', '/admin/products/new');
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref="/admin/products/new" />;
  }
  const { user, csrf } = gate;
  const shell = (children: ReactNode) => (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf} breadcrumbs={[{ label: TITLE }]}>
      {children}
    </WorkspaceShell>
  );

  // Creating needs both: the API answers with the product, which products.read covers.
  for (const permission of ['products.read', 'products.create'] as const) {
    if (!user.permissions.includes(permission)) {
      return shell(<PageForbidden title={TITLE} permission={permission} back={back} />);
    }
  }

  const categories = await readCategories();
  if (categories.kind === 'signed_out') redirect(signInPath('/admin/products/new'));
  if (categories.kind !== 'ok') {
    return shell(
      <PageFailure
        title={TITLE}
        failure={categories.kind}
        retryHref="/admin/products/new"
        back={back}
      />,
    );
  }

  return shell(
    <>
      <PageToolbar
        back={back}
        icon={PackagePlus}
        title={TITLE}
        description="The product is saved as a draft. Submit its content for review, and publish it once a moderator approves it."
      />
      {categories.value.length > 0 ? (
        <ProductCreateForm csrf={csrf} categories={categories.value} />
      ) : (
        <section className="nz-panel nz-panel-sheen rounded-2xl border">
          <EmptyPanel
            icon={FolderPlus}
            titleAs="h2"
            title="Create a category first"
            description="Every product belongs to a category, and there are none yet."
            action={
              user.permissions.includes('products.publish') ? (
                <Link href="/admin/categories/new" className={buttonClasses({ className: 'max-sm:min-h-11' })}><AutoText>New category</AutoText></Link>
              ) : (
                <p className="text-sm text-muted-foreground"><AutoText>Ask an admin to create one: categories need the “Publish products” permission.</AutoText></p>
              )
            }
            className="py-16"
          />
        </section>
      )}
    </>,
  );
}
