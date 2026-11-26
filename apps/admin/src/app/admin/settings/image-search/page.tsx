import { Skeleton } from '@nilzora/ui';
import { ScanSearch, Search } from 'lucide-react';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { ForbiddenState } from '@/components/admin-kit/states';
import { ImageSearchView, IMAGE_SEARCH_PATH } from '@/components/image-search/image-search-view';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';

export const metadata: Metadata = {
  title: 'Image search',
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 10;

/** A non-negative offset from the query string, snapped to whole pages. */
function offsetOf(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed / PAGE_SIZE) * PAGE_SIZE;
}

function text(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? '').trim().slice(0, 120);
}

/**
 * Settings -> Image Search: the model, the threshold, the index, the pictures that cannot be
 * indexed and the anonymised search log. Every panel reads the database on this request
 * (image_search.manage).
 */
export default async function ImageSearchSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const gate = await workspaceGate('admin', IMAGE_SEARCH_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={IMAGE_SEARCH_PATH} />;
  }
  const { user, csrf } = gate;
  const params = await searchParams;
  const q = text(params.q);
  const missingOffset = offsetOf(params.missing);
  const activityOffset = offsetOf(params.activity);

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={ScanSearch}
          title="Image search"
          description="Let customers search the catalogue with a photo. Product pictures are embedded locally and indexed in PostgreSQL; this page shows what is indexed, what could not be, and how customers are using it."
        />
        {user.permissions.includes('image_search.manage') ? (
          <>
            <form
              method="get"
              action={IMAGE_SEARCH_PATH}
              className="flex flex-wrap items-end gap-2"
            >
              <label htmlFor="image-search-filter" className="sr-only">
                Filter products and searches
              </label>
              <span className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  id="image-search-filter"
                  name="q"
                  defaultValue={q}
                  placeholder="Filter by product name, SKU or image hash"
                  className="h-10 w-72 max-w-full rounded-xl border border-input-border bg-surface pr-3 pl-9 text-sm ring-inset focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-sm:h-11"
                />
              </span>
              <button
                type="submit"
                className="h-10 rounded-xl bg-surface-muted px-4 text-sm font-semibold text-foreground hover:bg-border max-sm:h-11"
              >
                Filter
              </button>
            </form>
            <Suspense fallback={<Skeleton className="h-64 rounded-2xl" />}>
              <ImageSearchView
                csrf={csrf}
                q={q}
                missingOffset={missingOffset}
                activityOffset={activityOffset}
              />
            </Suspense>
          </>
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ForbiddenState permission="image_search.manage" />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
