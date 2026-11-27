import { Images } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { pageParam, single } from '@/components/admin-kit/href';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import { MEDIA_PAGE_SIZE, MEDIA_PATH, MediaLibraryView } from '@/components/media/media-library';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { permissionLabel } from '@/lib/identity';
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = {
  title: 'Media library',
  robots: { index: false, follow: false },
};

const TITLE = 'Media library';

/**
 * The media library. Browsing needs settings.manage or products.update (as the API's
 * list does); uploading, describing and deleting need settings.manage. The page checks
 * both itself before any API call, and the API checks every request again.
 */
export default async function MediaLibraryPage({ searchParams }: PageProps<'/admin/media'>) {
  const gate = await workspaceGate('admin', MEDIA_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={MEDIA_PATH} />;
  }
  const { user, csrf } = gate;
  const shell = (children: ReactNode) => (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <AutoText value={children} />
      </div>
    </WorkspaceShell>
  );

  const canManage = user.permissions.includes('settings.manage');
  const canBrowse = canManage || user.permissions.includes('products.update');
  if (!canBrowse) {
    return shell(
      <>
        <PageToolbar icon={Images} title={TITLE} />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState
            description={`This needs the “${permissionLabel('settings.manage')}” or the “${permissionLabel('products.update')}” permission. Ask the store owner or an admin if you need it.`}
          />
        </section>
      </>,
    );
  }

  const query = await searchParams;
  const text = single(query.q)?.trim().slice(0, 100);
  const filters = { q: text ? text : undefined };
  const page = pageParam(query.page);

  const list = await adminRead((api, token) =>
    api.adminListMedia(token, { q: filters.q, page, pageSize: MEDIA_PAGE_SIZE }),
  );
  if (list.kind === 'signed_out') redirect(signInPath(MEDIA_PATH));
  if (list.kind !== 'ok') {
    return shell(
      <>
        <PageToolbar icon={Images} title={TITLE} />
        <section className="nz-panel rounded-2xl border">
          <ReadState
            failure={list.kind}
            retryHref={MEDIA_PATH}
            resetHref={MEDIA_PATH}
            permission={canManage ? 'settings.manage' : 'products.update'}
          />
        </section>
      </>,
    );
  }

  return shell(
    <MediaLibraryView list={list.value} filters={filters} canManage={canManage} csrf={csrf} />,
  );
}
