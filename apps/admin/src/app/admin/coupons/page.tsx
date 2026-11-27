import { adminCouponListQuerySchema } from '@nilzora/contracts';
import { buttonClasses } from '@nilzora/ui';
import { Plus, TicketPercent } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { ExportMenu } from '@/components/admin-kit/export-menu';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ReadState, ForbiddenState } from '@/components/admin-kit/states';
import {
  COUPONS_PATH,
  CouponListView,
  type CouponFilters,
} from '@/components/marketing/coupon-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { exportRange } from '@/lib/export-range';
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = { title: 'Coupons', robots: { index: false, follow: false } };

/** The filters as the API's own schema reads them; anything malformed falls back. */
function parseFilters(params: Record<string, string | string[] | undefined>): CouponFilters {
  const parsed = adminCouponListQuerySchema.safeParse(params);
  if (!parsed.success) return {};
  const { q, state } = parsed.data;
  return {
    q: q === undefined || q === '' ? undefined : q,
    state: state === 'all' ? undefined : state,
  };
}

/** Every coupon, with its live usage figures, searchable and filterable by state. */
export default async function CouponsPage({ searchParams }: PageProps<'/admin/coupons'>) {
  const gate = await workspaceGate('admin', COUPONS_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={COUPONS_PATH} />;
  }
  const { user, csrf } = gate;

  if (!user.permissions.includes('coupons.update')) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={TicketPercent} title="Coupons" />
        <section className="nz-panel rounded-2xl border">
          <ForbiddenState permission="coupons.update" />
        </section>
      </WorkspaceShell>
    );
  }

  const raw = await searchParams;
  const parsed = adminCouponListQuerySchema.safeParse(raw);
  const page = parsed.success ? parsed.data.page : 1;
  const pageSize = parsed.success ? parsed.data.pageSize : 25;
  const filters = parseFilters(raw);

  const result = await adminRead((api, token) =>
    api.adminListCoupons(token, {
      ...(filters.q === undefined ? {} : { q: filters.q }),
      ...(filters.state === undefined ? {} : { state: filters.state }),
      page,
      pageSize,
    }),
  );
  if (result.kind === 'signed_out') redirect(signInPath(COUPONS_PATH));

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={TicketPercent}
          title="Coupons"
          description="Discount codes shoppers enter at checkout. The database prices every discount inside the order, so a code can never be claimed twice or beyond its limits."
          actions={
            <>
              <ExportMenu
                kind="coupons"
                filters={{
                  ...exportRange({}),
                  // The report knows two states; the list's other states have no export filter.
                  status:
                    filters.state === 'active' || filters.state === 'inactive'
                      ? filters.state
                      : undefined,
                  q: filters.q,
                }}
              />
              {user.permissions.includes('coupons.create') ? (
                <Link
                  href="/admin/coupons/new"
                  className={buttonClasses({ size: 'sm', className: 'h-9 rounded-xl max-sm:h-11' })}
                >
                  <Plus aria-hidden="true" strokeWidth={1.75} />
                  <AutoText>New coupon</AutoText>
                </Link>
              ) : null}
            </>
          }
        />

        {result.kind === 'ok' ? (
          <CouponListView
            coupons={result.value.coupons}
            filters={filters}
            page={result.value.page}
            total={result.value.total}
            totalPages={result.value.totalPages}
            pageSize={result.value.pageSize}
          />
        ) : (
          <section className="nz-panel rounded-2xl border">
            <ReadState failure={result.kind} retryHref={COUPONS_PATH} permission="coupons.update" />
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
