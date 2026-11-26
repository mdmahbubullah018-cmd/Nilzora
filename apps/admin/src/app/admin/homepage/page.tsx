import { LayoutTemplate } from 'lucide-react';
import type { Metadata, Route } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { readCategories } from '@/components/catalog/load-catalog';
import { HomepageEditor } from '@/components/content/homepage-editor';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = { title: 'Homepage', robots: { index: false, follow: false } };

const HOMEPAGE_PATH = '/admin/homepage' as Route;

/** Which sections the storefront's homepage shows, in which order, with which heading and limit. */
export default async function HomepagePage() {
  const gate = await workspaceGate('admin', HOMEPAGE_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={HOMEPAGE_PATH} />;
  }
  const { user, csrf } = gate;

  // The page's own check, before any API call: never rely on the layout alone.
  if (!user.permissions.includes('settings.manage')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={LayoutTemplate} title="Homepage" />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="settings.manage" />
        </section>
      </WorkspaceShell>
    );
  }

  const [homepage, categories, brands] = await Promise.all([
    adminRead((api, token) => api.adminGetHomepage(token)),
    readCategories(),
    adminRead((api, token) => api.adminListBrands(token).then((response) => response.brands)),
  ]);
  if (homepage.kind === 'signed_out') redirect(signInPath(HOMEPAGE_PATH));

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={LayoutTemplate}
          title="Homepage"
          description="Choose the sections visitors see, their order, their headings and how many items each shows."
        />
        {homepage.kind === 'ok' ? (
          <HomepageEditor
            sections={homepage.value.sections}
            // A list that could not be read leaves its filter as a typed slug.
            categories={
              categories.kind === 'ok'
                ? categories.value.map((category) => ({ slug: category.slug, name: category.name }))
                : null
            }
            brands={
              brands.kind === 'ok'
                ? brands.value.map((brand) => ({ slug: brand.slug, name: brand.name }))
                : null
            }
            csrf={csrf}
          />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState failure={homepage.kind} retryHref={HOMEPAGE_PATH} permission="settings.manage" />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
