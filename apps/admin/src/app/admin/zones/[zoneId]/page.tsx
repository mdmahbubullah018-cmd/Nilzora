import { adminShoppingZoneSchema } from '@nilzora/contracts';
import { ImageIcon, Layers, Link2, Smartphone, Trash2 } from 'lucide-react';
import type { Metadata, Route } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { Chip } from '@/components/admin-kit/chip';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { SectionCard } from '@/components/admin-kit/section-card';
import { readCategories } from '@/components/catalog/load-catalog';
import { PageFailure, PageForbidden } from '@/components/catalog/page-states';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { ZoneCategoryPicker, ZoneProductPicker } from '@/components/zones/association-forms';
import {
  DeleteZoneForm,
  ZoneBannerForm,
  ZoneForm,
  ZoneMobileBannerForm,
  ZoneVisibilityForm,
} from '@/components/zones/zone-forms';
import { workspaceGate } from '@/lib/access';
/* @/lib/format */
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';
import { CountText } from '@/components/i18n/format-text';

export const metadata: Metadata = {
  title: 'Shopping zone',
  robots: { index: false, follow: false },
};

const back = { href: '/admin/zones', label: 'Shopping zones' } as const;

/** How many products the pickers can offer: the API's own page-size limit. */
const PICKER_LIMIT = 100;

/** Edits one zone: its words, picture, what it holds and whether shoppers see it. */
export default async function ZonePage({ params }: PageProps<'/admin/zones/[zoneId]'>) {
  const { zoneId: rawId } = await params;
  const zoneId = adminShoppingZoneSchema.shape.id.safeParse(rawId).success ? rawId : undefined;
  const pagePath: Route = zoneId ? (`/admin/zones/${zoneId}` as Route) : '/admin/zones';

  const gate = await workspaceGate('admin', pagePath);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={pagePath} />;
  }
  const { user, csrf } = gate;
  const shell = (children: ReactNode, crumb = 'Shopping zone') => (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf} breadcrumbs={[{ label: crumb }]}>
      {children}
    </WorkspaceShell>
  );

  if (!user.permissions.includes('zones.manage')) {
    return shell(<PageForbidden title="Shopping zone" permission="zones.manage" back={back} />);
  }
  if (!zoneId) {
    return shell(
      <PageFailure
        title="Shopping zone"
        failure="not_found"
        retryHref="/admin/zones"
        back={back}
      />,
    );
  }

  const [zone, categories, products] = await Promise.all([
    adminRead((api, token) => api.adminZone(token, zoneId).then((response) => response.zone)),
    readCategories(),
    adminRead((api, token) =>
      api
        .adminListProducts(token, { pageSize: PICKER_LIMIT })
        .then((response) => response.products),
    ),
  ]);
  if (zone.kind === 'signed_out') redirect(signInPath(pagePath));
  if (zone.kind !== 'ok') {
    return shell(
      <PageFailure title="Shopping zone" failure={zone.kind} retryHref={pagePath} back={back} />,
    );
  }
  const categoryList = categories.kind === 'ok' ? categories.value : [];
  const productList = products.kind === 'ok' ? products.value : [];

  return shell(
    <>
      <PageToolbar
        back={back}
        title={zone.value.name}
        icon={Layers}
        eyebrow={
          zone.value.isActive ? (
            <Chip tone="success" dot><AutoText>Shown in the store</AutoText></Chip>
          ) : (
            <Chip tone="neutral" dot><AutoText>Hidden</AutoText></Chip>
          )
        }
        meta={
          <>
            <span><CountText count={zone.value.productCount} one="product" /> in this zone</span>
            <span className="font-mono text-xs">/products?zone={zone.value.slug}</span>
          </>
        }
        description="A zone is a collection beside the category tree. Pinned products belong to it no matter what their category says; every other product follows its category."
        actions={<ZoneVisibilityForm csrf={csrf} zone={zone.value} />}
      />
      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        <section
          aria-label="Zone details"
          className="nz-panel-strong nz-panel-sheen rounded-2xl border p-5 sm:p-6 lg:col-span-2"
        >
          <ZoneForm csrf={csrf} zone={zone.value} />
        </section>
        <div className="grid gap-6">
          <SectionCard
            title="Picture"
            icon={ImageIcon}
            description="The website's picture. The app has its own below."
          >
            <ZoneBannerForm zone={zone.value} csrf={csrf} />
          </SectionCard>
          <SectionCard
            title="App artwork"
            icon={Smartphone}
            description="The picture the app fills the whole collection card with. Independent of the website's picture."
          >
            <ZoneMobileBannerForm zone={zone.value} csrf={csrf} />
          </SectionCard>
          <SectionCard
            title="Delete zone"
            icon={Trash2}
            description="Only an empty zone can be deleted. To take it out of the store without deleting it, hide it above."
          >
            <DeleteZoneForm zone={zone.value} csrf={csrf} />
          </SectionCard>
        </div>
      </div>
      <SectionCard
        title="Categories it inherits"
        icon={Link2}
        description="Every product in these categories belongs to the zone unless it is pinned to another one. Nothing here touches the categories themselves."
        className="nz-panel-strong"
      >
        <ZoneCategoryPicker
          zoneId={zone.value.id}
          categories={categoryList}
          selected={zone.value.categoryIds}
          csrf={csrf}
        />
      </SectionCard>
      <SectionCard
        title="Pinned products"
        icon={Layers}
        description="These products belong to the zone whatever their category says. A product pinned to two zones appears in both."
        className="nz-panel-strong"
      >
        <ZoneProductPicker
          zoneId={zone.value.id}
          products={productList}
          selected={zone.value.productIds}
          csrf={csrf}
        />
      </SectionCard>
    </>,
    zone.value.name,
  );
}
