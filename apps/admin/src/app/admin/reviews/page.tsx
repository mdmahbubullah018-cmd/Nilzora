import { adminReviewListQuerySchema } from '@nilzora/contracts';
import { MessageSquareQuote } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import {
  REVIEWS_PATH,
  ReviewListView,
  type ReviewFilters,
} from '@/components/catalog/review-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = { title: 'Reviews', robots: { index: false, follow: false } };

/** Customer reviews awaiting a decision, with the ones already decided. */
export default async function ReviewsPage({ searchParams }: PageProps<'/admin/reviews'>) {
  const gate = await workspaceGate('admin', REVIEWS_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={REVIEWS_PATH} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('reviews.moderate')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={MessageSquareQuote} title="Reviews" />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="reviews.moderate" />
        </section>
      </WorkspaceShell>
    );
  }

  const raw = await searchParams;
  const parsed = adminReviewListQuerySchema.safeParse(raw);
  const status = parsed.success ? parsed.data.status : 'pending';
  const page = parsed.success ? parsed.data.page : 1;
  const pageSize = parsed.success ? parsed.data.pageSize : 25;
  const q = parsed.success && parsed.data.q !== '' ? parsed.data.q : undefined;
  const filters: ReviewFilters = {
    status: status === 'all' ? undefined : status,
    q,
  };

  const result = await adminRead((api, token) =>
    api.adminListReviews(token, {
      status,
      ...(q === undefined ? {} : { q }),
      page,
      pageSize,
    }),
  );
  if (result.kind === 'signed_out') redirect(signInPath(REVIEWS_PATH));

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={MessageSquareQuote}
          title="Reviews"
          description="What customers say about products they received. Only published reviews appear on the storefront, and only buyers can write one."
        />
        {result.kind === 'ok' ? (
          <ReviewListView
            reviews={result.value.reviews}
            filters={filters}
            page={result.value.page}
            total={result.value.total}
            totalPages={result.value.totalPages}
            pageSize={result.value.pageSize}
            csrf={csrf}
          />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState
              failure={result.kind}
              retryHref={REVIEWS_PATH}
              permission="reviews.moderate"
            />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
