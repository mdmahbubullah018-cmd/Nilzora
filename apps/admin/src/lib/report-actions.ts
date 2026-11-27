'use server';

import {
  createExportRequestSchema,
  EXPORT_FORMATS,
  REPORT_DEFINITIONS,
  REPORT_KINDS,
  reportFilterIssues,
} from '@nilzora/contracts';
import { revalidatePath } from 'next/cache';
import { adminAct, formText, type ActionState } from '@/components/admin-kit/act';
import { oneOf } from '@/components/admin-kit/href';
import { readableReportKinds, parseReportPage } from './report-query';
import { session } from './session';

/**
 * Starts a background export (any size) for the report on screen. The filters come from
 * hidden fields the page wrote, but nothing is trusted: they are parsed again with the same
 * rules as the page, checked against what the report accepts, and the API checks the
 * account's permission for the report and writes the audit row.
 */
export async function createExportAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const kind = oneOf(formText(formData, 'kind'), REPORT_KINDS);
  const format = oneOf(formText(formData, 'format'), EXPORT_FORMATS);
  if (!kind || !format) {
    return { status: 'error', message: 'This export could not be identified. Reload the page.' };
  }

  // Re-use the page's own parsing so a hand-built form cannot smuggle in other filters.
  const user = await session.getSession();
  const allowed = user.status === 'signed_in' ? readableReportKinds(user.user.permissions) : [];
  const params: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (typeof value === 'string' && name !== 'format') params[name] = value;
  }
  const page = parseReportPage({ ...params, range: 'custom' }, allowed);
  if (!page || page.kind !== kind) {
    return { status: 'error', message: 'Your account cannot export this report.' };
  }
  // An unusable range falls back to a default when parsed; never export a different one.
  if (page.range.from !== params.from || page.range.to !== params.to) {
    return {
      status: 'error',
      message: 'Choose a range of at most 366 days that ends today at the latest.',
    };
  }
  const filters = { from: page.range.from, to: page.range.to, ...page.filters };
  if (reportFilterIssues(kind, filters).length > 0) {
    return {
      status: 'error',
      message: 'Some filters do not apply to this report. Reload the page.',
    };
  }
  const parsed = createExportRequestSchema.safeParse({ kind, format, filters });
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Choose a range of at most 366 days that ends today at the latest.',
    };
  }

  const result = await adminAct(
    formData,
    (api, token) => api.adminCreateExport(token, parsed.data),
    {
      returnTo: '/admin/reports',
      label: 'report export',
      messages: {
        forbidden: `Exporting ${REPORT_DEFINITIONS[kind].title.toLowerCase()} needs a permission your account does not have.`,
        exports_unavailable:
          'Background exports are not available right now. Smaller reports can still be downloaded directly.',
        rate_limited: 'You already have several exports waiting. Wait for one to finish.',
      },
    },
  );
  if (!result.ok) return result.state;

  revalidatePath('/admin/reports');
  return {
    status: 'success',
    message: `Your ${format.toUpperCase()} export is queued. It appears under “Your exports” when it is ready.`,
  };
}
