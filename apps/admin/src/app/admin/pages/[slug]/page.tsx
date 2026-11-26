import { SITE_PAGE_SLUGS } from '@nilzora/contracts';
import { FileText } from 'lucide-react';
import type { Metadata, Route } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { isSitePageSlug, SITE_PAGE_LABELS } from '@/components/content/content-rules';
import { PAGES_PATH } from '@/components/content/site-page-paths';
import { SitePageForm } from '@/components/content/site-page-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = { title: 'Page', robots: { index: false, follow: false } };

const back = { href: PAGES_PATH, label: 'Pages' };

/** One static page: its title, text, published state and search metadata. */
export default async function SitePageEditor({ params }: PageProps<'/admin/pages/[slug]'>) {
  const { slug } = await params;
  if (!isSitePageSlug(slug)) notFound();

  const path = `/admin/pages/${slug}` as Route;
  const gate = await workspaceGate('admin', path);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={path} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('settings.manage')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={FileText} title={SITE_PAGE_LABELS[slug]} back={back} />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="settings.manage" />
        </section>
      </WorkspaceShell>
    );
  }

  const result = await adminRead((api, token) => api.adminListSitePages(token));
  if (result.kind === 'signed_out') redirect(signInPath(path));

  const page =
    result.kind === 'ok' ? result.value.pages.find((item) => item.slug === slug) : undefined;
  // A page that was never written is not in the list's data: start it from its name.
  const editable =
    page ??
    (result.kind === 'ok' && SITE_PAGE_SLUGS.includes(slug)
      ? {
          slug,
          title: SITE_PAGE_LABELS[slug],
          body: '',
          seoTitle: null,
          seoDescription: null,
          isPublished: false,
          updatedAt: null,
        }
      : undefined);

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={FileText}
          back={back}
          title={SITE_PAGE_LABELS[slug]}
          description="Plain text for customers. Save a draft to keep working; publish it when it is ready."
        />
        {editable ? (
          <SitePageForm page={editable} csrf={csrf} />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState
              failure={result.kind === 'ok' ? 'unavailable' : result.kind}
              retryHref={path}
              permission="settings.manage"
            />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
