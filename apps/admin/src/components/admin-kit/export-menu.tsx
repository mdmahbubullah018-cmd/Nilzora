'use client';

import type { ReportKind } from '@nilzora/contracts';
import { buttonClasses, cn } from '@nilzora/ui';
import { Download, FileSpreadsheet, FileText, Sheet } from 'lucide-react';
import { useRef } from 'react';
import { reportDownloadHref } from '@/lib/report-download';
import { useDetailsDismiss } from './use-details-dismiss';
import { AutoText } from '@/components/i18n/translate';

const FORMATS = [
  { format: 'csv', label: 'CSV', hint: 'For spreadsheets and imports', icon: Sheet },
  { format: 'xlsx', label: 'Excel', hint: 'Formatted workbook (.xlsx)', icon: FileSpreadsheet },
  { format: 'pdf', label: 'PDF', hint: 'Branded, printable report', icon: FileText },
] as const;

export interface ExportMenuProps {
  /** Which report the list corresponds to. */
  kind: ReportKind;
  /**
   * The list's current filters, already validated by the page (from/to are required by
   * the reports; pass the page's range or a sensible default). Empty values are dropped.
   */
  filters: Readonly<Record<string, string | undefined>>;
  className?: string;
}

/**
 * "Export" on a data table: CSV, Excel or PDF of the list with its current filters. Plain
 * download links (a native <details> menu), so it works without JavaScript; the API checks
 * the report's permission, builds the file and audits the download. A list too long to
 * download at once leads to the Reports page, where a background export can be started.
 */
export function ExportMenu({ kind, filters, className }: ExportMenuProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  const { onToggle, close } = useDetailsDismiss(ref);
  return (
    <details ref={ref} className={cn('group relative', className)} onToggle={onToggle}>
      <summary
        className={cn(
          buttonClasses({ variant: 'outline', size: 'sm' }),
          'h-9 cursor-pointer list-none rounded-xl [&::-webkit-details-marker]:hidden',
        )}
      >
        <Download aria-hidden="true" /><AutoText>Export</AutoText></summary>
      <div className="nz-glass absolute top-full right-0 z-30 mt-2 grid w-64 gap-0.5 rounded-xl border p-1.5">
        {FORMATS.map(({ format, label, hint, icon: Icon }) => (
          <a
            key={format}
            href={reportDownloadHref(kind, format, filters)}
            download
            onClick={close}
            className="flex min-h-11 items-center gap-3 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-surface-muted"
          >
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-info-soft text-info-ink ring-1 ring-info-line"
            >
              <Icon className="size-4" strokeWidth={1.75} />
            </span>
            <span className="grid leading-tight">
              <span className="text-sm font-semibold text-foreground"><AutoText value={label} /></span>
              <span className="text-xs text-muted-foreground"><AutoText value={hint} /></span>
            </span>
          </a>
        ))}
      </div>
    </details>
  );
}
