'use client';

import type { ReportKind } from '@nilzora/contracts';
import { Button } from '@nilzora/ui';
import { CloudDownload } from 'lucide-react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { createExportAction } from '@/lib/report-actions';

function QueueButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" loading={pending} className="rounded-xl">
      {pending ? null : <CloudDownload aria-hidden="true" />}
      {label}
    </Button>
  );
}

export interface CreateExportFormProps {
  kind: ReportKind;
  /** The report's range and filters, as the page validated them. */
  query: Readonly<Record<string, string>>;
  csrf: CsrfInput;
  /** Offer only these formats (a very large PDF is refused by the server). */
  formats?: readonly ('csv' | 'xlsx' | 'pdf')[];
}

const LABELS = { csv: 'CSV', xlsx: 'Excel', pdf: 'PDF' } as const;

/**
 * "Create a background export": for a report too long to download at once, or whenever
 * the file should wait for you. The filters travel as hidden fields; the Server Action
 * parses them again and the API checks the permission, so nothing here is trusted.
 */
export function CreateExportForm({
  kind,
  query,
  csrf,
  formats = ['csv', 'xlsx'],
}: CreateExportFormProps) {
  const [state, action] = useActionState(createExportAction, IDLE_STATE);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {formats.map((format) => (
          <form key={format} action={action}>
            <CsrfField csrf={csrf} />
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="format" value={format} />
            {Object.entries(query).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <QueueButton label={`Queue ${LABELS[format]}`} />
          </form>
        ))}
      </div>
      <ActionFeedback state={state} />
    </div>
  );
}
