import { seoOverviewQuerySchema } from '@nilzora/contracts';
import { uuidSchema } from '@nilzora/validation';
import { Search } from 'lucide-react';
import type { Metadata, Route } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { SeoEditorForm } from '@/components/site/seo-editor-form';
import { SEO_PATH } from '@/components/site/seo-overview';
import { seoEditorPath } from '@/components/site/site-rules';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = {
  title: 'Search metadata',
  robots: { index: false, follow: false },
};

const back = { href: SEO_PATH, label: 'SEO' };

interface PageParams {
  params: Promise<{ kind: string; targetId: string }>;
}

/**
 * The search metadata for one product or category. Values come from the same overview the
 * list uses, so a save never clears a field the form did not show. The route takes the
 * singular kind (/admin/seo/product/:id); a plural one is not a page.
 */
export default async function SeoEditorPage({ params }: PageParams) {
  const { kind, targetId } = await params;
  if ((kind !== 'product' && kind !== 'category') || !uuidSchema.safeParse(targetId).success) {
    notFound();
  }
  const seoKind = kind === 'product' ? 'product' : 'category';

  const path = seoEditorPath(seoKind, targetId) as Route;
  const gate = await workspaceGate('admin', path);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={path} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('products.read')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Search} title="Search metadata" back={back} />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="products.read" />
        </section>
      </WorkspaceShell>
    );
  }

  const result = await adminRead((api, token) =>
    api.adminSeoOverview(token, seoOverviewQuerySchema.parse({ q: '' })),
  );
  if (result.kind === 'signed_out') redirect(signInPath(path));
  if (result.kind !== 'ok') {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Search} title="Search metadata" back={back} />
        <section className="nz-panel rounded-2xl border">
          <ReadState failure={result.kind} retryHref={path} permission="products.read" />
        </section>
      </WorkspaceShell>
    );
  }

  const entry = result.value.entries.find(
    (candidate) => candidate.kind === seoKind && candidate.id === targetId,
  );
  if (entry === undefined) notFound();

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={Search}
          back={back}
          title={entry.name}
          description={
            entry.isPublic
              ? 'This page is public and can be indexed.'
              : 'This page is not public yet, so search engines cannot reach it.'
          }
        />
        <SeoEditorForm
          entry={entry}
          canEdit={user.permissions.includes('products.update')}
          csrf={csrf}
        />
      </div>
    </WorkspaceShell>
  );
}
