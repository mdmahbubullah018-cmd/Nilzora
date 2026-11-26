import { uuidSchema } from '@nilzora/validation';
import { Alert } from '@nilzora/ui';
import { Boxes } from 'lucide-react';
import type { Metadata, Route } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { Chip } from '@/components/admin-kit/chip';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState, type ReadFailure } from '@/components/admin-kit/states';
import { PageForbidden } from '@/components/catalog/page-states';
import { VariantEditor } from '@/components/catalog/variant-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { formatMoney } from '@/lib/format';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = { title: 'Variants', robots: { index: false, follow: false } };

interface PageParams {
  params: Promise<{ productId: string }>;
}

const TITLE = 'Product options';

/**
 * One product's options. The product keeps selling as a single item until it has a
 * variant, so adding the first one is an ordinary catalogue change.
 *
 * The page checks products.read itself before any API call; changes need
 * products.update (and stock changes inventory.adjust), which the API enforces on every
 * action — accounts without it see the options read-only, with a note saying so.
 */
export default async function ProductVariantsPage({ params }: PageParams) {
  const { productId } = await params;
  const parsed = uuidSchema.safeParse(productId);
  if (!parsed.success) notFound();

  const path = `/admin/products/${productId}/variants` as Route;
  const productPath = `/admin/products/${productId}` as Route;
  const gate = await workspaceGate('admin', path);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={path} />;
  }
  const { user, csrf } = gate;
  const shell = (children: ReactNode) => (
    <WorkspaceShell
      workspace="admin"
      user={user}
      csrf={csrf}
      breadcrumbs={[{ label: 'Product', href: productPath }, { label: 'Variants' }]}
    >
      {children}
    </WorkspaceShell>
  );

  if (!user.permissions.includes('products.read')) {
    return shell(
      <PageForbidden
        title={TITLE}
        permission="products.read"
        back={{ href: '/admin/products', label: 'Products' }}
      />,
    );
  }
  const canEdit = user.permissions.includes('products.update');
  const canAdjust = user.permissions.includes('inventory.adjust');
  const canDelete = user.permissions.includes('products.publish');

  const [product, variants, attributes] = await Promise.all([
    adminRead((api, token) => api.adminGetProduct(token, productId)),
    adminRead((api, token) => api.adminProductVariants(token, productId)),
    adminRead((api, token) => api.adminListAttributes(token)),
  ]);
  if (
    product.kind === 'signed_out' ||
    variants.kind === 'signed_out' ||
    attributes.kind === 'signed_out'
  ) {
    redirect(signInPath(path));
  }
  if (product.kind === 'not_found') notFound();

  const productFailure = product.kind === 'ok' ? null : product.kind;
  const variantsFailure = variants.kind === 'ok' ? null : variants.kind;
  const attributesFailure = attributes.kind === 'ok' ? null : attributes.kind;
  // 'signed_out' already redirected above, so anything left is a real read failure.
  const failure: ReadFailure | null = productFailure ?? variantsFailure ?? attributesFailure;

  return shell(
    <div className="grid gap-6">
      <PageToolbar
        icon={Boxes}
        back={{ href: productPath, label: 'Back to the product' }}
        title={product.kind === 'ok' ? `${product.value.product.name} options` : TITLE}
        description="Each variant is one value from every attribute, with its own SKU, price and stock."
        meta={
          product.kind === 'ok' ? (
            <>
              <Chip tone="primary">Base price {formatMoney(product.value.product.priceMinor)}</Chip>
              <span>SKU {product.value.product.sku}</span>
            </>
          ) : undefined
        }
      />
      {product.kind === 'ok' && variants.kind === 'ok' && attributes.kind === 'ok' ? (
        <>
          {canEdit ? null : (
            <Alert tone="info" title="View only">
              Your account can see this product&apos;s options but not change them (that needs the
              “Edit products” permission).
            </Alert>
          )}
          <VariantEditor
            product={product.value.product}
            variants={variants.value.variants}
            attributes={attributes.value.attributes}
            csrf={csrf}
            canEdit={canEdit}
            canAdjust={canAdjust}
            canDelete={canDelete}
          />
        </>
      ) : failure === 'forbidden' ? (
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="products.read" />
        </section>
      ) : (
        <section className="nz-panel rounded-2xl border">
          <ReadState
            failure={failure === null ? 'unavailable' : failure}
            retryHref={path}
            permission="products.read"
          />
        </section>
      )}
    </div>,
  );
}
