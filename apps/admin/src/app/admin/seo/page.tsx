import { seoOverviewQuerySchema } from '@nilzora/contracts';
import { Search } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { SEO_PATH, SeoOverviewView } from '@/components/site/seo-overview';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = { title: 'SEO', robots: { index: false, follow: false } };

interface PageParams {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** How each page's search metadata stands. No score, no ranking claim: only what is set. */
export default async function SeoPage({ searchParams }: PageParams) {
  const gate = await workspaceGate('admin', SEO_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={SEO_PATH} />;
  }
  const { user, csrf } = gate;

  // The page's own check, before any API call: never rely on the layout alone.
  if (!user.permissions.includes('products.read')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={Search} title="SEO" />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="products.read" />
        </section>
      </WorkspaceShell>
    );
  }

  const parsed = seoOverviewQuerySchema.safeParse(await searchParams);
  const query = parsed.success ? parsed.data : seoOverviewQuerySchema.parse({ q: '' });
  const result = await adminRead((api, token) => api.adminSeoOverview(token, query));
  if (result.kind === 'signed_out') redirect(signInPath(SEO_PATH));

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={Search}
          title="SEO"
          description="How each product and category page is described to search engines and when it is shared. Open a page to edit its title, description and share picture. Nothing here is required: an empty field falls back to the page’s own name and summary."
        />
        {result.kind === 'ok' ? (
          <SeoOverviewView entries={result.value.entries} q={query.q} />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState failure={result.kind} retryHref={SEO_PATH} permission="products.read" />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
