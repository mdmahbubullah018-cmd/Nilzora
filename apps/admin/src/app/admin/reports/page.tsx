import { REPORT_DEFINITIONS } from '@nilzora/contracts';
import { Card } from '@nilzora/ui';
import { FileBarChart } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { ForbiddenState, ReadState } from '@/components/admin-kit/states';
import {
  DownloadSection,
  ExportJobsSection,
  KindNav,
  REPORTS_PATH,
  ReportChart,
  ReportFilters,
  ReportSummary,
  ReportTable,
  type FilterOptions,
} from '@/components/reports/report-views';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';
import { parseReportPage, readableReportKinds, reportQueryOf } from '@/lib/report-query';
import { signInPath } from '@/lib/workspace-access';

export const metadata: Metadata = { title: 'Reports', robots: { index: false, follow: false } };

/**
 * Reports: sales, orders, products, stock, customers, coupons, COD collections, content
 * reviews and the audit log. Each report is listed only for accounts holding its own
 * permission (the API checks it again on every read and download), shows a preview with
 * a summary and chart over the chosen range, and downloads as CSV, Excel or PDF — or as a
 * background export when it is too large to download at once.
 */
export default async function ReportsPage({ searchParams }: PageProps<'/admin/reports'>) {
  const gate = await workspaceGate('admin', REPORTS_PATH);
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref={REPORTS_PATH} />;
  }
  const { user, csrf } = gate;

  const allowed = readableReportKinds(user.permissions);
  const query = parseReportPage(await searchParams, allowed);
  if (!query) {
    return (
      <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
        <PageToolbar icon={FileBarChart} title="Reports" />
        <Card className="nz-panel rounded-2xl">
          <ForbiddenState permission="finance.read" />
        </Card>
      </WorkspaceShell>
    );
  }

  const support = REPORT_DEFINITIONS[query.kind].filters;
  const [preview, exportJobs, categories, brands] = await Promise.all([
    adminRead((api, token) => api.adminReportPreview(token, query.kind, reportQueryOf(query))),
    adminRead((api, token) => api.adminListExports(token)),
    support.categoryId
      ? adminRead((api, token) => api.adminListCategories(token))
      : Promise.resolve(null),
    support.brandId ? adminRead((api, token) => api.adminListBrands(token)) : Promise.resolve(null),
  ]);
  if (preview.kind === 'signed_out' || exportJobs.kind === 'signed_out') {
    redirect(signInPath(REPORTS_PATH));
  }

  const options: FilterOptions = {
    ...(categories?.kind === 'ok'
      ? { categories: categories.value.categories.map(({ id, name }) => ({ id, name })) }
      : {}),
    ...(brands?.kind === 'ok'
      ? { brands: brands.value.brands.map(({ id, name }) => ({ id, name })) }
      : {}),
  };

  return (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      <div className="grid gap-6">
        <PageToolbar
          icon={FileBarChart}
          title="Reports"
          description={`${REPORT_DEFINITIONS[query.kind].title} · ${query.range.label}. Preview a report, then download it as CSV, Excel or PDF.`}
        />
        <div className="grid items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <KindNav kinds={allowed} current={query.kind} query={query} />
          <div className="grid min-w-0 gap-6">
            <ReportFilters query={query} options={options} />
            {preview.kind === 'ok' ? (
              <>
                <ReportSummary report={preview.value.report} kind={query.kind} />
                <ReportChart report={preview.value.report} />
                <ReportTable report={preview.value.report} />
                <DownloadSection report={preview.value.report} query={query} csrf={csrf} />
              </>
            ) : (
              <Card className="nz-panel rounded-2xl">
                {preview.kind === 'forbidden' ? (
                  <ForbiddenState permission={REPORT_DEFINITIONS[query.kind].permission} />
                ) : (
                  <ReadState failure={preview.kind} retryHref={REPORTS_PATH} />
                )}
              </Card>
            )}
            {exportJobs.kind === 'ok' ? (
              <ExportJobsSection jobs={exportJobs.value.jobs} now={new Date()} />
            ) : null}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
