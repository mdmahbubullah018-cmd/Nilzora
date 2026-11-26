import { adminCategoryRefSchema } from '@nilzora/contracts';
import type { Metadata, Route } from 'next';
import { adminRead } from '@/components/admin-kit/read';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { anySignedOut, loadProductDetail } from '@/components/catalog/load-catalog';
import { productNotice } from '@/components/catalog/notices';
import { PageFailure, PageForbidden } from '@/components/catalog/page-states';
import { ProductDetailView } from '@/components/catalog/product-detail-view';
import { productAbilities } from '@/components/catalog/product-rules';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = { title: 'Product', robots: { index: false, follow: false } };

const back = { href: '/admin/products', label: 'Products' } as const;

/** One product: its content, pricing, ordering, publishing, review and stock. */
export default async function ProductPage({
  params,
  searchParams,
}: PageProps<'/admin/products/[productId]'>) {
  const { productId: rawId } = await params;
  // Only a well-formed id ever reaches the API or the sign-in return path.
  const productId = adminCategoryRefSchema.shape.id.safeParse(rawId).success ? rawId : undefined;
  const pagePath: Route = productId ? (`/admin/products/${productId}` as Route) : '/admin/products';

  const gate = await workspaceGate('admin', pagePath);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={pagePath} />;
  }
  const { user, csrf } = gate;
  const shell = (children: ReactNode, crumb = 'Product') => (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf} breadcrumbs={[{ label: crumb }]}>
      {children}
    </WorkspaceShell>
  );

  if (!user.permissions.includes('products.read')) {
    return shell(<PageForbidden title="Product" permission="products.read" back={back} />);
  }
  if (!productId) {
    return shell(
      <PageFailure title="Product" failure="not_found" retryHref="/admin/products" back={back} />,
    );
  }

  const canOpenReview = user.permissions.includes('moderation.assign');
  const canManageZones = user.permissions.includes('zones.manage');
  const data = await loadProductDetail(productId, { readReviewer: canOpenReview });
  if (anySignedOut([data.product, data.categories, data.movements])) redirect(signInPath(pagePath));
  if (data.product.kind !== 'ok') {
    return shell(
      <PageFailure
        title="Product"
        failure={data.product.kind === 'signed_out' ? 'unavailable' : data.product.kind}
        retryHref={pagePath}
        permission="products.read"
        back={back}
      />,
    );
  }

  const product = data.product.value;
  const { movements, categories } = data;
  // Brand and variants are side panels: a failed read leaves them out (or says so),
  // never the product itself.
  // The search metadata comes from the one SEO store the SEO editor also reads (narrowed to
  // this product's address); the product page only shows it and links to the editor.
  const [brands, productBrand, variants, videos, seo, zones, productZones] = await Promise.all([
    adminRead((api, token) => api.adminListBrands(token).then((response) => response.brands)),
    adminRead((api, token) => api.adminGetProductBrand(token, productId)),
    adminRead((api, token) =>
      api.adminProductVariants(token, productId).then((response) => response.variants),
    ),
    adminRead((api, token) =>
      api.adminListProductVideos(token, productId).then((response) => response.videos),
    ),
    adminRead((api, token) =>
      api
        .adminSeoOverview(token, { q: product.slug })
        .then(
          (response) =>
            response.entries.find(
              (entry) => entry.kind === 'product' && entry.id === productId,
            ) ?? null,
        ),
    ),
    // The zone panel is optional: an account without the permission, or a store whose zone
    // functions are not deployed, simply does not see it.
    canManageZones
      ? adminRead((api, token) =>
          api.adminListZones(token, { pageSize: 100 }).then((response) => response.zones),
        )
      : null,
    canManageZones
      ? adminRead((api, token) => api.adminProductZones(token, productId))
      : null,
  ]);
  return shell(
    <ProductDetailView
      product={product}
      reviewer={data.reviewer}
      canOpenReview={canOpenReview}
      categories={categories.kind === 'ok' ? categories.value : null}
      movements={movements.kind === 'signed_out' ? { kind: 'unavailable' } : movements}
      abilities={productAbilities(user.permissions, user.role)}
      csrf={csrf}
      notice={productNotice((await searchParams).notice)}
      variants={variants.kind === 'ok' ? variants.value : null}
      videos={videos.kind === 'ok' ? videos.value : null}
      seo={seo.kind === 'ok' ? seo.value : undefined}
      brand={
        brands.kind === 'ok' && productBrand.kind === 'ok'
          ? { brands: brands.value, brandId: productBrand.value.brandId }
          : null
      }
      zones={
        zones?.kind === 'ok' && productZones?.kind === 'ok'
          ? {
              zones: zones.value,
              mine: productZones.value.mine,
              inherited: productZones.value.inherited,
            }
          : null
      }
    />,
    product.name,
  );
}
