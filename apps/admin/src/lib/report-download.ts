import type { ReportKind } from '@nilzora/contracts';

/*
 * The download address of a report. A plain module (no 'use client'), because both the
 * Reports page, a Server Component, and the client-side export menu build these links:
 * a function that lives in a client module cannot be called from the server.
 */

export const REPORT_FORMATS = [
  { format: 'csv', label: 'CSV', hint: 'For spreadsheets and imports' },
  { format: 'xlsx', label: 'Excel', hint: 'Formatted workbook (.xlsx)' },
  { format: 'pdf', label: 'PDF', hint: 'Branded, printable report' },
] as const;

export type ReportFormat = (typeof REPORT_FORMATS)[number]['format'];

/** The download address for one format of a report with the given filters. */
export function reportDownloadHref(
  kind: ReportKind,
  format: ReportFormat,
  filters: Readonly<Record<string, string | undefined>>,
): string {
  const params = new URLSearchParams({ format });
  for (const [name, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(name, value);
  }
  return `/api/reports/${kind}?${params.toString()}`;
}
